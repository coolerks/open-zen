import { del, get, post, put } from './client';
import type {
  AppCenterItem,
  AppCenterItemCreateRequest,
  AppCenterItemUpdateRequest,
} from '../types';

export const appCenterApi = {
  list: () => get<AppCenterItem[]>('/apps'),
  getById: (id: number) => get<AppCenterItem>(`/apps/${id}`),
  create: (data: AppCenterItemCreateRequest) => post<AppCenterItem>('/apps', data),
  update: (id: number, data: AppCenterItemUpdateRequest) => put<AppCenterItem>(`/apps/${id}`, data),
  delete: (id: number) => del<void>(`/apps/${id}`),
};
