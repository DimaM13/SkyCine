import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, X, Play } from 'lucide-react';
import { useSocket } from '../../context/SocketContext';

export const InviteToast: React.FC = () => {
  const { currentInvite, clearInvite } = useSocket();
  const navigate = useNavigate();

  if (!currentInvite) return null;

  const handleJoin = () => {
    const code = currentInvite.roomCode;
    clearInvite();
    navigate(`/rooms/${code}`);
  };

  return (
    <div className="fixed top-6 right-6 z-50 animate-bounce max-w-sm w-full">
      <div className="bg-cinema-900/95 border-2 border-cinema-gold/60 rounded-3xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <img
              src={currentInvite.senderAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${currentInvite.senderUsername}`}
              alt={currentInvite.senderUsername}
              className="w-10 h-10 rounded-full bg-cinema-800 object-cover border border-cinema-gold"
            />
            <div>
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-cinema-gold" />
                <span className="text-xs font-bold text-white">Приглашение на просмотр!</span>
              </div>
              <p className="text-xs text-slate-300">
                <b className="text-cinema-gold">{currentInvite.senderUsername}</b> зовёт вас смотреть:
              </p>
            </div>
          </div>

          <button
            onClick={clearInvite}
            className="p-1 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Media Thumbnail & Title */}
        <div className="flex items-center gap-3 p-2.5 rounded-2xl bg-white/5 border border-white/5">
          {currentInvite.posterPath && (
            <img
              src={currentInvite.posterPath}
              alt={currentInvite.mediaTitle}
              className="w-10 h-14 rounded-lg object-cover"
            />
          )}
          <div className="flex-1 overflow-hidden">
            <span className="text-xs font-bold text-white block truncate">{currentInvite.mediaTitle}</span>
            <span className="text-[10px] text-slate-400">Комната: {currentInvite.roomTitle}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={clearInvite}
            className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold text-slate-300 hover:text-white transition-colors"
          >
            Позже
          </button>
          <button
            onClick={handleJoin}
            className="flex-1 py-2 rounded-xl bg-cinema-gold text-black text-xs font-bold flex items-center justify-center gap-1.5 shadow-glow-gold hover:bg-yellow-400 transition-all"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Присоединиться</span>
          </button>
        </div>
      </div>
    </div>
  );
};
