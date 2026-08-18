import React, { useState, useEffect } from 'react';
import { X, Copy, Check, UserPlus, Sparkles } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Friend, Room } from '../../types';

interface InviteFriendsModalProps {
  room: Room;
  isOpen: boolean;
  onClose: () => void;
  onInviteFriend: (friendId: string) => void;
}

export const InviteFriendsModal: React.FC<InviteFriendsModalProps> = ({
  room,
  isOpen,
  onClose,
  onInviteFriend,
}) => {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (isOpen) {
      apiClient.get('/friends')
        .then((res) => setFriends(res.data.friends || []))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const roomLink = `${window.location.origin}/rooms/${room.code}`;

  const copyToClipboard = (text: string, isLink: boolean) => {
    navigator.clipboard.writeText(text);
    if (isLink) {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleInvite = (friendId: string) => {
    onInviteFriend(friendId);
    setInvitedIds((prev) => new Set(prev).add(friendId));
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
      <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-cinema-gold/20 text-cinema-gold">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Пригласить друзей</h3>
              <p className="text-xs text-slate-400">Совместный просмотр: {room.mediaTitle || 'Фильм'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[70vh]">
          {/* Direct Link Section */}
          <div className="flex flex-col gap-2">
            <label className="text-xs font-semibold text-slate-300">Прямая ссылка на комнату</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={roomLink}
                className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none"
              />
              <button
                onClick={() => copyToClipboard(roomLink, true)}
                className="px-3 py-2 rounded-xl bg-cinema-gold text-black font-semibold text-xs flex items-center gap-1.5 shadow-glow-gold hover:bg-yellow-400 transition-all shrink-0"
              >
                {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copiedLink ? 'Скопировано' : 'Копировать'}</span>
              </button>
            </div>
          </div>

          {/* Room Code Badge */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-white/5 border border-white/10">
            <div>
              <span className="text-[11px] text-slate-400 uppercase tracking-wider block">Код комнаты</span>
              <span className="text-lg font-mono font-extrabold text-cinema-gold tracking-widest">{room.code}</span>
            </div>
            <button
              onClick={() => copyToClipboard(room.code, false)}
              className="p-2 text-xs rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              {copiedCode ? 'Скопировано!' : 'Скопировать код'}
            </button>
          </div>

          {/* Friends List for 1-Click Invite */}
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold text-slate-300">Ваши друзья</span>

            {friends.length === 0 ? (
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center text-xs text-slate-400">
                У вас пока нет добавленных друзей. Скопируйте ссылку выше и отправьте её друзьям!
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                {friends.map((friend) => {
                  const isInvited = invitedIds.has(friend.id);
                  return (
                    <div
                      key={friend.id}
                      className="flex items-center justify-between p-2.5 rounded-2xl bg-white/5 border border-white/5 hover:border-white/15 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <img
                            src={friend.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${friend.username}`}
                            alt={friend.username}
                            className="w-9 h-9 rounded-full bg-cinema-800 object-cover"
                          />
                          <span
                            className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-cinema-900 ${
                              friend.isOnline ? 'bg-emerald-400' : 'bg-slate-500'
                            }`}
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-white">{friend.username}</span>
                          <span className="text-[10px] text-slate-400">
                            {friend.isOnline ? 'В сети' : 'Не в сети'}
                          </span>
                        </div>
                      </div>

                      <button
                        disabled={isInvited}
                        onClick={() => handleInvite(friend.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                          isInvited
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-white/10 hover:bg-cinema-gold hover:text-black text-white'
                        }`}
                      >
                        {isInvited ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Отправлено</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-3.5 h-3.5" />
                            <span>Пригласить</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
