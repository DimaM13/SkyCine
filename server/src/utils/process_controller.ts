import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const controllerExe = path.resolve(__dirname, '../../bin/process_controller.exe');

export class ProcessController {
  private static isAvailable: boolean | null = null;

  public static checkAvailability(): boolean {
    if (this.isAvailable === null) {
      this.isAvailable = process.platform === 'win32' && fs.existsSync(controllerExe);
      if (this.isAvailable) {
        console.log('[ProcessController] ✅ Kernel-level process controller loaded');
      } else {
        console.warn('[ProcessController] ⚠️ process_controller.exe not found, fallback mode');
      }
    }
    return this.isAvailable;
  }

  public static async suspend(pid: number): Promise<boolean> {
    if (!pid || pid <= 0) return false;
    if (!this.checkAvailability()) return false;

    try {
      await execFileAsync(controllerExe, ['suspend', pid.toString()], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  public static async resume(pid: number): Promise<boolean> {
    if (!pid || pid <= 0) return false;
    if (!this.checkAvailability()) return false;

    try {
      await execFileAsync(controllerExe, ['resume', pid.toString()], { windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  public static async kill(pid: number): Promise<boolean> {
    if (!pid || pid <= 0) return false;

    // 1. Resume first if using native controller, so suspended threads can exit cleanly
    if (this.checkAvailability()) {
      try {
        await execFileAsync(controllerExe, ['kill', pid.toString()], { windowsHide: true });
      } catch {}
    }

    // 2. Guaranteed process tree termination on Windows
    if (process.platform === 'win32') {
      try {
        await execFileAsync('taskkill', ['/pid', pid.toString(), '/T', '/F'], { windowsHide: true });
      } catch {}
    }

    return true;
  }
}
