import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'myplex.db');
export const db = new Database(dbPath);

// Enable WAL mode and foreign keys for high performance & reliability
db.pragma('journal_mode = WAL');
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
      type TEXT NOT NULL, -- 'MOVIES' | 'SHOWS'
      path TEXT NOT NULL UNIQUE,
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
      mediaItemId TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
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

  // Default server settings
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO server_settings (key, value) VALUES (?, ?)
  `);

  insertSetting.run('serverName', 'SkyCine Server');
  insertSetting.run('tmdbApiKey', ''); // Can be configured in UI
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
