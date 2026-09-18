const natUpnp = require('nat-upnp');
import { logger } from './logger.service';

export interface UpnpStatus {
  running: boolean;
  ok: boolean;
  publicIp: string | null;
  publicPort: number;
  lastOkAt: number | null;
  lastError: string | null;
  consecutiveFails: number;
}

const WATCHDOG_MS = 60 * 1000; // проверка каждую минуту
const RENEW_MS = 6 * 60 * 60 * 1000; // плановое продление лизы
const CALL_TIMEOUT_MS = 15000; // SSDP может висеть без сети — не ждём вечно

export class UpnpService {
  private static client: any = null;
  private static refreshTimer: NodeJS.Timeout | null = null;
  private static watchdogTimer: NodeJS.Timeout | null = null;
  private static busy: boolean = false;
  private static currentPort: number = 3000;
  private static wasOk: boolean = false;
  private static lastOkAt: number | null = null;
  private static lastError: string | null = null;
  private static consecutiveFails: number = 0;
  public static publicIp: string | null = null;

  public static async init(port = 3000): Promise<{ success: boolean; publicIp?: string; publicPort?: number; error?: string }> {
    this.currentPort = port;
    const res = await this.establish(port);
    this.startTimers();
    return res;
  }

  public static getStatus(): UpnpStatus {
    return {
      running: this.watchdogTimer !== null,
      ok: this.wasOk,
      publicIp: this.publicIp,
      publicPort: this.currentPort,
      lastOkAt: this.lastOkAt,
      lastError: this.lastError,
      consecutiveFails: this.consecutiveFails,
    };
  }

  // ── Внутреннее ──

  private static startTimers() {
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void this.renew(this.currentPort);
      }, RENEW_MS);
      if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
    }
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        void this.watchdog(this.currentPort);
      }, WATCHDOG_MS);
      if (typeof this.watchdogTimer.unref === 'function') this.watchdogTimer.unref();
    }
  }

  private static newClient() {
    try {
      this.client = natUpnp.createClient();
    } catch (e: any) {
      this.client = null;
    }
  }

  /** Полный цикл: свежий клиент → externalIp → portMapping. Идемпотентен. */
  private static establish(port: number): Promise<{ success: boolean; publicIp?: string; publicPort?: number; error?: string }> {
    if (this.busy) {
      return Promise.resolve(
        this.wasOk
          ? { success: true, publicIp: this.publicIp || undefined, publicPort: port }
          : { success: false, error: this.lastError || 'UPnP busy' },
      );
    }
    this.busy = true;
    this.newClient();

    return new Promise((resolve) => {
      let settled = false;
      const done = (result: { success: boolean; publicIp?: string; publicPort?: number; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(killTimer);
        this.busy = false;
        if (result.success) {
          this.onOk(result.publicIp || null);
        } else {
          this.onFail(result.error || 'Unknown UPnP error');
        }
        resolve(result);
      };

      // Роутер может молчать (нет сети) — колбэки nat-upnp тогда не приходят вообще
      const killTimer = setTimeout(() => {
        done({ success: false, error: 'UPnP timeout: роутер не отвечает (нет сети?)' });
      }, CALL_TIMEOUT_MS);

      if (!this.client) {
        done({ success: false, error: 'Не удалось создать UPnP клиент' });
        return;
      }

      try {
        this.client.externalIp((err: any, ip: string) => {
          if (err || !ip) {
            done({ success: false, error: err?.message || 'Failed to get external IP' });
            return;
          }
          const prevIp = this.publicIp;
          this.publicIp = ip;
          if (prevIp && prevIp !== ip) {
            logger.info('UPnP', `Внешний IP изменился: ${prevIp} → ${ip}, обновляем маппинг`);
          }
          try {
            this.client.portMapping(
              {
                public: port,
                private: port,
                ttl: 86400,
                description: 'SkyCine Media Server',
              },
              (mapErr: any) => {
                if (mapErr) {
                  done({ success: false, publicIp: ip, error: mapErr.message });
                  return;
                }
                done({ success: true, publicIp: ip, publicPort: port });
              },
            );
          } catch (e: any) {
            done({ success: false, publicIp: ip, error: e?.message || 'portMapping throw' });
          }
        });
      } catch (e: any) {
        done({ success: false, error: e?.message || 'externalIp throw' });
      }
    });
  }

  /** Плановое продление: ошибка → полный re-establish (лизу могли снести). */
  private static async renew(port: number) {
    if (this.busy) return;
    if (!this.client) {
      await this.establish(port);
      return;
    }
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const kill = setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error('renew timeout'));
          }
        }, CALL_TIMEOUT_MS);
        this.client.portMapping(
          {
            public: port,
            private: port,
            ttl: 86400,
            description: 'SkyCine Media Server',
          },
          (err: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(kill);
            if (err) reject(err);
            else resolve();
          },
        );
      });
      this.onOk(this.publicIp);
    } catch (e: any) {
      logger.warn('UPnP', `Продление маппинга не удалось (${e?.message}), пересоздаём…`);
      await this.establish(port);
    }
  }

  /**
   * Сторож: раз в минуту заново утверждает маппинг.
   * Интернет пропал → externalIp упадёт, пойдёт счётчик fails.
   * Интернет вернулся → первый же тик всё восстановит без рестарта сервера.
   */
  private static async watchdog(port: number) {
    if (this.busy) return;
    await this.establish(port);
  }

  private static onOk(ip: string | null) {
    this.consecutiveFails = 0;
    this.lastError = null;
    this.lastOkAt = Date.now();
    if (!this.wasOk) {
      this.wasOk = true;
      logger.info('UPnP', `Порт ${this.currentPort} открыт на роутере через UPnP! Внешний IP: ${ip || '?'}`);
      logger.info('UPnP', `Прямой адрес: http://${ip || '?'}:${this.currentPort}`);
    }
  }

  private static onFail(error: string) {
    this.consecutiveFails += 1;
    this.lastError = error;
    if (this.wasOk) {
      // Маппинг только что потерян (роутер ребутнулся / сеть упала) — одна строка, не спам
      this.wasOk = false;
      logger.warn('UPnP', `Доступ через UPnP потерян: ${error}. Повторная попытка каждую минуту…`);
    } else if (this.consecutiveFails <= 3 || this.consecutiveFails % 10 === 0) {
      // Пока чинимся — редкие строки, чтобы не засирать лог каждую минуту
      logger.warn('UPnP', `UPnP недоступен (${this.consecutiveFails} мин): ${error}`);
    }
  }

  public static close(port?: number) {
    const p = port ?? this.currentPort;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.wasOk = false;
    if (this.client) {
      try {
        this.client.portUnmapping({ public: p }, () => {});
      } catch (e) {}
      this.client = null;
    }
  }
}
