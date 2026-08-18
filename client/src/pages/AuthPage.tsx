import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Film, Play, Lock, User, Mail, Sparkles, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const AuthPage: React.FC = () => {
  const { login, register, user } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [loading, setLoading] = useState(false);

  if (user) {
    navigate('/');
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setLoading(true);

    try {
      if (mode === 'login') {
        await login({ login: username, password });
      } else {
        await register({ username, email, password });
      }
      navigate('/');
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Ошибка аутентификации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-4 relative overflow-hidden bg-cinema-950">
      {/* Ambient background glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cinema-gold/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="w-full max-w-md bg-cinema-900/90 border border-white/15 rounded-3xl p-8 shadow-2xl backdrop-blur-2xl relative z-10 flex flex-col gap-6">
        {/* Branding Logo Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-14 h-14 rounded-3xl bg-gradient-to-tr from-cinema-gold to-yellow-300 flex items-center justify-center shadow-glow-gold">
            <Play className="w-7 h-7 text-black fill-black ml-1" />
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-wide font-['Outfit'] mt-2">
            Добро пожаловать в Sky<span className="text-cinema-gold">Cine</span>
          </h2>
          <p className="text-xs text-slate-400">
            Персональный медиасервер и совместный просмотр с друзьями
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 p-1 rounded-2xl bg-cinema-950 border border-white/10">
          <button
            type="button"
            onClick={() => {
              setMode('login');
              setErrorMsg('');
            }}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
              mode === 'login'
                ? 'bg-cinema-gold text-black shadow-glow-gold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Вход
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg('');
            }}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
              mode === 'register'
                ? 'bg-cinema-gold text-black shadow-glow-gold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Регистрация
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              {mode === 'login' ? 'Имя пользователя или Email' : 'Имя пользователя'}
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                placeholder={mode === 'login' ? 'alex_movie' : 'Придумайте логин'}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold transition-colors"
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Email</label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  placeholder="alex@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold transition-colors"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">Пароль</label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-cinema-950 border border-white/10 rounded-2xl pl-10 pr-4 py-3 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 w-full py-3.5 rounded-2xl bg-cinema-gold text-black font-extrabold text-xs tracking-wide shadow-glow-gold hover:bg-yellow-400 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {loading ? 'Обработка...' : mode === 'login' ? 'Войти в кинозал' : 'Создать аккаунт'}
          </button>
        </form>
      </div>
    </div>
  );
};
