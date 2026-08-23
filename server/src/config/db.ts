import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'myplex.db');
export const db = new Database(dbPath);

// Enable WAL mode and performance pragmas for high concurrency & stability
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL'); // Safe with WAL, massively improves write speed
db.pragma('cache_size = -32000'); // 32MB cache (negative means KB)
db.pragma('temp_store = MEMORY'); // Store temporary tables in RAM
db.pragma('mmap_size = 3000000000'); // Use memory mapping up to 3GB
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      avatarUrl TEXT,
      role TEXT NOT NULL DEFAULT 'USER',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requesterId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addresseeId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(requesterId, addresseeId)
    );

    CREATE TABLE IF NOT EXISTS libraries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL, -- 'MOVIES' | 'SHOWS' | 'VIDEOS'
      path TEXT,
      lastScannedAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      libraryId TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      originalTitle TEXT,
      type TEXT NOT NULL, -- 'MOVIE' | 'EPISODE'
      year INTEGER,
      overview TEXT,
      posterPath TEXT,
      backdropPath TEXT,
      stillPath TEXT,
      rating REAL,
      genres TEXT,
      durationSeconds REAL DEFAULT 0,
      filePath TEXT NOT NULL UNIQUE,
      fileSize INTEGER DEFAULT 0,
      resolution TEXT,
      videoCodec TEXT,
      audioCodec TEXT,
      showTitle TEXT,
      seasonNumber INTEGER,
      episodeNumber INTEGER,
      streamDetails TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_tracks (
      id TEXT PRIMARY KEY,
      mediaItemId TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      type TEXT NOT NULL, -- 'AUDIO' | 'SUBTITLE'
      streamIndex INTEGER NOT NULL,
      title TEXT,
      language TEXT,
      codec TEXT NOT NULL,
      channels INTEGER DEFAULT 2,
      isDefault INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mediaItemId TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      progressSeconds REAL DEFAULT 0,
      durationSeconds REAL DEFAULT 0,
      isCompleted INTEGER DEFAULT 0,
      lastWatchedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, mediaItemId)
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      hostUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mediaItemId TEXT REFERENCES media_items(id) ON DELETE SET NULL,
      sourceType TEXT NOT NULL DEFAULT 'LOCAL', -- 'LOCAL' | 'YOUTUBE'
      youtubeId TEXT,
      youtubeUrl TEXT,
      youtubeTitle TEXT,
      youtubeThumbnail TEXT,
      state TEXT NOT NULL DEFAULT 'PAUSED', -- 'PLAYING' | 'PAUSED' | 'BUFFERING'
      currentPosition REAL DEFAULT 0,
      serverTimestamp INTEGER NOT NULL,
      playbackRate REAL DEFAULT 1.0,
      isPrivate INTEGER DEFAULT 0,
      password TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS server_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_library_access (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      libraryId TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, libraryId)
    );

    CREATE TABLE IF NOT EXISTS user_media_access (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mediaItemId TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(userId, mediaItemId)
    );

    CREATE INDEX IF NOT EXISTS idx_user_lib_access ON user_library_access(userId, libraryId);
    CREATE INDEX IF NOT EXISTS idx_user_media_access ON user_media_access(userId, mediaItemId);
    CREATE INDEX IF NOT EXISTS idx_media_library ON media_items(libraryId);
    CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
    CREATE INDEX IF NOT EXISTS idx_media_show ON media_items(showTitle, seasonNumber, episodeNumber);
    CREATE INDEX IF NOT EXISTS idx_tracks_media ON media_tracks(mediaItemId);
    CREATE INDEX IF NOT EXISTS idx_watch_user ON watch_history(userId);
    CREATE INDEX IF NOT EXISTS idx_friendship_users ON friendships(requesterId, addresseeId);
  `);

  try {
    db.exec('ALTER TABLE media_items ADD COLUMN stillPath TEXT;');
  } catch (e) {}

  try {
    const tableInfo = db.prepare('PRAGMA table_info(libraries)').all() as any[];
    const pathCol = tableInfo.find((col) => col.name === 'path');
    if (pathCol && pathCol.notnull === 1) {
      db.exec(`
        PRAGMA foreign_keys=off;
        CREATE TABLE IF NOT EXISTS libraries_migration (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          path TEXT,
          lastScannedAt DATETIME,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO libraries_migration SELECT id, name, type, path, lastScannedAt, createdAt FROM libraries;
        DROP TABLE libraries;
        ALTER TABLE libraries_migration RENAME TO libraries;
        PRAGMA foreign_keys=on;
      `);
    }
  } catch (e) {}

  // Migration for rooms table (add YouTube fields and nullable mediaItemId)
  try {
    const roomTableInfo = db.prepare('PRAGMA table_info(rooms)').all() as any[];
    const hasSourceType = roomTableInfo.some((col) => col.name === 'sourceType');
    const mediaItemCol = roomTableInfo.find((col) => col.name === 'mediaItemId');

    if (!hasSourceType || (mediaItemCol && mediaItemCol.notnull === 1)) {
      db.exec(`
        PRAGMA foreign_keys=off;
        CREATE TABLE IF NOT EXISTS rooms_migration (
          id TEXT PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          title TEXT NOT NULL,
          hostUserId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          mediaItemId TEXT REFERENCES media_items(id) ON DELETE SET NULL,
          sourceType TEXT NOT NULL DEFAULT 'LOCAL',
          youtubeId TEXT,
          youtubeUrl TEXT,
          youtubeTitle TEXT,
          youtubeThumbnail TEXT,
          state TEXT NOT NULL DEFAULT 'PAUSED',
          currentPosition REAL DEFAULT 0,
          serverTimestamp INTEGER NOT NULL,
          playbackRate REAL DEFAULT 1.0,
          isPrivate INTEGER DEFAULT 0,
          password TEXT,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO rooms_migration (
          id, code, title, hostUserId, mediaItemId, state, currentPosition, serverTimestamp, playbackRate, isPrivate, password, createdAt
        ) SELECT id, code, title, hostUserId, mediaItemId, state, currentPosition, serverTimestamp, playbackRate, isPrivate, password, createdAt FROM rooms;
        DROP TABLE rooms;
        ALTER TABLE rooms_migration RENAME TO rooms;
        PRAGMA foreign_keys=on;
      `);
    }
  } catch (e) {
    try {
      db.exec("ALTER TABLE rooms ADD COLUMN sourceType TEXT NOT NULL DEFAULT 'LOCAL';");
      db.exec("ALTER TABLE rooms ADD COLUMN youtubeId TEXT;");
      db.exec("ALTER TABLE rooms ADD COLUMN youtubeUrl TEXT;");
      db.exec("ALTER TABLE rooms ADD COLUMN youtubeTitle TEXT;");
      db.exec("ALTER TABLE rooms ADD COLUMN youtubeThumbnail TEXT;");
    } catch (err) {}
  }

  try {
    db.exec("ALTER TABLE rooms ADD COLUMN youtubeEngine TEXT NOT NULL DEFAULT 'iframe';");
  } catch (err) {}

  // Default server settings
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)
  `);

  insertSetting.run('serverName', 'SkyCine Server');
  insertSetting.run('tmdbApiKey', 'af51bdc93df8ab4cf422aaba091d83d1');
  insertSetting.run('transcodeHardware', 'auto');
  insertSetting.run('maxTranscodeBitrate', '20000'); // 20 Mbps
  insertSetting.run('allowPublicRegistration', 'true');
  insertSetting.run('transcodeTempDir', path.resolve(dataDir, 'transcodes'));

  // Ensure transcode temp directory exists
  const tempDir = path.resolve(dataDir, 'transcodes');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  // Ensure uploads directory exists
  const uploadsDir = path.resolve(__dirname, '../../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}
