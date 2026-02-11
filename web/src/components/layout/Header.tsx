import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useThemeStore } from '../../store/themeStore';

export const Header: React.FC = () => {
  const location = useLocation();
  const { theme, toggleTheme } = useThemeStore();

  const navItems = [
    { path: '/chat', label: '聊天' },
    { path: '/models', label: '模型管理' },
    { path: '/agents', label: '智能体' },
    { path: '/apps', label: '应用中心' },
  ];

  return (
    <header className="h-14 border-b border-slate-200 bg-white dark:border-[#2f2f2f] dark:bg-[#171717] flex items-center px-4 shrink-0">
      <div className="flex items-center gap-6 flex-1">
        <Link to="/chat" className="text-lg font-bold text-slate-900 dark:text-slate-100">
          AI Agent
        </Link>

        <nav className="flex gap-1">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                ${location.pathname === item.path
                  ? 'bg-slate-200 text-slate-800 dark:bg-[#2f2f2f] dark:text-slate-100'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-[#2a2a2a]'
                }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <button
        onClick={toggleTheme}
        className="p-2 rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
      >
        {theme === 'light' ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        )}
      </button>
    </header>
  );
};
