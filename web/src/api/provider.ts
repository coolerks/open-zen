import { get, post, put, patch } from './client';
import type { Provider, ProviderRequest } from '../types';

export const providerApi = {
  list: () => get<Provider[]>('/providers'),
  getById: (id: number) => get<Provider>(`/providers/${id}`),
  create: (data: ProviderRequest) => post<Provider>('/providers', data),
  update: (id: number, data: ProviderRequest) => put<Provider>(`/providers/${id}`, data),
  toggle: (id: number, enabled: boolean) => patch<void>(`/providers/${id}/toggle`, { enabled }),
};
