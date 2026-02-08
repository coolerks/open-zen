import { del, get, patch, post, put } from './client';
import type { Agent, AgentRequest } from '../types';

export const agentApi = {
  list: () => get<Agent[]>('/agents'),
  listEnabled: () => get<Agent[]>('/agents/enabled'),
  getById: (id: number) => get<Agent>(`/agents/${id}`),
  create: (data: AgentRequest) => post<Agent>('/agents', data),
  update: (id: number, data: AgentRequest) => put<Agent>(`/agents/${id}`, data),
  toggle: (id: number, enabled: boolean) => patch<void>(`/agents/${id}/toggle`, { enabled }),
  delete: (id: number) => del<void>(`/agents/${id}`),
};
