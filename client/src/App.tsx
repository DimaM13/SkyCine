import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { Navbar } from './components/layout/Navbar';
import { InviteToast } from './components/layout/InviteToast';
import { HomePage } from './pages/HomePage';
import { MoviesPage } from './pages/MoviesPage';
import { ShowsPage } from './pages/ShowsPage';
import { RoomsPage } from './pages/RoomsPage';
import { RoomPage } from './pages/RoomPage';
import { DirectPlayerPage } from './pages/DirectPlayerPage';
import { FriendsPage } from './pages/FriendsPage';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Загрузка SkyCine...</span>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
};

const MainLayout: React.FC = () => {
  const location = useLocation();
  const isPlayerScreen =
    location.pathname.startsWith('/watch') ||
    (/^\/rooms\/[a-zA-Z0-9_-]+$/.test(location.pathname) && location.pathname !== '/rooms');

  if (isPlayerScreen) {
    return (
      <div className="fixed inset-0 w-full h-full bg-black overflow-hidden select-none touch-none z-50 flex flex-col">
        <main className="w-full h-full flex-1 relative overflow-hidden">
          <Routes>
            <Route path="/rooms/:code" element={<ProtectedRoute><RoomPage /></ProtectedRoute>} />
            <Route path="/watch/:id" element={<ProtectedRoute><DirectPlayerPage /></ProtectedRoute>} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cinema-950 text-slate-100 flex flex-col">
      <Navbar />
      <InviteToast />
      <main className="flex-1">
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
          <Route path="/movies" element={<ProtectedRoute><MoviesPage /></ProtectedRoute>} />
          <Route path="/shows" element={<ProtectedRoute><ShowsPage /></ProtectedRoute>} />
          <Route path="/rooms" element={<ProtectedRoute><RoomsPage /></ProtectedRoute>} />
          <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <SocketProvider>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <MainLayout />
        </Router>
      </SocketProvider>
    </AuthProvider>
  );
};
export default App;
