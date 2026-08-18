import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';

export class PermissionService {
  /**
   * Checks if user has permission to access a specific media item.
   * Admin always has access.
   * Regular users have access if explicitly granted to media item OR to the library containing it.
   */
  public hasMediaAccess(userId: string, userRole: string, mediaItemId: string): boolean {
    if (userRole === 'ADMIN') return true;

    // Check direct media access
    const directAccess = db.prepare(`
      SELECT id FROM user_media_access WHERE userId = ? AND mediaItemId = ?
    `).get(userId, mediaItemId);
    if (directAccess) return true;

    // Check library access
    const libraryAccess = db.prepare(`
      SELECT ula.id FROM user_library_access ula
      JOIN media_items m ON m.libraryId = ula.libraryId
      WHERE ula.userId = ? AND m.id = ?
    `).get(userId, mediaItemId);
    if (libraryAccess) return true;

    return false;
  }

  /**
   * Checks if user has permission to stream a media item.
   * Grants access if user has standard media access OR is a participant in a room playing this item.
   */
  public hasMediaOrRoomAccess(userId: string, userRole: string, mediaItemId: string): boolean {
    if (userRole === 'ADMIN') return true;
    if (this.hasMediaAccess(userId, userRole, mediaItemId)) return true;

    // Check if media is currently being played in a room
    const room = db.prepare(`
      SELECT id FROM rooms WHERE mediaItemId = ?
    `).get(mediaItemId);

    if (room) return true;

    return false;
  }

  /**
   * Checks if user has permission to access a library.
   */
  public hasLibraryAccess(userId: string, userRole: string, libraryId: string): boolean {
    if (userRole === 'ADMIN') return true;

    const access = db.prepare(`
      SELECT id FROM user_library_access WHERE userId = ? AND libraryId = ?
    `).get(userId, libraryId);

    return !!access;
  }

  /**
   * Returns SQL filter clause for media items based on user role and id.
   */
  public getMediaFilter(userId: string, userRole: string, tableAlias = 'm'): { sql: string; params: any[] } {
    if (userRole === 'ADMIN') {
      return { sql: '1=1', params: [] };
    }

    return {
      sql: `(${tableAlias}.id IN (SELECT mediaItemId FROM user_media_access WHERE userId = ?) OR ${tableAlias}.libraryId IN (SELECT libraryId FROM user_library_access WHERE userId = ?))`,
      params: [userId, userId],
    };
  }

  /**
   * Get permissions for a specific user (all libraries, movies, and shows with access flags).
   */
  public getUserPermissions(userId: string) {
    const libraries = db.prepare(`
      SELECT l.id, l.name, l.type,
             CASE WHEN ula.id IS NOT NULL THEN 1 ELSE 0 END as hasAccess
      FROM libraries l
      LEFT JOIN user_library_access ula ON (ula.libraryId = l.id AND ula.userId = ?)
      ORDER BY l.name ASC
    `).all(userId);

    const movies = db.prepare(`
      SELECT m.id, m.title, m.type, m.year, m.posterPath, m.libraryId, l.name as libraryName,
             CASE WHEN uma.id IS NOT NULL THEN 1 ELSE 0 END as hasDirectAccess,
             CASE WHEN ula.id IS NOT NULL THEN 1 ELSE 0 END as hasLibraryAccess,
             CASE WHEN ula.id IS NOT NULL OR uma.id IS NOT NULL THEN 1 ELSE 0 END as hasAccess
      FROM media_items m
      JOIN libraries l ON m.libraryId = l.id
      LEFT JOIN user_media_access uma ON (uma.mediaItemId = m.id AND uma.userId = ?)
      LEFT JOIN user_library_access ula ON (ula.libraryId = m.libraryId AND ula.userId = ?)
      WHERE m.type = 'MOVIE'
      ORDER BY m.title ASC
    `).all(userId, userId);

    const shows = db.prepare(`
      SELECT m.showTitle,
             COUNT(m.id) as totalEpisodes,
             MIN(m.posterPath) as posterPath,
             MIN(m.year) as year,
             MIN(m.libraryId) as libraryId,
             MIN(l.name) as libraryName,
             CASE WHEN MIN(ula.id) IS NOT NULL THEN 1
                  WHEN (SELECT COUNT(*) FROM user_media_access uma WHERE uma.userId = ? AND uma.mediaItemId IN (SELECT id FROM media_items mi WHERE mi.showTitle = m.showTitle)) > 0 THEN 1
                  ELSE 0 END as hasAccess,
             CASE WHEN (SELECT COUNT(*) FROM user_media_access uma WHERE uma.userId = ? AND uma.mediaItemId IN (SELECT id FROM media_items mi WHERE mi.showTitle = m.showTitle)) > 0 THEN 1
                  ELSE 0 END as hasDirectAccess,
             CASE WHEN MIN(ula.id) IS NOT NULL THEN 1 ELSE 0 END as hasLibraryAccess
      FROM media_items m
      JOIN libraries l ON m.libraryId = l.id
      LEFT JOIN user_library_access ula ON (ula.libraryId = m.libraryId AND ula.userId = ?)
      WHERE m.type = 'EPISODE' AND m.showTitle IS NOT NULL
      GROUP BY m.showTitle
      ORDER BY m.showTitle ASC
    `).all(userId, userId, userId);

    return { libraries, movies, shows, mediaItems: movies };
  }

  /**
   * Set permissions for a user.
   */
  public setUserPermissions(userId: string, libraryIds: string[], mediaItemIds: string[], showTitles: string[] = []) {
    const updateTx = db.transaction(() => {
      // Clear existing
      db.prepare('DELETE FROM user_library_access WHERE userId = ?').run(userId);
      db.prepare('DELETE FROM user_media_access WHERE userId = ?').run(userId);

      // Insert libraries
      const insertLib = db.prepare('INSERT INTO user_library_access (id, userId, libraryId) VALUES (?, ?, ?)');
      for (const libId of libraryIds) {
        insertLib.run(uuidv4(), userId, libId);
      }

      // Insert media items (movies or standalone episodes)
      const allMediaIds = new Set<string>(mediaItemIds);

      // If showTitles are passed, add all episodes of those shows
      if (showTitles && showTitles.length > 0) {
        for (const showTitle of showTitles) {
          const episodes = db.prepare('SELECT id FROM media_items WHERE showTitle = ?').all(showTitle) as { id: string }[];
          for (const ep of episodes) {
            allMediaIds.add(ep.id);
          }
        }
      }

      const insertMedia = db.prepare('INSERT INTO user_media_access (id, userId, mediaItemId) VALUES (?, ?, ?)');
      for (const mediaId of allMediaIds) {
        insertMedia.run(uuidv4(), userId, mediaId);
      }
    });

    updateTx();
  }

  /**
   * Get user access list for a specific media item.
   */
  public getMediaItemAccess(mediaItemId: string) {
    const media = db.prepare('SELECT libraryId FROM media_items WHERE id = ?').get(mediaItemId) as { libraryId: string } | undefined;
    if (!media) return { users: [] };

    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatarUrl, u.role,
             CASE WHEN u.role = 'ADMIN' THEN 1
                  WHEN uma.id IS NOT NULL THEN 1
                  WHEN ula.id IS NOT NULL THEN 1
                  ELSE 0 END as hasAccess,
             CASE WHEN uma.id IS NOT NULL THEN 1 ELSE 0 END as hasDirectAccess,
             CASE WHEN ula.id IS NOT NULL THEN 1 ELSE 0 END as hasLibraryAccess
      FROM users u
      LEFT JOIN user_media_access uma ON (uma.userId = u.id AND uma.mediaItemId = ?)
      LEFT JOIN user_library_access ula ON (ula.userId = u.id AND ula.libraryId = ?)
      ORDER BY u.username ASC
    `).all(mediaItemId, media.libraryId);

    return { users };
  }

  /**
   * Set which users have direct access to a specific media item.
   */
  public setMediaItemAccess(mediaItemId: string, userIds: string[]) {
    const updateTx = db.transaction(() => {
      db.prepare('DELETE FROM user_media_access WHERE mediaItemId = ?').run(mediaItemId);
      const insert = db.prepare('INSERT INTO user_media_access (id, userId, mediaItemId) VALUES (?, ?, ?)');
      for (const uid of userIds) {
        insert.run(uuidv4(), uid, mediaItemId);
      }
    });

    updateTx();
  }

  /**
   * Get user access list for an entire TV Show by showTitle.
   */
  public getShowAccess(showTitle: string) {
    const episodes = db.prepare('SELECT id, libraryId FROM media_items WHERE showTitle = ?').all(showTitle) as { id: string; libraryId: string }[];
    if (episodes.length === 0) return { users: [] };

    const firstEpisode = episodes[0];
    const episodeIds = episodes.map(e => e.id);
    const placeholders = episodeIds.map(() => '?').join(',');

    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatarUrl, u.role,
             CASE WHEN u.role = 'ADMIN' THEN 1
                  WHEN ula.id IS NOT NULL THEN 1
                  WHEN (SELECT COUNT(*) FROM user_media_access uma WHERE uma.userId = u.id AND uma.mediaItemId IN (${placeholders})) > 0 THEN 1
                  ELSE 0 END as hasAccess,
             CASE WHEN (SELECT COUNT(*) FROM user_media_access uma WHERE uma.userId = u.id AND uma.mediaItemId IN (${placeholders})) > 0 THEN 1 ELSE 0 END as hasDirectAccess,
             CASE WHEN ula.id IS NOT NULL THEN 1 ELSE 0 END as hasLibraryAccess
      FROM users u
      LEFT JOIN user_library_access ula ON (ula.userId = u.id AND ula.libraryId = ?)
      ORDER BY u.username ASC
    `).all(...episodeIds, ...episodeIds, firstEpisode.libraryId);

    return { users, totalEpisodes: episodes.length };
  }

  /**
   * Set which users have access to an entire TV Show (all its episodes).
   */
  public setShowAccess(showTitle: string, userIds: string[]) {
    const episodes = db.prepare('SELECT id FROM media_items WHERE showTitle = ?').all(showTitle) as { id: string }[];
    if (episodes.length === 0) return;

    const episodeIds = episodes.map(e => e.id);
    const placeholders = episodeIds.map(() => '?').join(',');

    const updateTx = db.transaction(() => {
      // Clear existing direct access for all episodes of this show
      db.prepare(`DELETE FROM user_media_access WHERE mediaItemId IN (${placeholders})`).run(...episodeIds);

      // Insert access for each user to each episode
      const insert = db.prepare('INSERT INTO user_media_access (id, userId, mediaItemId) VALUES (?, ?, ?)');
      for (const uid of userIds) {
        for (const ep of episodeIds) {
          insert.run(uuidv4(), uid, ep);
        }
      }
    });

    updateTx();
  }

  /**
   * Get user access list for a specific library.
   */
  public getLibraryAccess(libraryId: string) {
    const users = db.prepare(`
      SELECT u.id, u.username, u.email, u.avatarUrl, u.role,
             CASE WHEN u.role = 'ADMIN' THEN 1
                  WHEN ula.id IS NOT NULL THEN 1
                  ELSE 0 END as hasAccess
      FROM users u
      LEFT JOIN user_library_access ula ON (ula.userId = u.id AND ula.libraryId = ?)
      ORDER BY u.username ASC
    `).all(libraryId);

    return { users };
  }

  /**
   * Set which users have access to a specific library.
   */
  public setLibraryAccess(libraryId: string, userIds: string[]) {
    const updateTx = db.transaction(() => {
      db.prepare('DELETE FROM user_library_access WHERE libraryId = ?').run(libraryId);
      const insert = db.prepare('INSERT INTO user_library_access (id, userId, libraryId) VALUES (?, ?, ?)');
      for (const uid of userIds) {
        insert.run(uuidv4(), uid, libraryId);
      }
    });

    updateTx();
  }
}

export const permissionService = new PermissionService();
