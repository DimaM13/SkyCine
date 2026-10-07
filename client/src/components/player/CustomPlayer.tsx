import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Volume1,
  RotateCcw, RotateCw, Settings,
  Maximize, Minimize
} from 'lucide-react';
import { MediaItem, MediaTrack, RoomState } from '../../types';
import { ReactionOverlay } from './ReactionOverlay';
import { apiClient } from '../../api/client';
import { qualityLabel, formatTime, clamp01 } from './playerUtils';
import { PlayerTopBar } from './PlayerTopBar';
import { PlayerStatsModal } from './PlayerStatsModal';
import { PlayerSettingsMenu } from './PlayerSettingsMenu';
import { SeekFlash, CenterFlash, ShortcutsButton, ShortcutsModal } from './PlayerOverlays';
import type { SeekFlashData, CenterFlashData } from './PlayerOverlays';

export { qualityLabel };

interface CustomPlayerProps {
  media: MediaItem;
  room?: any;
  roomState?: RoomState;
  syncDiffSec?: number;
  isWatchTogether?: boolean;
  isHost?: boolean;
  members?: any[];
  currentUserId?: string;
  reactions?: any[];
  onPlayRequest?: () => void;
  onPauseRequest?: () => void;
  onSeekRequest?: (pos: number, shouldPlay?: boolean) => void;
  onSyncToHost?: () => void;
  onForceSyncAll?: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  onBack?: () => void;
  onInvite?: () => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachPlayHandler?: (fn: () => void) => void;
  onAttachPauseHandler?: (fn: () => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  onAttachGetIsPaused?: (fn: () => boolean) => void;
  initialPosition?: number;
  videoRef?: React.RefObject<HTMLVideoElement>;
  onStreamModeDetected?: (mode: 'direct' | 'fmp4') => void;
  onControlsVisibilityChange?: (visible: boolean) => void;
}

export const CustomPlayer: React.FC<CustomPlayerProps> = ({
  media,
  room,
  roomState,
  syncDiffSec = 0,
  isWatchTogether = false,
  isHost = false,
  members = [],
  reactions = [],
  initialPosition = 0,
  onStreamModeDetected,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
  onSyncToHost,
  onForceSyncAll,
  onToggleSidebar,
  isSidebarOpen = false,
  onBack,
  onInvite,
  onAttachSeekHandler,
  onAttachPlayHandler,
  onAttachPauseHandler,
  onAttachGetCurrentTime,
  onAttachGetIsPaused,
  videoRef: externalVideoRef,
  onControlsVisibilityChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  // Web Audio Gain Booster
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const displayTime = isScrubbing ? scrubTime : currentTime;
  const [duration, setDuration] = useState(media.durationSeconds || 0);
  const effectiveDuration = (media.durationSeconds && media.durationSeconds > 0)
    ? media.durationSeconds
    : (duration > 0 ? duration : 0);
  const currentTimeRef = useRef<number>(initialPosition || 0);
  const effectiveDurationRef = useRef<number>(effectiveDuration);
  useEffect(() => {
    effectiveDurationRef.current = effectiveDuration;
  }, [effectiveDuration]);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioBoost, setAudioBoost] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPip, setIsPip] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{ ratio: number; time: number } | null>(null);
  const [seekHint, setSeekHint] = useState<string | null>(null);
  const [autoNotice, setAutoNotice] = useState<string | null>(null);
  const [seekFlash, setSeekFlash] = useState<SeekFlashData | null>(null);
  const [centerFlash, setCenterFlash] = useState<CenterFlashData | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const flashKeyRef = useRef(0);
  const [techStats, setTechStats] = useState({ droppedFrames: 0, totalFrames: 0, hlsBitrate: 0, fallbackStage: 0, bufferedAhead: 0 });

  const audioTracks = useMemo(() => media.tracks?.filter((t: MediaTrack) => t.type === 'AUDIO') || [], [media.tracks]);
  const subtitleTracks = useMemo(() => media.tracks?.filter((t: MediaTrack) => t.type === 'SUBTITLE') || [], [media.tracks]);

  // Preferred default audio track (auto-select Russian track if present)
  const defaultAudioTrackIndex = useMemo(() => {
    if (!audioTracks.length) return 0;
    const rus = audioTracks.find((t: MediaTrack) =>
      /rus|ru|russian|рус|дубляж|многоголосый|проф/i.test(t.language || '') ||
      /rus|ru|russian|рус|дубляж|многоголосый|проф/i.test(t.title || '')
    );
    return rus ? rus.streamIndex : audioTracks[0].streamIndex;
  }, [audioTracks]);

  const [selectedQuality, setSelectedQuality] = useState<string>('original');
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(defaultAudioTrackIndex);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  const isAppleDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // Десктопный Mac тоже Apple: те же кодеки/ограничения, что у iPad/iPhone,
    // воспроизведение — через нативный AVPlayer где он есть (Safari),
    // остальные браузеры сами упадут в hls.js по canPlayType-проверке ниже
    return /iPad|iPhone|iPod/.test(ua) || /Macintosh/.test(ua);
  }, []);

  // ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ (MMS): мобильный Apple — это iPad/iPhone, либо iPadOS,
  // прикидывающийся Macintosh (отличаем по тачу — у маков его нет).
  const isMobileApple = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    return /Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1;
  }, []);

  // Managed Media Source (iPadOS 17+): hls.js через него вместо нативного AVPlayer.
  // Свой толерантный парсер, видимые ошибки, рабочие ретраи. Нет MMS — как раньше.
  const canUseManagedMse = useMemo(() => {
    if (typeof window === 'undefined' || !isMobileApple) return false;
    try {
      return !!(window as any).ManagedMediaSource && Hls.isSupported();
    } catch {
      return false;
    }
  }, [isMobileApple]);

  useEffect(() => {
    setSelectedAudioTrack(defaultAudioTrackIndex);
  }, [defaultAudioTrackIndex]);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Сообщаем наружу видимость интерфейса (топ-бар здоровья прячется вместе с ним)
  const onControlsVisibilityChangeRef = useRef(onControlsVisibilityChange);
  onControlsVisibilityChangeRef.current = onControlsVisibilityChange;
  useEffect(() => {
    onControlsVisibilityChangeRef.current?.(showControls);
  }, [showControls]);

  // Direct Play eligibility check
  const isDirectPlay = useMemo(() => {
    const ext = (media.filePath || '').toLowerCase();
    const pcContainers = ['.mp4', '.m4v', '.webm', '.mkv'];
    const appleContainers = ['.mp4', '.m4v', '.webm'];
    const isNativeContainer = isAppleDevice
      ? appleContainers.some(c => ext.endsWith(c))
      : pcContainers.some(c => ext.endsWith(c));
    if (!isNativeContainer || selectedQuality !== 'original') return false;
    if (audioTracks.length > 1) return false;

    const selectedTrack = audioTracks.find(t => t.streamIndex === selectedAudioTrack) || audioTracks[0];
    const rawAudioCodec = (selectedTrack?.codec || media.audioCodec || '').toLowerCase();
    const rawVideoCodec = (media.videoCodec || '').toLowerCase();

    // ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ: 4K VP9 идёт напрямую, без исключений.
    if (isAppleDevice) {
      const isNativeAppleAudio = ['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus'].some(c => rawAudioCodec.includes(c));
      const isNativeAppleVideo = ['h264', 'hevc', 'h265', 'vp8', 'vp9'].includes(rawVideoCodec);
      return isNativeAppleAudio && isNativeAppleVideo;
    } else {
      const isNativePcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'].some(c => rawAudioCodec.includes(c));
      const isNativePcVideo = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'].includes(rawVideoCodec);
      return isNativePcAudio && isNativePcVideo;
    }
  }, [media.filePath, media.audioCodec, media.videoCodec, media.resolution, selectedQuality, audioTracks, selectedAudioTrack, isAppleDevice]);

  const currentAudioTrack = useMemo(() => {
    return audioTracks.find(t => t.streamIndex === selectedAudioTrack) || audioTracks[0];
  }, [audioTracks, selectedAudioTrack]);

  const streamBadges = useMemo(() => {
    const rawVideoCodec = (media.videoCodec || '').toLowerCase();
    const rawAudioCodec = (currentAudioTrack?.codec || media.audioCodec || '').toUpperCase();

    // Check if video codec is supported by browser for Direct Copy without transcoding
    // ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ: 4K VP9 идёт напрямую, без исключений.
    // PC без vp8 (твин серверного isDirectCopyVideo): Chrome MSE в MP4 VP8 не
    // принимает — сервер такие транскодирует, бейдж обязан показать транскод.
    const pcSupportedCodecs = ['h264', 'hevc', 'h265', 'vp9', 'av1'];
    const appleSupportedCodecs = ['h264', 'hevc', 'h265', 'vp8', 'vp9'];
    const isSupportedVideo = isAppleDevice
      ? appleSupportedCodecs.includes(rawVideoCodec)
      : pcSupportedCodecs.includes(rawVideoCodec);

    const isVideoDirectCopy = isDirectPlay || (selectedQuality === 'original' && isSupportedVideo);
    // Контейнер HLS всегда fMP4 (MPEG-TS удалён на сервере для всех).

    const isAudioTrans = !isDirectPlay && (
      isAppleDevice
        // Твин серверного appleAudio: FLAC на Apple копируется (passthrough).
        ? !['AAC', 'MP3', 'AC3', 'EAC3', 'ALAC', 'OPUS', 'FLAC'].some(c => rawAudioCodec.includes(c))
        : !['AAC', 'MP3', 'OPUS', 'FLAC'].some(c => rawAudioCodec.includes(c))
    );

    // Куда реально перекодируется звук (твин серверного _create): Apple 5.1+ при
    // не-копии идёт в AC3 640k, всё остальное не-копи — в AAC. Бейдж обязан
    // показать правду, а не всегда "→ AAC".
    const transAudioLabel = (isAppleDevice && ((currentAudioTrack?.channels || 0) >= 6))
      ? `Звук: ${rawAudioCodec || 'DTS'} → AC3 5.1`
      : `Звук: ${rawAudioCodec || 'DTS'} → AAC`;

    let modeText = 'Direct Stream (Оригинал)';
    let modeType: 'direct' | 'stream' | 'transcode' = 'stream';

    if (isDirectPlay) {
      modeText = 'Direct Play (Оригинал)';
      modeType = 'direct';
    } else if (isVideoDirectCopy) {
      modeType = 'stream';
      if (isAudioTrans) {
        modeText = `Direct Stream • ${transAudioLabel}`;
      } else {
        modeText = 'Direct Stream (Оригинал)';
      }
    } else {
      modeType = 'transcode';
      const vText = !isSupportedVideo
        ? `${(rawVideoCodec || 'VC-1').toUpperCase()} → H.264`
        : qualityLabel(selectedQuality);
      const aText = isAudioTrans
        ? transAudioLabel
        : `Звук: Оригинал (${rawAudioCodec || 'AAC'})`;

      modeText = `Транскодирование (Видео: ${vText} • ${aText})`;
    }

    const vCodec = (media.videoCodec || '').toUpperCase();
    const res = media.resolution || '';
    const videoLabel = [vCodec, res].filter(Boolean).join(' • ');

    const aTrack = currentAudioTrack;
    const aLang = aTrack?.language?.toUpperCase() || aTrack?.title || 'АУДИО';
    const aCodec = (aTrack?.codec || media.audioCodec || '').toUpperCase();
    const channelsNum = aTrack?.channels;
    const chText = channelsNum === 6 ? '5.1' : channelsNum === 8 ? '7.1' : channelsNum === 2 ? '2.0' : channelsNum ? `${channelsNum}.0` : '';
    const audioLabel = `${aLang}${aCodec ? ` • ${aCodec}` : ''}${chText ? ` ${chText}` : ''}`;

    const isDesktopApp = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);

    // Контейнер HLS всегда fMP4 (MPEG-TS удалён на сервере для всех).
    const containerLabel = isDesktopApp
      ? 'Native MKV / Direct Stream'
      : isDirectPlay
        ? 'Direct MP4'
        : (isAppleDevice ? 'fMP4 CMAF (Apple HLS)' : 'fMP4 CMAF (Chunked MP4)');
    const engineLabel = isDesktopApp
      ? 'MPV Native Engine (Direct3D11 / GPU NVDEC)'
      : isDirectPlay ? 'HTML5 Native Player' : isAppleDevice ? 'Apple Native AVPlayer' : 'Hls.js Engine (MSE)';

    return {
      modeText: isDesktopApp ? 'Прямой нативный поток (Bit-perfect MPV Direct Play)' : modeText,
      modeType: isDesktopApp ? 'direct' : modeType,
      isVideoDirectCopy: isDesktopApp ? true : isVideoDirectCopy,
      isAudioTrans: isDesktopApp ? false : isAudioTrans,
      vCodec,
      res,
      videoLabel,
      aLang,
      aCodec,
      chText,
      audioLabel,
      containerLabel,
      engineLabel,
    };
  }, [isDirectPlay, selectedQuality, media, currentAudioTrack, isAppleDevice]);

  // Режим HLS всегда fMP4 (MPEG-TS удалён на сервере): 'apple_ts' больше не бывает.
  const calculatedStreamMode = useMemo((): 'direct' | 'fmp4' => {
    if (isDirectPlay) return 'direct';
    return 'fmp4';
  }, [isDirectPlay]);

  useEffect(() => {
    if (isWatchTogether && onStreamModeDetected) {
      onStreamModeDetected(calculatedStreamMode);
    }
  }, [isWatchTogether, calculatedStreamMode, onStreamModeDetected]);

  const hlsRef = useRef<Hls | null>(null);
  // Актуальный мастер-URL для hls (обновляется при каждом loadSource:
  // качество/дорожка могут смениться, а ERROR-хендлер живёт в замыкании)
  const hlsUrlRef = useRef<string>('');

  // Телеметрия плеера: ошибки video/hls + сводка уходят в /api/debug/player-log (лог PLAYER).
  // Нужна чтобы видеть ПРИЧИНУ отказа со стороны плеера (сервер видит только HTTP).
  const playerStatsRef = useRef({ waiting: 0, stalled: 0, emptied: 0, abortEv: 0, suspendEv: 0, fragErr: 0, mediaErr: 0, parsingErr: 0, bufferFlushed: 0 });
  const telemetryParsingSentRef = useRef(0);
  // Авто-фолбэк ступенями: 0 — нет, 1 — ушли на 'transcode' (оригинал-размер),
  // 2 — ушли на '720p' (лёгкий вес). Ручной выбор юзера гасит автомат.
  const fallbackStageRef = useRef(0);
  // Метка авто-переключения: эффект смены качества по ней отличает авто от ручного.
  const autoSwitchingRef = useRef(false);
  // Журнал вытеснений для детекта шёрна (время + позиция).
  const evictLogRef = useRef<{ at: number; pos: number }[]>([]);
  // Журнал аппендов по sn: один и тот же фрагмент лёг в буфер N раз,
  // а позиция стоит — значит его тут же вытесняют (девайс не тянет вес).
  const bufLogRef = useRef<{ at: number; sn: number; pos: number }[]>([]);
  // Ошибки парсинга по sn: transmux не может разобрать один и тот же фрагмент.
  const parseStreakRef = useRef<{ sn: number; count: number }>({ sn: -2, count: 0 });
  const sendPlayerLog = useCallback((event: string, level: 'info' | 'warn' | 'error' = 'info', extra: Record<string, any> = {}) => {
    try {
      const video = videoRef.current;
      let buffered = '';
      try {
        const b = video?.buffered;
        if (b) {
          const parts: string[] = [];
          for (let i = 0; i < b.length && i < 5; i++) {
            parts.push(`${b.start(i).toFixed(1)}-${b.end(i).toFixed(1)}`);
          }
          buffered = parts.join(',');
        }
      } catch {}
      let cur = -1;
      try {
        const dt = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);
        cur = dt ? currentTimeRef.current : (video?.currentTime ?? -1);
        cur = Math.round(cur * 100) / 100;
      } catch {}
      const payload = {
        event, level,
        mediaId: media.id,
        mount: mountIdRef.current,
        currentTime: cur,
        buffered,
        errorCode: extra.errorCode ?? '',
        errorMessage: extra.errorMessage ?? '',
        detail: extra.detail ?? '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        stats: playerStatsRef.current,
      };
      const token = localStorage.getItem('myplex_token');
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        try {
          navigator.sendBeacon(`/api/debug/player-log${tokenParam}`, new Blob([body], { type: 'application/json' }));
          return;
        } catch {}
      }
      fetch(`/api/debug/player-log${tokenParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {}
  }, [media.id, videoRef]);

  useEffect(() => {
    fallbackStageRef.current = 0;
    autoSwitchingRef.current = false;
    telemetryParsingSentRef.current = 0;
    evictLogRef.current = [];
    bufLogRef.current = [];
    parseStreakRef.current = { sn: -2, count: 0 };
  }, [media.id]);
  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);
  // Единый авто-фолбэк: первая ступень — 'transcode' (то же разрешение, чистая
  // упаковка с ключевыми кадрами), вторая — '720p' (если вес всё равно не лезет).
  // Возвращает true если переключили. Ручной выбор качества гасит автомат.
  const attemptFallback = useCallback((reason: string, detail: string = ''): boolean => {
    try {
      const curQ = streamInfoRef.current?.quality || 'original';
      const stage = fallbackStageRef.current;
      let next: string | null = null;
      if (stage === 0 && curQ === 'original') next = 'transcode';
      else if (stage <= 1 && curQ !== '720p' && curQ !== 'transcode') next = 'transcode';
      else if (stage <= 1) next = '720p';
      if (!next || next === curQ) return false;
      fallbackStageRef.current = next === 'transcode' ? 1 : 2;
      autoSwitchingRef.current = true;
      sendPlayerLog('auto-fallback', 'warn', { detail: `${reason} -> ${next} ${detail}`.slice(0, 200) });
      try { setSelectedQuality(next); } catch {}
      try {
        setAutoNotice(`Авто-качество: ${qualityLabel(next)} (было тяжело)`);
        window.setTimeout(() => setAutoNotice(null), 4000);
        setTechStats((s) => ({ ...s, fallbackStage: fallbackStageRef.current }));
      } catch {}
      evictLogRef.current = [];
      bufLogRef.current = [];
      return true;
    } catch {
      return false;
    }
  }, [sendPlayerLog]);

  // PiP: доступность + синхронизация иконки с системным событием
  useEffect(() => {
    try {
      setPipSupported(typeof document !== 'undefined' && !!(document as any).pictureInPictureEnabled && !isDesktop);
    } catch { setPipSupported(false); }
    const onEnter = () => setIsPip(true);
    const onLeave = () => setIsPip(false);
    try {
      (document as any).addEventListener?.('enterpictureinpicture', onEnter);
      (document as any).addEventListener?.('leavepictureinpicture', onLeave);
    } catch {}
    return () => {
      try {
        (document as any).removeEventListener?.('enterpictureinpicture', onEnter);
        (document as any).removeEventListener?.('leavepictureinpicture', onLeave);
      } catch {}
    };
  }, [isDesktop]);

  // Применяем скорость к <video> (HLS/Direct переживают пересоздание src — дотягиваем здесь)
  useEffect(() => {
    if (isDesktop) return;
    const video = videoRef.current;
    if (!video) return;
    try {
      if (Math.abs((video.playbackRate || 1) - playbackRate) > 0.01) video.playbackRate = playbackRate;
    } catch {}
  }, [playbackRate, isDesktop, videoRef, selectedQuality, selectedAudioTrack, media.id]);
  const [hasVideoFrame, setHasVideoFrame] = useState(false);

  useEffect(() => {
    setHasVideoFrame(false);
  }, [media.id]);

  // Телеметрия video-элемента: фатальная ошибка + счётчики stalls (см. лог PLAYER).
  // Сводка улетает при размонтировании всегда (один маяк — зато видно буфер и время).
  useEffect(() => {
    if (isDesktop) return;
    const video = videoRef.current;
    if (!video) return;
    const st = playerStatsRef.current;
    const onWaiting = () => { st.waiting++; };
    const onStalled = () => { st.stalled++; };
    const onEmptied = () => { st.emptied++; };
    const onAbortEv = () => { st.abortEv++; };
    const onSuspendEv = () => { st.suspendEv++; };
    const onError = () => {
      const e: any = video.error;
      sendPlayerLog('video-error', 'error', {
        errorCode: e?.code ?? '',
        errorMessage: e?.message ?? '',
        detail: `readyState=${video.readyState} networkState=${video.networkState} src=${(video.currentSrc || '').slice(-80)}`,
      });
    };
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('emptied', onEmptied);
    video.addEventListener('abort', onAbortEv);
    video.addEventListener('suspend', onSuspendEv);
    video.addEventListener('error', onError);
    return () => {
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('emptied', onEmptied);
      video.removeEventListener('abort', onAbortEv);
      video.removeEventListener('suspend', onSuspendEv);
      video.removeEventListener('error', onError);
      const s = playerStatsRef.current;
      const noisy = s.waiting + s.stalled + s.emptied + s.abortEv + s.fragErr + s.mediaErr + s.parsingErr + s.bufferFlushed;
      sendPlayerLog('video-summary', noisy > 0 ? 'warn' : 'info', { detail: JSON.stringify(s) });
      playerStatsRef.current = { waiting: 0, stalled: 0, emptied: 0, abortEv: 0, suspendEv: 0, fragErr: 0, mediaErr: 0, parsingErr: 0, bufferFlushed: 0 };
    };
  }, [media.id, isDesktop, videoRef, sendPlayerLog]);

  useEffect(() => {
    if (!isDesktop) return;
    const dp = (window as any).desktopPlayer;
    if (!dp) return;

    const unsubs = [
      dp.onVideoReady?.(() => {
        setHasVideoFrame(true);
      }),
      dp.onTimeUpdate((t: number) => {
        if (t > 0.3) {
          setHasVideoFrame(true);
        }
        if (!isScrubbing) setCurrentTime(t);
      }),
      dp.onPlayState((playing: boolean) => {
        setIsPlaying(playing);
        setIsBuffering(false);
      }),
      dp.onDuration((d: number) => {
        if (d > 0) setDuration(d);
      }),
      dp.onBuffering((buf: boolean) => {
        setIsBuffering(buf);
      }),
      dp.onEnded(() => {
        setIsPlaying(false);
      })
    ];

    return () => {
      unsubs.forEach((u: any) => u?.());
    };
  }, [isDesktop, isScrubbing]);

  const loadStreamSource = useCallback((url: string, isDirect: boolean, shouldPlay: boolean = false, startPos: number = 0) => {
    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      const token = localStorage.getItem('myplex_token');
      const serverOrigin = window.location.port === '3000'
        ? `${window.location.protocol}//${window.location.hostname}:5000`
        : window.location.origin;
      const directUrl = `${serverOrigin}/api/stream/${media.id}/direct${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      dp?.loadFile(directUrl, startPos, media.title);
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (isDirect) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = url;

      if (startPos > 0) {
        const applyInitialSeek = () => {
          try {
            if (video.currentTime < startPos - 1 || video.currentTime === 0) {
              video.currentTime = startPos;
            }
          } catch (e) {}
        };
        video.addEventListener('loadedmetadata', applyInitialSeek, { once: true });
        video.addEventListener('canplay', applyInitialSeek, { once: true });
      }

      if (shouldPlay) {
        video.play().then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }).catch(() => {
          setIsPlaying(false);
          setIsBuffering(false);
        });
      }
    } else {
      // ЛОКАЛЬНЫЙ ЭКСПЕРИМЕНТ (MMS): мобильный Apple с ManagedMediaSource идёт
      // через hls.js (он сам выберет MMS), а не через нативный AVPlayer.
      // Остальные — как раньше (натив где он есть, иначе hls.js).
      const useNativeHls = isAppleDevice && !canUseManagedMse && video.canPlayType('application/vnd.apple.mpegurl');
      if (useNativeHls) {
        // Native Apple Safari / Mac HLS Pipeline
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        video.src = url;
        video.load();
        if (startPos > 0) {
          const applySeek = () => {
            try {
              if (Math.abs(video.currentTime - startPos) > 1) {
                video.currentTime = startPos;
              }
            } catch (e) {}
          };
          video.addEventListener('loadedmetadata', applySeek, { once: true });
        }
        if (shouldPlay) {
          video.play().then(() => {
            setIsPlaying(true);
            setIsBuffering(false);
          }).catch(() => {
            setIsPlaying(false);
            setIsBuffering(false);
          });
        }
      } else if (Hls.isSupported()) {
        // Hls.js Pipeline: PC / Android (MSE) + мобильный Apple (ManagedMediaSource).
        // hls.js сам выбирает ManagedMediaSource где он есть.
        let hls = hlsRef.current;
        if (!hls) {
          // Буферы как в v10 (ужатия под память убраны: давали спиннеры недокачки
          // вместо спиннеров переполнения — шило на мыло; троттлит server-side окно).
          // Воркер transmux ВЫКЛЮЧЕН на мобильных: в нём 44МБ-фрагменты дохнут молча
          // (ни append'ов, ни ошибок — фолбэку не на что сработать), а без него всё
          // либо идёт, либо падает громко. Цена — возможные микрофризы интерфейса.
          hls = new Hls({
            enableWorker: !isMobileApple,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            autoStartLoad: false,
            // Nudge ВКЛЮЧЁН (дефолты hls.js): прайминг AAC (~44мс) и стартовые
            // сдвиги дают дырки ~0.1с — без наudge плеер падает в фатал
            // bufferSeekOverHole и крутится вечно вместо шага через дырку.
            // Нули тут стояли зря и давали бесконечные петли с первого фрагмента.
            maxBufferHole: 0.5,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 3,
            fragLoadingTimeOut: 25000,
            fragLoadingMaxRetry: 5,
            fragLoadingRetryDelay: 500,
          });

          hls.attachMedia(video);

          // Видимые вытеснения буфера (единый счётчик — он и есть вывод ошибок
          // по памяти: растёт — значит фрагменты выкидываются быстрее, чем играются).
          // Дауншифт при шёрне: ≥4 вытеснения, а время почти не двинулось (<2с) —
          // значит девайс не тянет текущий вес (жирный 4K): уходим на 720p-транскод.
          // При здоровом просмотре время идёт вперёд — ложных срабатываний нет.
          // Пауза безопасна: без аппендов нет и вытеснений.
          hls.on(Hls.Events.BUFFER_FLUSHED, (_e: any, data: any) => {
            try {
              playerStatsRef.current.bufferFlushed++;
              if (playerStatsRef.current.bufferFlushed <= 5) {
                sendPlayerLog('buffer-flushed', 'warn', { detail: `type=${data?.type ?? '?'} buffered-ahead-evicted` });
              }
              const now = Date.now();
              let cur = -1;
              try { cur = videoRef.current?.currentTime ?? -1; } catch {}
              evictLogRef.current.push({ at: now, pos: cur });
              while (evictLogRef.current.length > 0 && now - evictLogRef.current[0].at > 60000) {
                evictLogRef.current.shift();
              }
              const log = evictLogRef.current;
              if (log.length >= 4) {
                const dt = log[log.length - 1].at - log[0].at;
                const dp = log[log.length - 1].pos - log[0].pos;
                if (dt > 5000 && dp >= 0 && dp < 2) {
                  if (!attemptFallback('eviction-churn', `flushes=${log.length} posAdvance=${dp.toFixed(2)}s`)) {
                    try { hls?.stopLoad(); } catch {}
                  }
                }
              }
            } catch {}
          });

          // Счётчики мёртвой сессии: 404 по фрагменту = сессии на сервере уже нет
          // (убили при выходе / протухла). Лечится перезапросом мастера — сервер
          // пересоздаст сессию. После 2 перезапросов стопаемся, чтобы не спамить
          // мёртвую сессию (антигостинг-флуд в логах). Успешный фраг сбрасывает streak.
          let frag404Streak = 0;
          let masterReloads = 0;
          hls.on(Hls.Events.FRAG_BUFFERED, (_e: any, data: any) => {
            frag404Streak = 0;
            parseStreakRef.current = { sn: -2, count: 0 };
            // Шёрн аппендов: один sn лёг ≥4 раз, а позиция почти не двинулась —
            // девайс вытесняет быстрее, чем играет (жирный 4K + тесная память).
            // Уходим на 720p-транскод (лёгкие куски влезают). Один раз, только original.
            try {
              const sn = (data as any)?.frag?.sn;
              let cur = -1;
              try { cur = videoRef.current?.currentTime ?? -1; } catch {}
              if (typeof sn === 'number' && cur >= 0) {
                const now = Date.now();
                bufLogRef.current.push({ at: now, sn, pos: cur });
                while (bufLogRef.current.length > 0 && now - bufLogRef.current[0].at > 90000) {
                  bufLogRef.current.shift();
                }
                const same = bufLogRef.current.filter((e) => e.sn === sn && e.pos >= 0);
                if (same.length >= 4) {
                  const dp = same[same.length - 1].pos - same[0].pos;
                  if (dp >= 0 && dp < 3) {
                    if (!attemptFallback('append-churn', `sn=${sn} buffered=${same.length}x posAdvance=${dp.toFixed(2)}s`)) {
                      try { hls?.stopLoad(); } catch {}
                    }
                  }
                }
              }
            } catch {}
          });

          hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
            // Телеметрия в лог PLAYER (троттлинг парсинга — он сыпется пачками)
            try {
              const st = playerStatsRef.current;
              if (data.details === Hls.ErrorDetails.FRAG_PARSING_ERROR) {
                st.parsingErr++;
                if (telemetryParsingSentRef.current < 3) {
                  telemetryParsingSentRef.current++;
                  sendPlayerLog('hls-frag-parsing', 'warn', { detail: String(data?.reason ?? data?.details ?? '') });
                }
                // Шёрн парсинга: один и тот же фрагмент не разбирается раз за разом —
                // упаковка не по зубам (или воркер молча умирал — теперь он выключен
                // на мобильных, так что это честные ошибки). Уходим в фолбэк.
                try {
                  const psn = (data as any)?.frag?.sn;
                  const ps = parseStreakRef.current;
                  if (typeof psn === 'number' && psn === ps.sn) ps.count++;
                  else { ps.sn = typeof psn === 'number' ? psn : -1; ps.count = 1; }
                  bufLogRef.current = [];
                  if (ps.count >= 4) {
                    ps.count = 0;
                    attemptFallback('parse-churn', `sn=${ps.sn}`);
                  }
                } catch {}
              } else if (data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR) {
                st.mediaErr++;
                sendPlayerLog('hls-buffer-append', 'error', { detail: String(data?.error?.message ?? data?.details ?? '') });
              } else if (data.fatal && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                st.mediaErr++;
                if (st.mediaErr <= 3) {
                  sendPlayerLog('hls-media-fatal', 'error', { detail: String(data?.details ?? '') });
                }
              } else if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                st.fragErr++;
              }
            } catch {}
            // Авто-фолбэк: фатал уровня кодека (MMS закрылся, кодек не встал) —
            // сами не починим: сначала 'transcode' (то же разрешение), потом '720p'.
            // Некуда дальше — стопаем шторм.
            if (data.fatal) {
              const isCodecFatal =
                data.details === Hls.ErrorDetails.MEDIA_SOURCE_REQUIRES_RESET ||
                data.details === Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR;
              if (isCodecFatal) {
                if (!attemptFallback('codec-fatal', String(data?.details ?? ''))) {
                  try { hls?.stopLoad(); } catch {}
                }
                return;
              }
              const status = (data?.networkDetails as any)?.status ?? (data?.response as any)?.code;
              const isFrag404 =
                data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                (data.details === Hls.ErrorDetails.FRAG_LOAD_ERROR ||
                  data.details === Hls.ErrorDetails.KEY_LOAD_ERROR) &&
                status === 404;
              if (isFrag404) {
                frag404Streak++;
                if (masterReloads < 2 && hlsUrlRef.current) {
                  masterReloads++;
                  frag404Streak = 0;
                  try {
                    hls?.loadSource(hlsUrlRef.current);
                    hls?.startLoad();
                  } catch {}
                } else if (frag404Streak >= 3) {
                  // Сессия не воскресает — останавливаем загрузчик вместо вечного шторма
                  try { hls?.stopLoad(); } catch {}
                }
                return;
              }
              switch (data.type) {
                case Hls.ErrorTypes.NETWORK_ERROR:
                  hls?.startLoad();
                  break;
                case Hls.ErrorTypes.MEDIA_ERROR:
                  hls?.recoverMediaError();
                  break;
              }
            }
          });

          hlsRef.current = hls;
        }

        hls.once(Hls.Events.MANIFEST_PARSED, () => {
          if (startPos > 0) {
            try { video.currentTime = startPos; } catch (e) {}
          }
          if (shouldPlay) {
            video.play().then(() => {
              setIsPlaying(true);
              setIsBuffering(false);
            }).catch(() => {
              setIsPlaying(false);
              setIsBuffering(false);
            });
          }
        });

        if (startPos > 0) {
          try { video.currentTime = startPos; } catch (e) {}
        }
        hlsUrlRef.current = url;
        hls.loadSource(url);
        hls.startLoad(startPos);
      } else {
        video.src = url;
        video.load();
        if (startPos > 0) {
          try { video.currentTime = startPos; } catch (e) {}
        }
        if (shouldPlay) {
          video.play().catch(() => {});
        }
      }
    }
  }, [videoRef, isAppleDevice, canUseManagedMse]);

  const streamInfoRef = useRef({ mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay });
  useEffect(() => {
    streamInfoRef.current = { mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay };
  }, [media.id, selectedQuality, selectedAudioTrack, isAppleDevice, isDirectPlay]);

  // Уникальный id маунта плеера: сервер привязывает HLS-сессию к нему (суффикс _m...).
  // Прощальный маяк старого маунта (StrictMode-ремонт, вторая вкладка) чужую живую сессию
  // задеть не может. Стабилен весь маунт, уникален между маунтами/вкладками.
  const mountIdRef = useRef<string>(Math.random().toString(36).substring(2, 10));

  // Точечное завершение HLS-сессии сервера для ЯВНО указанной комбинации.
  // Бьёт только exact sessionId (media+quality+audio+device+mount): серверный
  // широкий kill по медиа срабатывает лишь для легаси-клиентов без mount,
  // а у веба mount всегда есть — чужие и комнатные сессии задеть нельзя.
  // Для несуществующей сессии — no-op. Используется и при размонтировании,
  // и при смене quality/audio (см. эффект ниже).
  const sendHlsSessionEnd = useCallback((mediaId: string, quality: string, audioIndex: number, isApple: boolean) => {
    try {
      const token = localStorage.getItem('myplex_token');
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
      const payload = JSON.stringify({ mediaId, quality, audioIndex, isApple, mount: mountIdRef.current });

      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(`/api/stream/hls/session/end${tokenParam}`, new Blob([payload], { type: 'application/json' }));
        }
      } catch (e) {}

      fetch(`/api/stream/hls/session/end${tokenParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: payload,
        keepalive: true
      }).catch(() => {});
    } catch {}
  }, []);

  // Clean up Hls and terminate FFmpeg session on unmount or page exit
  useEffect(() => {
    const endSession = () => {
      const { mediaId, quality, audioIndex, isApple, isDirectPlay } = streamInfoRef.current;
      const currentPos = currentTimeRef.current;
      const dur = effectiveDurationRef.current || media.durationSeconds || 0;
      const token = localStorage.getItem('myplex_token');
      const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';

      // Save watch progress on exit / pagehide / beforeunload
      if (mediaId && currentPos >= 2 && dur > 0) {
        const progressPayload = JSON.stringify({
          mediaItemId: mediaId,
          progressSeconds: Math.floor(currentPos),
          durationSeconds: Math.floor(dur)
        });

        try {
          if (navigator.sendBeacon) {
            navigator.sendBeacon(`/api/media/progress${tokenParam}`, new Blob([progressPayload], { type: 'application/json' }));
          }
        } catch (e) {}

        fetch(`/api/media/progress${tokenParam}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: progressPayload,
          keepalive: true
        }).catch(() => {});
      }

      if (!isDirectPlay && !isWatchTogether) {
        sendHlsSessionEnd(mediaId, quality, audioIndex, isApple);
      }
    };

    window.addEventListener('pagehide', endSession);
    window.addEventListener('beforeunload', endSession);

    return () => {
      window.removeEventListener('pagehide', endSession);
      window.removeEventListener('beforeunload', endSession);

      if (hlsRef.current) {
        try {
          hlsRef.current.stopLoad();
          hlsRef.current.destroy();
        } catch (e) {}
        hlsRef.current = null;
      }

      if (videoRef.current) {
        try {
          videoRef.current.pause();
          videoRef.current.src = '';
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch (e) {}
      }

      endSession();
    };
  }, [isWatchTogether, videoRef]);

  const buildStreamUrl = useCallback((quality: string, audioIndex: number, startPos: number = 0) => {
    const token = localStorage.getItem('myplex_token');
    const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
    const roomParam = isWatchTogether && room?.id ? `roomId=${room.id}` : '';

    if (isDirectPlay) {
      const params = [tokenParam, roomParam].filter(Boolean).join('&');
      return `/api/stream/${media.id}/direct${params ? `?${params}` : ''}`;
    }

    const isAppleParam = isAppleDevice ? '1' : '0';
    const startParam = startPos > 0 ? `startTime=${Math.floor(startPos)}` : '';
    const mountParam = `mount=${mountIdRef.current}`;
    const params = [`quality=${quality}`, `audioIndex=${audioIndex}`, `isApple=${isAppleParam}`, startParam, tokenParam, roomParam, mountParam].filter(Boolean).join('&');
    return `/api/stream/${media.id}/master.m3u8?${params}`;
  }, [media.id, isDirectPlay, isAppleDevice, isWatchTogether, room?.id]);

  const doSeek = useCallback((targetTime: number, forcePlayState?: boolean) => {
    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    setCurrentTime(safePos);
    setScrubTime(safePos);
    // Коммит seek всегда завершает скраббинг (иначе timeupdate игносрится и строка/время стоят)
    setIsScrubbing(false);

    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      dp?.seek(safePos);
      const shouldPlay = forcePlayState !== undefined ? forcePlayState : isPlaying;
      if (shouldPlay) dp?.play();
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    const shouldPlay = forcePlayState !== undefined ? forcePlayState : !video.paused;

    if (hlsRef.current) {
      hlsRef.current.startLoad(safePos);
    }
    try { video.currentTime = safePos; } catch (e) {}
    if (shouldPlay) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [effectiveDuration, isDesktop, isPlaying, videoRef]);

  useEffect(() => {
    onAttachSeekHandler?.(doSeek);
  }, [doSeek, onAttachSeekHandler]);

  const doPlay = useCallback(() => {
    if (isDesktop) {
      (window as any).desktopPlayer?.play();
      setIsPlaying(true);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.play().then(() => {
      setIsPlaying(true);
      setIsBuffering(false);
    }).catch(() => {});
  }, [isDesktop, videoRef]);

  const doPause = useCallback(() => {
    if (isDesktop) {
      (window as any).desktopPlayer?.pause();
      setIsPlaying(false);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setIsPlaying(false);
  }, [isDesktop, videoRef]);

  useEffect(() => {
    onAttachPlayHandler?.(doPlay);
  }, [doPlay, onAttachPlayHandler]);

  useEffect(() => {
    onAttachPauseHandler?.(doPause);
  }, [doPause, onAttachPauseHandler]);

  useEffect(() => {
    onAttachGetCurrentTime?.(() => {
      if (isDesktop) return currentTime;
      return videoRef.current?.currentTime || 0;
    });
  }, [onAttachGetCurrentTime, isDesktop, currentTime, videoRef]);

  useEffect(() => {
    onAttachGetIsPaused?.(() => {
      if (isDesktop) return !isPlaying;
      const video = videoRef.current;
      if (video) return video.paused;
      return !isPlaying;
    });
  }, [onAttachGetIsPaused, isDesktop, isPlaying, videoRef]);

  const isInitialMount = useRef(true);
  const hasLoadedDesktopRef = useRef<string | null>(null);

  // Initial load
  useEffect(() => {
    if (!isDesktop && !videoRef.current) return;
    if (isDesktop && hasLoadedDesktopRef.current === media.id) return;

    const dur = media.durationSeconds || 0;
    let startPos = Math.max(0, initialPosition || 0);
    if (dur > 0 && startPos >= dur - 2) {
      startPos = 0;
    }
    const shouldStartPlay = isWatchTogether ? (roomState === 'PLAYING') : true;

    setCurrentTime(startPos);
    setBufferedTime(startPos);
    isInitialMount.current = false;
    hasLoadedDesktopRef.current = media.id;

    const url = buildStreamUrl(selectedQuality, selectedAudioTrack, startPos);
    loadStreamSource(url, isDirectPlay, shouldStartPlay, startPos);
  }, [media.id, isDesktop]);

  // NOTE (watch-together): play/pause/seek управляются ТОЛЬКО через useSyncPlayer
  // (room:sync_state -> doSeek/doPlay/doPause выше). Отдельный useEffect[roomState] здесь
  // удалён — он дублировал те же video.play()/pause() и давал гонку/двойные вызовы.

  // Quality or audio track switch
  const prevQualityRef = useRef(selectedQuality);
  const prevAudioTrackRef = useRef(selectedAudioTrack);

  useEffect(() => {
    if (isInitialMount.current) return;
    if (prevQualityRef.current === selectedQuality && prevAudioTrackRef.current === selectedAudioTrack) {
      return;
    }

    // Ручная смена КАЧЕСТВА гасит авто-фолбэк (юзер сам рулит).
    // Авто-переключение помечено флагом и счётчик ступеней не трогает.
    // Смена только аудиодорожки автомат не касается.
    const qualityChanged = prevQualityRef.current !== selectedQuality;
    const audioChanged = prevAudioTrackRef.current !== selectedAudioTrack;
    // Снапшот СТАРОЙ комбинации ДО перезаписи: только она могла оставить
    // HLS-сессию (новая direct сессий не создаёт, новая HLS приберёт старую
    // и серверным stale-киллом — двойной kill идемпотентен).
    const oldQuality = prevQualityRef.current;
    const oldAudioTrack = prevAudioTrackRef.current;
    prevQualityRef.current = selectedQuality;
    prevAudioTrackRef.current = selectedAudioTrack;

    if (qualityChanged) {
      if (autoSwitchingRef.current) {
        autoSwitchingRef.current = false;
      } else {
        fallbackStageRef.current = 2;
      }
    }

    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      if (selectedAudioTrack >= 0) {
        dp?.setAudioTrack(selectedAudioTrack);
      }
      return;
    }

    // Гасим брошенную HLS-сессию СТАРОЙ комбинации — иначе она висит до
    // idle-свипера: возврат на Direct не стартует новую сессию, и серверному
    // stale-киллу не за что зацепиться (это и была дыра HLS→Direct).
    // Безопасно: exact sessionId (с mount), для несуществующей — no-op;
    // HLS→HLS продублирует серверный stale-kill (идемпотентно);
    // Direct→HLS бьёт в пустоту. Desktop/TV сюда не доходят (return выше),
    // комнаты — их сессии ведёт socket.service, mount-суффикса комнаты
    // в payload нет, чужое не задеваем.
    if (qualityChanged || audioChanged) {
      try {
        sendHlsSessionEnd(media.id, oldQuality, oldAudioTrack, isAppleDevice);
      } catch {}
    }

    const video = videoRef.current;
    if (!video) return;

    const currentPos = video.currentTime || 0;
    const wasPlaying = !video.paused;
    const url = buildStreamUrl(selectedQuality, selectedAudioTrack, currentPos);
    loadStreamSource(url, isDirectPlay, wasPlaying, currentPos);
  }, [selectedQuality, selectedAudioTrack, isDirectPlay, isDesktop, buildStreamUrl, loadStreamSource, videoRef, isAppleDevice, media.id, sendHlsSessionEnd]);

  // Video Time Update
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const actualIsPlaying = !video.paused && !video.ended;
    if (actualIsPlaying !== isPlaying) {
      setIsPlaying(actualIsPlaying);
    }

    const totalPos = video.currentTime || 0;
    currentTimeRef.current = totalPos;
    if (!isScrubbing && !video.seeking) {
      setCurrentTime(totalPos);
    }

    if ((!media.durationSeconds || media.durationSeconds <= 0) && video.duration && !isNaN(video.duration)) {
      setDuration(video.duration);
    }

    if (video.buffered.length > 0) {
      const bufEnd = video.buffered.end(video.buffered.length - 1);
      setBufferedTime(bufEnd);
    }
  };

  const lastReportedPosRef = useRef<number>(-1);

  // Watch Progress Reporting (stable callback - reads refs, doesn't re-create every frame)
  const reportProgress = useCallback((overridePos?: number) => {
    if (!media?.id) return;
    const video = videoRef.current;
    const pos = overridePos !== undefined
      ? overridePos
      : (isDesktop ? ((window as any).desktopPlayer?.getCurrentTime?.() || currentTimeRef.current) : (video?.currentTime ?? currentTimeRef.current));
    const dur = effectiveDurationRef.current || media.durationSeconds || video?.duration || 0;

    if (pos >= 2 && dur > 0) {
      if (overridePos === undefined && Math.abs(pos - lastReportedPosRef.current) < 1) {
        return;
      }
      lastReportedPosRef.current = pos;
      apiClient.post('/media/progress', {
        mediaItemId: media.id,
        progressSeconds: Math.floor(pos),
        durationSeconds: Math.floor(dur)
      }).catch(() => {});
    }
  }, [media?.id, media?.durationSeconds, isDesktop, videoRef]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      reportProgress();
    }, 5000);
    return () => clearInterval(timer);
  }, [isPlaying, reportProgress]);

  const handleWaiting = () => {
    setIsBuffering(true);
  };

  const handleCanPlay = () => {
    setIsBuffering(false);
  };

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setShowSettingsMenu(false);
      }
    }, 3000);
  };

  const popCenter = useCallback((kind: 'play' | 'pause') => {
    flashKeyRef.current += 1;
    const key = flashKeyRef.current;
    setCenterFlash({ kind, key });
    window.setTimeout(() => {
      setCenterFlash((cur) => (cur && cur.key === key ? null : cur));
    }, 600);
  }, []);

  const togglePlay = () => {
    if (isWatchTogether) {
      if (isPlaying) {
        popCenter('pause');
        onPauseRequest?.();
      } else {
        popCenter('play');
        onPlayRequest?.();
      }
      return;
    }

    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      dp?.togglePlay();
      popCenter(isPlaying ? 'pause' : 'play');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    if (!video.paused) {
      popCenter('pause');
      video.pause();
      setIsPlaying(false);
      reportProgress();
    } else {
      popCenter('play');
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const lastSeekTimeRef = useRef<number>(0);
  // Защита от запоздалых тач-событий слайдера (только joint): после pointerup-коммита
  // приехавшие позже input/change игнорятся до следующего pointerdown
  const seekCommitGuardRef = useRef<boolean>(false);

  // Коммит перемотки по координате касания (только joint): на таче в момент pointerup
  // e.target.value ещё старый (input приедет позже), поэтому тап коммитил прошлое место
  // и видео уходило «немного назад» или стояло. Координата из события — всегда актуальна.
  const commitSeekFromPointer = (e: React.PointerEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / width));
    const dur = effectiveDuration > 0 ? effectiveDuration : (parseFloat(e.currentTarget.max) || 0);
    triggerSeek(ratio * dur);
  };

  const triggerSeek = (targetTime: number) => {
    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    currentTimeRef.current = safePos;
    setCurrentTime(safePos);
    setScrubTime(safePos);
    // Тултип тут НЕ гасим: во время ведения по строке seek'и идут на каждом шаге,
    // а превью должно жить пока палец/мышь на строке. Гасится в onPointerUp/Cancel (тач)
    // и onMouseLeave (мышь).
    // Сброс скраба — ВСЕГДА, даже если отправка на сервер затроиллится (иначе timeupdate
    // игнорируется флагом isScrubbing и строка/время стоят при играющем видео)
    setIsScrubbing(false);

    if (isWatchTogether) {
      const now = Date.now();
      if (now - lastSeekTimeRef.current < 250) return;
      lastSeekTimeRef.current = now;
    }

    if (isWatchTogether) {
      // Явно пробрасываем shouldPlay, чтобы инициатор и гости получили одинаковый state.
      // Иначе sendSeek гадает по paused-статусу и SEEK расходится с PLAY (см. логи: SEEK ... -> PLAY ... с зазором).
      const video = videoRef.current;
      const shouldPlay = isDesktop ? isPlaying : video ? !video.paused : isPlaying;
      onSeekRequest?.(safePos, shouldPlay);
    } else {
      doSeek(safePos);
      reportProgress(safePos);
    }
  };

  const skip = (seconds: number) => {
    const newPos = Math.max(0, Math.min(effectiveDuration, currentTime + seconds));
    triggerSeek(newPos);
  };

  // Дабл-тап как в YouTube: одиночный тап по бокам тогглит play с задержкой 300мс,
  // второй тап в то же место отменяет тоггл и мотает ∓10с; дальнейшие быстрые тапы
  // суммируются (∓20, ∓30…) с ютуб-анимацией. Работает и тачем, и мышью.
  const tapStateRef = useRef<{
    lastTap: number; lastSide: 'left' | 'right' | null; pendingSingle: number | null;
    streakSide: 'left' | 'right' | null; streakCount: number; streakAt: number;
  }>({ lastTap: 0, lastSide: null, pendingSingle: null, streakSide: null, streakCount: 0, streakAt: 0 });

  const handleZoneTap = useCallback((side: 'left' | 'right') => {
    const st = tapStateRef.current;
    const now = Date.now();
    const dir = side === 'left' ? -1 : 1;

    const doSeekFlash = (total: number) => {
      const base = videoRef.current?.currentTime ?? currentTime;
      triggerSeek(base + dir * 10);
      flashKeyRef.current += 1;
      const key = flashKeyRef.current;
      setSeekFlash({ side, seconds: total, key });
      window.setTimeout(() => {
        setSeekFlash((cur) => (cur && cur.key === key ? null : cur));
      }, 780);
    };

    // Продолжение серии: тапы подряд после дабл-тапа добавляют по 10с
    if (st.streakSide === side && now - st.streakAt < 1000) {
      st.streakCount += 1;
      st.streakAt = now;
      doSeekFlash(st.streakCount * 10);
      return;
    }
    // Второй быстрый тап — это дабл-тап: гасим отложенный тоггл, мотаем
    if (st.lastSide === side && now - st.lastTap < 320) {
      if (st.pendingSingle) {
        window.clearTimeout(st.pendingSingle);
        st.pendingSingle = null;
      }
      st.lastTap = 0;
      st.lastSide = null;
      st.streakSide = side;
      st.streakCount = 1;
      st.streakAt = now;
      doSeekFlash(10);
      return;
    }
    // Первый тап — ждём 300мс: вдруг это начало дабл-тапа
    st.lastTap = now;
    st.lastSide = side;
    st.streakSide = null;
    st.streakCount = 0;
    if (st.pendingSingle) window.clearTimeout(st.pendingSingle);
    st.pendingSingle = window.setTimeout(() => {
      st.pendingSingle = null;
      togglePlay();
    }, 300);
  }, [triggerSeek, togglePlay, currentTime, videoRef]);

  const changeVolume = (val: number) => {
    setVolume(val);
    setIsMuted(val === 0);
    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      dp?.setVolume(val * 100);
      return;
    }
    const video = videoRef.current;
    if (video) video.volume = val;
  };

  const toggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      dp?.setMute(nextMute);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (!nextMute) {
      video.volume = volume || 0.5;
    } else {
      video.volume = 0;
    }
  };

  const flashSeekHint = useCallback((text: string) => {
    setSeekHint(text);
    window.setTimeout(() => setSeekHint((cur) => (cur === text ? null : cur)), 900);
  }, []);

  const applyPlaybackRate = useCallback((r: number) => {
    setPlaybackRate(r);
    if (isDesktop) {
      try { (window as any).desktopPlayer?.setRate?.(r); } catch {}
      return;
    }
    const video = videoRef.current;
    if (video) {
      try { video.playbackRate = r; } catch {}
    }
  }, [isDesktop, videoRef]);

  const togglePictureInPicture = useCallback(async () => {
    if (isDesktop) return;
    const video = videoRef.current as any;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await (document as any).exitPictureInPicture();
      } else if (video.requestPictureInPicture) {
        await video.requestPictureInPicture();
      }
    } catch {}
  }, [isDesktop, videoRef]);

  const toggleFullscreen = () => {
    if (isDesktop) {
      const dp = (window as any).desktopPlayer;
      dp?.toggleFullscreen?.();
      setIsFullscreen(!isFullscreen);
      return;
    }
    const video = videoRef.current as any;
    const container = containerRef.current as any;
    // iPhone Safari не умеет Fullscreen API для произвольных блоков:
    // container.requestFullscreen там undefined, вызов кидал TypeError
    // и кнопка молча «не работала». Зато у <video> есть webkitEnterFullscreen.
    // iPad/десктоп идут обычной веткой — поэтому там всё работало.
    if (!document.fullscreenElement) {
      if (container?.requestFullscreen) {
        try {
          const p = container.requestFullscreen();
          if (p && typeof p.then === 'function') {
            p.then(() => setIsFullscreen(true)).catch(() => {
              try { video?.webkitEnterFullscreen?.(); } catch {}
            });
          } else {
            setIsFullscreen(true);
          }
        } catch {
          try { video?.webkitEnterFullscreen?.(); } catch {}
        }
      } else {
        try { video?.webkitEnterFullscreen?.(); } catch {}
      }
    } else if (document.exitFullscreen) {
      try {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      } catch {}
    }
  };

  // Синхрон иконки фулскрина: обычный fullscreenchange + iOS webkit-события <video>
  useEffect(() => {
    const onFsChange = () => {
      try { setIsFullscreen(!!document.fullscreenElement); } catch {}
    };
    const onBegin = () => setIsFullscreen(true);
    const onEnd = () => setIsFullscreen(false);
    document.addEventListener('fullscreenchange', onFsChange);
    const video = videoRef.current as any;
    try {
      video?.addEventListener?.('webkitbeginfullscreen', onBegin);
      video?.addEventListener?.('webkitendfullscreen', onEnd);
    } catch {}
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      try {
        video?.removeEventListener?.('webkitbeginfullscreen', onBegin);
        video?.removeEventListener?.('webkitendfullscreen', onEnd);
      } catch {}
    };
  }, [videoRef]);

  // Хоткеи: Space/K — play/pause, ←/→/J/L — ±10с (Shift — ±30с), ↑/↓ — громкость,
  // F — fullscreen, M — mute, P — PiP, 0-9 — % длительности, +/- — скорость.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as any)?.isContentEditable) {
        if ((t as HTMLInputElement)?.type !== 'range') return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === '?' || k === '/') {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (showShortcuts && (k === 'Escape' || k === 'Enter')) {
        setShowShortcuts(false);
        return;
      }
      const lower = k.toLowerCase();
      if (k === ' ' || lower === 'k' || lower === 'л') {
        e.preventDefault();
        togglePlay();
      } else if (k === 'ArrowLeft' || lower === 'j' || lower === 'о') {
        e.preventDefault();
        const d = e.shiftKey ? -30 : -10;
        const base = videoRef.current?.currentTime ?? currentTime;
        triggerSeek(base + d);
        flashSeekHint(`${d}с`);
      } else if (k === 'ArrowRight' || lower === 'l' || lower === 'д') {
        e.preventDefault();
        const d = e.shiftKey ? 30 : 10;
        const base = videoRef.current?.currentTime ?? currentTime;
        triggerSeek(base + d);
        flashSeekHint(`+${d}с`);
      } else if (lower === 'f' || lower === 'а') {
        e.preventDefault();
        toggleFullscreen();
      } else if (lower === 'm' || lower === 'ь') {
        e.preventDefault();
        toggleMute();
      } else if (lower === 'p' || lower === 'з') {
        e.preventDefault();
        togglePictureInPicture();
      } else if (k === 'ArrowUp') {
        e.preventDefault();
        changeVolume(Math.min(1, Math.round((volume + 0.05) * 100) / 100));
      } else if (k === 'ArrowDown') {
        e.preventDefault();
        changeVolume(Math.max(0, Math.round((volume - 0.05) * 100) / 100));
      } else if (k >= '0' && k <= '9') {
        e.preventDefault();
        const ratio = parseInt(k, 10) / 10;
        triggerSeek(ratio * effectiveDuration);
      } else if (k === '+' || k === '=') {
        e.preventDefault();
        const idx = [0.5, 0.75, 1, 1.25, 1.5, 2].findIndex((r) => r === playbackRate);
        const next = [0.5, 0.75, 1, 1.25, 1.5, 2][Math.min(5, (idx < 0 ? 2 : idx) + 1)];
        applyPlaybackRate(next);
      } else if (k === '-' || k === '_') {
        e.preventDefault();
        const idx = [0.5, 0.75, 1, 1.25, 1.5, 2].findIndex((r) => r === playbackRate);
        const next = [0.5, 0.75, 1, 1.25, 1.5, 2][Math.max(0, (idx < 0 ? 2 : idx) - 1)];
        applyPlaybackRate(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [togglePlay, triggerSeek, toggleFullscreen, toggleMute, togglePictureInPicture, changeVolume, volume, currentTime, effectiveDuration, playbackRate, applyPlaybackRate, videoRef, showShortcuts]);

  // Тех-статистика для модалки: дропы + HLS-уровень/битрейт + буфер впереди (поллинг пока открыта)
  useEffect(() => {
    if (!showStatsModal) return;
    const id = window.setInterval(() => {
      try {
        const video = videoRef.current;
        let dropped = 0;
        let total = 0;
        try {
          const q: any = (video as any)?.getVideoPlaybackQuality?.();
          if (q) {
            dropped = q.droppedVideoFrames || 0;
            total = q.totalVideoFrames || 0;
          }
        } catch {}
        let br = 0;
        try {
          const hls: any = hlsRef.current;
          if (hls) {
            const lvl = typeof hls.currentLevel === 'number' ? hls.currentLevel : -1;
            const lv = lvl >= 0 ? hls.levels?.[lvl] : null;
            br = lv?.bitrate || 0;
          }
        } catch {}
        let ahead = 0;
        try {
          const cur = video?.currentTime || 0;
          const b = video?.buffered;
          if (b && b.length > 0) ahead = Math.max(0, b.end(b.length - 1) - cur);
        } catch {}
        setTechStats((s) => ({ ...s, droppedFrames: dropped, totalFrames: total, hlsBitrate: br, bufferedAhead: ahead, fallbackStage: fallbackStageRef.current }));
      } catch {}
    }, 500);
    return () => window.clearInterval(id);
  }, [showStatsModal, videoRef]);

  const setupAudioGain = useCallback(() => {
    const video = videoRef.current;
    if (!video || audioContextRef.current) return;

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaElementSource(video);
      const gainNode = ctx.createGain();

      gainNode.gain.value = audioBoost;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      audioContextRef.current = ctx;
      gainNodeRef.current = gainNode;
    } catch (e) {}
  }, [audioBoost, videoRef]);

  const setAudioGainBoost = (multiplier: number) => {
    setAudioBoost(multiplier);
    if (!audioContextRef.current && multiplier > 1.0) {
      setupAudioGain();
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = multiplier;
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={`relative w-full h-full ${isDesktop ? 'bg-transparent' : 'bg-black'} flex items-center justify-center select-none overflow-hidden group font-sans touch-none ${!showControls && isPlaying ? 'cursor-none' : ''}`}
    >
      {!isDesktop ? (
        <video
          ref={videoRef}
          onTimeUpdate={handleTimeUpdate}
          onWaiting={handleWaiting}
          onCanPlay={handleCanPlay}
          onCanPlayThrough={() => setIsBuffering(false)}
          onSeeked={() => {
            setIsBuffering(false);
            if (videoRef.current) setIsPlaying(!videoRef.current.paused);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => {
            setIsPlaying(false);
            reportProgress();
          }}
          onEnded={() => {
            setIsPlaying(false);
            const dur = effectiveDurationRef.current || media.durationSeconds || 0;
            if (dur > 0) {
              reportProgress(dur);
            }
          }}
          onClick={togglePlay}
          className="w-full h-full object-contain cursor-pointer focus:outline-none"
          playsInline
          preload="auto"
        >
          {selectedSubtitleTrack >= 0 && (
            <track
              kind="subtitles"
              src={`/api/stream/${media.id}/subtitle/${selectedSubtitleTrack}?format=vtt${localStorage.getItem('myplex_token') ? `&token=${encodeURIComponent(localStorage.getItem('myplex_token')!)}` : ''}`}
              srcLang="ru"
              label="Субтитры"
              default
            />
          )}
        </video>
      ) : (
        <div
          onClick={togglePlay}
          className="w-full h-full cursor-pointer focus:outline-none bg-transparent"
        />
      )}

      {/* Dark Cinema Solid Background until Video Frame is Decoded */}
      {isDesktop && !hasVideoFrame && (
        <div className="absolute inset-0 z-20 bg-[#07090e] flex flex-col items-center justify-center pointer-events-none select-none">
          <div className="w-14 h-14 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin mb-4 shadow-glow-gold" />
          <span className="text-sm font-semibold text-slate-200 tracking-wider">
            Запуск аппаратного воспроизведения...
          </span>
          <span className="text-xs text-cinema-gold/80 mt-1 font-medium">
            {media.title}
          </span>
        </div>
      )}

      {/* Floating Reaction Overlay */}
      {reactions.length > 0 && <ReactionOverlay reactions={reactions} />}

      {/* Double-tap seek zones (YouTube-style): тап — play/pause, дабл-тап — ∓10с,
          серия быстрых тапов суммируется. */}
      {!isDesktop && (
        <>
          <div
            onClick={() => handleZoneTap('left')}
            className="absolute left-0 top-[15%] bottom-[20%] w-[28%] z-10"
          />
          <div
            onClick={() => handleZoneTap('right')}
            className="absolute right-0 top-[15%] bottom-[20%] w-[28%] z-10"
          />
        </>
      )}

      <SeekFlash flash={seekFlash} />
      <CenterFlash flash={centerFlash} />
      <ShortcutsModal open={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Seek hint + auto-quality toasts */}
      {(seekHint || autoNotice) && (
        <div className="absolute inset-x-0 top-20 flex flex-col items-center gap-2 pointer-events-none z-40">
          {seekHint && (
            <div className="px-3 py-1.5 rounded-full bg-black/70 border border-white/15 text-white text-sm font-bold animate-fade-in">
              {seekHint}
            </div>
          )}
          {autoNotice && (
            <div className="px-3 py-1.5 rounded-full bg-amber-400/90 text-black text-xs font-bold animate-fade-in">
              {autoNotice}
            </div>
          )}
        </div>
      )}

      {/* Buffering Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="w-14 h-14 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin shadow-glow-gold"></div>
        </div>
      )}

      <PlayerTopBar
        visible={showControls}
        title={media.title}
        seasonNumber={media.seasonNumber}
        episodeNumber={media.episodeNumber}
        mediaType={media.type}
        badges={streamBadges}
        isWatchTogether={isWatchTogether}
        membersCount={members.length}
        isDesktop={isDesktop}
        isSidebarOpen={isSidebarOpen}
        onBack={onBack ? () => {
          reportProgress();
          if (isDesktop) {
            (window as any).desktopPlayer?.closePlayer();
          }
          onBack();
        } : undefined}
        onInvite={onInvite}
        onToggleSidebar={onToggleSidebar}
        onToggleStats={() => setShowStatsModal(!showStatsModal)}
      />

      <PlayerStatsModal
        open={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        modeText={streamBadges.modeText}
        videoLine={`${streamBadges.videoLabel || 'Оригинал'} • ${streamBadges.isVideoDirectCopy ? 'Direct Copy' : `Транскод ${selectedQuality === 'original' ? `${(media.videoCodec || '').toUpperCase()} → H.264` : selectedQuality}`}${techStats.hlsBitrate > 0 ? ` • ${(techStats.hlsBitrate / 1000).toFixed(0)} кбит/с` : ''}`}
        audioLine={`${streamBadges.audioLabel}${streamBadges.isAudioTrans ? ' (транскод)' : ''}`}
        playbackRate={playbackRate}
        tech={techStats}
      />

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-3 pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-20 flex flex-col gap-1.5 sm:gap-2 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div
          className="relative w-full flex items-center group/timeline py-2 -my-1"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = clamp01((e.clientX - rect.left) / Math.max(1, rect.width));
            setHoverPreview({ ratio, time: ratio * effectiveDuration });
            handleMouseMove();
          }}
          onPointerMove={(e) => {
            // Тач-драг по строке: mousemove на таче не едет вообще, поэтому во время
            // ведения пальцем сверху ничего не надписывалось. pointermove едет и на таче.
            // Мышь пропускаем — её уже покрывает onMouseMove выше (без двойных ререндеров).
            if (e.pointerType === 'mouse') return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = clamp01((e.clientX - rect.left) / Math.max(1, rect.width));
            setHoverPreview({ ratio, time: ratio * effectiveDuration });
          }}
          onMouseLeave={() => setHoverPreview(null)}
        >
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/timeline:h-1.5 bg-white/20 rounded-full pointer-events-none transition-all"
            style={{ width: `${effectiveDuration > 0 ? (bufferedTime / effectiveDuration) * 100 : 0}%` }}
          />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1 group-hover/timeline:h-1.5 bg-cinema-gold rounded-full pointer-events-none transition-all"
            style={{ width: `${effectiveDuration > 0 ? (displayTime / effectiveDuration) * 100 : 0}%` }}
          />
          {hoverPreview && effectiveDuration > 0 && (
            <div
              className="absolute -top-7 px-2 py-0.5 rounded-md bg-black/85 border border-white/15 text-[11px] font-mono text-white pointer-events-none whitespace-nowrap z-20"
              style={{ left: `${Math.min(94, Math.max(6, hoverPreview.ratio * 100))}%`, transform: 'translateX(-50%)' }}
            >
              {formatTime(hoverPreview.time)}
            </div>
          )}
          <input
            type="range"
            min={0}
            max={effectiveDuration || 100}
            step={0.1}
            value={displayTime}
            aria-label="Позиция воспроизведения"
            onPointerDown={() => {
              // Новый жест — снимаем защиту от запоздалых тач-событий прошлого коммита.
              // (ref пишем всегда, поведение одиночки не меняется)
              if (isWatchTogether) seekCommitGuardRef.current = false;
              setIsScrubbing(true);
            }}
            onInput={(e) => {
              // На таче input/change могут приехать ПОСЛЕ pointerup коммита — такие запоздалые
              // события игнорим, иначе они заново взводят isScrubbing и строка/время зависают.
              // Только joint — одиночный слайдер не трогаем.
              if (isWatchTogether && seekCommitGuardRef.current) return;
              setIsScrubbing(true);
              const v = parseFloat((e.target as HTMLInputElement).value);
              setScrubTime(v);
              // Тултип над строкой клеим к бегунку: на таче mousemove не едет за пальцем,
              // без этого сверху замирало старое время, а снизу шло живое — расхождение.
              if (effectiveDuration > 0) {
                setHoverPreview({ ratio: Math.min(1, Math.max(0, v / effectiveDuration)), time: v });
              }
            }}
            onChange={(e) => {
              if (isWatchTogether) {
                if (seekCommitGuardRef.current) return;
                setScrubTime(parseFloat(e.target.value));
              } else {
                triggerSeek(parseFloat(e.target.value));
              }
            }}
            onPointerUp={(e) => {
              if (isWatchTogether) {
                seekCommitGuardRef.current = true;
                commitSeekFromPointer(e);
              }
              // Жест пальцем закончился — гасим превью (mouseleave на таче не бывает)
              if (e.pointerType !== 'mouse') setHoverPreview(null);
            }}
            onPointerCancel={(e) => {
              // Прерванный жест (тач, второй палец, увод указателя): без этого isScrubbing
              // залипает в true, timeupdate игнорируется и строка/время стоят при играющем видео.
              // Только joint — одиночный слайдер не трогаем.
              if (isWatchTogether) {
                seekCommitGuardRef.current = true;
                commitSeekFromPointer(e);
              }
              if (e.pointerType !== 'mouse') setHoverPreview(null);
            }}
            onKeyUp={(e) => {
              if (isWatchTogether && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
                seekCommitGuardRef.current = true;
                triggerSeek(parseFloat((e.target as HTMLInputElement).value));
              }
            }}
            className="w-full h-6 bg-transparent appearance-none cursor-pointer relative z-10 focus-visible:ring-2 focus-visible:ring-cinema-gold rounded [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cinema-gold [&::-webkit-slider-thumb]:shadow-glow-gold [&::-webkit-slider-thumb]:cursor-grab group-hover/timeline:[&::-webkit-slider-thumb]:scale-110 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-cinema-gold [&::-moz-range-thumb]:border-0"
          />
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          <div className="flex items-center gap-1 sm:gap-3 min-w-0 flex-1">
            <button
              onClick={togglePlay}
              aria-label={isPlaying ? 'Пауза (Space/K)' : 'Играть (Space/K)'}
              className="p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-white/10 hover:bg-cinema-gold hover:text-black hover:scale-105 active:scale-95 text-white transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold shadow-lg"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button onClick={() => { skip(-10); flashSeekHint('-10с'); }} aria-label="Назад 10 секунд (←)" className={`${isWatchTogether ? 'hidden sm:flex' : 'flex'} p-1.5 sm:p-2 min-w-[36px] sm:min-w-[40px] min-h-[40px] items-center justify-center text-slate-300 hover:text-white hover:scale-110 active:scale-95 transition-transform cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold rounded-lg`} title="Назад 10с (←)">
              <span className="relative inline-flex">
                <RotateCcw className="w-5 h-5" />
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold pt-[2px]">10</span>
              </span>
            </button>
            <button onClick={() => { skip(10); flashSeekHint('+10с'); }} aria-label="Вперед 10 секунд (→)" className={`${isWatchTogether ? 'hidden sm:flex' : 'flex'} p-1.5 sm:p-2 min-w-[36px] sm:min-w-[40px] min-h-[40px] items-center justify-center text-slate-300 hover:text-white hover:scale-110 active:scale-95 transition-transform cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold rounded-lg`} title="Вперед 10с (→)">
              <span className="relative inline-flex">
                <RotateCw className="w-5 h-5" />
                <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold pt-[2px]">10</span>
              </span>
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button onClick={toggleMute} aria-label={isMuted ? 'Включить звук (M)' : 'Выключить звук (M)'} className="p-1 min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-300 hover:text-white cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold rounded-lg">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                aria-label="Громкость"
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                className="hidden sm:block w-16 h-1 bg-white/20 accent-cinema-gold rounded-full cursor-pointer"
              />
              <button
                onClick={() => setAudioGainBoost(audioBoost === 1.0 ? 1.5 : audioBoost === 1.5 ? 2.0 : 1.0)}
                aria-label="Усилитель звука до 200%"
                className={`hidden sm:block text-[10px] font-bold px-1.5 py-0.5 min-h-[28px] rounded border transition-colors focus-visible:ring-2 focus-visible:ring-cinema-gold ${
                  audioBoost > 1.0 ? 'bg-cinema-gold/20 text-cinema-gold border-cinema-gold' : 'bg-white/5 text-slate-400 border-white/10'
                }`}
                title="Усилитель звука до 200%"
              >
                {audioBoost > 1.0 ? `+${Math.round((audioBoost - 1.0) * 100)}%` : 'Boost'}
              </button>
            </div>

            {/* Time Stamp & Sync button */}
            <div className="text-[11px] sm:text-xs text-slate-300 font-mono tabular-nums tracking-wider flex items-center gap-1 sm:gap-1.5 whitespace-nowrap min-w-0">
              <span>{formatTime(displayTime)}</span>
              <span className="text-slate-500">/</span>
              <span className="hidden sm:inline">{formatTime(effectiveDuration)}</span>

              {isWatchTogether && (
                <button
                  onClick={() => {
                    if (isHost) onForceSyncAll?.();
                    else onSyncToHost?.();
                    setJustSynced(true);
                    setTimeout(() => setJustSynced(false), 2000);
                  }}
                  className="px-2 py-1 min-h-[32px] rounded-md border text-[10px] font-bold bg-white/10 hover:bg-white/20 text-cinema-gold border-cinema-gold/30 cursor-pointer ml-1 sm:ml-2 whitespace-nowrap"
                  title={isHost ? 'Выровнять всех' : 'Выровнять с хостом'}
                >
                  {justSynced ? '✓' : isHost ? '👑' : '📡'}
                  <span className="hidden min-[420px]:inline">
                    {justSynced ? ' Выровнено' : isHost ? ' Выровнять всех' : ' Выровнять'}
                  </span>
                </button>
              )}

            </div>
          </div>

          {/* Right: Shortcuts, Settings & Fullscreen (скорость/PiP/буст — только в шестерёнке, без дублей) */}
          <div className="flex items-center gap-1 sm:gap-2 relative shrink-0">
            <ShortcutsButton onOpen={() => setShowShortcuts(true)} />

            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                aria-label="Настройки качества и звука"
                aria-expanded={showSettingsMenu}
                className={`p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold ${showSettingsMenu ? 'bg-cinema-gold text-black' : 'text-slate-300 hover:text-white hover:bg-white/10'}`}
                title="Настройки качества и звука"
              >
                <Settings className="w-5 h-5" />
              </button>

              <PlayerSettingsMenu
                open={showSettingsMenu}
                selectedQuality={selectedQuality}
                onSelectQuality={(q) => setSelectedQuality(q)}
                audioTracks={audioTracks}
                selectedAudioTrack={selectedAudioTrack}
                onSelectAudioTrack={(i) => setSelectedAudioTrack(i)}
                subtitleTracks={subtitleTracks}
                selectedSubtitleTrack={selectedSubtitleTrack}
                onSelectSubtitleTrack={(i) => setSelectedSubtitleTrack(i)}
                playbackRate={playbackRate}
                onSelectRate={(r) => applyPlaybackRate(r)}
                audioBoost={audioBoost}
                onCycleBoost={() => setAudioGainBoost(audioBoost === 1.0 ? 1.5 : audioBoost === 1.5 ? 2.0 : 1.0)}
                pipSupported={pipSupported}
                isPip={isPip}
                onTogglePip={() => togglePictureInPicture()}
                onClose={() => setShowSettingsMenu(false)}
              />
            </div>

            <button
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Выйти из полноэкранного (F)' : 'Во весь экран (F)'}
              title="Во весь экран (F)"
              className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer focus-visible:ring-2 focus-visible:ring-cinema-gold"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
