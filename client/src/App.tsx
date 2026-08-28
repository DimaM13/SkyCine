import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { InviteToast } from './components/layout/InviteToast';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { MoviesPage } from './pages/MoviesPage';
import { ShowsPage } from './pages/ShowsPage';
import { RoomsPage } from './pages/RoomsPage';
import { RoomPage } from './pages/RoomPage';
import { DirectPlayerPage } from './pages/DirectPlayerPage';
import { FriendsPage } from './pages/FriendsPage';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { Titlebar } from './components/layout/Titlebar';

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
  const { user } = useAuth();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Reset scroll and force Safari WebKit layout reflow when navigating between routes
  useEffect(() => {
    window.scrollTo(0, 0);
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
    return () => clearTimeout(timer);
  }, [location.pathname]);

  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);

  const isPlayerScreen =
    location.pathname.startsWith('/watch') ||
    (/^\/rooms\/[a-zA-Z0-9_-]+$/.test(location.pathname) && location.pathname !== '/rooms');

  const prevIsPlayerScreen = useRef(isPlayerScreen);
  useEffect(() => {
    if (isDesktop) {
      if (isPlayerScreen) {
        document.body.style.backgroundColor = 'transparent';
      } else {
        document.body.style.backgroundColor = '#07090e';
        if (prevIsPlayerScreen.current) {
          (window as any).desktopPlayer?.closePlayer();
        }
      }
      prevIsPlayerScreen.current = isPlayerScreen;
    }
  }, [isPlayerScreen, isDesktop]);

  if (isPlayerScreen) {
    return (
      <div className={`fixed inset-0 w-full h-full ${isDesktop ? 'bg-transparent' : 'bg-black'} overflow-hidden select-none touch-none z-50 flex flex-col`}>
        <main className={`w-full h-full flex-1 relative overflow-hidden ${isDesktop ? 'bg-transparent' : 'bg-black'}`}>
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
      <Titlebar />
      <Navbar onToggleSidebar={() => setMobileSidebarOpen(!mobileSidebarOpen)} />
      <InviteToast />

      <div className="flex-1 flex w-full">
        {user && (
          <Sidebar
            mobileOpen={mobileSidebarOpen}
            onCloseMobile={() => setMobileSidebarOpen(false)}
          />
        )}

        <main className="flex-1 min-w-0 overflow-x-hidden">
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/library/:id" element={<ProtectedRoute><LibraryPage /></ProtectedRoute>} />
            <Route path="/movies" element={<ProtectedRoute><MoviesPage /></ProtectedRoute>} />
            <Route path="/shows" element={<ProtectedRoute><ShowsPage /></ProtectedRoute>} />
            <Route path="/rooms" element={<ProtectedRoute><RoomsPage /></ProtectedRoute>} />
            <Route path="/friends" element={<ProtectedRoute><FriendsPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
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
