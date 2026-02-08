import { create } from 'zustand';
import type { AiModel, ModelRequest } from '../types';
import { modelApi } from '../api/model';

interface ModelState {
  models: AiModel[];
  enabledModels: AiModel[];
  loading: boolean;
  error: string | null;
  fetchModels: () => Promise<void>;
  fetchEnabledModels: () => Promise<void>;
  createModel: (data: ModelRequest) => Promise<void>;
  updateModel: (id: number, data: ModelRequest) => Promise<void>;
  toggleModel: (id: number, enabled: boolean) => Promise<void>;
  setDefaultModel: (id: number, isDefault: boolean) => Promise<void>;
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: [],
  enabledModels: [],
  loading: false,
  error: null,

  fetchModels: async () => {
    set({ loading: true, error: null });
    try {
      const models = await modelApi.list();
      set({ models, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  fetchEnabledModels: async () => {
    try {
      const enabledModels = await modelApi.listEnabled();
      set({ enabledModels });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  createModel: async (data: ModelRequest) => {
    await modelApi.create(data);
    await Promise.all([get().fetchModels(), get().fetchEnabledModels()]);
  },

  updateModel: async (id: number, data: ModelRequest) => {
    await modelApi.update(id, data);
    await Promise.all([get().fetchModels(), get().fetchEnabledModels()]);
  },

  toggleModel: async (id: number, enabled: boolean) => {
    await modelApi.toggle(id, enabled);
    await Promise.all([get().fetchModels(), get().fetchEnabledModels()]);
  },

  setDefaultModel: async (id: number, isDefault: boolean) => {
    await modelApi.setDefault(id, isDefault);
    await Promise.all([get().fetchModels(), get().fetchEnabledModels()]);
  },
}));
