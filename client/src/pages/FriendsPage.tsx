import React from 'react';
import { FriendsHub } from '../components/friends/FriendsHub';
import { Users } from 'lucide-react';

export const FriendsPage: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 flex flex-col gap-8">
      <div>
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight flex items-center gap-2.5">
          <Users className="w-7 h-7 text-cinema-gold" />
          Друзья и Социальная сеть
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Добавляйте друзей, смотрите их статус в реальном времени и приглашайте на совместные киносеансы
        </p>
      </div>

      <FriendsHub />
    </div>
  );
};
