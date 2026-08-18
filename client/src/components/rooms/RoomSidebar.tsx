import React, { useState, useRef, useEffect } from 'react';
import { Send, Users, MessageSquare, Sparkles, UserPlus, X } from 'lucide-react';
import { RoomMember, RoomChatMessage } from '../../types';

interface RoomSidebarProps {
  members: RoomMember[];
  messages: RoomChatMessage[];
  onSendMessage: (text: string) => void;
  onSendReaction: (emoji: string) => void;
  onOpenInviteModal: () => void;
  onClose?: () => void;
}

const EMOJI_LIST = ['🍿', '❤️', '😂', '🔥', '😱', '👏', '⚡', '🎉'];

export const RoomSidebar: React.FC<RoomSidebarProps> = ({
  members,
  messages,
  onSendMessage,
  onSendReaction,
  onOpenInviteModal,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'members'>('chat');
  const [inputText, setInputText] = useState('');
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {onClose && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden animate-fade-in"
          onClick={onClose}
        />
      )}

      <div className="fixed inset-x-0 bottom-0 h-[68vh] md:h-full md:static md:w-96 bg-cinema-900/98 md:bg-cinema-900/95 border-t md:border-t-0 md:border-l border-white/15 flex flex-col backdrop-blur-2xl z-40 rounded-t-3xl md:rounded-none shadow-2xl md:shadow-none transition-all">
        {/* Mobile Pull Handle */}
        <div className="w-12 h-1 bg-white/20 rounded-full mx-auto mt-2.5 mb-1 md:hidden" />

        {/* Header Tabs */}
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex bg-cinema-950 p-1 rounded-2xl border border-white/10">
            <button
              onClick={() => setActiveTab('chat')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'chat'
                  ? 'bg-cinema-gold text-black shadow-glow-gold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Чат ({messages.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('members')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'members'
                  ? 'bg-cinema-gold text-black shadow-glow-gold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Участники ({members.length})</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={onOpenInviteModal}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
              title="Пригласить друзей"
            >
              <UserPlus className="w-4 h-4 text-cinema-gold" />
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="md:hidden p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white transition-colors"
                title="Закрыть чат"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'chat' ? (
          <div ref={chatScrollRef} className="flex flex-col gap-3 h-full overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-500">
                <Sparkles className="w-8 h-8 text-cinema-gold/40 mb-2" />
                <p className="text-xs">Здесь пока тихо. Напишите первое сообщение или отправьте реакцию!</p>
              </div>
            ) : (
              messages.map((msg) => {
                const isSystem = msg.userId === 'system';
                if (isSystem) {
                  return (
                    <div key={msg.id} className="text-center my-1">
                      <span className="text-[11px] text-slate-400 bg-white/5 px-2.5 py-1 rounded-full border border-white/5">
                        {msg.text}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="flex items-start gap-2.5 animate-fade-in">
                    <img
                      src={msg.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${msg.username}`}
                      alt={msg.username}
                      className="w-7 h-7 rounded-full bg-cinema-800 shrink-0 mt-0.5 object-cover"
                    />
                    <div className="flex flex-col max-w-[80%]">
                      <div className="flex items-baseline gap-2">
                        <span className="text-xs font-bold text-slate-200">{msg.username}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-100 bg-white/10 rounded-2xl rounded-tl-sm px-3 py-2 border border-white/5 break-words">
                        {msg.text}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
              В комнате прямо сейчас
            </span>

            {members.map((member) => (
              <div
                key={member.socketId}
                className="flex items-center justify-between p-3 rounded-2xl bg-white/5 border border-white/5"
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <img
                      src={member.avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${member.username}`}
                      alt={member.username}
                      className="w-8 h-8 rounded-full bg-cinema-800 object-cover"
                    />
                    <span
                      className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-cinema-900 ${
                        member.isReady ? 'bg-emerald-400' : 'bg-amber-400 animate-ping'
                      }`}
                    />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-white block">{member.username}</span>
                    <span className="text-[10px] text-slate-400">
                      {member.isReady ? 'Синхронизирован' : 'Буферизация...'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    {member.isReady ? 'Готов' : 'Загрузка'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Emoji Reaction Bar */}
      <div className="px-3 py-2 border-t border-white/10 bg-cinema-950/50 flex items-center justify-around">
        {EMOJI_LIST.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onSendReaction(emoji)}
            className="text-lg hover:scale-125 transform transition-transform active:scale-95 p-1"
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Input Message Bar */}
      <form onSubmit={handleSend} className="p-3 border-t border-white/10 bg-cinema-950 flex items-center gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Написать в чат..."
          className="flex-1 bg-cinema-900 border border-white/10 rounded-2xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold/60 transition-colors"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="p-2.5 rounded-2xl bg-cinema-gold text-black font-semibold disabled:opacity-40 disabled:hover:bg-cinema-gold shadow-glow-gold hover:bg-yellow-400 transition-all shrink-0"
        >
          <Send className="w-4 h-4" />
        </button>
        </form>
      </div>
    </>
  );
};
