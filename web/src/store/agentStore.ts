import { create } from 'zustand';
import { agentApi } from '../api/agent';
import type { Agent, AgentRequest } from '../types';

interface AgentState {
  agents: Agent[];
  enabledAgents: Agent[];
  loading: boolean;
  error: string | null;
  fetchAgents: () => Promise<void>;
  fetchEnabledAgents: () => Promise<void>;
  createAgent: (data: AgentRequest) => Promise<void>;
  updateAgent: (id: number, data: AgentRequest) => Promise<void>;
  toggleAgent: (id: number, enabled: boolean) => Promise<void>;
  deleteAgent: (id: number) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  enabledAgents: [],
  loading: false,
  error: null,

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await agentApi.list();
      set({ agents, loading: false });
    } catch (e: any) {
      set({ loading: false, error: e.message });
    }
  },

  fetchEnabledAgents: async () => {
    try {
      const enabledAgents = await agentApi.listEnabled();
      set({ enabledAgents });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  createAgent: async (data) => {
    await agentApi.create(data);
    await Promise.all([get().fetchAgents(), get().fetchEnabledAgents()]);
  },

  updateAgent: async (id, data) => {
    await agentApi.update(id, data);
    await Promise.all([get().fetchAgents(), get().fetchEnabledAgents()]);
  },

  toggleAgent: async (id, enabled) => {
    await agentApi.toggle(id, enabled);
    await Promise.all([get().fetchAgents(), get().fetchEnabledAgents()]);
  },

  deleteAgent: async (id) => {
    await agentApi.delete(id);
    await Promise.all([get().fetchAgents(), get().fetchEnabledAgents()]);
  },
}));
