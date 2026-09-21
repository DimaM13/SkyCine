import { Router } from 'express';
import { logger } from '../services/logger.service';
import { AuthController } from '../controllers/auth.controller';
import { FriendsController } from '../controllers/friends.controller';
import { LibraryController } from '../controllers/library.controller';
import { MediaController } from '../controllers/media.controller';
import { StreamController } from '../controllers/stream.controller';
import { YouTubeController } from '../controllers/youtube.controller';
import { RoomsController } from '../controllers/rooms.controller';
import { AdminController } from '../controllers/admin.controller';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.middleware';
import { authRateLimit, debugRateLimit } from '../middleware/rate-limit.middleware';

const router = Router();

// --- Auth Routes (рейт-лимит: душит перебор паролей) ---
router.post('/auth/register', authRateLimit, AuthController.register);
router.post('/auth/login', authRateLimit, AuthController.login);
router.get('/auth/me', authenticateToken, AuthController.me);
router.put('/auth/profile', authenticateToken, AuthController.updateProfile);

// --- Friends Routes ---
router.get('/friends', authenticateToken, FriendsController.getFriends);
router.get('/friends/requests', authenticateToken, FriendsController.getFriendRequests);
router.get('/friends/search', authenticateToken, FriendsController.searchUsers);
router.post('/friends/request', authenticateToken, FriendsController.sendFriendRequest);
router.post('/friends/accept/:requestId', authenticateToken, FriendsController.acceptFriendRequest);
router.delete('/friends/decline/:requestId', authenticateToken, FriendsController.declineFriendRequest);
router.delete('/friends/remove/:friendId', authenticateToken, FriendsController.removeFriend);

// --- Library Routes ---
router.get('/libraries', authenticateToken, LibraryController.getLibraries);
router.post('/libraries', requireAdmin, LibraryController.createLibrary);
router.post('/libraries/add-folder', requireAdmin, LibraryController.addFolder);
router.post('/libraries/:libraryId/add-folder', requireAdmin, LibraryController.addFolder);
router.post('/libraries/add-file', requireAdmin, LibraryController.addSingleFile);
router.post('/libraries/add-show-folder', requireAdmin, LibraryController.addShowFolder);
router.delete('/libraries/:libraryId', requireAdmin, LibraryController.deleteLibrary);
router.post('/libraries/:libraryId/scan', requireAdmin, LibraryController.scanLibrary);
router.post('/libraries/scan-all', requireAdmin, LibraryController.scanAll);
router.get('/libraries/scan-status', authenticateToken, LibraryController.getScanStatus);

// --- Media Routes ---
router.get('/media/movies', authenticateToken, MediaController.getMovies);
router.get('/media/shows', authenticateToken, MediaController.getShows);
router.get('/media/shows/:showTitle/episodes', authenticateToken, MediaController.getShowEpisodes);
router.get('/media/item/:id', authenticateToken, MediaController.getMediaItem);
router.get('/media/item/:id/thumbnail', MediaController.getThumbnail);
router.get('/media/continue-watching', authenticateToken, MediaController.getContinueWatching);
router.post('/media/progress', authenticateToken, MediaController.updateProgress);
router.get('/media/shows/match-search', requireAdmin, MediaController.searchShowMatch);
router.post('/media/shows/:showTitle/match-apply', requireAdmin, MediaController.applyShowMatch);
router.get('/media/:id/match-search', requireAdmin, MediaController.searchMatch);
router.post('/media/:id/match-apply', requireAdmin, MediaController.applyMatch);
router.delete('/media/:id', requireAdmin, MediaController.deleteMedia);

// --- YouTube Direct Stream Routes (yt-dlp fallback) ---
router.get('/stream/youtube/download-status/:videoId', YouTubeController.getDownloadStatus);
router.get('/stream/youtube/info/:videoId', YouTubeController.getInfo);
router.get('/stream/youtube/:videoId', YouTubeController.stream);

// --- Stream Routes ---
router.get('/stream/:id/info', authenticateToken, StreamController.getStreamInfo);
router.get('/stream/:id/direct', authenticateToken, StreamController.directStream);
router.get('/stream/:id/direct/:filename', authenticateToken, StreamController.directStream);
router.get('/stream/:id/remux', authenticateToken, StreamController.remuxStream);
router.get('/stream/:id/master.m3u8', authenticateToken, StreamController.getHlsMaster);
router.get('/stream/hls/session/start/:id', authenticateToken, StreamController.startHlsSession);
router.post('/stream/hls/session/end', optionalAuth, StreamController.endHlsSession);
router.get('/stream/hls/session/:sessionId/playlist.m3u8', StreamController.getHlsSessionPlaylist);
router.get('/stream/hls/session/:sessionId/:segmentName', StreamController.getHlsSessionSegment);
router.get('/stream/hls/:sessionId/:segmentName', StreamController.getHlsSessionSegment);
router.get('/stream/:mediaId/:segmentName', StreamController.getHlsSessionSegment);
router.get('/stream/:id/subtitle/:trackIndex', StreamController.getSubtitle);

// --- Rooms (Watch Together) Routes ---
router.get('/rooms', authenticateToken, RoomsController.getRooms);
router.post('/rooms', authenticateToken, RoomsController.createRoom);
router.get('/rooms/:codeOrId', authenticateToken, RoomsController.getRoom);
router.delete('/rooms/:roomId', authenticateToken, RoomsController.deleteRoom);

import { PermissionController } from '../controllers/permission.controller';

// --- Admin Permissions Routes ---
router.get('/admin/permissions/user/:userId', requireAdmin, PermissionController.getUserPermissions);
router.post('/admin/permissions/user/:userId', requireAdmin, PermissionController.setUserPermissions);
router.get('/admin/permissions/media/:mediaId', requireAdmin, PermissionController.getMediaAccess);
router.post('/admin/permissions/media/:mediaId', requireAdmin, PermissionController.setMediaAccess);
router.get('/admin/permissions/show/:showTitle', requireAdmin, PermissionController.getShowAccess);
router.post('/admin/permissions/show/:showTitle', requireAdmin, PermissionController.setShowAccess);
router.get('/admin/permissions/library/:libraryId', requireAdmin, PermissionController.getLibraryAccess);
router.post('/admin/permissions/library/:libraryId', requireAdmin, PermissionController.setLibraryAccess);

// --- Admin Panel Routes ---
router.get('/admin/status', requireAdmin, AdminController.getSystemStatus);
router.get('/admin/settings', requireAdmin, AdminController.getSettings);
router.put('/admin/settings', requireAdmin, AdminController.updateSettings);
router.get('/admin/users', requireAdmin, AdminController.getUsers);
router.put('/admin/users/:userId/role', requireAdmin, AdminController.updateUserRole);
router.delete('/admin/users/:userId', requireAdmin, AdminController.deleteUser);
router.get('/admin/logs', requireAdmin, AdminController.getLogs);
router.delete('/admin/logs', requireAdmin, AdminController.clearLogs);
router.get('/admin/fs/browse', requireAdmin, AdminController.browseFilesystem);
router.post('/admin/restart', requireAdmin, AdminController.restartServer);

// --- TV Remote Logging Routes (Tizen & WebOS, публичные — с рейт-лимитом от флуда) ---
router.post('/debug/tizen-log', debugRateLimit, (req, res) => {
  const { level = 'info', tag = 'TIZEN', message = '', data } = req.body;
  const detail = data !== undefined ? ` | ${typeof data === 'object' ? JSON.stringify(data) : data}` : '';
  const fullMsg = `${message}${detail}`;
  if (level === 'error') {
    logger.error(tag, fullMsg);
  } else if (level === 'warn') {
    logger.warn(tag, fullMsg);
  } else {
    logger.info(tag, fullMsg);
  }
  res.json({ ok: true });
});

router.post('/debug/webos-log', debugRateLimit, (req, res) => {
  const { level = 'info', tag = 'WEBOS_APP', message = '', data } = req.body;
  const detail = data !== undefined ? ` | ${typeof data === 'object' ? JSON.stringify(data) : data}` : '';
  const fullMsg = `${message}${detail}`;
  if (level === 'error') {
    logger.error(tag, fullMsg);
  } else if (level === 'warn') {
    logger.warn(tag, fullMsg);
  } else {
    logger.info(tag, fullMsg);
  }
  res.json({ ok: true });
});

// --- Player Telemetry (браузерный плеер шлёт сюда ошибки video/hls + сводку) ---
router.post('/debug/player-log', debugRateLimit, (req, res) => {
  const body = (req.body || {}) as Record<string, any>;
  const level = body.level === 'error' ? 'error' : body.level === 'warn' ? 'warn' : 'info';
  // Режем размер: клиент может слать UA и buffered-строки
  const safe = (v: any, n: number) => String(v ?? '').slice(0, n);
  const fullMsg =
    `[${safe(body.event, 24)}] media=${safe(body.mediaId, 40)} mount=${safe(body.mount, 12)} ` +
    `t=${safe(body.currentTime, 12)} buf=${safe(body.buffered, 64)} ` +
    `err=${safe(body.errorCode, 8)}/${safe(body.errorMessage, 160)} ` +
    `detail=${safe(body.detail, 200)} ua=${safe(body.ua, 120)}`;
  if (level === 'error') {
    logger.error('PLAYER', fullMsg);
  } else if (level === 'warn') {
    logger.warn('PLAYER', fullMsg);
  } else {
    logger.info('PLAYER', fullMsg);
  }
  res.json({ ok: true });
});

export default router;
