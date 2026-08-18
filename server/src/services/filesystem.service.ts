import fs from 'fs';
import path from 'path';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.m4v', '.webm', '.ts', '.wmv', '.flv']);

export class FilesystemService {
  /**
   * Get list of available disk drives on the system
   */
  public getDrives(): string[] {
    if (process.platform === 'win32') {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      const availableDrives: string[] = [];
      for (const letter of letters) {
        const root = `${letter}:\\`;
        try {
          if (fs.existsSync(root)) {
            availableDrives.push(root);
          }
        } catch (e) {}
      }
      return availableDrives.length > 0 ? availableDrives : ['C:\\'];
    } else {
      return ['/'];
    }
  }

  /**
   * Browse a folder on the host system
   */
  public browse(targetPath?: string, mode: 'folders' | 'files' | 'all' = 'folders') {
    const drives = this.getDrives();
    let currentPath = targetPath ? path.resolve(targetPath) : (drives[0] || 'C:\\');

    // Ensure valid directory
    if (!fs.existsSync(currentPath)) {
      currentPath = drives[0] || 'C:\\';
    }

    try {
      const stat = fs.statSync(currentPath);
      if (!stat.isDirectory()) {
        currentPath = path.dirname(currentPath);
      }
    } catch (e) {
      currentPath = drives[0] || 'C:\\';
    }

    const parentPath = path.dirname(currentPath) !== currentPath ? path.dirname(currentPath) : null;

    const directories: { name: string; path: string }[] = [];
    const files: { name: string; path: string; size: number; isVideo: boolean }[] = [];

    try {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        // Skip hidden/system files
        if (entry.name.startsWith('$') || entry.name.startsWith('.')) continue;
        if (entry.name === 'System Volume Information' || entry.name === 'pagefile.sys' || entry.name === 'hiberfil.sys') continue;

        const fullPath = path.join(currentPath, entry.name);

        if (entry.isDirectory()) {
          directories.push({
            name: entry.name,
            path: fullPath,
          });
        } else if (entry.isFile() && mode !== 'folders') {
          const ext = path.extname(entry.name).toLowerCase();
          const isVideo = VIDEO_EXTENSIONS.has(ext);

          if (mode === 'all' || (mode === 'files' && isVideo)) {
            let size = 0;
            try {
              size = fs.statSync(fullPath).size;
            } catch (e) {}

            files.push({
              name: entry.name,
              path: fullPath,
              size,
              isVideo,
            });
          }
        }
      }
    } catch (err: any) {
      console.warn(`[FS] Could not read directory ${currentPath}:`, err.message);
    }

    // Sort alphabetically
    directories.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    return {
      currentPath,
      parentPath,
      drives,
      directories,
      files,
    };
  }
}

export const filesystemService = new FilesystemService();
