import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Users, Shield, LogOut, User as UserIcon,
  Play, Menu, Radio
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface NavbarProps {
  onToggleSidebar?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onToggleSidebar }) => {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isPlayerScreen =
    location.pathname.startsWith('/watch') ||
    (/^\/rooms\/[a-zA-Z0-9_-]+$/.test(location.pathname) && location.pathname !== '/rooms');

  if (isPlayerScreen) {
    return null;
  }

  const isActive = (path: string) => location.pathname === path;

  const navLinks = [
    { path: '/rooms', label: 'Комнаты', icon: Radio },
    { path: '/friends', label: 'Друзья', icon: Users },
  ];

  if (isAdmin) {
    navLinks.push({ path: '/admin', label: 'Панель сервера', icon: Shield });
  }

  const handleLogout = () => {
    logout();
    navigate('/auth');
  };

  return (
    <header className="sticky top-0 z-40 bg-cinema-950/80 backdrop-blur-xl border-b border-white/10 h-20">
      <div className="w-full px-4 md:px-8 h-full flex items-center justify-between">
        {/* Left: Mobile Toggle & Brand Logo */}
        <div className="flex items-center gap-3">
          {user && (
            <button
              onClick={onToggleSidebar}
              className="md:hidden p-2 rounded-xl bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
              title="Открыть меню библиотек"
            >
              <Menu className="w-5 h-5" />
            </button>
          )}

          <Link to="/" className="flex items-center gap-3 group">
            {/* Cinematic clapper mark */}
            <div className="relative w-10 h-10 rounded-2xl overflow-hidden bg-gradient-to-br from-yellow-300 via-cinema-gold to-amber-600 shadow-glow-gold ring-1 ring-yellow-200/30 transition-all duration-300 group-hover:scale-105 group-hover:shadow-[0_0_32px_-4px_rgba(229,160,13,0.7)]">
              <div className="absolute top-0 inset-x-0 h-2.5 bg-[repeating-linear-gradient(-45deg,#07090e_0_4px,#fde68a_4px_8px)] shadow-[0_1px_3px_rgba(0,0,0,0.35)]" />
              <div className="absolute inset-0 flex items-center justify-center pt-1.5">
                <Play className="w-4 h-4 text-black fill-black ml-0.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]" />
              </div>
              <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-logo-shine bg-gradient-to-r from-transparent via-white/45 to-transparent" />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/25" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-extrabold tracking-wider font-['Outfit']">
                <span className="bg-gradient-to-r from-slate-100 via-white to-slate-300 bg-clip-text text-transparent">Sky</span>
                <span className="bg-gradient-to-r from-yellow-300 via-cinema-gold to-amber-500 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(229,160,13,0.35)] transition-[filter] duration-300 group-hover:drop-shadow-[0_0_16px_rgba(229,160,13,0.75)]">Cine</span>
              </span>
              <span className="text-[10px] text-cinema-gold/90 font-semibold uppercase tracking-widest -mt-1 hidden sm:block transition-colors group-hover:text-yellow-300">
                Personal Cinema &amp; Sync
              </span>
            </div>
          </Link>
        </div>

        {/* Right Nav & User Area */}
        <div className="flex items-center gap-3 md:gap-4">
          {/* Desktop Navigation */}
          {user && (
            <nav className="hidden md:flex items-center gap-1 bg-white/5 border border-white/5 p-1 rounded-2xl">
              {navLinks.map((link) => {
                const Icon = link.icon;
                const active = isActive(link.path);
                return (
                  <Link
                    key={link.path}
                    to={link.path}
                    className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
                      active
                        ? 'bg-cinema-gold text-black shadow-glow-gold'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{link.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}

          {/* User Profile / Auth Area */}
          {user ? (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2.5 p-1.5 pr-3 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
              >
                <img
                  src={user.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`}
                  alt={user.username}
                  className="w-8 h-8 rounded-full bg-cinema-800 object-cover"
                />
                <div className="hidden sm:flex flex-col text-left">
                  <span className="text-xs font-bold text-white">{user.username}</span>
                  <span className="text-[10px] text-cinema-gold uppercase font-bold tracking-wider">
                    {user.role}
                  </span>
                </div>
              </button>

              {/* User Dropdown Menu */}
              {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-cinema-900 border border-white/15 rounded-2xl p-2 shadow-2xl z-50 animate-fade-in flex flex-col gap-1 text-xs">
                  <Link
                    to="/friends"
                    onClick={() => setShowUserMenu(false)}
                    className="p-2.5 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white flex items-center gap-2 transition-colors"
                  >
                    <Users className="w-4 h-4 text-cinema-gold" />
                    <span>Друзья и заявки</span>
                  </Link>

                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setShowUserMenu(false)}
                      className="p-2.5 rounded-xl hover:bg-white/10 text-slate-300 hover:text-white flex items-center gap-2 transition-colors"
                    >
                      <Shield className="w-4 h-4 text-cinema-gold" />
                      <span>Панель сервера</span>
                    </Link>
                  )}

                  <div className="my-1 border-t border-white/10" />

                  <button
                    onClick={handleLogout}
                    className="p-2.5 rounded-xl hover:bg-red-500/20 text-red-400 flex items-center gap-2 transition-colors w-full text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Выйти</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/auth"
              className="px-5 py-2.5 rounded-2xl bg-cinema-gold text-black font-bold text-xs shadow-glow-gold hover:bg-yellow-400 transition-all"
            >
              Войти / Регистрация
            </Link>
          )}
        </div>
      </div>
    </header>
  );
};
