import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Film, Tv, Video, Radio, Users, Shield, Plus,
  Sparkles, Clapperboard, Folder, ChevronRight, X, Layers
} from 'lucide-react';
import { apiClient } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Library } from '../../types';

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onCloseMobile }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLibraries = () => {
    apiClient.get('/libraries')
      .then((res) => setLibraries(res.data.libraries || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (user) {
      fetchLibraries();
    }
  }, [user, location.pathname]);

  const isActive = (path: string) => location.pathname === path;

  const getLibraryIcon = (lib: Library) => {
    const name = (lib.name || '').toLowerCase();
    if (name.includes('аниме') || name.includes('anime')) return Sparkles;
    if (name.includes('мульт') || name.includes('cartoon') || name.includes('детск')) return Clapperboard;
    if (lib.type === 'SHOWS' || name.includes('сериал') || name.includes('show')) return Tv;
    if (lib.type === 'VIDEOS' || name.includes('видео') || name.includes('video') || name.includes('клип') || name.includes('ролик')) return Video;
    return Film;
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    onCloseMobile?.();
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between p-4 overflow-y-auto">
      {/* Top Section */}
      <div className="flex flex-col gap-6">
        {/* Mobile Header with Close Button */}
        <div className="flex md:hidden items-center justify-between pb-2 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cinema-gold to-yellow-300 flex items-center justify-center shadow-glow-gold">
              <Film className="w-4 h-4 text-black fill-black" />
            </div>
            <span className="text-base font-extrabold text-white font-['Outfit']">
              Sky<span className="text-cinema-gold">Cine</span>
            </span>
          </div>

          <button
            onClick={onCloseMobile}
            className="p-1.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Primary Dashboard Link */}
        <div className="flex flex-col gap-1">
          <button
            onClick={() => handleNavClick('/')}
            className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-bold flex items-center justify-between transition-all group ${
              isActive('/')
                ? 'bg-cinema-gold text-black shadow-glow-gold'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-3">
              <Home className={`w-4 h-4 ${isActive('/') ? 'text-black' : 'text-cinema-gold'}`} />
              <span>Главная</span>
            </div>
            <ChevronRight className={`w-3.5 h-3.5 opacity-50 group-hover:translate-x-0.5 transition-transform ${isActive('/') ? 'text-black' : ''}`} />
          </button>
        </div>

        {/* Libraries Section */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between px-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 flex items-center gap-1.5">
              <Layers className="w-3 h-3 text-cinema-gold" />
              Медиатека
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 font-mono font-bold">{libraries.length}</span>
              {isAdmin && (
                <button
                  onClick={() => handleNavClick('/admin')}
                  className="p-1 rounded-md bg-white/5 hover:bg-cinema-gold text-slate-400 hover:text-black transition-colors"
                  title="Создать библиотеку"
                >
                  <Plus className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            {loading ? (
              <div className="p-4 flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
              </div>
            ) : libraries.length === 0 ? (
              <div className="p-3 rounded-2xl bg-white/5 border border-white/5 text-center text-[11px] text-slate-500">
                Библиотек пока нет
              </div>
            ) : (
              libraries.map((lib) => {
                const Icon = getLibraryIcon(lib);
                const active = isActive(`/library/${lib.id}`) || (lib.type === 'MOVIES' && isActive('/movies') && libraries[0]?.id === lib.id) || (lib.type === 'SHOWS' && isActive('/shows') && libraries.find(l => l.type === 'SHOWS')?.id === lib.id);

                return (
                  <button
                    key={lib.id}
                    onClick={() => handleNavClick(`/library/${lib.id}`)}
                    className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all group ${
                      active
                        ? 'bg-cinema-gold text-black font-bold shadow-glow-gold'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-black' : 'text-cinema-gold/80 group-hover:text-cinema-gold'}`} />
                      <span className="truncate">{lib.name}</span>
                    </div>

                    {lib.itemCount !== undefined && lib.itemCount > 0 && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-md font-mono font-bold shrink-0 ${
                        active ? 'bg-black/20 text-black' : 'bg-white/10 text-slate-400 group-hover:text-slate-200'
                      }`}>
                        {lib.itemCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}

            {/* Admin Add Library Button */}
            {isAdmin && (
              <button
                onClick={() => handleNavClick('/admin')}
                className="w-full mt-1 px-3 py-2 rounded-2xl border border-dashed border-white/15 hover:border-cinema-gold/50 text-[11px] text-slate-400 hover:text-cinema-gold font-semibold flex items-center justify-center gap-2 transition-all group hover:bg-cinema-gold/5"
              >
                <Plus className="w-3.5 h-3.5 text-cinema-gold transition-transform group-hover:rotate-90" />
                <span>Добавить библиотеку</span>
              </button>
            )}
          </div>
        </div>

        {/* Social & Room Section */}
        <div className="flex flex-col gap-2">
          <div className="px-2">
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
              Совместно
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <button
              onClick={() => handleNavClick('/rooms')}
              className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all group ${
                isActive('/rooms')
                  ? 'bg-cinema-gold text-black font-bold shadow-glow-gold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Radio className={`w-4 h-4 ${isActive('/rooms') ? 'text-black' : 'text-cinema-gold'}`} />
                <span>Комнаты</span>
              </div>
              <ChevronRight className={`w-3.5 h-3.5 opacity-50 group-hover:translate-x-0.5 transition-transform ${isActive('/rooms') ? 'text-black' : ''}`} />
            </button>

            <button
              onClick={() => handleNavClick('/friends')}
              className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all group ${
                isActive('/friends')
                  ? 'bg-cinema-gold text-black font-bold shadow-glow-gold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Users className={`w-4 h-4 ${isActive('/friends') ? 'text-black' : 'text-cinema-gold'}`} />
                <span>Друзья</span>
              </div>
              <ChevronRight className={`w-3.5 h-3.5 opacity-50 group-hover:translate-x-0.5 transition-transform ${isActive('/friends') ? 'text-black' : ''}`} />
            </button>
          </div>
        </div>

        {/* Admin Server Management */}
        {isAdmin && (
          <div className="flex flex-col gap-2">
            <div className="px-2">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                Сервер
              </span>
            </div>

            <button
              onClick={() => handleNavClick('/admin')}
              className={`w-full px-3.5 py-2.5 rounded-2xl text-xs font-semibold flex items-center justify-between transition-all group ${
                isActive('/admin')
                  ? 'bg-cinema-gold text-black font-bold shadow-glow-gold'
                  : 'text-slate-300 hover:text-white hover:bg-white/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <Shield className={`w-4 h-4 ${isActive('/admin') ? 'text-black' : 'text-cinema-gold'}`} />
                <span>Панель сервера</span>
              </div>
              <ChevronRight className={`w-3.5 h-3.5 opacity-50 group-hover:translate-x-0.5 transition-transform ${isActive('/admin') ? 'text-black' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="pt-4 border-t border-white/5 flex flex-col gap-1 px-2">
        <span className="text-[10px] text-slate-600 font-mono">SkyCine Cinema Server</span>
        <span className="text-[9px] text-slate-600">v2.0.0 • Multi-room sync</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar (Permanent) */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-cinema-950/70 backdrop-blur-2xl border-r border-white/10 sticky top-20 h-[calc(100vh-5rem)] z-30">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer (Slide-over) */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden animate-fade-in flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
            onClick={onCloseMobile}
          />

          {/* Drawer content */}
          <div className="relative w-72 max-w-[85vw] h-full bg-cinema-950 border-r border-white/15 shadow-2xl z-10 flex flex-col animate-slide-right">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
