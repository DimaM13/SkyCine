import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Share2, Sparkles, Film } from 'lucide-react';
import { apiClient } from '../api/client';
import { CustomPlayer } from '../components/player/CustomPlayer';
import { RoomSidebar } from '../components/rooms/RoomSidebar';
import { InviteFriendsModal } from '../components/rooms/InviteFriendsModal';
import { useSyncPlayer } from '../hooks/useSyncPlayer';
import { useAuth } from '../context/AuthContext';
import { Room, MediaItem } from '../types';

export const RoomPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [room, setRoom] = useState<Room | null>(null);
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!code) return;
    setLoading(true);
    apiClient.get(`/rooms/${code}`)
      .then((res) => {
        const roomData = res.data.room;
        setRoom(roomData);
        setMedia({
          id: roomData.mediaItemId,
          libraryId: roomData.libraryId || '',
          title: roomData.mediaTitle || roomData.title,
          originalTitle: roomData.originalTitle || '',
          type: roomData.type || 'MOVIE',
          year: roomData.year,
          overview: roomData.overview,
          posterPath: roomData.posterPath,
          backdropPath: roomData.backdropPath,
          rating: roomData.rating,
          genres: roomData.genres,
          durationSeconds: roomData.durationSeconds || 0,
          filePath: roomData.filePath || '',
          fileSize: roomData.fileSize || 0,
          resolution: roomData.resolution,
          videoCodec: roomData.videoCodec,
          audioCodec: roomData.audioCodec,
          tracks: roomData.tracks || [],
        });
      })
      .catch((err) => {
        alert('Комната не найдена');
        navigate('/rooms');
      })
      .finally(() => setLoading(false));
  }, [code, navigate]);

  const doSeekRef = useRef<((pos: number, shouldPlay?: boolean) => void) | null>(null);
  const getCurrentTimeRef = useRef<(() => number) | null>(null);

  const { user } = useAuth();

  const {
    roomState,
    members,
    messages,
    reactions,
    syncDiffMs,
    syncQuality,
    syncToHost,
    forceSyncAll,
    isHost,
    sendPlay,
    sendPause,
    sendSeek,
    sendMessage,
    sendReaction,
    sendFriendInvite,
    reportBufferStatus,
  } = useSyncPlayer({
    room,
    videoRef,
    onSeekTo: (pos: number, shouldPlay?: boolean) => {
      if (doSeekRef.current) {
        doSeekRef.current(pos, shouldPlay);
      } else if (videoRef.current) {
        videoRef.current.currentTime = pos;
        if (shouldPlay) {
          videoRef.current.play().catch(() => {});
        }
      }
    },
    getCurrentTime: () => {
      if (getCurrentTimeRef.current) {
        return getCurrentTimeRef.current();
      }
      return videoRef.current?.currentTime || 0;
    },
  });

  if (loading || !room || !media) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Подключение к комнате совместного просмотра...</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden bg-black relative select-none touch-none">
      {/* Main Video Screen Area */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-black">
        {/* Video Player */}
        <div className="flex-1 w-full h-full">
          <CustomPlayer
            media={media}
            roomState={roomState}
            syncDiffMs={syncDiffMs}
            syncQuality={syncQuality}
            isWatchTogether={true}
            isHost={isHost}
            onForceSyncAll={forceSyncAll}
            onSyncToHost={syncToHost}
            members={members}
            currentUserId={user?.id}
            hostUserId={room.hostUserId}
            reactions={reactions}
            initialPosition={room.currentPosition || 0}
            initialPlaying={room.state === 'PLAYING'}
            onPlayRequest={sendPlay}
            onPauseRequest={sendPause}
            onSeekRequest={sendSeek}
            onBufferStatusChange={reportBufferStatus}
            onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
            isSidebarOpen={isSidebarOpen}
            onBack={() => navigate('/rooms')}
            onInvite={() => setIsInviteModalOpen(true)}
            onAttachSeekHandler={(fn) => { doSeekRef.current = fn; }}
            onAttachGetCurrentTime={(fn) => { getCurrentTimeRef.current = fn; }}
            videoRef={videoRef}
          />
        </div>
      </div>

      {/* Room Sidebar (Members, Live Chat, Reactions) */}
      {isSidebarOpen && (
        <RoomSidebar
          members={members}
          messages={messages}
          onSendMessage={sendMessage}
          onSendReaction={sendReaction}
          onOpenInviteModal={() => setIsInviteModalOpen(true)}
          onClose={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Invite Friends Modal */}
      <InviteFriendsModal
        room={room}
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onInviteFriend={sendFriendInvite}
      />
    </div>
  );
};
