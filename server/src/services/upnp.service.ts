const natUpnp = require('nat-upnp');
import { logger } from './logger.service';

export class UpnpService {
  private static client: any = null;
  private static refreshTimer: NodeJS.Timeout | null = null;
  public static publicIp: string | null = null;

  public static async init(port = 3000): Promise<{ success: boolean; publicIp?: string; publicPort?: number; error?: string }> {
    try {
      this.client = natUpnp.createClient();

      return new Promise((resolve) => {
        // 1. Get External IP
        this.client.externalIp((err: any, ip: string) => {
          if (err || !ip) {
            logger.warn('UPnP', `Не удалось получить внешний IP роутера: ${err?.message || 'Unknown'}`);
            return resolve({ success: false, error: err?.message || 'Failed to get external IP' });
          }

          this.publicIp = ip;

          // 2. Map Port
          this.client.portMapping(
            {
              public: port,
              private: port,
              ttl: 86400, // 24 hours
              description: 'SkyCine Media Server',
            },
            (mapErr: any) => {
              if (mapErr) {
                logger.warn('UPnP', `Ошибка проброса порта ${port} через UPnP: ${mapErr.message}`);
                return resolve({ success: false, publicIp: ip, error: mapErr.message });
              }

              logger.info('UPnP', `Порт ${port} успешно открыт на роутере через UPnP! Внешний IP: ${ip}`);
              logger.info('UPnP', `Прямой постоянный адрес: http://${ip}:${port}`);

              // Set periodic renewal every 6 hours
              if (!this.refreshTimer) {
                this.refreshTimer = setInterval(() => {
                  this.client.portMapping({
                    public: port,
                    private: port,
                    ttl: 86400,
                    description: 'SkyCine Media Server',
                  }, () => {});
                }, 6 * 60 * 60 * 1000);
              }

              resolve({ success: true, publicIp: ip, publicPort: port });
            }
          );
        });
      });
    } catch (e: any) {
      logger.warn('UPnP', `UPnP инициализация не удалась: ${e.message}`);
      return { success: false, error: e.message };
    }
  }

  public static close(port = 3000) {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.client) {
      try {
        this.client.portUnmapping({ public: port }, () => {});
      } catch (e) {}
    }
  }
}
