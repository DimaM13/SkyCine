import fs from 'fs';
import path from 'path';

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

class LoggerService {
  private logDir: string;
  private serverLogFile: string;
  private errorLogFile: string;

  constructor() {
    this.logDir = path.resolve(__dirname, '../../../data/logs');
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    this.serverLogFile = path.join(this.logDir, 'server.log');
    this.errorLogFile = path.join(this.logDir, 'error.log');
  }

  private formatMessage(level: LogLevel, tag: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 23);
    const metaStr = meta ? (meta instanceof Error ? `\n${meta.stack}` : ` | ${JSON.stringify(meta)}`) : '';
    return `[${timestamp}] [${level}] [${tag}] ${message}${metaStr}\n`;
  }

  private writeToFile(filePath: string, formatted: string) {
    try {
      fs.appendFileSync(filePath, formatted, 'utf8');
    } catch (e) {
      console.error('Failed to write to log file:', e);
    }
  }

  public debug(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.DEBUG, tag, message, meta);
    this.writeToFile(this.serverLogFile, formatted);
    if (process.env.NODE_ENV === 'development') {
      console.log(`\x1b[90m${formatted.trim()}\x1b[0m`);
    }
  }

  public info(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.INFO, tag, message, meta);
    this.writeToFile(this.serverLogFile, formatted);
    console.log(`\x1b[36m${formatted.trim()}\x1b[0m`);
  }

  public warn(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.WARN, tag, message, meta);
    this.writeToFile(this.serverLogFile, formatted);
    console.warn(`\x1b[33m${formatted.trim()}\x1b[0m`);
  }

  public error(tag: string, message: string, meta?: any) {
    const formatted = this.formatMessage(LogLevel.ERROR, tag, message, meta);
    this.writeToFile(this.serverLogFile, formatted);
    this.writeToFile(this.errorLogFile, formatted);
    console.error(`\x1b[31m${formatted.trim()}\x1b[0m`);
  }

  public getRecentLogs(linesCount: number = 150): { serverLogs: string[]; errorLogs: string[] } {
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
      serverLogs: readTail(this.serverLogFile),
      errorLogs: readTail(this.errorLogFile),
    };
  }

  public clearLogs() {
    try {
      if (fs.existsSync(this.serverLogFile)) fs.writeFileSync(this.serverLogFile, '');
      if (fs.existsSync(this.errorLogFile)) fs.writeFileSync(this.errorLogFile, '');
    } catch (e) {}
  }
}

export const logger = new LoggerService();
