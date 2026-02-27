import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import 'katex/dist/katex.min.css';
import { useThemeStore } from './store/themeStore';
import { useTerminalStore } from './store/terminalStore';

// 在渲染前初始化主题，避免页面闪烁
useThemeStore.getState().initTheme();
// 初始化终端状态
useTerminalStore.getState().initTerminalState();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
