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
  segmentDuration?: number;
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

export type RoomSourceType = 'LOCAL' | 'YOUTUBE';

export interface Room {
  id: string;
  code: string;
  title: string;
  hostUserId: string;
  mediaItemId?: string | null;
  sourceType: RoomSourceType;
  youtubeId?: string | null;
  youtubeUrl?: string | null;
  youtubeTitle?: string | null;
  youtubeThumbnail?: string | null;
  youtubeEngine?: 'iframe' | 'server_stream';
  state: RoomState;
  currentPosition: number;
  serverTimestamp: number;
  mediaTitle?: string;
  posterPath?: string;
  backdropPath?: string;
  durationSeconds?: number;
  segmentDuration?: number;
  hostUsername?: string;
  hostAvatar?: string;
}

export type MemberHealthStatus = 'ok' | 'warning' | 'lagging' | 'buffering' | 'offline';

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
  streamMode?: 'direct' | 'fmp4';
  joinedAt: string;
  // ── Room Health telemetry (Watch Together diagnostics) ──
  isBuffering?: boolean;
  isPlaying?: boolean;
  bufferedAheadSec?: number;
  stallCount?: number;
  stallMs?: number;
  rttMs?: number;
  droppedFrames?: number;
  platform?: 'web' | 'desktop' | 'mobile' | string;
  hwdec?: string;
  healthStatus?: MemberHealthStatus;
  lastHealthUpdate?: number;
}

export interface RoomHealthEntry {
  userId: string;
  username: string;
  avatarUrl?: string;
  status: MemberHealthStatus;
  isBuffering: boolean;
  bufferedAheadSec: number;
  stallCount: number;
  rttMs: number;
  droppedFrames: number;
  driftSec: number;
  platform?: string;
  streamMode?: string;
  currentPosition: number;
  detail: string;
}

export interface RoomActionFeedEntry {
  id: string;
  userId: string;
  username: string;
  avatarUrl?: string;
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'JOIN' | 'LEAVE' | 'SYNC' | 'BUFFERING' | 'RECOVERED';
  position?: number;
  text: string;
  timestamp: number;
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
