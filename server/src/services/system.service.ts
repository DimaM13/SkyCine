import os from 'os';
import si from 'systeminformation';
import { TranscodeSession } from '../types';

class SystemService {
  private activeSessions: Map<string, TranscodeSession> = new Map();

  public registerSession(session: TranscodeSession) {
    this.activeSessions.set(session.sessionId, session);
  }

  public updateSession(sessionId: string, updates: Partial<TranscodeSession>) {
    const existing = this.activeSessions.get(sessionId);
    if (existing) {
      this.activeSessions.set(sessionId, { ...existing, ...updates });
    }
  }

  public removeSession(sessionId: string) {
    this.activeSessions.delete(sessionId);
  }

  public getActiveSessions(): TranscodeSession[] {
    return Array.from(this.activeSessions.values());
  }

  public async getSystemStats() {
    try {
      const [cpuLoad, mem, fsSize, graphics] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.graphics(),
      ]);

      const gpus = graphics.controllers.map(g => ({
        model: g.model,
        vendor: g.vendor,
        vram: g.vram,
      }));

      const disks = fsSize.map(d => ({
        fs: d.fs,
        type: d.type,
        size: d.size,
        used: d.used,
        available: d.available,
        usePercent: d.use,
        mount: d.mount,
      }));

      return {
        cpu: {
          cores: os.cpus().length,
          model: os.cpus()[0]?.model || 'Unknown CPU',
          currentLoad: Math.round(cpuLoad.currentLoad),
        },
        memory: {
          total: mem.total,
          free: mem.free,
          used: mem.used,
          active: mem.active,
          usedPercent: Math.round((mem.used / mem.total) * 100),
        },
        disks,
        gpus,
        activeStreamsCount: this.activeSessions.size,
        uptimeSeconds: os.uptime(),
      };
    } catch (err) {
      return {
        cpu: { cores: os.cpus().length, model: os.cpus()[0]?.model || 'CPU', currentLoad: 0 },
        memory: { total: os.totalmem(), free: os.freemem(), used: os.totalmem() - os.freemem(), active: 0, usedPercent: 50 },
        disks: [],
        gpus: [],
        activeStreamsCount: this.activeSessions.size,
        uptimeSeconds: os.uptime(),
      };
    }
  }
}

export const systemService = new SystemService();
