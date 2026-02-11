import { create } from 'zustand';
import { appCenterApi } from '../api/appCenter';
import type { AppCenterItem, AppCenterItemCreateRequest, AppCenterItemUpdateRequest } from '../types';

interface AppCenterState {
  items: AppCenterItem[];
  loading: boolean;
  error: string | null;
  fetchItems: () => Promise<void>;
  createItem: (data: AppCenterItemCreateRequest) => Promise<AppCenterItem>;
  updateItem: (id: number, data: AppCenterItemUpdateRequest) => Promise<AppCenterItem>;
  deleteItem: (id: number) => Promise<void>;
  clearError: () => void;
}

export const useAppCenterStore = create<AppCenterState>((set, get) => ({
  items: [],
  loading: false,
  error: null,

  fetchItems: async () => {
    set({ loading: true, error: null });
    try {
      const items = await appCenterApi.list();
      set({ items, loading: false });
    } catch (error: any) {
      set({ loading: false, error: error?.message ?? '加载应用中心失败' });
    }
  },

  createItem: async (data) => {
    const created = await appCenterApi.create(data);
    set((state) => ({ items: [created, ...state.items], error: null }));
    return created;
  },

  updateItem: async (id, data) => {
    const updated = await appCenterApi.update(id, data);
    set((state) => ({
      items: state.items.map((item) => (item.id === id ? updated : item)),
      error: null,
    }));
    return updated;
  },

  deleteItem: async (id) => {
    await appCenterApi.delete(id);
    set((state) => ({
      items: state.items.filter((item) => item.id !== id),
      error: null,
    }));
  },

  clearError: () => set({ error: null }),
}));
