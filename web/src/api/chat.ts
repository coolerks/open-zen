import { del, get, patch, post } from './client';
import type {
  ChatSession,
  ChatMessage,
  ChatSendRequest,
  ChatSessionCreateRequest,
  ChatSessionUpdateRequest,
  ChatSessionContextStats,
  StreamDonePayload,
} from '../types';

interface StreamHandlers {
  onStart?: (payload: any) => void;
  onDelta?: (payload: { content: string }) => void;
  onReasoning?: (payload: { reasoning: string }) => void;
  onDone?: (payload: StreamDonePayload) => void;
  onError?: (payload: { message: string }) => void;
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
  createSession: (body?: ChatSessionCreateRequest) =>
    post<ChatSession>('/chat/sessions', body ?? {}),
  getSession: (id: number) => get<ChatSession>(`/chat/sessions/${id}`),
  deleteSession: (id: number) => del<void>(`/chat/sessions/${id}`),
  copySession: (id: number, title?: string) =>
    post<ChatSession>(`/chat/sessions/${id}/copy`, { title }),
  branchSession: (id: number, messageId: number, title?: string) =>
    post<ChatSession>(`/chat/sessions/${id}/branch`, { messageId, title }),
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
        } else if (event === 'done') {
          handlers.onDone?.(payload as StreamDonePayload);
        } else if (event === 'error') {
          handlers.onError?.(payload as { message: string });
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseEventBlock(buffer);
      if (parsed?.event === 'done') {
        handlers.onDone?.(parsed.data as StreamDonePayload);
      }
      if (parsed?.event === 'error') {
        handlers.onError?.(parsed.data as { message: string });
      }
    }
  },
};
