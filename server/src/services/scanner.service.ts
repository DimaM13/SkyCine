import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { tmdbService } from './tmdb.service';
import { logger } from './logger.service';
import { Library, MediaItem, MediaTrack } from '../types';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv', '.m4v', '.ts', '.m2ts', '.iso'
]);

interface ParsedFileName {
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  showTitle?: string;
  isEpisode: boolean;
}

class ScannerService {
  private isScanning = false;
  private currentProgress = {
    libraryName: '',
    scannedFiles: 0,
    totalFiles: 0,
    currentFile: '',
  };

  public getStatus() {
    return {
      isScanning: this.isScanning,
      progress: this.currentProgress,
    };
  }

  public parseFileName(fileName: string): ParsedFileName {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);

    // Clean dots, underscores, dashes
    const cleanStr = base.replace(/[\._]/g, ' ').trim();

    // Check for TV Show pattern S01E02 or 1x02
    const episodeMatch = cleanStr.match(/(.+?)\s*[sS](\d{1,2})[eE](\d{1,3})/i) ||
                         cleanStr.match(/(.+?)\s*(\d{1,2})[xX](\d{1,3})/i);

    if (episodeMatch) {
      const showTitle = this.cleanTitle(episodeMatch[1]);
      const seasonNumber = parseInt(episodeMatch[2], 10);
      const episodeNumber = parseInt(episodeMatch[3], 10);
      return {
        title: `${showTitle} - S${seasonNumber < 10 ? '0' : ''}${seasonNumber}E${episodeNumber < 10 ? '0' : ''}${episodeNumber}`,
        showTitle,
        seasonNumber,
        episodeNumber,
        isEpisode: true,
      };
    }

    // Check for Year in title e.g. "Inception (2010)" or "Inception 2010 1080p"
    const yearMatch = cleanStr.match(/(.+?)\s*[\(\[]?((?:19|20)\d{2})[\)\]]?/);
    if (yearMatch) {
      const title = this.cleanTitle(yearMatch[1]);
      const year = parseInt(yearMatch[2], 10);
      return {
        title,
        year,
        isEpisode: false,
      };
    }

    return {
      title: this.cleanTitle(cleanStr),
      isEpisode: false,
    };
  }

  private cleanTitle(raw: string): string {
    // Remove typical release tags
    return raw
      .replace(/\b(1080p|720p|2160p|4k|uhd|bluray|bdrip|web-dl|webrip|dvdrip|x264|x265|hevc|aac|dts|remux|h264|h265|proper|repack)\b.*/gi, '')
      .replace(/[\(\)\[\]\{\}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public async scanLibrary(libraryId: string): Promise<void> {
    if (this.isScanning) {
      throw new Error('Сканирование уже выполняется');
    }

    const library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId) as Library | undefined;
    if (!library) throw new Error('Библиотека не найдена');

    this.isScanning = true;
    this.currentProgress = {
      libraryName: library.name,
      scannedFiles: 0,
      totalFiles: 0,
      currentFile: '',
    };

    try {
      if (!fs.existsSync(library.path)) {
        throw new Error(`Путь к папке не существует: ${library.path}`);
      }

      const files = this.collectFiles(library.path);
      this.currentProgress.totalFiles = files.length;

      for (const filePath of files) {
        this.currentProgress.currentFile = path.basename(filePath);
        await this.processFile(filePath, library);
        this.currentProgress.scannedFiles++;
      }

      db.prepare('UPDATE libraries SET lastScannedAt = CURRENT_TIMESTAMP WHERE id = ?').run(libraryId);
    } finally {
      this.isScanning = false;
    }
  }

  public async scanAll(): Promise<void> {
    const libraries = db.prepare('SELECT id FROM libraries').all() as { id: string }[];
    for (const lib of libraries) {
      await this.scanLibrary(lib.id);
    }
  }

  public async addSingleFile(
    filePath: string,
    libraryId?: string,
    overrideTitle?: string,
    forceType?: 'MOVIE' | 'EPISODE'
  ): Promise<any> {
    const cleanPath = path.normalize(filePath).trim();
    if (!fs.existsSync(cleanPath)) {
      throw new Error(`Файл не найден на диске: ${cleanPath}`);
    }

    const ext = path.extname(cleanPath).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) {
      throw new Error(`Неподдерживаемый формат видеофайла (${ext}). Поддерживаются: MKV, MP4, AVI, MOV, WEBM, TS и др.`);
    }

    let library: Library | undefined;

    if (libraryId) {
      library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId) as Library | undefined;
    }

    if (!library) {
      // Find existing library of appropriate type or create one for the parent folder
      const isShow = forceType === 'EPISODE' || cleanPath.match(/[sS]\d{1,2}[eE]\d{1,2}/i);
      const targetType = isShow ? 'SHOWS' : 'MOVIES';

      library = db.prepare('SELECT * FROM libraries WHERE type = ? ORDER BY createdAt ASC').get(targetType) as Library | undefined;

      if (!library) {
        // Create an automatic library for parent directory
        const parentDir = path.dirname(cleanPath);
        const newLibId = uuidv4();
        db.prepare(`
          INSERT INTO libraries (id, name, type, path)
          VALUES (?, ?, ?, ?)
        `).run(newLibId, targetType === 'MOVIES' ? 'Фильмы' : 'Сериалы', targetType, parentDir);

        library = {
          id: newLibId,
          name: targetType === 'MOVIES' ? 'Фильмы' : 'Сериалы',
          type: targetType,
          path: parentDir,
          createdAt: new Date().toISOString(),
        };
      }
    }

    await this.processFile(cleanPath, library, overrideTitle, forceType);

    const created = db.prepare(`
      SELECT m.*, l.name as libraryName
      FROM media_items m
      JOIN libraries l ON m.libraryId = l.id
      WHERE m.filePath = ?
    `).get(cleanPath);

    return created;
  }

  public async addShowFolder(
    folderPath: string,
    libraryId?: string,
    overrideShowTitle?: string
  ): Promise<{ showTitle: string; episodesAdded: number; libraryName: string }> {
    const cleanPath = path.normalize(folderPath).trim();
    if (!fs.existsSync(cleanPath)) {
      throw new Error(`Папка не найдена на диске: ${cleanPath}`);
    }

    const stat = fs.statSync(cleanPath);
    if (!stat.isDirectory()) {
      throw new Error(`Указанный путь не является папкой: ${cleanPath}`);
    }

    let library: Library | undefined;
    if (libraryId) {
      library = db.prepare('SELECT * FROM libraries WHERE id = ?').get(libraryId) as Library | undefined;
    }

    if (!library) {
      library = db.prepare('SELECT * FROM libraries WHERE type = "SHOWS" ORDER BY createdAt ASC').get() as Library | undefined;

      if (!library) {
        const newLibId = uuidv4();
        db.prepare(`
          INSERT INTO libraries (id, name, type, path)
          VALUES (?, ?, ?, ?)
        `).run(newLibId, 'Сериалы', 'SHOWS', cleanPath);

        library = {
          id: newLibId,
          name: 'Сериалы',
          type: 'SHOWS',
          path: cleanPath,
          createdAt: new Date().toISOString(),
        };
      }
    }

    const folderName = path.basename(cleanPath);
    const showTitle = overrideShowTitle?.trim() || this.cleanTitle(folderName);

    // Search TMDB show metadata once
    const showMetadata = await tmdbService.searchShow(showTitle);
    const finalShowTitle = showMetadata?.title || showTitle;

    const files = this.collectFiles(cleanPath);
    if (files.length === 0) {
      throw new Error(`В папке "${folderName}" не найдено ни одного видеофайла (.mkv, .mp4, .avi и др.)`);
    }

    // Sort files to preserve episode order
    files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    let count = 0;
    for (let i = 0; i < files.length; i++) {
      const filePath = files[i];
      try {
        await this.processEpisodeFile(filePath, library, finalShowTitle, showMetadata, i + 1);
        count++;
      } catch (err: any) {
        console.warn(`[Scanner] Could not process episode file ${filePath}:`, err.message);
      }
    }

    return {
      showTitle: finalShowTitle,
      episodesAdded: count,
      libraryName: library.name,
    };
  }

  private async processEpisodeFile(
    filePath: string,
    library: Library,
    showTitle: string,
    showMetadata: any,
    fallbackIndex: number
  ): Promise<void> {
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    const fullNormalized = path.normalize(filePath);

    // Determine Season
    let seasonNumber = 1;
    const seasonInPath = fullNormalized.match(/[\\/](?:season|сезон|s)\s*(\d{1,2})[\\/]/i) ||
                         fileName.match(/[sS](\d{1,2})[eE]\d{1,3}/i);
    if (seasonInPath) {
      seasonNumber = parseInt(seasonInPath[1], 10);
    }

    // Determine Episode
    let episodeNumber = fallbackIndex;
    const epMatch = fileName.match(/[eE](\d{1,3})/i) ||
                    fileName.match(/\b\d{1,2}[xX](\d{1,3})/i) ||
                    fileName.match(/(\d{1,3})\s*(?:серия|эпизод|серии)/i) ||
                    fileName.match(/(?:^|[.\s_-])(\d{1,2})(?:[.\s_-]|$)/);
    if (epMatch) {
      episodeNumber = parseInt(epMatch[1], 10);
    }

    const title = `${showTitle} - S${seasonNumber < 10 ? '0' : ''}${seasonNumber}E${episodeNumber < 10 ? '0' : ''}${episodeNumber}`;
    const year = showMetadata?.year || null;
    const overview = showMetadata?.overview || '';
    const posterPath = showMetadata?.posterPath || '';
    const backdropPath = showMetadata?.backdropPath || '';
    const rating = showMetadata?.rating || 0;
    const genres = showMetadata?.genres ? JSON.stringify(showMetadata.genres) : '';

    const probeData = await this.probeFile(filePath);
    const durationSeconds = probeData.durationSeconds;
    const resolution = probeData.resolution;
    const videoCodec = probeData.videoCodec;
    const audioCodec = probeData.audioCodec;
    const streamDetails = JSON.stringify(probeData.rawStreams);

    const existing = db.prepare('SELECT id FROM media_items WHERE filePath = ?').get(filePath) as { id: string } | undefined;
    const mediaId = existing?.id || uuidv4();

    if (existing) {
      db.prepare(`
        UPDATE media_items SET
          title = ?, originalTitle = ?, type = 'EPISODE', year = ?, overview = ?,
          posterPath = ?, backdropPath = ?, rating = ?, genres = ?,
          durationSeconds = ?, fileSize = ?, resolution = ?,
          videoCodec = ?, audioCodec = ?, showTitle = ?,
          seasonNumber = ?, episodeNumber = ?, streamDetails = ?,
          updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title, showMetadata?.originalTitle || '', year, overview,
        posterPath, backdropPath, rating, genres,
        durationSeconds, stat.size, resolution,
        videoCodec, audioCodec, showTitle,
        seasonNumber, episodeNumber, streamDetails,
        mediaId
      );

      db.prepare('DELETE FROM media_tracks WHERE mediaItemId = ?').run(mediaId);
    } else {
      db.prepare(`
        INSERT INTO media_items (
          id, libraryId, title, originalTitle, type, year, overview,
          posterPath, backdropPath, rating, genres, durationSeconds,
          filePath, fileSize, resolution, videoCodec, audioCodec,
          showTitle, seasonNumber, episodeNumber, streamDetails
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId, library.id, title, showMetadata?.originalTitle || '',
        'EPISODE', year, overview,
        posterPath, backdropPath, rating, genres, durationSeconds,
        filePath, stat.size, resolution, videoCodec, audioCodec,
        showTitle, seasonNumber, episodeNumber, streamDetails
      );
    }

    const insertTrack = db.prepare(`
      INSERT INTO media_tracks (
        id, mediaItemId, type, streamIndex, title, language, codec, channels, isDefault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const track of probeData.tracks) {
      insertTrack.run(
        uuidv4(),
        mediaId,
        track.type,
        track.streamIndex,
        track.title || '',
        track.language || 'und',
        track.codec,
        track.channels || 2,
        track.isDefault ? 1 : 0
      );
    }
  }

  private collectFiles(dir: string): string[] {
    let results: string[] = [];
    try {
      const list = fs.readdirSync(dir);
      for (const file of list) {
        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat && stat.isDirectory()) {
            results = results.concat(this.collectFiles(fullPath));
          } else {
            const ext = path.extname(file).toLowerCase();
            if (VIDEO_EXTENSIONS.has(ext)) {
              results.push(fullPath);
            }
          }
        } catch (e) {
          // ignore inaccessible file
        }
      }
    } catch (e) {
      // ignore directory access error
    }
    return results;
  }

  private async processFile(
    filePath: string,
    library: Library,
    overrideTitle?: string,
    forceType?: 'MOVIE' | 'EPISODE'
  ): Promise<void> {
    const stat = fs.statSync(filePath);
    const existing = db.prepare('SELECT id FROM media_items WHERE filePath = ?').get(filePath) as { id: string } | undefined;

    const parsed = this.parseFileName(path.basename(filePath));
    if (overrideTitle) {
      parsed.title = overrideTitle;
    }
    if (forceType) {
      parsed.isEpisode = forceType === 'EPISODE';
    }

    // Probe media with ffprobe
    const probeData = await this.probeFile(filePath);

    let metadata: any = null;
    if ((library.type === 'MOVIES' || forceType === 'MOVIE') && !parsed.isEpisode) {
      metadata = await tmdbService.searchMovie(parsed.title, parsed.year);
    } else if (library.type === 'SHOWS' || parsed.isEpisode || forceType === 'EPISODE') {
      metadata = await tmdbService.searchShow(parsed.showTitle || parsed.title, parsed.year);
    }

    const title = overrideTitle || metadata?.title || parsed.title;
    const year = metadata?.year || parsed.year;
    const overview = metadata?.overview || '';
    const posterPath = metadata?.posterPath || '';
    const backdropPath = metadata?.backdropPath || '';
    const rating = metadata?.rating || 0;
    const genres = metadata?.genres ? JSON.stringify(metadata.genres) : '';

    const durationSeconds = probeData.durationSeconds;
    const resolution = probeData.resolution;
    const videoCodec = probeData.videoCodec;
    const audioCodec = probeData.audioCodec;
    const streamDetails = JSON.stringify(probeData.rawStreams);

    const mediaId = existing?.id || uuidv4();

    if (existing) {
      db.prepare(`
        UPDATE media_items SET
          title = ?, originalTitle = ?, year = ?, overview = ?,
          posterPath = ?, backdropPath = ?, rating = ?, genres = ?,
          durationSeconds = ?, fileSize = ?, resolution = ?,
          videoCodec = ?, audioCodec = ?, showTitle = ?,
          seasonNumber = ?, episodeNumber = ?, streamDetails = ?,
          updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        title, metadata?.originalTitle || '', year || null, overview,
        posterPath, backdropPath, rating, genres,
        durationSeconds, stat.size, resolution,
        videoCodec, audioCodec, parsed.showTitle || null,
        parsed.seasonNumber || null, parsed.episodeNumber || null, streamDetails,
        mediaId
      );

      // Clean existing tracks
      db.prepare('DELETE FROM media_tracks WHERE mediaItemId = ?').run(mediaId);
    } else {
      db.prepare(`
        INSERT INTO media_items (
          id, libraryId, title, originalTitle, type, year, overview,
          posterPath, backdropPath, rating, genres, durationSeconds,
          filePath, fileSize, resolution, videoCodec, audioCodec,
          showTitle, seasonNumber, episodeNumber, streamDetails
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        mediaId, library.id, title, metadata?.originalTitle || '',
        parsed.isEpisode ? 'EPISODE' : 'MOVIE', year || null, overview,
        posterPath, backdropPath, rating, genres, durationSeconds,
        filePath, stat.size, resolution, videoCodec, audioCodec,
        parsed.showTitle || null, parsed.seasonNumber || null, parsed.episodeNumber || null, streamDetails
      );
    }

    // Insert audio and subtitle tracks
    const insertTrack = db.prepare(`
      INSERT INTO media_tracks (
        id, mediaItemId, type, streamIndex, title, language, codec, channels, isDefault
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const track of probeData.tracks) {
      insertTrack.run(
        uuidv4(),
        mediaId,
        track.type,
        track.streamIndex,
        track.title || '',
        track.language || 'und',
        track.codec,
        track.channels || 2,
        track.isDefault ? 1 : 0
      );
    }
  }

  private probeFile(filePath: string): Promise<{
    durationSeconds: number;
    resolution: string;
    videoCodec: string;
    audioCodec: string;
    tracks: any[];
    rawStreams: any[];
  }> {
    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err || !metadata) {
          return resolve({
            durationSeconds: 0,
            resolution: '1080p',
            videoCodec: 'unknown',
            audioCodec: 'unknown',
            tracks: [],
            rawStreams: [],
          });
        }

        const format = metadata.format || {};
        const durationSeconds = format.duration ? parseFloat(format.duration.toString()) : 0;
        const streams = metadata.streams || [];

        let videoCodec = 'unknown';
        let audioCodec = 'unknown';
        let resolution = '1080p';
        const tracks: any[] = [];

        for (const s of streams) {
          if (s.codec_type === 'video' && videoCodec === 'unknown') {
            videoCodec = s.codec_name || 'h264';
            const width = s.width || 0;
            const height = s.height || 0;
            if (width >= 3800 || height >= 2000) resolution = '4K';
            else if (width >= 1900 || height >= 1000) resolution = '1080p';
            else if (width >= 1200 || height >= 700) resolution = '720p';
            else if (width > 0) resolution = '480p';
          } else if (s.codec_type === 'audio') {
            if (audioCodec === 'unknown') audioCodec = s.codec_name || 'aac';
            tracks.push({
              type: 'AUDIO',
              streamIndex: s.index,
              title: s.tags?.title || s.tags?.handler_name || `Audio Stream #${s.index}`,
              language: s.tags?.language || 'und',
              codec: s.codec_name || 'aac',
              channels: s.channels || 2,
              isDefault: (s.disposition?.default === 1) || tracks.filter(t => t.type === 'AUDIO').length === 0,
            });
          } else if (s.codec_type === 'subtitle') {
            tracks.push({
              type: 'SUBTITLE',
              streamIndex: s.index,
              title: s.tags?.title || s.tags?.handler_name || `Subtitle Stream #${s.index}`,
              language: s.tags?.language || 'und',
              codec: s.codec_name || 'subrip',
              channels: 0,
              isDefault: s.disposition?.default === 1,
            });
          }
        }

        resolve({
          durationSeconds,
          resolution,
          videoCodec,
          audioCodec,
          tracks,
          rawStreams: streams,
        });
      });
    });
  }
}

export const scannerService = new ScannerService();
