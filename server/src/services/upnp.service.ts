const natUpnp = require('nat-upnp');
import { logger } from './logger.service';

export interface UpnpPortStatus {
  port: number;
  ok: boolean;
  publicIp: string | null;
  lastOkAt: number | null;
  lastError: string | null;
  consecutiveFails: number;
}

export interface UpnpStatus {
  running: boolean;
  ok: boolean;
  ports: UpnpPortStatus[];
  publicIp: string | null;
}

const WATCHDOG_MS = 60 * 1000; // проверка каждую минуту
const RENEW_MS = 6 * 60 * 60 * 1000; // плановое продление лизы
const CALL_TIMEOUT_MS = 15000; // SSDP может висеть без сети — не ждём вечно
const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export class UpnpService {
  private static client: any = null;
  private static refreshTimer: NodeJS.Timeout | null = null;
  private static watchdogTimer: NodeJS.Timeout | null = null;
  private static busy: boolean = false;
  private static ports: number[] = [3000];
  private static portState: Map<number, { wasOk: boolean; lastOkAt: number | null; lastError: string | null; fails: number }> = new Map();
  public static publicIp: string | null = null;

  public static async init(ports: number | number[] = 3000): Promise<{ success: boolean; publicIp?: string; error?: string }> {
    this.ports = (Array.isArray(ports) ? ports : [ports]).filter((p) => Number.isInteger(p) && p > 0);
    if (this.ports.length === 0) this.ports = [3000];
    for (const p of this.ports) {
      if (!this.portState.has(p)) {
        this.portState.set(p, { wasOk: false, lastOkAt: null, lastError: null, fails: 0 });
      }
    }
    let ok = true;
    let lastErr: string | undefined;
    for (const p of this.ports) {
      const res = await this.establish(p);
      if (!res.success) {
        ok = false;
        lastErr = res.error;
      }
    }
    this.startTimers();
    return ok
      ? { success: true, publicIp: this.publicIp || undefined }
      : { success: false, error: lastErr };
  }

  public static getStatus(): UpnpStatus {
    const ports: UpnpPortStatus[] = this.ports.map((p) => {
      const st = this.portState.get(p) || { wasOk: false, lastOkAt: null, lastError: null, fails: 0 };
      return {
        port: p,
        ok: st.wasOk,
        publicIp: st.wasOk ? this.publicIp : null,
        lastOkAt: st.lastOkAt,
        lastError: st.lastError,
        consecutiveFails: st.fails,
      };
    });
    return {
      running: this.watchdogTimer !== null,
      ok: ports.length > 0 && ports.every((p) => p.ok),
      ports,
      publicIp: this.publicIp,
    };
  }

  // ── Внутреннее ──

  /**
   * Роутеры/библиотеки иногда отдают IP не строкой, а объектом
   * (отсюда был мусор "[object Object]" в логах). Приводим к строке
   * и проверяем, что это вообще IPv4 — иначе считаем ошибкой.
   */
  private static extractIp(raw: any): string {
    if (typeof raw === 'string') {
      const s = raw.trim();
      return IPV4_RE.test(s) ? s : '';
    }
    if (raw && typeof raw === 'object') {
      const candidates = [
        raw.NewExternalIPAddress,
        raw.externalIPAddress,
        raw.ip,
        raw.address,
        raw.ExternalIPAddress,
      ];
      for (const c of candidates) {
        if (typeof c === 'string' && IPV4_RE.test(c.trim())) return c.trim();
      }
    }
    return '';
  }

  private static startTimers() {
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        void this.renewAll();
      }, RENEW_MS);
      if (typeof this.refreshTimer.unref === 'function') this.refreshTimer.unref();
    }
    if (!this.watchdogTimer) {
      this.watchdogTimer = setInterval(() => {
        void this.watchdogAll();
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
      const st = this.portState.get(port);
      return Promise.resolve(
        st?.wasOk
          ? { success: true, publicIp: this.publicIp || undefined, publicPort: port }
          : { success: false, error: st?.lastError || 'UPnP busy' },
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
          this.onOk(port, result.publicIp || null);
        } else {
          this.onFail(port, result.error || 'Unknown UPnP error');
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
        this.client.externalIp((err: any, rawIp: any) => {
          const ip = this.extractIp(rawIp);
          if (err || !ip) {
            done({ success: false, error: err?.message || 'Роутер вернул некорректный внешний IP' });
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

  private static async renewAll() {
    for (const port of this.ports) {
      await this.renew(port);
    }
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
      this.onOk(port, this.publicIp);
    } catch (e: any) {
      logger.warn('UPnP', `Продление маппинга порта ${port} не удалось (${e?.message}), пересоздаём…`);
      await this.establish(port);
    }
  }

  private static async watchdogAll() {
    for (const port of this.ports) {
      if (this.busy) return;
      await this.establish(port);
    }
  }

  private static onOk(port: number, ip: string | null) {
    let st = this.portState.get(port);
    if (!st) {
      st = { wasOk: false, lastOkAt: null, lastError: null, fails: 0 };
      this.portState.set(port, st);
    }
    st.fails = 0;
    st.lastError = null;
    st.lastOkAt = Date.now();
    if (!st.wasOk) {
      st.wasOk = true;
      logger.info('UPnP', `Порт ${port} открыт на роутере через UPnP! Внешний IP: ${ip || '?'}`);
      logger.info('UPnP', `Прямой адрес: http://${ip || '?'}:${port}`);
    }
  }

  private static onFail(port: number, error: string) {
    let st = this.portState.get(port);
    if (!st) {
      st = { wasOk: false, lastOkAt: null, lastError: null, fails: 0 };
      this.portState.set(port, st);
    }
    st.fails += 1;
    st.lastError = error;
    if (st.wasOk) {
      // Маппинг только что потерян (роутер ребутнулся / сеть упала) — одна строка, не спам
      st.wasOk = false;
      logger.warn('UPnP', `Доступ через UPnP к порту ${port} потерян: ${error}. Повторная попытка каждую минуту…`);
    } else if (st.fails <= 3 || st.fails % 10 === 0) {
      // Пока чинимся — редкие строки, чтобы не засирать лог каждую минуту
      logger.warn('UPnP', `UPnP порт ${port} недоступен (${st.fails} мин): ${error}`);
    }
  }

  public static close(port?: number) {
    const ports = port !== undefined ? [port] : [...this.ports];
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    for (const [, st] of this.portState) st.wasOk = false;
    if (this.client) {
      for (const p of ports) {
        try {
          this.client.portUnmapping({ public: p }, () => {});
        } catch (e) {}
      }
      this.client = null;
    }
  }
}
