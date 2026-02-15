import { create } from 'zustand';
import { chatApi } from '../api/chat';
import type {
  ChatMessage,
  ChatSession,
  ChatSessionCreateRequest,
  StreamDonePayload,
} from '../types';

interface ChatState {
  sessions: ChatSession[];
  currentSessionId: number | null;
  currentSession: ChatSession | null;
  messages: ChatMessage[];
  selectedModelId: number | null;
  streaming: boolean;
  loading: boolean;
  error: string | null;

  fetchSessions: () => Promise<void>;
  createSession: (payload?: ChatSessionCreateRequest) => Promise<ChatSession>;
  startDraftSession: () => void;
  deleteSession: (id: number) => Promise<void>;
  copySession: (id: number, title?: string) => Promise<ChatSession>;
  renameSession: (id: number, title: string) => Promise<void>;
  selectSession: (id: number) => Promise<void>;
  fetchMessages: (sessionId: number) => Promise<void>;
  sendMessage: (
    content: string,
    images?: string[],
    options?: { maxTokens?: number | null; temperature?: number | null },
  ) => Promise<void>;
  stopStreaming: () => Promise<void>;
  deleteMessage: (messageId: number) => Promise<void>;
  branchFromMessage: (messageId: number, title?: string) => Promise<ChatSession>;
  setSelectedModelId: (id: number | null) => Promise<void>;
  setSelectedAgentId: (id: number | null) => Promise<void>;
  clearError: () => void;
}

const STREAM_RENDER_INTERVAL_MS = 32;
const STREAM_RENDER_MIN_CHARS = 2;
const STREAM_RENDER_MAX_CHARS = 48;
const DEFAULT_SESSION_TITLE = '新会话';

function appendStreamField(original: string | null, delta: string): string {
  return `${original ?? ''}${delta}`;
}

function resolveStreamStepSize(queueLength: number): number {
  if (queueLength <= 0) {
    return 0;
  }
  // 队列越长，单帧吐字越多，避免大段积压后明显延迟。
  const dynamicStep = Math.ceil(queueLength / 24);
  return Math.min(STREAM_RENDER_MAX_CHARS, Math.max(STREAM_RENDER_MIN_CHARS, dynamicStep));
}

function isDefaultSessionTitle(title: string | null | undefined): boolean {
  if (!title) {
    return true;
  }
  return title.trim() === '' || title.trim() === DEFAULT_SESSION_TITLE;
}

let activeStreamAbortController: AbortController | null = null;

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  currentSession: null,
  messages: [],
  selectedModelId: null,
  streaming: false,
  loading: false,
  error: null,

  fetchSessions: async () => {
    set({ loading: true, error: null });
    try {
      const sessions = await chatApi.listSessions();
      set({ sessions, loading: false });

      const { currentSessionId } = get();
      if (currentSessionId != null) {
        const current = sessions.find((session) => session.id === currentSessionId) ?? null;
        if (!current) {
          set({ currentSessionId: null, currentSession: null, messages: [], selectedModelId: null });
        }
      }
    } catch (e: any) {
      set({
        loading: false,
        error: e.message,
        currentSessionId: null,
        currentSession: null,
        messages: [],
        selectedModelId: null,
      });
    }
  },

  createSession: async (payload) => {
    const created = await chatApi.createSession(payload);
    await get().fetchSessions();
    set({
      currentSessionId: created.id,
      currentSession: created,
      messages: [],
      selectedModelId: created.modelId,
    });
    return created;
  },

  startDraftSession: () => {
    set((state) => ({
      currentSessionId: null,
      currentSession: null,
      messages: [],
      error: null,
      // 保留当前模型选择，避免新建草稿时丢失用户偏好。
      selectedModelId: state.selectedModelId,
    }));
  },

  deleteSession: async (id) => {
    await chatApi.deleteSession(id);
    const { currentSessionId } = get();
    if (currentSessionId === id) {
      set({ currentSessionId: null, currentSession: null, messages: [], selectedModelId: null });
    }
    await get().fetchSessions();
  },

  copySession: async (id, title) => {
    const copied = await chatApi.copySession(id, title);
    await get().fetchSessions();
    await get().selectSession(copied.id);
    return copied;
  },

  renameSession: async (id, title) => {
    await chatApi.updateSession(id, { title });
    await get().fetchSessions();

    if (get().currentSessionId === id) {
      const updated = await chatApi.getSession(id);
      set({ currentSession: updated });
    }
  },

  selectSession: async (id) => {
    set({ currentSessionId: id, loading: true, error: null });
    try {
      const [session, messages] = await Promise.all([
        chatApi.getSession(id),
        chatApi.getMessages(id),
      ]);

      // 优先使用该会话“最后一条带模型 ID 的消息”作为当前选择模型。
      const lastMessageModelId =
        [...messages]
          .reverse()
          .find((message) => message.modelId != null)?.modelId ?? null;
      set({
        currentSession: session,
        messages,
        selectedModelId: lastMessageModelId ?? session.modelId,
        loading: false,
      });
    } catch (e: any) {
      set({
        loading: false,
        error: e.message,
        currentSessionId: null,
        currentSession: null,
        messages: [],
        selectedModelId: null,
      });
    }
  },

  fetchMessages: async (sessionId) => {
    try {
      const messages = await chatApi.getMessages(sessionId);
      set({ messages });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  sendMessage: async (content, images = [], options) => {
    const { currentSessionId, selectedModelId, messages, currentSession } = get();
    if (!currentSessionId || !selectedModelId) {
      set({ error: '请先选择会话和模型' });
      return;
    }

    const normalizedContent = content.trim();
    const normalizedImages = images.map((img) => img.trim()).filter(Boolean);
    if (!normalizedContent && normalizedImages.length === 0) {
      return;
    }

    const persistedUserMessageCount = messages.filter(
      (item) => item.id > 0 && item.role === 'user',
    ).length;
    const shouldAutoGenerateTitle =
      persistedUserMessageCount === 0 && isDefaultSessionTitle(currentSession?.title);

    const tempUserId = -Date.now();
    const tempAssistantId = tempUserId - 1;
    const now = new Date().toISOString();

    const optimisticUser: ChatMessage = {
      id: tempUserId,
      sessionId: currentSessionId,
      role: 'user',
      content: normalizedContent || null,
      toolCalls: null,
      toolCallId: null,
      tokenUsage: null,
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costUsd: null,
      modelId: selectedModelId,
      modelName: null,
      agentId: null,
      agentName: null,
      agentAvatarType: null,
      agentAvatarValue: null,
      reasoningContent: null,
      reasoningDurationMs: null,
      imageUrls: normalizedImages.length > 0 ? JSON.stringify(normalizedImages) : null,
      createdAt: now,
    };

    const optimisticAssistant: ChatMessage = {
      id: tempAssistantId,
      sessionId: currentSessionId,
      role: 'assistant',
      content: '',
      toolCalls: null,
      toolCallId: null,
      tokenUsage: null,
      promptTokens: null,
      completionTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costUsd: null,
      modelId: selectedModelId,
      modelName: null,
      agentId: null,
      agentName: null,
      agentAvatarType: null,
      agentAvatarValue: null,
      reasoningContent: '',
      reasoningDurationMs: null,
      imageUrls: null,
      createdAt: now,
    };

    set({
      streaming: true,
      error: null,
      messages: [...messages, optimisticUser, optimisticAssistant],
    });
    activeStreamAbortController = new AbortController();

    if (shouldAutoGenerateTitle) {
      // 标题生成独立调用后端，不阻塞首轮对话，也不影响主链路的成功/失败。
      void chatApi.autoGenerateTitle(currentSessionId, {
        modelId: selectedModelId,
        firstQuestion: normalizedContent || undefined,
      }).then((updatedSession) => {
        set((state) => {
          const nextTitle = updatedSession.title?.trim() ?? '';
          const localCurrentTitle = state.currentSession?.title?.trim() ?? '';
          // 防止并发回包把已有有效标题回退成“新会话”。
          if (isDefaultSessionTitle(nextTitle) && !isDefaultSessionTitle(localCurrentTitle)) {
            return state;
          }
          return {
            currentSession:
              state.currentSessionId === currentSessionId && state.currentSession
                ? { ...state.currentSession, title: updatedSession.title }
                : state.currentSession,
            sessions: state.sessions.map((item) =>
              item.id === currentSessionId ? { ...item, title: updatedSession.title } : item,
            ),
          };
        });
      }).catch(() => {
        // 自动标题失败时静默降级，保持聊天流程无感知。
      });
    }

    const donePayloadHolder: { value: StreamDonePayload | null } = { value: null };
    const streamQueue = {
      content: '',
      reasoning: '',
    };
    let streamFlushTimer: ReturnType<typeof setInterval> | null = null;
    let streamClosed = false;
    let resolveQueueDrain: (() => void) | null = null;

    const clearStreamFlushTimer = () => {
      if (streamFlushTimer == null) {
        return;
      }
      clearInterval(streamFlushTimer);
      streamFlushTimer = null;
    };

    const tryResolveQueueDrain = () => {
      if (!streamClosed) {
        return;
      }
      if (streamQueue.content.length > 0 || streamQueue.reasoning.length > 0) {
        return;
      }
      clearStreamFlushTimer();
      if (resolveQueueDrain) {
        resolveQueueDrain();
        resolveQueueDrain = null;
      }
    };

    const flushStreamQueue = () => {
      const contentStep = resolveStreamStepSize(streamQueue.content.length);
      const reasoningStep = resolveStreamStepSize(streamQueue.reasoning.length);
      const contentDelta = contentStep > 0 ? streamQueue.content.slice(0, contentStep) : '';
      const reasoningDelta = reasoningStep > 0 ? streamQueue.reasoning.slice(0, reasoningStep) : '';

      if (contentDelta) {
        streamQueue.content = streamQueue.content.slice(contentDelta.length);
      }
      if (reasoningDelta) {
        streamQueue.reasoning = streamQueue.reasoning.slice(reasoningDelta.length);
      }

      if (!contentDelta && !reasoningDelta) {
        tryResolveQueueDrain();
        return;
      }

      set((state) => ({
        messages: state.messages.map((msg) => {
          if (msg.id !== tempAssistantId) {
            return msg;
          }

          const nextContent = contentDelta ? appendStreamField(msg.content, contentDelta) : msg.content;
          const nextReasoning = reasoningDelta ? appendStreamField(msg.reasoningContent, reasoningDelta) : msg.reasoningContent;

          if (nextContent === msg.content && nextReasoning === msg.reasoningContent) {
            return msg;
          }

          return {
            ...msg,
            content: nextContent,
            reasoningContent: nextReasoning,
          };
        }),
      }));

      tryResolveQueueDrain();
    };

    const ensureStreamFlushTimer = () => {
      if (streamFlushTimer != null) {
        return;
      }
      // 以稳定帧率小步刷新，避免后端 chunk 边界导致“整段跳字”。
      streamFlushTimer = setInterval(() => {
        flushStreamQueue();
      }, STREAM_RENDER_INTERVAL_MS);
    };

    const waitForStreamQueueDrain = async () => {
      if (streamQueue.content.length === 0 && streamQueue.reasoning.length === 0) {
        clearStreamFlushTimer();
        return;
      }
      await new Promise<void>((resolve) => {
        resolveQueueDrain = resolve;
      });
    };

    try {
      await chatApi.streamMessage(
        {
          sessionId: currentSessionId,
          modelId: selectedModelId,
          content: normalizedContent || undefined,
          images: normalizedImages.length > 0 ? normalizedImages : undefined,
          maxTokens: options?.maxTokens != null ? options.maxTokens : undefined,
          temperature: options?.temperature != null ? options.temperature : undefined,
        },
        {
          onDelta: ({ content: delta }) => {
            if (!delta) {
              return;
            }
            streamQueue.content += delta;
            ensureStreamFlushTimer();
          },
          onReasoning: ({ reasoning }) => {
            if (!reasoning) {
              return;
            }
            streamQueue.reasoning += reasoning;
            ensureStreamFlushTimer();
          },
          onDone: (payload) => {
            donePayloadHolder.value = payload;
          },
          onError: (payload) => {
            set({ error: payload.message || '流式响应发生异常' });
          },
        },
        { signal: activeStreamAbortController.signal },
      );
      streamClosed = true;
      flushStreamQueue();
      await waitForStreamQueueDrain();

      const [session, latestMessages] = await Promise.all([
        chatApi.getSession(currentSessionId),
        chatApi.getMessages(currentSessionId),
      ]);

      const sessions = await chatApi.listSessions();
      set({
        sessions,
        currentSession: session,
        messages: latestMessages,
        selectedModelId: session.modelId,
      });

      if (donePayloadHolder.value?.title && session.title !== donePayloadHolder.value.title) {
        set((state) => ({
          currentSession: state.currentSession ? { ...state.currentSession, title: donePayloadHolder.value!.title } : state.currentSession,
          sessions: state.sessions.map((item) =>
            item.id === currentSessionId ? { ...item, title: donePayloadHolder.value!.title } : item,
          ),
        }));
      }
    } catch (e: any) {
      streamClosed = true;
      flushStreamQueue();
      clearStreamFlushTimer();
      const isAborted = e?.name === 'AbortError';
      if (!isAborted) {
        set({ error: e.message });
        await get().fetchMessages(currentSessionId);
      }
    } finally {
      streamClosed = true;
      clearStreamFlushTimer();
      activeStreamAbortController = null;
      set({ streaming: false });
    }
  },

  stopStreaming: async () => {
    const { currentSessionId, streaming } = get();
    if (!streaming || !activeStreamAbortController) {
      return;
    }

    activeStreamAbortController.abort();
    activeStreamAbortController = null;
    set({ streaming: false });

    if (!currentSessionId) {
      return;
    }

    try {
      const [session, latestMessages, sessions] = await Promise.all([
        chatApi.getSession(currentSessionId),
        chatApi.getMessages(currentSessionId),
        chatApi.listSessions(),
      ]);
      set({
        currentSession: session,
        selectedModelId: session.modelId,
        messages: latestMessages,
        sessions,
      });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  deleteMessage: async (messageId) => {
    const { currentSessionId } = get();
    if (!currentSessionId) {
      return;
    }

    await chatApi.deleteMessage(currentSessionId, messageId);
    const [session, messages, sessions] = await Promise.all([
      chatApi.getSession(currentSessionId),
      chatApi.getMessages(currentSessionId),
      chatApi.listSessions(),
    ]);

    set({
      currentSession: session,
      selectedModelId: session.modelId,
      messages,
      sessions,
    });
  },

  branchFromMessage: async (messageId, title) => {
    const { currentSessionId } = get();
    if (!currentSessionId) {
      throw new Error('请先选择会话');
    }

    const branchSession = await chatApi.branchSession(currentSessionId, messageId, title);
    await get().fetchSessions();
    await get().selectSession(branchSession.id);
    return branchSession;
  },

  setSelectedModelId: async (id) => {
    set({ selectedModelId: id });
    const { currentSessionId } = get();
    if (!currentSessionId || id == null) {
      return;
    }

    try {
      await chatApi.updateSession(currentSessionId, { modelId: id });
      const updatedSession = await chatApi.getSession(currentSessionId);
      set((state) => ({
        currentSession: updatedSession,
        sessions: state.sessions.map((item) =>
          item.id === currentSessionId ? updatedSession : item,
        ),
      }));
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  setSelectedAgentId: async (id) => {
    const { currentSessionId } = get();
    if (!currentSessionId) {
      return;
    }

    try {
      await chatApi.updateSession(currentSessionId, { agentId: id ?? 0 });
      const updatedSession = await chatApi.getSession(currentSessionId);
      const sessions = await chatApi.listSessions();
      set({ currentSession: updatedSession, sessions });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  clearError: () => set({ error: null }),
}));
