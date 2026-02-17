import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import ChatPage from './pages/ChatPage';

const AppShell: React.FC = () => {
  return (
    <div className="h-screen min-h-0 overflow-hidden flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Routes>
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:sessionId" element={<ChatPage />} />
        <Route path="/models" element={<ChatPage />} />
        <Route path="/agents" element={<ChatPage />} />
        <Route path="/apps" element={<ChatPage />} />
        <Route path="/projects" element={<ChatPage />} />
        <Route path="/projects/:projectId" element={<ChatPage />} />
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
