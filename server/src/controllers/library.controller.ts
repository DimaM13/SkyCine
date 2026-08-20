import { Response } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../config/db';
import { AuthRequest } from '../middleware/auth.middleware';
import { scannerService } from '../services/scanner.service';

export class LibraryController {
  public static async getLibraries(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id || '';
      const userRole = req.user?.role || 'USER';

      if (userRole === 'ADMIN') {
        const libraries = db.prepare(`
          SELECT l.*,
                 CASE 
                   WHEN l.type = 'SHOWS' THEN (
                     SELECT COUNT(DISTINCT m.showTitle)
                     FROM media_items m
                     WHERE m.libraryId = l.id AND m.type = 'EPISODE' AND m.showTitle IS NOT NULL
                   )
                   ELSE (
                     SELECT COUNT(m.id)
                     FROM media_items m
                     WHERE m.libraryId = l.id AND m.type IN ('MOVIE', 'VIDEO')
                   )
                 END as itemCount
          FROM libraries l
          ORDER BY l.name ASC
        `).all();
        res.json({ libraries });
        return;
      }

      // For regular users: only show libraries they have access to or have shared items in
      const libraries = db.prepare(`
        SELECT l.*,
               CASE 
                 WHEN l.type = 'SHOWS' THEN (
                   SELECT COUNT(DISTINCT m.showTitle)
                   FROM media_items m
                   WHERE m.libraryId = l.id AND m.type = 'EPISODE' AND m.showTitle IS NOT NULL
                     AND (
                       l.id IN (SELECT libraryId FROM user_library_access WHERE userId = ?)
                       OR m.id IN (SELECT mediaItemId FROM user_media_access WHERE userId = ?)
                     )
                 )
                 ELSE (
                   SELECT COUNT(m.id)
                   FROM media_items m
                   WHERE m.libraryId = l.id AND m.type IN ('MOVIE', 'VIDEO')
                     AND (
                       l.id IN (SELECT libraryId FROM user_library_access WHERE userId = ?)
                       OR m.id IN (SELECT mediaItemId FROM user_media_access WHERE userId = ?)
                     )
                 )
               END as itemCount
        FROM libraries l
        WHERE l.id IN (SELECT libraryId FROM user_library_access WHERE userId = ?)
           OR l.id IN (SELECT libraryId FROM media_items WHERE id IN (SELECT mediaItemId FROM user_media_access WHERE userId = ?))
        GROUP BY l.id
        ORDER BY l.name ASC
      `).all(userId, userId, userId, userId, userId, userId);

      res.json({ libraries });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения библиотек' });
    }
  }

  public static async createLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { name, type, path: folderPath } = req.body;

      if (!name || !type) {
        res.status(400).json({ error: 'Укажите название и тип библиотеки (MOVIES, SHOWS или VIDEOS)' });
        return;
      }

      if (type !== 'MOVIES' && type !== 'SHOWS' && type !== 'VIDEOS') {
        res.status(400).json({ error: 'Тип библиотеки должен быть MOVIES, SHOWS или VIDEOS' });
        return;
      }

      let validPath: string | null = null;
      if (folderPath && typeof folderPath === 'string' && folderPath.trim()) {
        const trimmed = folderPath.trim();
        if (!fs.existsSync(trimmed)) {
          try {
            fs.mkdirSync(trimmed, { recursive: true });
          } catch (e) {
            res.status(400).json({ error: `Папка не существует и не может быть создана: ${trimmed}` });
            return;
          }
        }
        validPath = trimmed;
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO libraries (id, name, type, path)
        VALUES (?, ?, ?, ?)
      `).run(id, name.trim(), type, validPath);

      // If a folder path was provided, trigger scan in background
      if (validPath) {
        scannerService.scanFolderIntoLibrary(id, validPath).catch(err => console.error('Scan error:', err));
      }

      res.status(201).json({
        message: validPath
          ? 'Библиотека создана и поставлена в очередь сканирования'
          : 'Библиотека успешно создана. Теперь вы можете добавить в неё папки или отдельные файлы.',
        id,
      });
    } catch (err: any) {
      console.error('createLibrary error:', err);
      res.status(500).json({ error: 'Ошибка создания библиотеки' });
    }
  }

  public static async addFolder(req: AuthRequest, res: Response): Promise<void> {
    try {
      const libraryId = req.params.libraryId || req.body.libraryId;
      const { folderPath } = req.body;

      if (!libraryId || !folderPath || !folderPath.trim()) {
        res.status(400).json({ error: 'Укажите библиотеку и путь к папке на сервере' });
        return;
      }

      const result = await scannerService.scanFolderIntoLibrary(libraryId, folderPath.trim());

      res.status(200).json({
        message: `Папка успешно добавлена в библиотеку «${result.libraryName}» (${result.itemsAdded} элементов)!`,
        ...result,
      });
    } catch (err: any) {
      console.error('addFolder error:', err);
      res.status(400).json({ error: err.message || 'Ошибка добавления папки' });
    }
  }

  public static async deleteLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { libraryId } = req.params;
      db.prepare('DELETE FROM libraries WHERE id = ?').run(libraryId);
      res.json({ message: 'Библиотека удалена' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка удаления библиотеки' });
    }
  }

  public static async scanLibrary(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { libraryId } = req.params;
      scannerService.scanLibrary(libraryId as string).catch(err => console.error('Scan error:', err));
      res.json({ message: 'Сканирование библиотеки запущено' });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Ошибка запуска сканирования' });
    }
  }

  public static async scanAll(req: AuthRequest, res: Response): Promise<void> {
    try {
      scannerService.scanAll().catch(err => console.error('Scan all error:', err));
      res.json({ message: 'Сканирование всех библиотек запущено' });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Ошибка запуска сканирования' });
    }
  }

  public static getScanStatus(req: AuthRequest, res: Response): void {
    res.json(scannerService.getStatus());
  }

  public static async addSingleFile(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { filePath, libraryId, title, type } = req.body;

      if (!filePath || !filePath.trim()) {
        res.status(400).json({ error: 'Укажите путь к видеофайлу' });
        return;
      }

      const mediaItem = await scannerService.addSingleFile(
        filePath.trim(),
        libraryId || undefined,
        title?.trim() || undefined,
        type || undefined
      );

      res.status(201).json({
        message: 'Файл успешно добавлен в медиатеку',
        mediaItem,
      });
    } catch (err: any) {
      console.error('addSingleFile error:', err);
      res.status(400).json({ error: err.message || 'Ошибка добавления файла' });
    }
  }

  public static async addShowFolder(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { folderPath, libraryId, showTitle } = req.body;

      if (!folderPath || !folderPath.trim()) {
        res.status(400).json({ error: 'Укажите путь к папке с сериалом' });
        return;
      }

      const result = await scannerService.addShowFolder(
        folderPath.trim(),
        libraryId || undefined,
        showTitle?.trim() || undefined
      );

      res.status(201).json({
        message: `Сериал «${result.showTitle}» успешно добавлен (${result.episodesAdded} серий)!`,
        ...result,
      });
    } catch (err: any) {
      console.error('addShowFolder error:', err);
      res.status(400).json({ error: err.message || 'Ошибка добавления сериала' });
    }
  }
}
