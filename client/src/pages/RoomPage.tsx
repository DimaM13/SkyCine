import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Share2, Sparkles, Film, Video } from 'lucide-react';
import { apiClient } from '../api/client';
import { CustomPlayer } from '../components/player/CustomPlayer';
import { YouTubeSyncPlayer } from '../components/player/YouTubeSyncPlayer';
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
        const roomData: Room = res.data.room;
        setRoom(roomData);

        if (roomData.sourceType !== 'YOUTUBE') {
          setMedia({
            id: roomData.mediaItemId || '',
            libraryId: (roomData as any).libraryId || '',
            title: roomData.mediaTitle || roomData.title,
            originalTitle: (roomData as any).originalTitle || '',
            type: (roomData as any).type || 'MOVIE',
            year: (roomData as any).year,
            overview: (roomData as any).overview,
            posterPath: roomData.posterPath,
            backdropPath: roomData.backdropPath,
            rating: (roomData as any).rating,
            genres: (roomData as any).genres,
            durationSeconds: roomData.durationSeconds || 0,
            filePath: (roomData as any).filePath || '',
            fileSize: (roomData as any).fileSize || 0,
            resolution: (roomData as any).resolution,
            videoCodec: (roomData as any).videoCodec,
            audioCodec: (roomData as any).audioCodec,
            tracks: (roomData as any).tracks || [],
          });
        }
      })
      .catch((err) => {
        alert('Комната не найдена');
        navigate('/rooms');
      })
      .finally(() => setLoading(false));
  }, [code, navigate]);

  const doSeekRef = useRef<((pos: number, shouldPlay?: boolean) => void) | null>(null);
  const doPlayRef = useRef<(() => void) | null>(null);
  const doPauseRef = useRef<(() => void) | null>(null);
  const getCurrentTimeRef = useRef<(() => number) | null>(null);
  const getIsPausedRef = useRef<(() => boolean) | null>(null);

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
    onPlay: () => {
      if (doPlayRef.current) {
        doPlayRef.current();
      } else if (videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    },
    onPause: () => {
      if (doPauseRef.current) {
        doPauseRef.current();
      } else if (videoRef.current) {
        videoRef.current.pause();
      }
    },
    getCurrentTime: () => {
      if (getCurrentTimeRef.current) {
        return getCurrentTimeRef.current();
      }
      return videoRef.current?.currentTime || 0;
    },
    getIsPaused: () => {
      if (getIsPausedRef.current) {
        return getIsPausedRef.current();
      }
      return videoRef.current ? videoRef.current.paused : (roomState !== 'PLAYING');
    },
  });

  if (loading || !room) {
    return (
      <div className="h-[80vh] flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Подключение к комнате совместного просмотра...</span>
      </div>
    );
  }

  const isYouTubeRoom = room.sourceType === 'YOUTUBE';

  return (
    <div className="w-full h-full flex flex-col md:flex-row overflow-hidden bg-black relative select-none touch-none">
      {/* Main Screen Area */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden bg-black">
        <div className="flex-1 w-full h-full">
          {isYouTubeRoom ? (
            <YouTubeSyncPlayer
              room={room}
              roomState={roomState}
              syncDiffMs={syncDiffMs}
              syncQuality={syncQuality}
              isHost={isHost}
              onForceSyncAll={forceSyncAll}
              onSyncToHost={syncToHost}
              members={members}
              currentUserId={user?.id}
              hostUserId={room.hostUserId}
              reactions={reactions}
              onPlayRequest={sendPlay}
              onPauseRequest={sendPause}
              onSeekRequest={sendSeek}
              onBufferStatusChange={reportBufferStatus}
              onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
              isSidebarOpen={isSidebarOpen}
              onBack={() => navigate('/rooms')}
              onInvite={() => setIsInviteModalOpen(true)}
              onSendReaction={sendReaction}
              onAttachSeekHandler={(fn) => { doSeekRef.current = fn; }}
              onAttachPlayHandler={(fn) => { doPlayRef.current = fn; }}
              onAttachPauseHandler={(fn) => { doPauseRef.current = fn; }}
              onAttachGetCurrentTime={(fn) => { getCurrentTimeRef.current = fn; }}
              onAttachGetIsPaused={(fn) => { getIsPausedRef.current = fn; }}
            />
          ) : media ? (
            <CustomPlayer
              media={media}
              room={room}
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
          ) : null}
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
