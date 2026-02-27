import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Plus, X, ChevronDown, ChevronUp, Settings } from 'lucide-react';
import { useTerminalStore } from '../../store/terminalStore';
import { useThemeStore } from '../../store/themeStore';
import { useProjectStore } from '../../store/projectStore';

type TerminalInstance = {
  xterm: XTerm;
  fitAddon: FitAddon;
  websocket: WebSocket | null;
};

export function Terminal() {
  const {
    isOpen,
    height,
    tabs,
    activeTabId,
    fontFamily,
    setHeight,
    addTab,
    removeTab,
    setActiveTab,
    closeTerminal,
  } = useTerminalStore();

  const theme = useThemeStore((state) => state.theme);
  const activeProject = useProjectStore((state) =>
    state.projects.find((p) => p.id === state.selectedProjectId)
  );

  const [isResizing, setIsResizing] = useState(false);
  const [showFontSettings, setShowFontSettings] = useState(false);
  const [customFont, setCustomFont] = useState(fontFamily);
  const resizeStartYRef = useRef(0);
  const resizeStartHeightRef = useRef(0);
  const terminalInstancesRef = useRef<Map<string, TerminalInstance>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Get terminal instance for active tab
  const getActiveTerminal = () => {
    if (!activeTabId) return null;
    return terminalInstancesRef.current.get(activeTabId) || null;
  };

  // Initialize terminal theme
  const getTerminalTheme = () => {
    if (theme === 'dark') {
      return {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      };
    } else {
      return {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#333333',
        cursorAccent: '#ffffff',
        selectionBackground: '#add6ff',
        black: '#000000',
        red: '#cd3131',
        green: '#00bc00',
        yellow: '#949800',
        blue: '#0451a5',
        magenta: '#bc05bc',
        cyan: '#0598bc',
        white: '#555555',
        brightBlack: '#666666',
        brightRed: '#cd3131',
        brightGreen: '#14ce14',
        brightYellow: '#b5ba00',
        brightBlue: '#0451a5',
        brightMagenta: '#bc05bc',
        brightCyan: '#0598bc',
        brightWhite: '#a5a5a5',
      };
    }
  };

  // Create WebSocket connection
  const createWebSocket = (tabId: string, cwd: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/terminal/${tabId}?cwd=${encodeURIComponent(cwd)}`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log(`Terminal ${tabId} WebSocket connected`);
      };

      ws.onerror = (error) => {
        console.error(`Terminal ${tabId} WebSocket error:`, error);
      };

      ws.onclose = () => {
        console.log(`Terminal ${tabId} WebSocket closed`);
      };

      return ws;
    } catch (error) {
      console.error(`Failed to create WebSocket for terminal ${tabId}:`, error);
      return null;
    }
  };

  // Create new terminal instance
  const createTerminal = (tabId: string, containerElement: HTMLElement, cwd: string) => {
    const xterm = new XTerm({
      fontFamily: fontFamily,
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: getTerminalTheme(),
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(containerElement);

    // Fit terminal to container
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch (error) {
        console.error('Error fitting terminal:', error);
      }
    }, 10);

    // Create WebSocket connection
    const websocket = createWebSocket(tabId, cwd);

    if (websocket) {
      // Handle incoming data from server
      websocket.onmessage = (event) => {
        xterm.write(event.data);
      };

      // Handle user input
      xterm.onData((data) => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'input', data }));
        }
      });

      // Handle terminal resize
      xterm.onResize(({ cols, rows }) => {
        if (websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });
    } else {
      xterm.writeln('Failed to connect to terminal server.');
      xterm.writeln('Please check your backend server configuration.');
    }

    const instance: TerminalInstance = {
      xterm,
      fitAddon,
      websocket,
    };

    terminalInstancesRef.current.set(tabId, instance);
    return instance;
  };

  // Handle resize drag
  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartYRef.current = e.clientY;
    resizeStartHeightRef.current = height;
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = resizeStartYRef.current - e.clientY;
      const newHeight = resizeStartHeightRef.current + deltaY;
      setHeight(newHeight);

      // Fit all visible terminals
      terminalInstancesRef.current.forEach((instance) => {
        setTimeout(() => {
          try {
            instance.fitAddon.fit();
          } catch (error) {
            // Ignore fit errors during resize
          }
        }, 0);
      });
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, setHeight]);

  // Update terminal theme when theme changes
  useEffect(() => {
    const newTheme = getTerminalTheme();
    terminalInstancesRef.current.forEach((instance) => {
      instance.xterm.options.theme = newTheme;
    });
  }, [theme]);

  // Update terminal font when fontFamily changes
  useEffect(() => {
    terminalInstancesRef.current.forEach((instance) => {
      instance.xterm.options.fontFamily = fontFamily;
    });
  }, [fontFamily]);

  // Cleanup terminals on unmount
  useEffect(() => {
    return () => {
      terminalInstancesRef.current.forEach((instance) => {
        instance.websocket?.close();
        instance.xterm.dispose();
      });
      terminalInstancesRef.current.clear();
    };
  }, []);

  // Handle window resize
  useEffect(() => {
    const handleWindowResize = () => {
      terminalInstancesRef.current.forEach((instance) => {
        setTimeout(() => {
          try {
            instance.fitAddon.fit();
          } catch (error) {
            // Ignore fit errors
          }
        }, 100);
      });
    };

    window.addEventListener('resize', handleWindowResize);
    return () => window.removeEventListener('resize', handleWindowResize);
  }, []);

  // Fit terminal when switching tabs
  useEffect(() => {
    if (activeTabId) {
      const instance = terminalInstancesRef.current.get(activeTabId);
      if (instance) {
        setTimeout(() => {
          try {
            instance.fitAddon.fit();
          } catch (error) {
            // Ignore
          }
        }, 50);
      }
    }
  }, [activeTabId]);

  // Handle creating new terminal tab
  const handleAddTab = () => {
    const cwd = activeProject?.directory || '.';
    addTab(cwd);
  };

  // Handle closing terminal tab
  const handleRemoveTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const instance = terminalInstancesRef.current.get(tabId);
    if (instance) {
      instance.websocket?.close();
      instance.xterm.dispose();
      terminalInstancesRef.current.delete(tabId);
    }

    removeTab(tabId);
  };

  // Render terminal container for a tab
  const renderTerminalContainer = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return null;

    return (
      <div
        key={tabId}
        className={`h-full ${activeTabId === tabId ? 'block' : 'hidden'}`}
        ref={(element) => {
          if (element && activeTabId === tabId && !terminalInstancesRef.current.has(tabId)) {
            createTerminal(tabId, element, tab.cwd);
          }
        }}
      />
    );
  };

  const handleApplyCustomFont = () => {
    const store = useTerminalStore.getState();
    store.setFontFamily(customFont);
    setShowFontSettings(false);
  };

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-0 left-0 right-0 z-10 flex flex-col border-t border-[rgb(209,209,209)] bg-white dark:border-[#2f2f2f] dark:bg-[#1e1e1e]"
      style={{ height: `${height}px` }}
    >
      {/* Resize handle */}
      <div
        className={`absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-500 ${
          isResizing ? 'bg-blue-500' : ''
        }`}
        onMouseDown={handleResizeMouseDown}
      />

      {/* Terminal header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[rgb(209,209,209)] bg-[#f7f7f8] px-2 dark:border-[#2f2f2f] dark:bg-[#252526]">
        {/* Tabs */}
        <div className="flex flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-2 rounded px-2 py-1 text-xs transition-colors ${
                activeTabId === tab.id
                  ? 'bg-white text-[rgb(13,13,13)] dark:bg-[#1e1e1e] dark:text-slate-100'
                  : 'text-[rgb(80,80,80)] hover:bg-[rgb(239,239,239)] dark:text-slate-400 dark:hover:bg-[#2a2a2a]'
              }`}
            >
              <span>{tab.name}</span>
              <X
                className="h-3 w-3 opacity-0 group-hover:opacity-100"
                onClick={(e) => handleRemoveTab(tab.id, e)}
              />
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={handleAddTab}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[rgb(80,80,80)] transition-colors hover:bg-[rgb(239,239,239)] dark:text-slate-400 dark:hover:bg-[#2a2a2a]"
            title="新建终端"
          >
            <Plus className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowFontSettings(!showFontSettings)}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[rgb(80,80,80)] transition-colors hover:bg-[rgb(239,239,239)] dark:text-slate-400 dark:hover:bg-[#2a2a2a]"
            title="终端设置"
          >
            <Settings className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={closeTerminal}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-[rgb(80,80,80)] transition-colors hover:bg-[rgb(239,239,239)] dark:text-slate-400 dark:hover:bg-[#2a2a2a]"
            title="隐藏终端"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Font settings panel */}
      {showFontSettings && (
        <div className="shrink-0 border-b border-[rgb(209,209,209)] bg-[#f7f7f8] p-3 dark:border-[#2f2f2f] dark:bg-[#252526]">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[rgb(80,80,80)] dark:text-slate-400">
              字体:
            </label>
            <input
              type="text"
              value={customFont}
              onChange={(e) => setCustomFont(e.target.value)}
              className="flex-1 rounded border border-[rgb(209,209,209)] bg-white px-2 py-1 text-xs text-[rgb(13,13,13)] dark:border-[#2f2f2f] dark:bg-[#1e1e1e] dark:text-slate-100"
              placeholder="输入字体名称"
            />
            <button
              type="button"
              onClick={handleApplyCustomFont}
              className="rounded bg-blue-500 px-3 py-1 text-xs text-white hover:bg-blue-600"
            >
              应用
            </button>
          </div>
          <div className="mt-1 text-xs text-[rgb(120,120,120)] dark:text-slate-500">
            默认: JetBrainsMonoNL Nerd Font, 回退到系统等宽字体
          </div>
        </div>
      )}

      {/* Terminal content */}
      <div className="relative flex-1 overflow-hidden">
        {tabs.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[rgb(120,120,120)] dark:text-slate-500">
            <div className="text-center">
              <div className="mb-2 text-sm">没有打开的终端</div>
              <button
                type="button"
                onClick={handleAddTab}
                className="rounded bg-blue-500 px-4 py-2 text-sm text-white hover:bg-blue-600"
              >
                创建新终端
              </button>
            </div>
          </div>
        ) : (
          tabs.map((tab) => renderTerminalContainer(tab.id))
        )}
      </div>
    </div>
  );
}
