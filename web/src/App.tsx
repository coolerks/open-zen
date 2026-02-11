import React from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Header } from './components/layout/Header';
import ChatPage from './pages/ChatPage';
import ModelsPage from './pages/ModelsPage';
import AgentsPage from './pages/AgentsPage';
import AppsPage from './pages/AppsPage';

const AppShell: React.FC = () => {
  const location = useLocation();
  const isChatPage = location.pathname === '/chat' || location.pathname.startsWith('/chat/');

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {!isChatPage && <Header />}
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/models" element={<ModelsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="*" element={<Navigate to="/chat" replace />} />
      </Routes>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
};

export default App;
