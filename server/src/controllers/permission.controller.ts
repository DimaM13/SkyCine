import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { permissionService } from '../services/permission.service';

export class PermissionController {
  public static async getUserPermissions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.params.userId as string;
      const data = permissionService.getUserPermissions(userId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения прав пользователя' });
    }
  }

  public static async setUserPermissions(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.params.userId as string;
      const { libraryIds = [], mediaItemIds = [], showTitles = [] } = req.body;
      permissionService.setUserPermissions(userId, libraryIds, mediaItemIds, showTitles);
      res.json({ message: 'Права пользователя успешно сохранены' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения прав пользователя' });
    }
  }

  public static async getMediaAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const mediaId = req.params.mediaId as string;
      const data = permissionService.getMediaItemAccess(mediaId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения прав на медиафайл' });
    }
  }

  public static async setMediaAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const mediaId = req.params.mediaId as string;
      const { userIds = [] } = req.body;
      permissionService.setMediaItemAccess(mediaId, userIds);
      res.json({ message: 'Права на фильм успешно обновлены' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения прав на медиафайл' });
    }
  }

  public static async getShowAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const showTitle = decodeURIComponent(req.params.showTitle as string);
      const data = permissionService.getShowAccess(showTitle);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения прав на сериал' });
    }
  }

  public static async setShowAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const showTitle = decodeURIComponent(req.params.showTitle as string);
      const { userIds = [] } = req.body;
      permissionService.setShowAccess(showTitle, userIds);
      res.json({ message: `Права на сериал «${showTitle}» успешно обновлены` });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения прав на сериал' });
    }
  }

  public static async getLibraryAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const libraryId = req.params.libraryId as string;
      const data = permissionService.getLibraryAccess(libraryId);
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Ошибка получения прав на библиотеку' });
    }
  }

  public static async setLibraryAccess(req: AuthRequest, res: Response): Promise<void> {
    try {
      const libraryId = req.params.libraryId as string;
      const { userIds = [] } = req.body;
      permissionService.setLibraryAccess(libraryId, userIds);
      res.json({ message: 'Права на библиотеку успешно сохранены' });
    } catch (err) {
      res.status(500).json({ error: 'Ошибка сохранения прав на библиотеку' });
    }
  }
}
