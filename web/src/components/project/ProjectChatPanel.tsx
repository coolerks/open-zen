import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { modelApi } from '../../api/model';
import { projectChatApi } from '../../api/projectChat';
import type { AiModel, ChatMessage, ChatSession, ChatToolDefinition } from '../../types';
import { Plus, Settings, Send, Square, ChevronDown, ChevronRight, MessageSquare, Check, X, Loader2, List, MoreHorizontal, Wrench } from 'lucide-react';


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

function ToolInvocationCard({ invocation }: { invocation: ToolInvocation }) {
  const [expanded, setExpanded] = useState(true);
  const isDone = Boolean(invocation.resultText);

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-[rgb(229,229,229)] dark:border-[#333333] bg-[rgb(249,249,249)] dark:bg-[#1a1a1a]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 hover:bg-[rgb(239,239,239)] dark:hover:bg-[#222222] transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        )}
        <Wrench className="h-3.5 w-3.5 text-slate-400 shrink-0" />
        <span className="flex-1 truncate text-left text-xs font-medium text-[rgb(13,13,13)] dark:text-slate-300">
          {invocation.name}
        </span>
        {isDone ? (
          <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-[rgb(229,229,229)] dark:border-[#333333] bg-white dark:bg-[#141414] p-3">
          {invocation.argumentsText && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Arguments
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgb(249,249,249)] dark:bg-[#1a1a1a] p-2 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                {invocation.argumentsText}
              </pre>
            </div>
          )}
          {invocation.resultText && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Result
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[rgb(249,249,249)] dark:bg-[#1a1a1a] p-2 text-[11px] font-mono text-slate-700 dark:text-slate-300">
                {invocation.resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsPopover({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`rounded-md p-1.5 transition-colors ${open ? 'bg-[rgb(239,239,239)] dark:bg-[#2a2a2a] text-[rgb(13,13,13)] dark:text-slate-100' : 'text-slate-500 hover:bg-[rgb(239,239,239)] dark:hover:bg-[#2a2a2a] hover:text-[rgb(13,13,13)] dark:hover:text-slate-100'}`}
        title="工具设置"
      >
        <Settings className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 w-64 rounded-xl border border-[rgb(209,209,209)] bg-white p-3 shadow-xl dark:border-[#3a3a3a] dark:bg-[#1f1f1f]">
          <div className="mb-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
            工具设置
          </div>
          <div className="flex flex-col gap-3">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const autoScrollRef = useRef(true);
  const scrollRafRef = useRef<number | null>(null);
  const pendingForceScrollRef = useRef(false);

  const currentSession = useMemo(
    () => sessions.find((item) => item.id === currentSessionId) ?? null,
    [currentSessionId, sessions],
  );

  const handleToolPermissionModeChange = useCallback(
    (nextMode: ToolPermissionMode) => {
      setToolPermissionMode(nextMode);
      window.localStorage.setItem(`project.chat.tool.permission.${projectId}`, nextMode);
    },
    [projectId],
  );

  const handleToolRoundsChange = useCallback(
    (rawValue: string) => {
      const sanitizedValue = rawValue.replace(/[^\d]/g, '');
      const normalizedValue = String(resolveToolRounds(sanitizedValue || String(DEFAULT_TOOL_ROUNDS)));
      setToolRoundsInput(normalizedValue);
      window.localStorage.setItem(`project.chat.tool.rounds.${projectId}`, normalizedValue);
    },
    [projectId],
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

  const scrollToBottomIfNeeded = useCallback((force: boolean = false) => {
    if (!force && !autoScrollRef.current) {
      return;
    }
    if (force) {
      pendingForceScrollRef.current = true;
    }
    if (scrollRafRef.current != null) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      const container = messageListRef.current;
      const forceNow = pendingForceScrollRef.current;
      pendingForceScrollRef.current = false;
      if (!container) {
        scrollRafRef.current = null;
        return;
      }
      if (forceNow || autoScrollRef.current) {
        container.scrollTop = container.scrollHeight;
      }
      scrollRafRef.current = null;
    });
  }, []);

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
    const raw = window.localStorage.getItem(`project.chat.tool.rounds.${projectId}`);
    setToolRoundsInput(raw ? String(resolveToolRounds(raw)) : String(DEFAULT_TOOL_ROUNDS));
  }, [projectId]);

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
    autoScrollRef.current = true;
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
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      pendingForceScrollRef.current = false;
      if (streamAbortRef.current) {
        streamAbortRef.current.abort();
        streamAbortRef.current = null;
      }
    };
  }, [projectId, refreshSessions]);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) {
      return;
    }
    const updateAutoScrollState = () => {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      autoScrollRef.current = distanceToBottom <= 24;
    };
    updateAutoScrollState();
    container.addEventListener('scroll', updateAutoScrollState, { passive: true });
    return () => {
      container.removeEventListener('scroll', updateAutoScrollState);
    };
  }, []);

  useEffect(() => {
    scrollToBottomIfNeeded(false);
  }, [
    displayMessages,
    messagesLoading,
    sending,
    streamingToolApprovalRequired,
    streamingToolInvocations,
    scrollToBottomIfNeeded,
  ]);

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
      autoScrollRef.current = true;
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
    // 如果当前会话没有发送过任何消息，不创建新会话，直接复用当前空会话
    if (currentSessionId != null && messages.length === 0) {
      setSessionListOpen(false);
      return;
    }
    try {
      autoScrollRef.current = true;
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
  }, [projectId, sending, currentSessionId, messages.length]);

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
          await refreshMessages(currentSessionId);
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
      await refreshMessages(currentSessionId);
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
        // 流中断时后端可能已保存了部分消息（如工具调用结果），刷新以展示真实状态。
        await refreshMessages(sendingSessionId);
      }
      setMessages((prev) => prev.filter((item) => item.id !== tempAssistantId && item.id !== tempUserId));
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
    <div className="flex h-full min-h-0 flex-col bg-[rgb(249,249,249)] dark:bg-[#1e1e1e]">
      {/* 1. Header Area */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[rgb(13,13,13)] dark:text-slate-100 truncate">
            {currentSession?.title || '项目聊天'}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSessionListOpen(prev => !prev)}
            className={`rounded-md p-1.5 transition-colors ${
              sessionListOpen
                ? 'bg-[rgb(239,239,239)] text-[rgb(13,13,13)] dark:bg-[#2a2a2a] dark:text-slate-100'
                : 'text-slate-500 hover:bg-[rgb(239,239,239)] hover:text-[rgb(13,13,13)] dark:hover:bg-[#2a2a2a] dark:hover:text-slate-100'
            }`}
            title="历史会话"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <SettingsPopover>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">工具权限模式</label>
                <select
                  value={toolPermissionMode}
                  onChange={(event) => handleToolPermissionModeChange(event.target.value as ToolPermissionMode)}
                  className="w-full rounded-md border border-[rgb(209,209,209)] bg-[rgb(249,249,249)] px-2 py-1.5 text-xs text-[rgb(13,13,13)] outline-none dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-slate-100"
                >
                  <option value="require_approval">需授权 (Require Approval)</option>
                  <option value="auto">自动调用 (Auto)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-slate-500">
                  工具轮次上限 (默认 100)
                </label>
                <input
                  value={toolRoundsInput}
                  onChange={(event) => handleToolRoundsChange(event.target.value)}
                  className="w-full rounded-md border border-[rgb(209,209,209)] bg-[rgb(249,249,249)] px-2 py-1.5 text-xs text-[rgb(13,13,13)] outline-none dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-slate-100"
                />
              </div>
              <div className="text-[10px] text-slate-500">
                已启用工具: {enabledToolNames.length} / {tools.length}
              </div>
            </div>
          </SettingsPopover>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            className="rounded-md p-1.5 text-slate-500 hover:bg-[rgb(239,239,239)] hover:text-[rgb(13,13,13)] transition-colors dark:hover:bg-[#2a2a2a] dark:hover:text-slate-100"
            title="新建会话"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>


      

      {/* Session List Popover */}
      {sessionListOpen && (
        <div
          ref={sessionPopoverRef}
          className="absolute right-2 top-10 z-30 w-64 rounded-xl border border-[rgb(209,209,209)] bg-white p-1.5 shadow-xl dark:border-[#3a3a3a] dark:bg-[#1f1f1f]"
        >
          <div className="mb-1 px-2 py-1 text-xs font-semibold text-slate-500 dark:text-slate-400">历史会话</div>
          <div className="max-h-64 overflow-y-auto space-y-0.5">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => void handleSwitchSession(session.id)}
                className={`group flex w-full flex-col items-start justify-center rounded-lg px-3 py-2 text-left transition-colors ${
                  currentSessionId === session.id
                    ? 'bg-[rgb(239,239,239)] dark:bg-[#2a2a2a]'
                    : 'hover:bg-[rgb(245,245,245)] dark:hover:bg-[#252525]'
                }`}
                title={session.title}
              >
                <span className={`w-full truncate text-xs font-medium ${currentSessionId === session.id ? 'text-[rgb(13,13,13)] dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>
                  {session.title || `会话 ${session.id}`}
                </span>
                <span className="mt-0.5 text-[10px] text-slate-400">
                  {formatSessionTime(session.updatedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. Message Area */}
      <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {loading || messagesLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-slate-400">
            <MessageSquare className="mb-2 h-8 w-8 opacity-20" />
            <p className="text-xs">开始新的对话</p>
          </div>
        ) : (
          <div className="space-y-6">
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
                <div key={`project-chat-message-${message.id}`} className="flex flex-col">
                  {isUser ? (
                    <div className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-[rgb(229,229,229)] px-4 py-2.5 text-[13px] text-[rgb(13,13,13)] dark:bg-[#333333] dark:text-slate-100">
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                    </div>
                  ) : (
                    <div className="w-full">
                      {!hideEmptyAssistantBubble && (
                        <div className="text-[13px] text-[rgb(13,13,13)] dark:text-slate-100 mb-2">
                          {message.reasoningContent?.trim() && (
                            <details className="mb-3 rounded-lg border border-[rgb(229,229,229)] bg-[rgb(249,249,249)] px-3 py-2 text-xs dark:border-[#333333] dark:bg-[#1a1a1a]">
                              <summary className="cursor-pointer select-none font-medium text-slate-500">
                                思考过程
                              </summary>
                              <div className="mt-2 whitespace-pre-wrap break-words text-slate-600 dark:text-slate-400">
                                {message.reasoningContent}
                              </div>
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
                              <div className="h-3 w-3 animate-pulse rounded-full bg-slate-400"></div>
                            </div>
                          ) : null}
                        </div>
                      )}

                      {effectiveToolInvocations.length > 0 && (
                        <div className="mt-2 max-w-full">
                          {effectiveToolInvocations.map((invocation) => (
                            <ToolInvocationCard key={invocation.id} invocation={invocation} />
                          ))}
                          
                          {effectiveRequiresApproval && approvalMessageId == null && (
                            <div className="mt-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/10 dark:text-amber-400">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              等待工具授权...
                            </div>
                          )}

                          {effectiveRequiresApproval && approvalMessageId != null && approvalStatus == null && (
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                disabled={waitingApproval}
                                onClick={() => void handleApproveToolCall(approvalMessageId, true)}
                                className="flex items-center gap-1.5 rounded-full bg-[rgb(13,13,13)] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-black disabled:opacity-50 dark:bg-slate-100 dark:text-black dark:hover:bg-white"
                              >
                                <Check className="h-3.5 w-3.5" />
                                {waitingApproval ? '处理中...' : '允许'}
                              </button>
                              <button
                                type="button"
                                disabled={waitingApproval || pendingApprovalMessageIds.length <= 1}
                                onClick={() => void handleApproveAllToolCalls()}
                                className="flex items-center gap-1.5 rounded-full border border-[rgb(209,209,209)] bg-white px-4 py-1.5 text-xs font-medium text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(245,245,245)] disabled:opacity-50 dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-slate-200 dark:hover:bg-[#2a2a2a]"
                              >
                                <List className="h-3.5 w-3.5" />
                                {approvingAllTools ? '处理中...' : '全部允许'}
                              </button>
                              <button
                                type="button"
                                disabled={waitingApproval}
                                onClick={() => void handleApproveToolCall(approvalMessageId, false)}
                                className="flex items-center gap-1.5 rounded-full border border-[rgb(209,209,209)] bg-white px-4 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-50 dark:border-[#3a3a3a] dark:bg-[#252525] dark:text-rose-400 dark:hover:bg-rose-950/30"
                              >
                                <X className="h-3.5 w-3.5" />
                                {waitingApproval ? '处理中...' : '拒绝'}
                              </button>
                            </div>
                          )}
                          {approvalStatus === 'approved' && (
                            <div className="mt-1 text-[10px] text-emerald-600 dark:text-emerald-500">
                              ✓ 已允许
                            </div>
                          )}
                          {approvalStatus === 'rejected' && (
                            <div className="mt-1 text-[10px] text-rose-600 dark:text-rose-500">
                              ✗ 已拒绝
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Input Area */}
      <div className="shrink-0 px-3 pb-4 pt-1">
        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
              <X className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 whitespace-pre-wrap break-words">{error}</span>
            </div>
          )}
          {hasPendingToolApproval && !error && (
            <div className="mb-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                需确认工具调用
              </span>
              <button
                type="button"
                disabled={approvingAllTools}
                onClick={() => void handleApproveAllToolCalls()}
                className="shrink-0 font-medium hover:underline disabled:opacity-50"
              >
                {approvingAllTools ? '处理中...' : '全部允许'}
              </button>
            </div>
          )}
          
          <div className="relative flex flex-col rounded-2xl border border-[rgb(220,220,220)] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.08)] focus-within:border-[rgb(180,180,180)] transition-colors dark:border-[#3a3a3a] dark:bg-[#202020] dark:shadow-[0_2px_8px_rgba(0,0,0,0.3)] dark:focus-within:border-[#555]">
            <textarea
              ref={textAreaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
                if (nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend();
                }
              }}
              rows={1}
              placeholder="提问或描述需求..."
              className="max-h-48 min-h-[44px] w-full resize-none bg-transparent py-3 px-4 text-[13px] text-[rgb(13,13,13)] outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            
            <div className="flex items-center justify-between px-2 py-1.5">
              <select
                value={selectedModelId ?? ''}
                onChange={(event) => {
                  const nextId = Number(event.target.value);
                  if (Number.isFinite(nextId)) {
                    setSelectedModelId(nextId);
                  }
                }}
                className="max-w-[60%] truncate appearance-none bg-transparent py-0.5 text-[11px] text-slate-500 outline-none cursor-pointer hover:text-[rgb(13,13,13)] transition-colors dark:text-slate-400 dark:hover:text-slate-200"
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                {sending ? (
                  <button
                    type="button"
                    onClick={handleStop}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-[#333333] dark:text-slate-300 dark:hover:bg-[#444444]"
                    title="停止生成"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!input.trim() || selectedModelId == null || currentSessionId == null || hasPendingToolApproval}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgb(13,13,13)] text-white transition-colors hover:bg-black disabled:opacity-30 dark:bg-slate-100 dark:text-black dark:hover:bg-white"
                    title={hasPendingToolApproval ? '请先处理待确认工具调用' : '发送'}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectChatPanel;
