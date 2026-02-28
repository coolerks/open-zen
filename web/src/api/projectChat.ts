import { del, get, patch, post } from './client';
import type {
  ChatMessage,
  ChatSendRequest,
  ChatSession,
  ChatSessionContextStats,
  ChatSessionCreateRequest,
  ChatSessionUpdateRequest,
  ChatToolDefinition,
  StreamDonePayload,
} from '../types';

interface StreamHandlers {
  onStart?: (payload: any) => void;
  onDelta?: (payload: { content: string }) => void;
  onReasoning?: (payload: { reasoning: string }) => void;
  onTool?: (payload: {
    type?: string;
    round?: number;
    toolCallId?: string | null;
    name?: string | null;
    arguments?: string | null;
    result?: string | null;
  }) => void;
  onDone?: (payload: StreamDonePayload) => void;
  onError?: (payload: { message: string }) => void;
}

function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

function normalizeStreamError(payload: unknown): { message: string } {
  if (typeof payload === 'string') {
    const text = payload.trim();
    return { message: text || '流式响应发生异常' };
  }
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return { message: message.trim() };
    }
  }
  return { message: '流式响应发生异常' };
}

function parseEventBlock(block: string): { event: string; data: any } | null {
  if (!block.trim()) {
    return null;
  }
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }

  const rawData = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(rawData) };
  } catch {
    return { event, data: rawData };
  }
}

export const projectChatApi = {
  listSessions: (projectId: string) =>
    get<ChatSession[]>(`/projects/${encodeProjectId(projectId)}/chat/sessions`),

  createSession: (projectId: string, body?: ChatSessionCreateRequest) =>
    post<ChatSession>(`/projects/${encodeProjectId(projectId)}/chat/sessions`, body ?? {}),

  getSession: (projectId: string, sessionId: number) =>
    get<ChatSession>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}`),

  updateSession: (projectId: string, sessionId: number, data: ChatSessionUpdateRequest) =>
    patch<void>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}`, data),

  autoGenerateTitle: (
    projectId: string,
    sessionId: number,
    data: { modelId?: number; firstQuestion?: string },
  ) => post<ChatSession>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/auto-title`, data),

  deleteSession: (projectId: string, sessionId: number) =>
    del<void>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}`),

  getMessages: (projectId: string, sessionId: number) =>
    get<ChatMessage[]>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/messages`),

  deleteMessage: (projectId: string, sessionId: number, messageId: number) =>
    del<void>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/messages/${messageId}`),

  listTools: (projectId: string) =>
    get<ChatToolDefinition[]>(`/projects/${encodeProjectId(projectId)}/chat/tools`),

  getSessionContextStats: (projectId: string, sessionId: number, modelId?: number | null) => {
    const query = modelId != null ? `?modelId=${modelId}` : '';
    return get<ChatSessionContextStats>(
      `/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/context${query}`,
    );
  },

  approveToolCall: (
    projectId: string,
    sessionId: number,
    assistantMessageId: number,
    approved: boolean,
    maxToolRounds?: number,
  ) =>
    post<ChatMessage>(`/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/tool-approval`, {
      assistantMessageId,
      approved,
      maxToolRounds,
    }),

  approveToolCallStream: async (
    projectId: string,
    sessionId: number,
    assistantMessageId: number,
    approved: boolean,
    maxToolRounds: number | undefined,
    handlers: StreamHandlers,
    options?: { signal?: AbortSignal },
  ) => {
    const response = await fetch(
      `/api/projects/${encodeProjectId(projectId)}/chat/sessions/${sessionId}/tool-approval/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assistantMessageId,
          approved,
          maxToolRounds,
        }),
        signal: options?.signal,
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `流式授权请求失败: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('流式授权响应为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const parsed = parseEventBlock(block);
        if (!parsed) {
          continue;
        }
        const { event, data: payload } = parsed;
        if (event === 'start') {
          handlers.onStart?.(payload);
        } else if (event === 'delta') {
          handlers.onDelta?.(payload as { content: string });
        } else if (event === 'reasoning') {
          handlers.onReasoning?.(payload as { reasoning: string });
        } else if (event === 'tool') {
          handlers.onTool?.(payload as {
            type?: string;
            round?: number;
            toolCallId?: string | null;
            name?: string | null;
            arguments?: string | null;
            result?: string | null;
          });
        } else if (event === 'done') {
          handlers.onDone?.(payload as StreamDonePayload);
        } else if (event === 'error') {
          const normalizedError = normalizeStreamError(payload);
          handlers.onError?.(normalizedError);
          throw new Error(normalizedError.message);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseEventBlock(buffer);
      if (parsed?.event === 'done') {
        handlers.onDone?.(parsed.data as StreamDonePayload);
      } else if (parsed?.event === 'error') {
        const normalizedError = normalizeStreamError(parsed.data);
        handlers.onError?.(normalizedError);
        throw new Error(normalizedError.message);
      }
    }
  },

  sendMessage: (projectId: string, data: ChatSendRequest) =>
    post<ChatMessage>(`/projects/${encodeProjectId(projectId)}/chat/send`, data),

  streamMessage: async (
    projectId: string,
    data: ChatSendRequest,
    handlers: StreamHandlers,
    options?: { signal?: AbortSignal },
  ) => {
    const response = await fetch(`/api/projects/${encodeProjectId(projectId)}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: options?.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `流式请求失败: ${response.status}`);
    }
    if (!response.body) {
      throw new Error('流式响应为空');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';

      for (const block of blocks) {
        const parsed = parseEventBlock(block);
        if (!parsed) {
          continue;
        }
        const { event, data: payload } = parsed;
        if (event === 'start') {
          handlers.onStart?.(payload);
        } else if (event === 'delta') {
          handlers.onDelta?.(payload as { content: string });
        } else if (event === 'reasoning') {
          handlers.onReasoning?.(payload as { reasoning: string });
        } else if (event === 'tool') {
          handlers.onTool?.(payload as {
            type?: string;
            round?: number;
            toolCallId?: string | null;
            name?: string | null;
            arguments?: string | null;
            result?: string | null;
          });
        } else if (event === 'done') {
          handlers.onDone?.(payload as StreamDonePayload);
        } else if (event === 'error') {
          const normalizedError = normalizeStreamError(payload);
          handlers.onError?.(normalizedError);
          throw new Error(normalizedError.message);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseEventBlock(buffer);
      if (parsed?.event === 'done') {
        handlers.onDone?.(parsed.data as StreamDonePayload);
      } else if (parsed?.event === 'error') {
        const normalizedError = normalizeStreamError(parsed.data);
        handlers.onError?.(normalizedError);
        throw new Error(normalizedError.message);
      }
    }
  },
};
