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
  sendMessage: (content: string, images?: string[]) => Promise<void>;
  stopStreaming: () => Promise<void>;
  deleteMessage: (messageId: number) => Promise<void>;
  branchFromMessage: (messageId: number, title?: string) => Promise<ChatSession>;
  setSelectedModelId: (id: number | null) => Promise<void>;
  setSelectedAgentId: (id: number | null) => Promise<void>;
  clearError: () => void;
}

function appendStreamField(original: string | null, delta: string): string {
  return `${original ?? ''}${delta}`;
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
      set({ loading: false, error: e.message });
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
      set({ loading: false, error: e.message });
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

  sendMessage: async (content, images = []) => {
    const { currentSessionId, selectedModelId, messages } = get();
    if (!currentSessionId || !selectedModelId) {
      set({ error: '请先选择会话和模型' });
      return;
    }

    const normalizedContent = content.trim();
    const normalizedImages = images.map((img) => img.trim()).filter(Boolean);
    if (!normalizedContent && normalizedImages.length === 0) {
      return;
    }

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

    const donePayloadHolder: { value: StreamDonePayload | null } = { value: null };

    try {
      await chatApi.streamMessage(
        {
          sessionId: currentSessionId,
          modelId: selectedModelId,
          content: normalizedContent || undefined,
          images: normalizedImages.length > 0 ? normalizedImages : undefined,
        },
        {
          onDelta: ({ content: delta }) => {
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === tempAssistantId
                  ? { ...msg, content: appendStreamField(msg.content, delta) }
                  : msg,
              ),
            }));
          },
          onReasoning: ({ reasoning }) => {
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === tempAssistantId
                  ? {
                      ...msg,
                      reasoningContent: appendStreamField(msg.reasoningContent, reasoning),
                    }
                  : msg,
              ),
            }));
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
      const isAborted = e?.name === 'AbortError';
      if (!isAborted) {
        set({ error: e.message });
        await get().fetchMessages(currentSessionId);
      }
    } finally {
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
