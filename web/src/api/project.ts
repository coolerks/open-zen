import { del, get, patch, post } from './client';
import type { ProjectItem } from '../types';

type ProjectCreateRequest = {
  name: string;
  description?: string;
  realDirPath: string;
  rootDirName?: string;
};

type ProjectDirectoryUpdateRequest = {
  realDirPath: string;
  rootDirName?: string;
};

export const projectApi = {
  list: () => get<ProjectItem[]>('/projects'),
  getById: (id: string) => get<ProjectItem>(`/projects/${encodeURIComponent(id)}`),
  create: (data: ProjectCreateRequest) => post<ProjectItem>('/projects', data),
  updateDirectory: (id: string, data: ProjectDirectoryUpdateRequest) =>
    patch<ProjectItem>(`/projects/${encodeURIComponent(id)}/directory`, data),
  delete: (id: string) => del<void>(`/projects/${encodeURIComponent(id)}`),
};
