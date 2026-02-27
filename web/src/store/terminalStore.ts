import { create } from 'zustand';

export type TerminalTab = {
  id: string;
  name: string;
  cwd: string;
};

type TerminalState = {
  isOpen: boolean;
  height: number;
  tabs: TerminalTab[];
  activeTabId: string | null;
  fontFamily: string;

  openTerminal: () => void;
  closeTerminal: () => void;
  toggleTerminal: () => void;
  setHeight: (height: number) => void;
  addTab: (cwd: string) => string;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  renameTab: (tabId: string, name: string) => void;
  setFontFamily: (fontFamily: string) => void;
  initTerminalState: () => void;
};

const TERMINAL_HEIGHT_STORAGE_KEY = 'terminal.height';
const TERMINAL_FONT_FAMILY_STORAGE_KEY = 'terminal.fontFamily';
const TERMINAL_MIN_HEIGHT = 100;
const TERMINAL_MAX_HEIGHT = 800;
const TERMINAL_DEFAULT_HEIGHT = Math.floor(window.innerHeight / 3);

const DEFAULT_FONT_FAMILY = 'JetBrainsMonoNL Nerd Font, Menlo, Monaco, "Courier New", monospace';

function readStoredHeight(): number {
  const raw = window.localStorage.getItem(TERMINAL_HEIGHT_STORAGE_KEY);
  if (!raw) return TERMINAL_DEFAULT_HEIGHT;

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return TERMINAL_DEFAULT_HEIGHT;

  return Math.max(TERMINAL_MIN_HEIGHT, Math.min(TERMINAL_MAX_HEIGHT, parsed));
}

function readStoredFontFamily(): string {
  const stored = window.localStorage.getItem(TERMINAL_FONT_FAMILY_STORAGE_KEY);
  return stored || DEFAULT_FONT_FAMILY;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  isOpen: false,
  height: TERMINAL_DEFAULT_HEIGHT,
  tabs: [],
  activeTabId: null,
  fontFamily: DEFAULT_FONT_FAMILY,

  openTerminal: () => {
    const state = get();
    if (state.tabs.length === 0) {
      // Create first tab if none exist
      const tabId = `terminal-${Date.now()}`;
      set({
        isOpen: true,
        tabs: [{ id: tabId, name: 'Terminal 1', cwd: '.' }],
        activeTabId: tabId,
      });
    } else {
      set({ isOpen: true });
    }
  },

  closeTerminal: () => set({ isOpen: false }),

  toggleTerminal: () => {
    const state = get();
    if (state.isOpen) {
      state.closeTerminal();
    } else {
      state.openTerminal();
    }
  },

  setHeight: (height: number) => {
    const clampedHeight = Math.max(TERMINAL_MIN_HEIGHT, Math.min(TERMINAL_MAX_HEIGHT, height));
    set({ height: clampedHeight });
    window.localStorage.setItem(TERMINAL_HEIGHT_STORAGE_KEY, String(clampedHeight));
  },

  addTab: (cwd: string) => {
    const state = get();
    const tabId = `terminal-${Date.now()}`;
    const tabNumber = state.tabs.length + 1;
    const newTab: TerminalTab = {
      id: tabId,
      name: `Terminal ${tabNumber}`,
      cwd,
    };

    set({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    });

    return tabId;
  },

  removeTab: (tabId: string) => {
    const state = get();
    const newTabs = state.tabs.filter((tab) => tab.id !== tabId);

    let newActiveTabId = state.activeTabId;
    if (state.activeTabId === tabId) {
      // If we're removing the active tab, switch to another tab
      if (newTabs.length > 0) {
        const removedIndex = state.tabs.findIndex((tab) => tab.id === tabId);
        const newIndex = Math.min(removedIndex, newTabs.length - 1);
        newActiveTabId = newTabs[newIndex].id;
      } else {
        newActiveTabId = null;
      }
    }

    set({
      tabs: newTabs,
      activeTabId: newActiveTabId,
      isOpen: newTabs.length > 0 ? state.isOpen : false,
    });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  renameTab: (tabId: string, name: string) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, name } : tab
      ),
    }));
  },

  setFontFamily: (fontFamily: string) => {
    set({ fontFamily });
    window.localStorage.setItem(TERMINAL_FONT_FAMILY_STORAGE_KEY, fontFamily);
  },

  initTerminalState: () => {
    const height = readStoredHeight();
    const fontFamily = readStoredFontFamily();
    set({ height, fontFamily });
  },
}));
