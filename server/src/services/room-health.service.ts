import { RoomMember, MemberHealthStatus, RoomHealthEntry } from '../types';

interface HealthInput {
  isBuffering?: boolean;
  isPlaying?: boolean;
  bufferedAheadSec?: number;
  bufferedPosition?: number;
  currentPosition?: number;
  stallCount?: number;
  stallMs?: number;
  rttMs?: number;
  pingMs?: number;
  droppedFrames?: number;
  platform?: string;
  hwdec?: string;
  streamMode?: string;
}

const BER_AHEAD_OK = 4;
const BER_AHEAD_WARN = 1.5;

/**
 * RoomHealthService — чистая логика диагностики комнат.
 * Без зависимости от socket.io: принимает снепшоты мемберов + якорь комнаты,
 * возвращает статусы, виновников и подпись "кого ждём".
 *
 * Семантика, чтобы не врать:
 * - Комната на ПАУЗЕ: все ok ("На паузе"), виновников нет. Никто никого не тормозит,
 *   позиции стоят, дрейф и сталы не считаются.
 * - "Буферизация" только если комната PLAYING И сам участник играет (isPlaying).
 *   Пауза + seek дают 'waiting' без 'playing' — это не лаг, а намеренное состояние.
 * - stallCount / droppedFrames приходят ОКНАМИ за ~3с (клиент обнуляет после отправки),
 *   поэтому пороги — про текущий момент, а не про накопленную историю.
 * - bufferedAheadSec == -1 (или нет данных) = "буфер неизвестен" (YouTube iframe,
 *   старт потока): предупреждения про буфер не выносим, ждём реальных сигналов
 *   (stall/пинг/дрейф). Иначе все ютуб-зрители вечно жёлтые "Мало буфера".
 */
class RoomHealthService {
  analyze(
    members: RoomMember[],
    roomAnchor: { position: number; serverTimestamp: number; state: string; playbackRate?: number } | null,
    now: number = Date.now(),
  ): { health: RoomHealthEntry[]; culpritIds: string[]; waitingFor: string[]; waitingText: string | null } {
    const roomPlaying = roomAnchor?.state === 'PLAYING';

    let livePos = roomAnchor?.position ?? 0;
    if (roomAnchor && roomPlaying && roomAnchor.serverTimestamp) {
      livePos += Math.max(0, (now - roomAnchor.serverTimestamp) / 1000) * (roomAnchor.playbackRate || 1.0);
    }

    const health: RoomHealthEntry[] = members.map((m) => {
      const input = m as RoomMember & HealthInput;
      const ahead = this.resolveAhead(m); // null = неизвестно
      const memberPlaying = input.isPlaying !== false;
      // Честная буферизация: флаг + комната играет + сам участник играет.
      // Старые клиенты isPlaying не шлют (undefined → считаем играет, как раньше).
      const bufferingActive = Boolean(input.isBuffering) && roomPlaying === true && memberPlaying;
      const windowStalls = input.stallCount ?? 0;
      const rtt = input.rttMs ?? m.pingMs ?? 0;
      const windowDrops = input.droppedFrames ?? 0;
      const drift = roomPlaying ? (m.currentPosition || 0) - livePos : 0;

      let status: MemberHealthStatus = 'ok';
      let detail = roomPlaying ? 'Всё хорошо' : 'На паузе';
      if (roomPlaying) {
        if (bufferingActive) {
          status = 'buffering';
          detail = `Буферизация…${ahead !== null ? ` запас ${ahead.toFixed(1)}с` : ''}`;
        } else if (memberPlaying && (rtt > 800 || drift < -6 || windowStalls >= 3)) {
          status = 'lagging';
          if (rtt > 800) detail = `Высокий пинг ${Math.round(rtt)}мс`;
          else if (drift < -6) detail = `Отстаёт на ${Math.abs(drift).toFixed(0)}с`;
          else detail = `Серия остановок (${windowStalls} за пару секунд)`;
        } else if (memberPlaying && (rtt > 350 || (ahead !== null && ahead < BER_AHEAD_WARN) || Math.abs(drift) > 2.5 || windowDrops > 15 || windowStalls >= 1)) {
          status = 'warning';
          if (windowStalls >= 1) detail = `Краткая остановка (${windowStalls})`;
          else if (ahead !== null && ahead < BER_AHEAD_WARN) detail = `Мало буфера: ${ahead.toFixed(1)}с`;
          else if (Math.abs(drift) > 2.5) detail = `Рассинхрон ${drift > 0 ? '+' : ''}${drift.toFixed(1)}с`;
          else if (rtt > 350) detail = `Пинг ${Math.round(rtt)}мс`;
          else detail = `Потери кадров: ${windowDrops}`;
        } else if (memberPlaying && ahead !== null && ahead < BER_AHEAD_OK) {
          status = 'warning';
          detail = `Буфер ${ahead.toFixed(1)}с`;
        }
      }

      // Обновляем кеш статуса прямо на мембере для переиспользования
      m.healthStatus = status;
      if (ahead !== null) m.bufferedAheadSec = ahead;
      m.lastHealthUpdate = now;

      return {
        userId: m.userId,
        username: m.username,
        avatarUrl: m.avatarUrl,
        status,
        isBuffering: bufferingActive,
        bufferedAheadSec: ahead !== null ? Math.round(ahead * 10) / 10 : 0,
        stallCount: windowStalls,
        rttMs: Math.round(rtt),
        droppedFrames: windowDrops,
        driftSec: Math.round(drift * 10) / 10,
        platform: (m as RoomMember).platform,
        streamMode: m.streamMode,
        currentPosition: m.currentPosition || 0,
        detail,
      };
    });

    const culprits = health.filter((h) => h.status === 'buffering' || h.status === 'lagging');
    const culpritIds = culprits.map((c) => c.userId);
    const waitingFor = culprits.map((c) => c.username);
    let waitingText: string | null = null;
    if (culprits.length === 1) {
      const c = culprits[0];
      waitingText = c.status === 'buffering'
        ? `Ожидаем ${c.username} — буферизация (запас ${c.bufferedAheadSec}с)`
        : `Ожидаем ${c.username} — ${c.detail}`;
    } else if (culprits.length > 1) {
      waitingText = `Тормозят: ${waitingFor.join(', ')} — ожидаем прогрузки`;
    }

    return { health, culpritIds, waitingFor, waitingText };
  }

  private resolveAhead(m: RoomMember): number | null {
    // -1 = клиент честно сказал "не знаю" (нет video.buffered / нет MPV-статов)
    if (m.bufferedAheadSec === -1) return null;
    if (typeof m.bufferedAheadSec === 'number' && Number.isFinite(m.bufferedAheadSec)) {
      return Math.max(0, m.bufferedAheadSec);
    }
    const ahead = (m.bufferedPosition || 0) - (m.currentPosition || 0);
    if (Number.isFinite(ahead) && ahead >= 0 && ahead < 36000) return ahead;
    return null;
  }
}

export const roomHealthService = new RoomHealthService();
