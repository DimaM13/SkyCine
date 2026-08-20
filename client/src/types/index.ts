export type UserRole = 'ADMIN' | 'USER';
export type RoomState = 'PLAYING' | 'PAUSED' | 'BUFFERING';

export interface User {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  role: UserRole;
}

export interface Friend {
  id: string;
  username: string;
  email: string;
  avatarUrl?: string;
  role: UserRole;
  friendshipId: string;
  friendsSince: string;
  isOnline: boolean;
  presenceStatus: string;
  currentActivity?: string;
}

export interface FriendRequest {
  id: string;
  createdAt: string;
  requesterId?: string;
  addresseeId?: string;
  username: string;
  avatarUrl?: string;
}

export interface Library {
  id: string;
  name: string;
  type: 'MOVIES' | 'SHOWS' | 'VIDEOS';
  path?: string;
  lastScannedAt?: string;
  itemCount?: number;
}

export interface MediaTrack {
  id: string;
  mediaItemId: string;
  type: 'AUDIO' | 'SUBTITLE';
  streamIndex: number;
  title?: string;
  language?: string;
  codec: string;
  channels?: number;
  isDefault: boolean;
}

export interface MediaItem {
  id: string;
  libraryId: string;
  libraryName?: string;
  title: string;
  originalTitle?: string;
  type: 'MOVIE' | 'EPISODE' | 'VIDEO';
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  stillPath?: string;
  rating?: number;
  genres?: string;
  durationSeconds: number;
  filePath: string;
  fileSize: number;
  resolution?: string;
  videoCodec?: string;
  audioCodec?: string;
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  userProgress?: number;
  userCompleted?: number;
  tracks?: MediaTrack[];
}

export interface ContinueWatchingItem {
  mediaId: string;
  title: string;
  posterPath?: string;
  backdropPath?: string;
  type: 'MOVIE' | 'EPISODE';
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  progressSeconds: number;
  durationSeconds: number;
  fullDuration: number;
}

export type RoomSourceType = 'LOCAL' | 'YOUTUBE';

export interface Room {
  id: string;
  code: string;
  title: string;
  hostUserId: string;
  mediaItemId?: string | null;
  sourceType?: RoomSourceType;
  youtubeId?: string | null;
  youtubeUrl?: string | null;
  youtubeTitle?: string | null;
  youtubeThumbnail?: string | null;
  state: 'PLAYING' | 'PAUSED' | 'BUFFERING';
  currentPosition: number;
  serverTimestamp: number;
  playbackRate: number;
  isPrivate: boolean;
  createdAt: string;
  mediaTitle?: string;
  posterPath?: string;
  backdropPath?: string;
  durationSeconds?: number;
  hostUsername?: string;
  hostAvatar?: string;
}

export interface RoomMember {
  userId: string;
  username: string;
  avatarUrl?: string;
  socketId: string;
  isReady: boolean;
  bufferedPosition: number;
  currentPosition: number;
  pingMs: number;
  bufferPercent?: number;
  joinedAt: string;
}

export interface RoomChatMessage {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  text: string;
  timestamp: number;
}

export interface RoomReaction {
  id: string;
  emoji: string;
  username: string;
  timestamp: number;
}

export interface RoomInviteNotification {
  senderUsername: string;
  senderAvatar?: string;
  roomId: string;
  roomCode: string;
  roomTitle: string;
  mediaTitle: string;
  posterPath?: string;
  timestamp: number;
}

export interface SystemStats {
  cpu: { cores: number; model: string; currentLoad: number };
  memory: { total: number; free: number; used: number; usedPercent: number };
  disks: { fs: string; type: string; size: number; used: number; available: number; usePercent: number; mount: string }[];
  gpus: { model: string; vendor: string; vram: number }[];
  activeStreamsCount: number;
  uptimeSeconds: number;
  activeSessions: any[];
}
