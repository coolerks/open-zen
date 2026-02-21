import { create } from 'zustand';
import type { ProjectItem } from '../types';
import { projectApi } from '../api/project';

const PROJECT_LAST_REAL_DIR_STORAGE_KEY = 'openzen.projects.last.real_dir.v1';

type ProjectCreatePayload = {
  name: string;
  description?: string;
  realDirPath: string;
  rootDirName?: string;
};

type ProjectUpdateDirectoryPayload = {
  realDirPath: string;
  rootDirName?: string;
};

interface ProjectState {
  items: ProjectItem[];
  loading: boolean;
  error: string | null;
  fetchItems: () => Promise<void>;
  createItem: (payload: ProjectCreatePayload) => Promise<ProjectItem>;
  updateDirectory: (projectId: string, payload: ProjectUpdateDirectoryPayload) => Promise<void>;
  deleteItem: (projectId: string) => Promise<void>;
  getLastRealDirectoryPath: () => string | null;
  setLastRealDirectoryPath: (path: string) => void;
  clearError: () => void;
}

function getDirectoryNameFromPath(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  if (!normalized) {
    return '根目录';
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function readLastRealDirectoryPath(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const raw = window.localStorage.getItem(PROJECT_LAST_REAL_DIR_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  const normalized = raw.trim();
  return normalized || null;
}

function writeLastRealDirectoryPath(path: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  const normalized = path.trim();
  if (!normalized) {
    window.localStorage.removeItem(PROJECT_LAST_REAL_DIR_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(PROJECT_LAST_REAL_DIR_STORAGE_KEY, normalized);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await projectApi.list();
      set({ items, loading: false, error: null });
    } catch (error: any) {
      set({ loading: false, error: error?.message ?? '加载项目失败' });
    }
  },

  createItem: async (payload) => {
    const trimmedName = payload.name.trim();
    const normalizedDescription = payload.description?.trim() || null;
    const normalizedRealDirPath = payload.realDirPath.trim();
    const normalizedRootDirName =
      payload.rootDirName?.trim() ||
      (normalizedRealDirPath ? getDirectoryNameFromPath(normalizedRealDirPath) : '') ||
      '未关联目录';
    const created = await projectApi.create({
      name: trimmedName || normalizedRootDirName || '未命名项目',
      description: normalizedDescription || undefined,
      realDirPath: normalizedRealDirPath,
      rootDirName: normalizedRootDirName,
    });

    const nextItems = [created, ...get().items.filter((item) => item.id !== created.id)].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (normalizedRealDirPath) {
      writeLastRealDirectoryPath(normalizedRealDirPath);
    }
    set({ items: nextItems, error: null });
    return created;
  },

  updateDirectory: async (projectId, payload) => {
    const normalizedRealDirPath = payload.realDirPath.trim();
    const normalizedRootDirName =
      payload.rootDirName?.trim() ||
      (normalizedRealDirPath ? getDirectoryNameFromPath(normalizedRealDirPath) : '') ||
      '未关联目录';
    const updated = await projectApi.updateDirectory(projectId, {
      realDirPath: normalizedRealDirPath,
      rootDirName: normalizedRootDirName,
    });

    const nextItems = get().items
      .map((item) => (item.id === projectId ? updated : item))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (normalizedRealDirPath) {
      writeLastRealDirectoryPath(normalizedRealDirPath);
    }
    set({ items: nextItems, error: null });
  },

  deleteItem: async (projectId) => {
    await projectApi.delete(projectId);
    const nextItems = get().items.filter((item) => item.id !== projectId);
    set({ items: nextItems, error: null });
  },

  getLastRealDirectoryPath: () => readLastRealDirectoryPath(),
  setLastRealDirectoryPath: (path) => {
    writeLastRealDirectoryPath(path);
  },

  clearError: () => set({ error: null }),
}));

