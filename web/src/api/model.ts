import { get, post, put, patch } from './client';
import type { AiModel, ModelDiscoveryItem, ModelRequest } from '../types';

export const modelApi = {
  list: () => get<AiModel[]>('/models'),
  listEnabled: () => get<AiModel[]>('/models/enabled'),
  discover: (providerId: number) => get<ModelDiscoveryItem[]>(`/models/discover?providerId=${providerId}`),
  getById: (id: number) => get<AiModel>(`/models/${id}`),
  create: (data: ModelRequest) => post<AiModel>('/models', data),
  update: (id: number, data: ModelRequest) => put<AiModel>(`/models/${id}`, data),
  toggle: (id: number, enabled: boolean) => patch<void>(`/models/${id}/toggle`, { enabled }),
  setDefault: (id: number, isDefault: boolean) => patch<void>(`/models/${id}/default`, { isDefault }),
};
