import fs from 'fs';
import path from 'path';
import os from 'os';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class LoggerService {
  private logDir: string;
  private sessionLogFile: string;
  private serverLatestFile: string;
  private errorLogFile: string;
  private errorLatestFile: string;
  private startTime: Date;

  constructor() {
    this.startTime = new Date();
    this.logDir = path.resolve(__dirname, '../../../data/logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const sessionStamp = this.formatTimestampForFilename(this.startTime);
    this.sessionLogFile = path.join(this.logDir, `server-${sessionStamp}.log`);
    this.serverLatestFile = path.join(this.logDir, 'server-latest.log');
    this.errorLogFile = path.join(this.logDir, 'error.log');
    this.errorLatestFile = path.join(this.logDir, 'error-latest.log');

    // Reset session latest mirrors
    try {
      fs.writeFileSync(this.serverLatestFile, '');
      fs.writeFileSync(this.errorLatestFile, '');
    } catch {}

    this.writeStartupBanner();
    this.setupCrashHandlers();
  }

  private formatTimestampForFilename(d: Date): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  }

  private formatTimestamp(d: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ms = d.getMilliseconds().toString().padStart(3, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${ms}`;
  }

  private writeStartupBanner() {
    const banner = [
      '================================================================================',
      `🎬 SkyCine Cinema Server v6.2.0 - Session Log`,
      `Session Started: ${this.formatTimestamp(this.startTime)}`,
      `Node.js: ${process.version} | OS: ${os.type()} ${os.release()} (${os.arch()}) | PID: ${process.pid}`,
      `Session File:   ${path.basename(this.sessionLogFile)}`,
      `Directory:      ${this.logDir}`,
      '================================================================================\n'
    ].join('\n');

    this.rawAppend(this.sessionLogFile, banner);
    this.rawAppend(this.serverLatestFile, banner);
    console.log(`\x1b[35m${banner}\x1b[0m`);
  }

  private setupCrashHandlers() {
    process.on('uncaughtException', (err: Error) => {
      this.error('FATAL_CRASH', `Uncaught Exception: ${err.message}`, err);
    });

    process.on('unhandledRejection', (reason: any) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      this.error('UNHANDLED_REJECTION', `Unhandled Promise Rejection: ${msg}`, reason);
    });
  }

  private formatMessage(level: LogLevel, tag: string, message: string, meta?: any): string {
    const timestamp = this.formatTimestamp();
    let metaStr = '';
    if (meta !== undefined && meta !== null) {
      if (meta instanceof Error) {
        metaStr = `\n${meta.stack || meta.message}`;
      } else if (typeof meta === 'object') {
        try {
          metaStr = ` | ${JSON.stringify(meta)}`;
        } catch {
          metaStr = ` | [Object]`;
        }
      } else {
        metaStr = ` | ${meta}`;
      }
    }
    return `[${timestamp}] [${level}] [${tag}] ${message}${metaStr}\n`;
  }

  private rawAppend(filePath: string, content: string) {
    try {
      fs.appendFileSync(filePath, content, 'utf8');
    } catch (e) {
      console.error(`[Logger] Failed to write to ${filePath}:`, e);
    }
  }

  public debug(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.DEBUG, tag, message, meta);
    this.rawAppend(this.sessionLogFile, formatted);
    this.rawAppend(this.serverLatestFile, formatted);
    if (process.env.NODE_ENV === 'development') {
      console.log(`\x1b[90m${formatted.trim()}\x1b[0m`);
    }
  }

  public info(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.INFO, tag, message, meta);
    this.rawAppend(this.sessionLogFile, formatted);
    this.rawAppend(this.serverLatestFile, formatted);
    console.log(`\x1b[36m${formatted.trim()}\x1b[0m`);
  }

  public warn(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.WARN, tag, message, meta);
    this.rawAppend(this.sessionLogFile, formatted);
    this.rawAppend(this.serverLatestFile, formatted);
    console.warn(`\x1b[33m${formatted.trim()}\x1b[0m`);
  }

  public error(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.ERROR, tag, message, meta);
    this.rawAppend(this.sessionLogFile, formatted);
    this.rawAppend(this.serverLatestFile, formatted);
    this.rawAppend(this.errorLogFile, formatted);
    this.rawAppend(this.errorLatestFile, formatted);
    console.error(`\x1b[31m${formatted.trim()}\x1b[0m`);
  }

  public getSessionLogPath(): string {
    return this.sessionLogFile;
  }

  public getLatestLogPath(): string {
    return this.serverLatestFile;
  }

  public getRecentLogs(linesCount: number = 200): { serverLogs: string[]; errorLogs: string[] } {
    const readTail = (file: string) => {
      if (!fs.existsSync(file)) return [];
      try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        return lines.slice(-linesCount);
      } catch (e) {
        return [];
      }
    };

    return {
      serverLogs: readTail(this.serverLatestFile).length > 0 ? readTail(this.serverLatestFile) : readTail(this.sessionLogFile),
      errorLogs: readTail(this.errorLatestFile).length > 0 ? readTail(this.errorLatestFile) : readTail(this.errorLogFile),
    };
  }

  public listLogFiles(): Array<{ name: string; sizeBytes: number; modifiedAt: string }> {
    try {
      const entries = fs.readdirSync(this.logDir, { withFileTypes: true });
      return entries
        .filter(e => e.isFile() && e.name.endsWith('.log'))
        .map(e => {
          const fullPath = path.join(this.logDir, e.name);
          const stat = fs.statSync(fullPath);
          return {
            name: e.name,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    } catch {
      return [];
    }
  }

  public clearLogs() {
    try {
      if (fs.existsSync(this.serverLatestFile)) fs.writeFileSync(this.serverLatestFile, '');
      if (fs.existsSync(this.errorLatestFile)) fs.writeFileSync(this.errorLatestFile, '');
    } catch (e) {}
  }
}

export const logger = new LoggerService();
