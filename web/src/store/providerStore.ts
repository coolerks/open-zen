import { create } from 'zustand';
import type { Provider, ProviderRequest } from '../types';
import { providerApi } from '../api/provider';

interface ProviderState {
  providers: Provider[];
  loading: boolean;
  error: string | null;
  fetchProviders: () => Promise<void>;
  createProvider: (data: ProviderRequest) => Promise<void>;
  updateProvider: (id: number, data: ProviderRequest) => Promise<void>;
  toggleProvider: (id: number, enabled: boolean) => Promise<void>;
  deleteProvider: (id: number) => Promise<void>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  loading: false,
  error: null,

  fetchProviders: async () => {
    set({ loading: true, error: null });
    try {
      const providers = await providerApi.list();
      set({ providers, loading: false });
    } catch (e: any) {
      set({ error: e.message, loading: false });
    }
  },

  createProvider: async (data: ProviderRequest) => {
    await providerApi.create(data);
    await get().fetchProviders();
  },

  updateProvider: async (id: number, data: ProviderRequest) => {
    await providerApi.update(id, data);
    await get().fetchProviders();
  },

  toggleProvider: async (id: number, enabled: boolean) => {
    await providerApi.toggle(id, enabled);
    await get().fetchProviders();
  },

  deleteProvider: async (id: number) => {
    await providerApi.delete(id);
    await get().fetchProviders();
  },
}));
