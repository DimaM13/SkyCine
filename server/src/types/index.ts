export type UserRole = 'ADMIN' | 'USER';

export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  avatarUrl?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export type FriendshipStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'BLOCKED';

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: FriendshipStatus;
  createdAt: string;
  updatedAt: string;
}

export type LibraryType = 'MOVIES' | 'SHOWS' | 'VIDEOS';

export interface Library {
  id: string;
  name: string;
  type: LibraryType;
  path?: string;
  lastScannedAt?: string;
  createdAt: string;
}

export type MediaType = 'MOVIE' | 'EPISODE' | 'VIDEO';

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
  title: string;
  originalTitle?: string;
  type: MediaType;
  year?: number;
  overview?: string;
  posterPath?: string;
  backdropPath?: string;
  stillPath?: string;
  rating?: number;
  genres?: string; // JSON array or comma separated
  durationSeconds: number;
  filePath: string;
  fileSize: number;
  resolution?: string; // e.g. "1080p", "4K", "720p"
  videoCodec?: string;
  audioCodec?: string;
  // For TV Shows:
  showTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  streamDetails?: any;
  createdAt: string;
  updatedAt: string;
  tracks?: MediaTrack[];
}

export interface WatchHistory {
  id: string;
  userId: string;
  mediaItemId: string;
  progressSeconds: number;
  durationSeconds: number;
  isCompleted: boolean;
  lastWatchedAt: string;
  mediaItem?: MediaItem;
}

export type RoomState = 'PLAYING' | 'PAUSED' | 'BUFFERING';

export interface Room {
  id: string;
  code: string;
  title: string;
  hostUserId: string;
  mediaItemId: string;
  state: RoomState;
  currentPosition: number;
  serverTimestamp: number;
  playbackRate: number;
  isPrivate: boolean;
  password?: string;
  createdAt: string;
  mediaItem?: MediaItem;
  hostUser?: Partial<User>;
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
  joinedAt: string;
}

export interface ServerSettings {
  serverName: string;
  tmdbApiKey: string;
  transcodeHardware: 'auto' | 'nvenc' | 'qsv' | 'amf' | 'vaapi' | 'cpu';
  maxTranscodeBitrate: number; // in kbps
  transcodeTempDir: string;
  allowPublicRegistration: boolean;
}

export interface TranscodeSession {
  sessionId: string;
  mediaId: string;
  userId?: string;
  startTime: number;
  type: 'DIRECT_PLAY' | 'DIRECT_STREAM' | 'TRANSCODE';
  clientIp?: string;
  quality: string;
  audioTrackIndex?: number;
  subtitleTrackIndex?: number;
  fps?: number;
  progress?: number;
  speed?: string;
}
