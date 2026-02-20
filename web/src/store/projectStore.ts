import { create } from 'zustand';
import type { ProjectItem } from '../types';

const PROJECT_META_STORAGE_KEY = 'openzen.projects.meta.v1';
const PROJECT_LAST_REAL_DIR_STORAGE_KEY = 'openzen.projects.last.real_dir.v1';
const PROJECT_HANDLE_DB_NAME = 'openzen.projects.db';
const PROJECT_HANDLE_DB_VERSION = 1;
const PROJECT_HANDLE_STORE_NAME = 'project_handles';

type ProjectHandleRecord = {
  projectId: string;
  handle: FileSystemDirectoryHandle;
};

type ProjectCreatePayload = {
  name: string;
  description?: string;
  realDirPath: string;
  rootDirName?: string;
  directoryHandle: FileSystemDirectoryHandle;
};

type ProjectUpdateDirectoryPayload = {
  realDirPath: string;
  rootDirName?: string;
  directoryHandle: FileSystemDirectoryHandle;
};

interface ProjectState {
  items: ProjectItem[];
  loading: boolean;
  error: string | null;
  fetchItems: () => Promise<void>;
  createItem: (payload: ProjectCreatePayload) => Promise<ProjectItem>;
  updateDirectory: (projectId: string, payload: ProjectUpdateDirectoryPayload) => Promise<void>;
  deleteItem: (projectId: string) => Promise<void>;
  getDirectoryHandle: (projectId: string) => Promise<FileSystemDirectoryHandle | null>;
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

function normalizeProjectItems(raw: unknown): ProjectItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Partial<ProjectItem>;
      if (!record.id || !record.name || !record.rootDirName || !record.createdAt || !record.updatedAt) {
        return null;
      }
      return {
        id: String(record.id),
        name: String(record.name),
        description: record.description ? String(record.description) : null,
        rootDirName: String(record.rootDirName),
        realDirPath: record.realDirPath ? String(record.realDirPath) : null,
        createdAt: String(record.createdAt),
        updatedAt: String(record.updatedAt),
      } as ProjectItem;
    })
    .filter((item): item is ProjectItem => item != null);
}

function readProjectItemsFromStorage(): ProjectItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const raw = window.localStorage.getItem(PROJECT_META_STORAGE_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeProjectItems(parsed);
  } catch {
    return [];
  }
}

function writeProjectItemsToStorage(items: ProjectItem[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(PROJECT_META_STORAGE_KEY, JSON.stringify(items));
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

function generateProjectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function openProjectDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PROJECT_HANDLE_DB_NAME, PROJECT_HANDLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECT_HANDLE_STORE_NAME)) {
        db.createObjectStore(PROJECT_HANDLE_STORE_NAME, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打开项目数据库失败'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('数据库请求失败'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('数据库事务失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('数据库事务终止'));
  });
}

async function putProjectHandle(projectId: string, directoryHandle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openProjectDb();
  try {
    const tx = db.transaction(PROJECT_HANDLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_HANDLE_STORE_NAME);
    store.put({ projectId, handle: directoryHandle } as ProjectHandleRecord);
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

async function getProjectHandle(projectId: string): Promise<FileSystemDirectoryHandle | null> {
  const db = await openProjectDb();
  try {
    const tx = db.transaction(PROJECT_HANDLE_STORE_NAME, 'readonly');
    const store = tx.objectStore(PROJECT_HANDLE_STORE_NAME);
    const record = await requestToPromise(store.get(projectId) as IDBRequest<ProjectHandleRecord | undefined>);
    return record?.handle ?? null;
  } finally {
    db.close();
  }
}

async function removeProjectHandle(projectId: string): Promise<void> {
  const db = await openProjectDb();
  try {
    const tx = db.transaction(PROJECT_HANDLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(PROJECT_HANDLE_STORE_NAME);
    store.delete(projectId);
    await transactionToPromise(tx);
  } finally {
    db.close();
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = readProjectItemsFromStorage().sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      set({ items, loading: false, error: null });
    } catch (error: any) {
      set({ loading: false, error: error?.message ?? '加载项目失败' });
    }
  },

  createItem: async (payload) => {
    const trimmedName = payload.name.trim();
    const normalizedDescription = payload.description?.trim() || null;
    const normalizedRealDirPath = payload.realDirPath.trim();
    if (!payload.directoryHandle) {
      throw new Error('请选择浏览器目录授权');
    }
    const normalizedRootDirName =
      payload.rootDirName?.trim() ||
      (normalizedRealDirPath ? getDirectoryNameFromPath(normalizedRealDirPath) : '') ||
      payload.directoryHandle?.name ||
      '未关联目录';
    const now = new Date().toISOString();
    const created: ProjectItem = {
      id: generateProjectId(),
      name: trimmedName || normalizedRootDirName || '未命名项目',
      description: normalizedDescription,
      rootDirName: normalizedRootDirName,
      realDirPath: normalizedRealDirPath || null,
      createdAt: now,
      updatedAt: now,
    };

    await putProjectHandle(created.id, payload.directoryHandle);

    const nextItems = [created, ...get().items];
    writeProjectItemsToStorage(nextItems);
    if (normalizedRealDirPath) {
      writeLastRealDirectoryPath(normalizedRealDirPath);
    }
    set({ items: nextItems, error: null });
    return created;
  },

  updateDirectory: async (projectId, payload) => {
    const normalizedRealDirPath = payload.realDirPath.trim();
    if (!payload.directoryHandle) {
      throw new Error('请选择浏览器目录授权');
    }
    const normalizedRootDirName =
      payload.rootDirName?.trim() ||
      (normalizedRealDirPath ? getDirectoryNameFromPath(normalizedRealDirPath) : '') ||
      payload.directoryHandle?.name ||
      '未关联目录';
    await putProjectHandle(projectId, payload.directoryHandle);

    const now = new Date().toISOString();
    const nextItems = get().items.map((item) =>
      item.id === projectId
        ? {
            ...item,
            rootDirName: normalizedRootDirName,
            realDirPath: normalizedRealDirPath || null,
            updatedAt: now,
          }
        : item,
    );
    writeProjectItemsToStorage(nextItems);
    if (normalizedRealDirPath) {
      writeLastRealDirectoryPath(normalizedRealDirPath);
    }
    set({ items: nextItems, error: null });
  },

  deleteItem: async (projectId) => {
    await removeProjectHandle(projectId);
    const nextItems = get().items.filter((item) => item.id !== projectId);
    writeProjectItemsToStorage(nextItems);
    set({ items: nextItems, error: null });
  },

  getDirectoryHandle: async (projectId) => {
    try {
      return await getProjectHandle(projectId);
    } catch (error: any) {
      set({ error: error?.message ?? '读取项目目录失败' });
      return null;
    }
  },

  getLastRealDirectoryPath: () => readLastRealDirectoryPath(),
  setLastRealDirectoryPath: (path) => {
    writeLastRealDirectoryPath(path);
  },

  clearError: () => set({ error: null }),
}));
