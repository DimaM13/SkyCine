import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { FriendsController } from '../controllers/friends.controller';
import { LibraryController } from '../controllers/library.controller';
import { MediaController } from '../controllers/media.controller';
import { StreamController } from '../controllers/stream.controller';
import { YouTubeController } from '../controllers/youtube.controller';
import { RoomsController } from '../controllers/rooms.controller';
import { AdminController } from '../controllers/admin.controller';
import { authenticateToken, requireAdmin, optionalAuth } from '../middleware/auth.middleware';

const router = Router();

// --- Auth Routes ---
router.post('/auth/register', AuthController.register);
router.post('/auth/login', AuthController.login);
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
router.get('/stream/youtube/info/:videoId', YouTubeController.getInfo);
router.get('/stream/youtube/:videoId', YouTubeController.stream);

// --- Stream Routes ---
router.get('/stream/:id/info', authenticateToken, StreamController.getStreamInfo);
router.get('/stream/:id/direct', authenticateToken, StreamController.directStream);
router.get('/stream/:id/remux', authenticateToken, StreamController.remuxStream);
router.get('/stream/:id/master.m3u8', authenticateToken, StreamController.getHlsMaster);
router.get('/stream/hls/session/start/:id', authenticateToken, StreamController.startHlsSession);
router.post('/stream/hls/session/end', authenticateToken, StreamController.endHlsSession);
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

export default router;
