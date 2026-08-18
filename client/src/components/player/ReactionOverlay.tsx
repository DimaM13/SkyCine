import React from 'react';
import { RoomReaction } from '../../types';

interface ReactionOverlayProps {
  reactions: RoomReaction[];
}

export const ReactionOverlay: React.FC<ReactionOverlayProps> = ({ reactions }) => {
  if (reactions.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-30">
      {reactions.map((reaction, index) => {
        // Pseudo-random horizontal placement based on index & timestamp
        const leftPercent = 15 + ((reaction.timestamp + index * 17) % 70);
        return (
          <div
            key={reaction.id}
            className="absolute bottom-16 animate-float-reaction flex flex-col items-center select-none"
            style={{ left: `${leftPercent}%` }}
          >
            <span className="text-4xl filter drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]">
              {reaction.emoji}
            </span>
            <span className="text-[10px] text-white/80 bg-black/60 px-1.5 py-0.5 rounded-full mt-1 backdrop-blur-sm">
              {reaction.username}
            </span>
          </div>
        );
      })}
    </div>
  );
};
