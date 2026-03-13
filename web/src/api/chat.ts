import { del, get, patch, post } from './client';
import type {
  ChatSession,
  ChatMessage,
  ChatSendRequest,
  ChatSessionCreateRequest,
  ChatSessionUpdateRequest,
  ChatSearchResult,
  ChatToolDefinition,
  ChatSessionContextStats,
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

export const chatApi = {
  listSessions: () => get<ChatSession[]>('/chat/sessions'),
  listTools: () => get<ChatToolDefinition[]>('/chat/tools'),
  searchSessions: (keyword: string, limit = 80) =>
    get<ChatSearchResult[]>(`/chat/sessions/search?keyword=${encodeURIComponent(keyword)}&limit=${limit}`),
  createSession: (body?: ChatSessionCreateRequest) =>
    post<ChatSession>('/chat/sessions', body ?? {}),
  getSession: (id: number) => get<ChatSession>(`/chat/sessions/${id}`),
  deleteSession: (id: number) => del<void>(`/chat/sessions/${id}`),
  copySession: (id: number, title?: string) =>
    post<ChatSession>(`/chat/sessions/${id}/copy`, { title }),
  branchSession: (id: number, messageId: number, title?: string) =>
    post<ChatSession>(`/chat/sessions/${id}/branch`, { messageId, title }),
  autoGenerateTitle: (sessionId: number, data: { modelId?: number; firstQuestion?: string }) =>
    post<ChatSession>(`/chat/sessions/${sessionId}/auto-title`, data),
  updateSession: (id: number, data: ChatSessionUpdateRequest) =>
    patch<void>(`/chat/sessions/${id}`, data),
  updateSessionTitle: (id: number, title: string) =>
    patch<void>(`/chat/sessions/${id}`, { title }),
  getMessages: (sessionId: number) => get<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`),
  getSessionContextStats: (sessionId: number, modelId?: number | null) => {
    const query = modelId != null ? `?modelId=${modelId}` : '';
    return get<ChatSessionContextStats>(`/chat/sessions/${sessionId}/context${query}`);
  },
  deleteMessage: (sessionId: number, messageId: number) =>
    del<void>(`/chat/sessions/${sessionId}/messages/${messageId}`),
  approveToolCall: (sessionId: number, assistantMessageId: number, approved: boolean) =>
    post<ChatMessage>(`/chat/sessions/${sessionId}/tool-approval`, { assistantMessageId, approved }),
  approveToolCallStream: async (
    sessionId: number,
    assistantMessageId: number,
    approved: boolean,
    handlers: StreamHandlers,
    options?: { signal?: AbortSignal },
  ) => {
    const response = await fetch(`/api/chat/sessions/${sessionId}/tool-approval/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        assistantMessageId,
        approved,
      }),
      signal: options?.signal,
    });

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
  sendMessage: (data: ChatSendRequest) => post<ChatMessage>('/chat/send', data),
  streamMessage: async (
    data: ChatSendRequest,
    handlers: StreamHandlers,
    options?: { signal?: AbortSignal },
  ) => {
    const response = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
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
          // 收到错误事件后立即结束流，确保上层能及时回落发送状态。
          throw new Error(normalizedError.message);
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseEventBlock(buffer);
      if (parsed?.event === 'done') {
        handlers.onDone?.(parsed.data as StreamDonePayload);
      }
      if (parsed?.event === 'error') {
        const normalizedError = normalizeStreamError(parsed.data);
        handlers.onError?.(normalizedError);
        throw new Error(normalizedError.message);
      }
    }
  },
};
