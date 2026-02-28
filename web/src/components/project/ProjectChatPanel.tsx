import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { modelApi } from '../../api/model';
import { projectChatApi } from '../../api/projectChat';
import type { AiModel, ChatMessage, ChatSession, ChatToolDefinition } from '../../types';

type ToolPermissionMode = 'require_approval' | 'auto';

type ToolInvocation = {
  id: string;
  name: string;
  argumentsText: string | null;
  resultText: string | null;
};

type DisplayMessage = {
  message: ChatMessage;
  toolInvocations: ToolInvocation[];
  requiresApproval: boolean;
  approvalMessageId: number | null;
};

type ParsedToolCall = {
  id: string | null;
  name: string;
  argumentsText: string | null;
};

type ProjectChatPanelProps = {
  projectId: string;
  sessionListToggleSignal?: number;
};

const DEFAULT_TOOL_ROUNDS = 100;
const MIN_TOOL_ROUNDS = 1;
const MAX_TOOL_ROUNDS = 500;

function resolveDefaultModel(models: AiModel[]): AiModel | null {
  if (models.length === 0) {
    return null;
  }
  return models.find((item) => item.isDefault) ?? models[0];
}

function tryFormatToolJson(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed === 'string') {
      return parsed;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return normalized;
  }
}

function parseToolCalls(rawToolCalls: string | null): ParsedToolCall[] {
  if (!rawToolCalls?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawToolCalls);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const record = item as {
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const idCandidate = record.id;
        const nameCandidate = record.function?.name;
        const argumentsRaw = record.function?.arguments;
        const id =
          typeof idCandidate === 'string' && idCandidate.trim() ? idCandidate.trim() : null;
        const name =
          typeof nameCandidate === 'string' && nameCandidate.trim()
            ? nameCandidate.trim()
            : `工具${index + 1}`;
        const argumentsText =
          typeof argumentsRaw === 'string'
            ? tryFormatToolJson(argumentsRaw)
            : argumentsRaw != null
              ? tryFormatToolJson(JSON.stringify(argumentsRaw))
              : null;
        return { id, name, argumentsText };
      })
      .filter((item): item is ParsedToolCall => item != null);
  } catch {
    return [];
  }
}

function buildDisplayMessages(messages: ChatMessage[]): DisplayMessage[] {
  const result: DisplayMessage[] = [];
  let pending:
    | {
      anchorMessage: ChatMessage | null;
      invocations: ToolInvocation[];
    }
    | null = null;

  const flushPending = () => {
    if (!pending || pending.invocations.length === 0) {
      pending = null;
      return;
    }
    if (!pending.anchorMessage) {
      pending = null;
      return;
    }
    const hasPendingResult = pending.invocations.some((item) => !item.resultText);
    result.push({
      message: pending.anchorMessage,
      toolInvocations: pending.invocations,
      requiresApproval: hasPendingResult && pending.anchorMessage.id > 0,
      approvalMessageId: hasPendingResult && pending.anchorMessage.id > 0 ? pending.anchorMessage.id : null,
    });
    pending = null;
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      const parsedToolCalls = parseToolCalls(message.toolCalls);
      if (parsedToolCalls.length > 0) {
        flushPending();
        if (!pending) {
          pending = {
            anchorMessage: message,
            invocations: [],
          };
        }
        if (!pending.anchorMessage) {
          pending.anchorMessage = message;
        }
        parsedToolCalls.forEach((toolCall, index) => {
          pending?.invocations.push({
            id: toolCall.id ?? `tool-${message.id}-${index}`,
            name: toolCall.name,
            argumentsText: toolCall.argumentsText,
            resultText: null,
          });
        });
        continue;
      }

      if (pending && pending.invocations.length > 0) {
        flushPending();
      }

      result.push({
        message,
        toolInvocations: [],
        requiresApproval: false,
        approvalMessageId: null,
      });
      continue;
    }

    if (message.role === 'tool') {
      if (!pending) {
        pending = {
          anchorMessage: null,
          invocations: [],
        };
      }

      const resultText = message.content?.trim() || '(空返回)';
      const callId = message.toolCallId?.trim() || '';
      if (callId) {
        const matched = [...pending.invocations].reverse().find((item) => item.id === callId);
        if (matched) {
          matched.resultText = matched.resultText ? `${matched.resultText}\n${resultText}` : resultText;
        } else {
          pending.invocations.push({
            id: callId,
            name: '工具',
            argumentsText: null,
            resultText,
          });
        }
      } else {
        const unresolved = pending.invocations.find((item) => !item.resultText);
        if (unresolved) {
          unresolved.resultText = resultText;
        } else {
          pending.invocations.push({
            id: `tool-${message.id}`,
            name: '工具',
            argumentsText: null,
            resultText,
          });
        }
      }
      continue;
    }

    flushPending();
    result.push({
      message,
      toolInvocations: [],
      requiresApproval: false,
      approvalMessageId: null,
    });
  }

  flushPending();
  return result;
}

function isDefaultSessionTitle(title: string | null | undefined): boolean {
  const normalized = (title ?? '').trim();
  return !normalized || normalized === '新会话' || normalized === '项目会话';
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function resolveToolRounds(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TOOL_ROUNDS;
  }
  return Math.max(MIN_TOOL_ROUNDS, Math.min(MAX_TOOL_ROUNDS, Math.trunc(parsed)));
}

type StreamToolPayload = {
  type?: string;
  round?: number;
  toolCallId?: string | null;
  name?: string | null;
  arguments?: string | null;
  result?: string | null;
};

export const ProjectChatPanel: React.FC<ProjectChatPanelProps> = ({
  projectId,
  sessionListToggleSignal = 0,
}) => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [models, setModels] = useState<AiModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [tools, setTools] = useState<ChatToolDefinition[]>([]);
  const [enabledToolNames, setEnabledToolNames] = useState<string[]>([]);
  const [toolPermissionMode, setToolPermissionMode] = useState<ToolPermissionMode>('require_approval');
  const [toolRoundsInput, setToolRoundsInput] = useState(String(DEFAULT_TOOL_ROUNDS));
  const [toolApprovalPendingMessageId, setToolApprovalPendingMessageId] = useState<number | null>(null);
  const [approvingAllTools, setApprovingAllTools] = useState(false);
  const [toolApprovalStatusMap, setToolApprovalStatusMap] = useState<Record<number, 'approved' | 'rejected'>>({});
  const [autoTitleGenerating, setAutoTitleGenerating] = useState(false);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [streamingAssistantId, setStreamingAssistantId] = useState<number | null>(null);
  const [streamingToolInvocations, setStreamingToolInvocations] = useState<ToolInvocation[]>([]);
  const [streamingToolApprovalRequired, setStreamingToolApprovalRequired] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const currentSessionIdRef = useRef<number | null>(null);
  const sessionPopoverRef = useRef<HTMLDivElement>(null);
  const lastSessionListToggleSignalRef = useRef(sessionListToggleSignal);

  const currentSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );
  const displayMessages = useMemo(() => buildDisplayMessages(messages), [messages]);

  const pendingApprovalMessageIds = useMemo(
    () =>
      displayMessages
        .filter(
          (item) =>
            item.requiresApproval &&
            item.approvalMessageId != null &&
            !toolApprovalStatusMap[item.approvalMessageId],
        )
        .map((item) => item.approvalMessageId as number),
    [displayMessages, toolApprovalStatusMap],
  );
  const hasPendingToolApproval = pendingApprovalMessageIds.length > 0;

  useEffect(() => {
    if (sessionListToggleSignal === lastSessionListToggleSignalRef.current) {
      return;
    }
    lastSessionListToggleSignalRef.current = sessionListToggleSignal;
    setSessionListOpen((prev) => !prev);
  }, [sessionListToggleSignal]);

  useEffect(() => {
    if (!sessionListOpen) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      if (!sessionPopoverRef.current) {
        return;
      }
      if (sessionPopoverRef.current.contains(event.target as Node)) {
        return;
      }
      setSessionListOpen(false);
    };
    window.addEventListener('mousedown', handleOutsideClick);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [sessionListOpen]);

  const refreshMessages = useCallback(
    async (sessionId: number) => {
      setMessagesLoading(true);
      try {
        const data = await projectChatApi.getMessages(projectId, sessionId);
        setMessages(data);
        setError(null);
      } catch (refreshError: any) {
        setError(refreshError?.message ?? '加载项目聊天消息失败');
      } finally {
        setMessagesLoading(false);
      }
    },
    [projectId],
  );

  const refreshSessions = useCallback(
    async (preferredSessionId?: number | null) => {
      setLoading(true);
      try {
        let data = await projectChatApi.listSessions(projectId);
        if (data.length === 0) {
          const created = await projectChatApi.createSession(projectId, { title: '新会话' });
          data = [created];
        }
        setSessions(data);

        const nextSessionId =
          preferredSessionId && data.some((item) => item.id === preferredSessionId)
            ? preferredSessionId
            : currentSessionIdRef.current && data.some((item) => item.id === currentSessionIdRef.current)
              ? currentSessionIdRef.current
              : data[0]?.id ?? null;
        setCurrentSessionId(nextSessionId);
        if (nextSessionId != null) {
          await refreshMessages(nextSessionId);
        } else {
          setMessages([]);
        }
        setError(null);
      } catch (sessionError: any) {
        setError(sessionError?.message ?? '加载项目聊天会话失败');
        setSessions([]);
        setCurrentSessionId(null);
        setMessages([]);
      } finally {
        setLoading(false);
      }
    },
    [projectId, refreshMessages],
  );

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    let cancelled = false;
    const loadModels = async () => {
      try {
        const modelList = await modelApi.listEnabled();
        if (cancelled) {
          return;
        }
        setModels(modelList);
        const storageKey = `project.chat.model.${projectId}`;
        const savedModelRaw = window.localStorage.getItem(storageKey);
        const savedModelId = savedModelRaw ? Number(savedModelRaw) : null;
        const savedModel = savedModelId != null ? modelList.find((item) => item.id === savedModelId) ?? null : null;
        const fallback = resolveDefaultModel(modelList);
        const selected = savedModel ?? fallback;
        setSelectedModelId(selected?.id ?? null);
      } catch (modelError: any) {
        if (!cancelled) {
          setError(modelError?.message ?? '加载模型失败');
        }
      }
    };
    void loadModels();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (selectedModelId == null) {
      return;
    }
    window.localStorage.setItem(`project.chat.model.${projectId}`, String(selectedModelId));
  }, [projectId, selectedModelId]);

  useEffect(() => {
    const raw = window.localStorage.getItem(`project.chat.tool.permission.${projectId}`);
    if (raw === 'auto' || raw === 'require_approval') {
      setToolPermissionMode(raw);
    } else {
      setToolPermissionMode('require_approval');
    }
  }, [projectId]);

  useEffect(() => {
    window.localStorage.setItem(`project.chat.tool.permission.${projectId}`, toolPermissionMode);
  }, [projectId, toolPermissionMode]);

  useEffect(() => {
    const raw = window.localStorage.getItem(`project.chat.tool.rounds.${projectId}`);
    setToolRoundsInput(raw ? String(resolveToolRounds(raw)) : String(DEFAULT_TOOL_ROUNDS));
  }, [projectId]);

  useEffect(() => {
    window.localStorage.setItem(`project.chat.tool.rounds.${projectId}`, String(resolveToolRounds(toolRoundsInput)));
  }, [projectId, toolRoundsInput]);

  useEffect(() => {
    let cancelled = false;
    const loadTools = async () => {
      try {
        const data = await projectChatApi.listTools(projectId);
        if (cancelled) {
          return;
        }
        setTools(data);
        setEnabledToolNames(data.map((item) => item.name));
      } catch (toolError: any) {
        if (!cancelled) {
          setError(toolError?.message ?? '加载项目工具失败');
        }
      }
    };
    void loadTools();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    setSessions([]);
    setCurrentSessionId(null);
    currentSessionIdRef.current = null;
    setMessages([]);
    setInput('');
    setSessionListOpen(false);
    setToolApprovalStatusMap({});
    setToolApprovalPendingMessageId(null);
    setApprovingAllTools(false);
    setStreamingAssistantId(null);
    setStreamingToolInvocations([]);
    setStreamingToolApprovalRequired(false);
    let cancelled = false;
    const loadInitialSessions = async () => {
      if (cancelled) {
        return;
      }
      await refreshSessions();
    };
    void loadInitialSessions();
    return () => {
      cancelled = true;
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
  }, [projectId, refreshSessions]);

  useEffect(() => {
    if (!messageListRef.current) {
      return;
    }
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
  }, [displayMessages, messagesLoading, sending]);

  useEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = '0px';
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${nextHeight}px`;
  }, [input]);

  const handleSwitchSession = useCallback(
    async (sessionId: number) => {
      if (sending) {
        return;
      }
      setCurrentSessionId(sessionId);
      setSessionListOpen(false);
      setToolApprovalStatusMap({});
      setToolApprovalPendingMessageId(null);
      await refreshMessages(sessionId);
    },
    [refreshMessages, sending],
  );

  const handleCreateSession = useCallback(async () => {
    if (sending) {
      return;
    }
    try {
      const created = await projectChatApi.createSession(projectId, { title: '新会话' });
      setSessions((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setCurrentSessionId(created.id);
      setMessages([]);
      setSessionListOpen(false);
      setToolApprovalStatusMap({});
      setToolApprovalPendingMessageId(null);
      setError(null);
    } catch (createError: any) {
      setError(createError?.message ?? '新建会话失败');
    }
  }, [projectId, sending]);

  const handleStreamToolEvent = useCallback((payload: StreamToolPayload) => {
    const eventType = (payload.type ?? '').trim();
    if (!eventType) {
      return;
    }
    const rawId = typeof payload.toolCallId === 'string' ? payload.toolCallId.trim() : '';
    const toolId = rawId || `tool-stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const toolName =
      typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : '工具调用';
    const argumentText =
      typeof payload.arguments === 'string' && payload.arguments.trim()
        ? tryFormatToolJson(payload.arguments) ?? payload.arguments.trim()
        : null;
    const resultText =
      typeof payload.result === 'string' && payload.result.trim() ? payload.result.trim() : null;

    setStreamingToolInvocations((prev) => {
      const next = [...prev];
      const index = next.findIndex((item) => item.id === toolId);
      if (index >= 0) {
        const current = next[index];
        next[index] = {
          ...current,
          name: toolName || current.name,
          argumentsText: argumentText ?? current.argumentsText,
          resultText:
            eventType === 'result'
              ? resultText ?? current.resultText
              : current.resultText,
        };
        return next;
      }
      next.push({
        id: toolId,
        name: toolName,
        argumentsText: argumentText,
        resultText: eventType === 'result' ? resultText : null,
      });
      return next;
    });

    if (eventType === 'approval_required') {
      setStreamingToolApprovalRequired(true);
    }
  }, []);

  const handleApproveToolCall = useCallback(
    async (assistantMessageId: number, approved: boolean) => {
      if (currentSessionId == null || toolApprovalPendingMessageId != null || approvingAllTools) {
        return;
      }
      const resolvedToolRounds = resolveToolRounds(toolRoundsInput);
      const tempAssistantId = -Date.now();
      const createdAt = new Date().toISOString();
      let streamedContent = '';
      let streamedReasoning = '';

      setToolApprovalPendingMessageId(assistantMessageId);
      setError(null);
      setSending(true);
      setStreamingAssistantId(tempAssistantId);
      setStreamingToolInvocations([]);
      setStreamingToolApprovalRequired(false);
      setMessages((prev) => [
        ...prev,
        {
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
          reasoningContent: null,
          reasoningDurationMs: null,
          imageUrls: null,
          createdAt,
        },
      ]);

      const controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        await projectChatApi.approveToolCallStream(
          projectId,
          currentSessionId,
          assistantMessageId,
          approved,
          resolvedToolRounds,
          {
            onDelta: (payload) => {
              const delta = typeof payload?.content === 'string' ? payload.content : '';
              if (!delta) {
                return;
              }
              streamedContent += delta;
              setMessages((prev) =>
                prev.map((item) => (item.id === tempAssistantId ? { ...item, content: streamedContent } : item)),
              );
            },
            onReasoning: (payload) => {
              const piece = typeof payload?.reasoning === 'string' ? payload.reasoning : '';
              if (!piece) {
                return;
              }
              streamedReasoning += piece;
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === tempAssistantId
                    ? {
                      ...item,
                      reasoningContent: streamedReasoning,
                    }
                    : item,
                ),
              );
            },
            onTool: (payload) => {
              handleStreamToolEvent(payload);
            },
            onError: (payload) => {
              setError(payload.message || '处理工具授权失败');
            },
          },
          { signal: controller.signal },
        );

        setToolApprovalStatusMap((prev) => ({
          ...prev,
          [assistantMessageId]: approved ? 'approved' : 'rejected',
        }));
        await refreshMessages(currentSessionId);
        await refreshSessions(currentSessionId);
      } catch (approvalError: any) {
        if (approvalError?.name !== 'AbortError') {
          setError(approvalError?.message ?? '处理工具授权失败');
        }
        setMessages((prev) => prev.filter((item) => item.id !== tempAssistantId));
      } finally {
        streamAbortRef.current = null;
        setSending(false);
        setStreamingAssistantId(null);
        setStreamingToolInvocations([]);
        setStreamingToolApprovalRequired(false);
        setToolApprovalPendingMessageId(null);
      }
    },
    [
      approvingAllTools,
      currentSessionId,
      handleStreamToolEvent,
      projectId,
      refreshMessages,
      refreshSessions,
      selectedModelId,
      toolApprovalPendingMessageId,
      toolRoundsInput,
    ],
  );

  const handleApproveAllToolCalls = useCallback(async () => {
    if (currentSessionId == null || approvingAllTools || pendingApprovalMessageIds.length === 0) {
      return;
    }
    const resolvedToolRounds = resolveToolRounds(toolRoundsInput);
    setApprovingAllTools(true);
    setError(null);
    try {
      for (const messageId of pendingApprovalMessageIds) {
        await projectChatApi.approveToolCall(projectId, currentSessionId, messageId, true, resolvedToolRounds);
      }
      setToolApprovalStatusMap((prev) => {
        const next = { ...prev };
        pendingApprovalMessageIds.forEach((id) => {
          next[id] = 'approved';
        });
        return next;
      });
      await refreshMessages(currentSessionId);
      await refreshSessions(currentSessionId);
    } catch (approvalError: any) {
      setError(approvalError?.message ?? '处理批量工具授权失败');
    } finally {
      setApprovingAllTools(false);
    }
  }, [
    approvingAllTools,
    currentSessionId,
    pendingApprovalMessageIds,
    projectId,
    refreshMessages,
    refreshSessions,
    toolRoundsInput,
  ]);

  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || sending || currentSessionId == null || selectedModelId == null) {
      return;
    }
    if (hasPendingToolApproval) {
      setError('当前有待处理工具授权，请先允许或拒绝。');
      return;
    }

    const resolvedToolRounds = resolveToolRounds(toolRoundsInput);
    const shouldGenerateTitle =
      isDefaultSessionTitle(currentSession?.title) &&
      !messages.some((item) => item.role === 'user' && item.id > 0);

    const tempUserId = -Date.now();
    const tempAssistantId = tempUserId - 1;
    const createdAt = new Date().toISOString();
    const tempUserMessage: ChatMessage = {
      id: tempUserId,
      sessionId: currentSessionId,
      role: 'user',
      content,
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
      imageUrls: null,
      createdAt,
    };
    const tempAssistantMessage: ChatMessage = {
      ...tempUserMessage,
      id: tempAssistantId,
      role: 'assistant',
      content: '',
    };

    setInput('');
    setError(null);
    setSending(true);
    setStreamingAssistantId(tempAssistantId);
    setStreamingToolInvocations([]);
    setStreamingToolApprovalRequired(false);
    setMessages((prev) => [...prev, tempUserMessage, tempAssistantMessage]);

    const controller = new AbortController();
    streamAbortRef.current = controller;
    let streamedContent = '';
    let streamedReasoning = '';
    const sendingSessionId = currentSessionId;

    try {
      await projectChatApi.streamMessage(
        projectId,
        {
          sessionId: sendingSessionId,
          modelId: selectedModelId,
          content,
          toolPermissionMode,
          maxToolRounds: resolvedToolRounds,
          enabledToolNames: enabledToolNames.length > 0 ? enabledToolNames : null,
        },
        {
          onDelta: (payload) => {
            const delta = typeof payload?.content === 'string' ? payload.content : '';
            if (!delta) {
              return;
            }
            streamedContent += delta;
            setMessages((prev) =>
              prev.map((item) => (item.id === tempAssistantId ? { ...item, content: streamedContent } : item)),
            );
          },
          onReasoning: (payload) => {
            const piece = typeof payload?.reasoning === 'string' ? payload.reasoning : '';
            if (!piece) {
              return;
            }
            streamedReasoning += piece;
            setMessages((prev) =>
              prev.map((item) =>
                item.id === tempAssistantId
                  ? {
                    ...item,
                    reasoningContent: streamedReasoning,
                  }
                  : item,
              ),
            );
          },
          onTool: (payload) => {
            handleStreamToolEvent(payload);
          },
          onError: (payload) => {
            setError(payload.message || '项目聊天流式请求失败');
          },
        },
        { signal: controller.signal },
      );

      await refreshMessages(sendingSessionId);
      if (shouldGenerateTitle) {
        setAutoTitleGenerating(true);
        try {
          await projectChatApi.autoGenerateTitle(projectId, sendingSessionId, {
            modelId: selectedModelId,
            firstQuestion: content,
          });
        } catch {
          // 标题生成失败不影响主流程，保持回退标题。
        } finally {
          setAutoTitleGenerating(false);
        }
      }
      await refreshSessions(sendingSessionId);
    } catch (sendError: any) {
      if (sendError?.name !== 'AbortError') {
        setError(sendError?.message ?? '发送失败');
      }
      setMessages((prev) => prev.filter((item) => item.id !== tempAssistantId));
    } finally {
      setSending(false);
      setStreamingAssistantId(null);
      setStreamingToolInvocations([]);
      setStreamingToolApprovalRequired(false);
      streamAbortRef.current = null;
    }
  }, [
    currentSession?.title,
    currentSessionId,
    enabledToolNames,
    hasPendingToolApproval,
    input,
    messages,
    projectId,
    refreshMessages,
    refreshSessions,
    selectedModelId,
    sending,
    handleStreamToolEvent,
    toolPermissionMode,
    toolRoundsInput,
  ]);

  const handleStop = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    setSending(false);
    setStreamingAssistantId(null);
    setStreamingToolInvocations([]);
    setStreamingToolApprovalRequired(false);
    setToolApprovalPendingMessageId(null);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative border-b border-[rgb(209,209,209)] px-2 py-2 dark:border-[#303030]">
        <div className="flex items-center gap-1.5">
          <select
            value={selectedModelId ?? ''}
            onChange={(event) => {
              const nextId = Number(event.target.value);
              if (Number.isFinite(nextId)) {
                setSelectedModelId(nextId);
              }
            }}
            className="min-w-0 flex-1 rounded-md border border-[rgb(209,209,209)] bg-white px-2 py-1 text-xs text-[rgb(13,13,13)] dark:border-[#3a3a3a] dark:bg-[#242424] dark:text-slate-100"
          >
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void handleCreateSession();
            }}
            className="shrink-0 rounded-md border border-[rgb(209,209,209)] px-2 py-1 text-xs text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] dark:border-[#3a3a3a] dark:text-slate-100 dark:hover:bg-[#2a2a2a]"
            title="新建项目会话"
          >
            新建
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          <span>
            项目工具已启用：{enabledToolNames.length}/{tools.length}
          </span>
          <label className="inline-flex items-center gap-1">
            <span>权限</span>
            <select
              value={toolPermissionMode}
              onChange={(event) => setToolPermissionMode(event.target.value as ToolPermissionMode)}
              className="rounded border border-[rgb(209,209,209)] bg-white px-1 py-0.5 text-[11px] text-[rgb(13,13,13)] dark:border-[#3a3a3a] dark:bg-[#242424] dark:text-slate-100"
            >
              <option value="require_approval">需授权</option>
              <option value="auto">自动调用</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-1">
            <span>工具轮次上限</span>
            <input
              value={toolRoundsInput}
              onChange={(event) => {
                const nextValue = event.target.value.replace(/[^\d]/g, '');
                setToolRoundsInput(nextValue || String(DEFAULT_TOOL_ROUNDS));
              }}
              className="w-14 rounded border border-[rgb(209,209,209)] bg-white px-1 py-0.5 text-right text-[11px] text-[rgb(13,13,13)] outline-none dark:border-[#3a3a3a] dark:bg-[#242424] dark:text-slate-100"
              title="单次消息工具调用最大轮次（默认 100）"
            />
          </label>
          {autoTitleGenerating && <span>正在生成标题...</span>}
        </div>

        {sessionListOpen && (
          <div
            ref={sessionPopoverRef}
            className="absolute right-2 top-[70px] z-30 w-[280px] rounded-lg border border-[rgb(209,209,209)] bg-white p-1 shadow-xl dark:border-[#3a3a3a] dark:bg-[#1f1f1f]"
          >
            <div className="px-1.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">会话列表</div>
            <div className="max-h-64 overflow-y-auto">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    void handleSwitchSession(session.id);
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors ${
                    currentSessionId === session.id
                      ? 'bg-[rgb(234,234,234)] text-[rgb(13,13,13)] dark:bg-[#2f2f2f] dark:text-slate-100'
                      : 'text-slate-600 hover:bg-[rgb(239,239,239)] dark:text-slate-300 dark:hover:bg-[#2a2a2a]'
                  }`}
                  title={session.title}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{session.title || `会话 ${session.id}`}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-400 dark:text-slate-500">
                      {formatSessionTime(session.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {loading || messagesLoading ? (
          <p className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">加载中...</p>
        ) : displayMessages.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400 dark:text-slate-500">输入需求开始项目聊天</p>
        ) : (
          <div className="space-y-3">
            {displayMessages.map((item) => {
              const { message, toolInvocations, requiresApproval, approvalMessageId } = item;
              const isUser = message.role === 'user';
              const isStreamingAssistant = sending && message.id === streamingAssistantId;
              const effectiveToolInvocations =
                toolInvocations.length > 0
                  ? toolInvocations
                  : isStreamingAssistant
                    ? streamingToolInvocations
                    : [];
              const effectiveRequiresApproval =
                requiresApproval || (isStreamingAssistant && streamingToolApprovalRequired);
              const approvalStatus = approvalMessageId != null ? toolApprovalStatusMap[approvalMessageId] ?? null : null;
              const waitingApproval = toolApprovalPendingMessageId === approvalMessageId || approvingAllTools;
              const hasAssistantText = Boolean(message.content?.trim() || message.reasoningContent?.trim());
              const hideEmptyAssistantBubble =
                !isUser &&
                !hasAssistantText &&
                effectiveToolInvocations.length > 0 &&
                !(sending && isStreamingAssistant);
              return (
                <div key={`project-chat-message-${message.id}`} className="space-y-2">
                  {!hideEmptyAssistantBubble && (
                    <div
                      className={`rounded-xl px-3 py-2 text-sm ${
                        isUser
                          ? 'ml-8 bg-[rgb(236,236,236)] text-[rgb(13,13,13)] dark:bg-[#2f2f2f] dark:text-slate-100'
                          : 'mr-8 bg-[rgb(249,249,249)] text-[rgb(13,13,13)] dark:bg-[#262626] dark:text-slate-100'
                      }`}
                    >
                      {message.reasoningContent?.trim() && (
                        <details className="mb-2 rounded-lg border border-[rgb(209,209,209)] bg-white/60 px-2 py-1 text-xs dark:border-[#3a3a3a] dark:bg-[#1f1f1f]">
                          <summary className="cursor-pointer select-none text-slate-500 dark:text-slate-400">推理过程</summary>
                          <div className="mt-1 whitespace-pre-wrap break-words">{message.reasoningContent}</div>
                        </details>
                      )}
                      {message.content?.trim() ? (
                        <div className="chat-markdown">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : sending && !isUser ? (
                        <div className="flex h-6 items-center">
                          <span className="chat-loading-dot" aria-label="加载中" />
                        </div>
                      ) : (
                        <p className="text-slate-400 dark:text-slate-500">(空消息)</p>
                      )}
                    </div>
                  )}

                  {effectiveToolInvocations.length > 0 && (
                    <details
                      open={approvalStatus == null && effectiveRequiresApproval}
                      className="mr-8 rounded-xl border border-[rgb(209,209,209)] bg-[rgb(249,249,249)] px-2 py-2 dark:border-[#3a3a3a] dark:bg-[#252525]"
                    >
                      <summary className="cursor-pointer select-none text-xs font-medium text-slate-500 dark:text-slate-400">
                        工具调用 {effectiveToolInvocations.length} 次
                        {approvalStatus === 'approved' && (
                          <span className="ml-2 text-emerald-600 dark:text-emerald-400">已允许</span>
                        )}
                        {approvalStatus === 'rejected' && (
                          <span className="ml-2 text-rose-600 dark:text-rose-400">已拒绝</span>
                        )}
                        {approvalStatus == null && isStreamingAssistant && streamingToolApprovalRequired && (
                          <span className="ml-2 text-amber-600 dark:text-amber-400">等待授权</span>
                        )}
                      </summary>
                      <div className="mt-1.5 space-y-1.5">
                        {effectiveToolInvocations.map((invocation) => (
                          <div key={invocation.id} className="rounded-lg bg-white/60 px-2 py-1.5 dark:bg-[#1e1e1e]">
                            <p className="text-xs font-semibold text-[rgb(13,13,13)] dark:text-slate-100">{invocation.name}</p>
                            {invocation.argumentsText && (
                              <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-600 dark:text-slate-300">
                                参数: {invocation.argumentsText}
                              </pre>
                            )}
                            {invocation.resultText && (
                              <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-600 dark:text-slate-300">
                                结果: {invocation.resultText}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>

                      {effectiveRequiresApproval && approvalMessageId == null && (
                        <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
                          正在生成授权卡片，请稍候...
                        </div>
                      )}

                      {effectiveRequiresApproval && approvalMessageId != null && approvalStatus == null && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={waitingApproval}
                            onClick={() => {
                              void handleApproveToolCall(approvalMessageId, true);
                            }}
                            className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200"
                          >
                            {waitingApproval ? '处理中...' : '允许'}
                          </button>
                          <button
                            type="button"
                            disabled={waitingApproval || pendingApprovalMessageIds.length <= 1}
                            onClick={() => {
                              void handleApproveAllToolCalls();
                            }}
                            className="rounded-md border border-sky-300 bg-sky-50 px-2 py-1 text-[11px] text-sky-700 transition-colors hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-700 dark:bg-sky-900/20 dark:text-sky-200"
                          >
                            {approvingAllTools ? '处理中...' : '同意全部'}
                          </button>
                          <button
                            type="button"
                            disabled={waitingApproval}
                            onClick={() => {
                              void handleApproveToolCall(approvalMessageId, false);
                            }}
                            className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-200"
                          >
                            {waitingApproval ? '处理中...' : '拒绝'}
                          </button>
                        </div>
                      )}
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t border-[rgb(209,209,209)] p-2 dark:border-[#303030]">
        {error && (
          <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
            {error}
          </p>
        )}
        {hasPendingToolApproval && (
          <div className="mb-2 flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
            <span>当前有待处理工具授权，请先允许或拒绝。</span>
            <button
              type="button"
              disabled={approvingAllTools}
              onClick={() => {
                void handleApproveAllToolCalls();
              }}
              className="rounded border border-amber-400 px-1.5 py-0.5 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-600 dark:hover:bg-amber-900/40"
            >
              {approvingAllTools ? '处理中...' : '同意全部'}
            </button>
          </div>
        )}
        <div className="rounded-xl border border-[rgb(209,209,209)] bg-white px-2 py-2 dark:border-[#3a3a3a] dark:bg-[#202020]">
          <textarea
            ref={textAreaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
              if (nativeEvent.isComposing || nativeEvent.keyCode === 229) {
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder="在项目内提问，支持工具调用（Enter 发送）"
            className="max-h-40 min-h-[22px] w-full resize-none bg-transparent text-sm text-[rgb(13,13,13)] outline-none placeholder:text-[rgb(143,143,143)] dark:text-slate-100"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5">
            {sending ? (
              <button
                type="button"
                onClick={handleStop}
                className="rounded-lg border border-[rgb(209,209,209)] px-2 py-1 text-xs text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] dark:border-[#3a3a3a] dark:text-slate-100 dark:hover:bg-[#2a2a2a]"
              >
                停止
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void handleSend();
                }}
                disabled={!input.trim() || selectedModelId == null || currentSessionId == null || hasPendingToolApproval}
                title={hasPendingToolApproval ? '请先处理待确认工具调用' : '发送'}
                className="rounded-lg bg-[rgb(13,13,13)] px-3 py-1 text-xs text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-100 dark:text-black dark:hover:bg-white"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectChatPanel;
