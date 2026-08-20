import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  RotateCcw, RotateCw, Settings, MessageSquare,
  Users, Radio, Disc3, Subtitles, Volume1, Volume,
  ArrowLeft, Share2, Info, Activity, Cpu, Film, Music, Clock
} from 'lucide-react';
import { MediaItem, MediaTrack, RoomState } from '../../types';
import { ReactionOverlay } from './ReactionOverlay';
import { BufferBarrierBanner } from '../rooms/BufferBarrierBanner';
import { apiClient } from '../../api/client';

interface CustomPlayerProps {
  media: MediaItem;
  room?: any;
  roomState?: RoomState;
  syncDiffMs?: number;
  syncQuality?: 'perfect' | 'good' | 'adjusting' | 'seeking';
  isWatchTogether?: boolean;
  isHost?: boolean;
  allMembersReady?: boolean;
  isBufferingBarrier?: boolean;
  onForceBarrierPlay?: () => void;
  onForceSyncAll?: () => void;
  members?: any[];
  currentUserId?: string;
  hostUserId?: string;
  reactions?: any[];
  onPlayRequest?: () => void;
  onPauseRequest?: () => void;
  onSeekRequest?: (pos: number) => void;
  onSyncToHost?: () => void;
  onBufferStatusChange?: (isReady: boolean, bufferedPos?: number, currentPos?: number, bufferPercent?: number) => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  onBack?: () => void;
  onInvite?: () => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  initialPosition?: number;
  initialPlaying?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement>;
}

export const CustomPlayer: React.FC<CustomPlayerProps> = ({
  media,
  room,
  roomState,
  syncDiffMs = 0,
  syncQuality = 'perfect',
  isWatchTogether = false,
  isHost = false,
  allMembersReady = true,
  isBufferingBarrier = false,
  onForceBarrierPlay,
  onForceSyncAll,
  members = [],
  currentUserId,
  hostUserId,
  reactions = [],
  initialPosition = 0,
  initialPlaying,
  onPlayRequest,
  onPauseRequest,
  onSeekRequest,
  onSyncToHost,
  onBufferStatusChange,
  onToggleSidebar,
  isSidebarOpen = false,
  onBack,
  onInvite,
  onAttachSeekHandler,
  onAttachGetCurrentTime,
  videoRef: externalVideoRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const internalVideoRef = useRef<HTMLVideoElement>(null);
  const videoRef = externalVideoRef || internalVideoRef;

  // Web Audio Gain Booster (lazy initialized on Boost click)
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const lastInternalSeekPosRef = useRef<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const displayTime = isScrubbing ? scrubTime : currentTime;
  const [duration, setDuration] = useState(media.durationSeconds || 0);
  const effectiveDuration = (media.durationSeconds && media.durationSeconds > 0)
    ? media.durationSeconds
    : (duration > 0 ? duration : 0);
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioBoost, setAudioBoost] = useState(1.0); // 1.0 = normal, up to 2.0 = 200%
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Compute live relative drift for every member
  const memberDeltas = useMemo(() => {
    if (!members || !members.length) return [];
    // Host is reference point; if no host found, use current user
    const hostMember = members.find((m: any) => m.userId === hostUserId) || members[0];
    const referencePos = isHost ? displayTime : (hostMember?.currentPosition || displayTime);

    return members.map((m: any) => {
      const isMe = m.userId === currentUserId;
      const pos = isMe ? displayTime : (m.currentPosition || 0);
      const diffSec = pos - referencePos;
      return {
        ...m,
        isMe,
        isHostMember: m.userId === hostUserId,
        pos,
        diffSec,
      };
    });
  }, [members, hostUserId, currentUserId, isHost, displayTime]);

  const maxRoomLag = useMemo(() => {
    if (memberDeltas.length <= 1) return null;
    const lags = memberDeltas.filter(m => !m.isHostMember && m.diffSec < -0.4);
    if (!lags.length) return null;
    return lags.sort((a, b) => a.diffSec - b.diffSec)[0];
  }, [memberDeltas]);

  const audioTracks = useMemo(() => media.tracks?.filter((t: MediaTrack) => t.type === 'AUDIO') || [], [media.tracks]);
  const subtitleTracks = useMemo(() => media.tracks?.filter((t: MediaTrack) => t.type === 'SUBTITLE') || [], [media.tracks]);

  // Find preferred default audio track (auto-select Russian track if present)
  const defaultAudioTrackIndex = useMemo(() => {
    if (!audioTracks.length) return 0;
    const rus = audioTracks.find((t: MediaTrack) =>
      /rus|ru|russian|рус|дубляж|многоголосый|проф/i.test(t.language || '') ||
      /rus|ru|russian|рус|дубляж|многоголосый|проф/i.test(t.title || '')
    );
    return rus ? rus.streamIndex : audioTracks[0].streamIndex;
  }, [audioTracks]);

  // Tracks & Quality
  const [selectedQuality, setSelectedQuality] = useState<string>('original');
  const [selectedAudioTrack, setSelectedAudioTrack] = useState<number>(defaultAudioTrackIndex);
  const [selectedSubtitleTrack, setSelectedSubtitleTrack] = useState<number>(-1);
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [activeMenuTab, setActiveMenuTab] = useState<'root' | 'quality' | 'audio' | 'subtitles'>('root');
  const [justSynced, setJustSynced] = useState(false);

  // Apple device detection (iPad / iPhone / iPod / Mac Safari)
  const isAppleDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua);
    const isMacTouch = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    return isIos || isMacTouch;
  }, []);

  // Synchronize audio track on media item change
  useEffect(() => {
    setSelectedAudioTrack(defaultAudioTrackIndex);
  }, [defaultAudioTrackIndex]);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Direct Play eligibility check:
  // Direct Play is used for native MP4/M4V/WebM with 1 audio track.
  // Files with multiple audio tracks MUST use Direct Stream (HLS with direct stream copy)
  // to isolate the selected audio track and avoid browser multi-track audio playback/mixing.
  const isDirectPlay = useMemo(() => {
    const ext = (media.filePath || '').toLowerCase();
    const isNativeContainer = ext.endsWith('.mp4') || ext.endsWith('.m4v') || ext.endsWith('.webm');
    if (!isNativeContainer || selectedQuality !== 'original') return false;

    // Multi-track audio files must use HLS so FFmpeg delivers exactly one isolated audio track
    if (audioTracks.length > 1) {
      return false;
    }

    if (isAppleDevice) {
      const selectedTrack = audioTracks[0];
      const codec = (selectedTrack?.codec || media.audioCodec || '').toLowerCase();
      const isNativeAppleAudio = ['aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac'].some(c => codec.includes(c));
      return isNativeAppleAudio;
    } else {
      const isNativeAudio = media.audioCodec === 'aac' || media.audioCodec === 'mp3' || media.audioCodec === 'opus';
      return isNativeAudio;
    }
  }, [media.filePath, media.audioCodec, selectedQuality, audioTracks, isAppleDevice]);

  // Stream mode status for user transparency
  const streamMode = useMemo(() => {
    const selectedTrackObj = audioTracks.find(t => t.streamIndex === selectedAudioTrack) || audioTracks[0];
    const rawAudioCodec = (selectedTrackObj?.codec || media.audioCodec || 'aac').toLowerCase();
    const rawVideoCodec = (media.videoCodec || 'h264').toLowerCase();

    // Apple supports AC3/EAC3/AAC/MP3 natively. PC/Android browsers only support AAC/MP3 natively.
    const isDirectAudio = isAppleDevice
      ? (rawAudioCodec.includes('aac') || rawAudioCodec.includes('ac3') || rawAudioCodec.includes('eac3') || rawAudioCodec.includes('mp3') || rawAudioCodec.includes('alac'))
      : (rawAudioCodec === 'aac' || rawAudioCodec === 'mp3');

    const isSupportedVideoCodec = rawVideoCodec === 'h264' || rawVideoCodec === 'hevc' || rawVideoCodec === 'h265';
    const isDirectVideo = selectedQuality === 'original' && isSupportedVideoCodec;

    const audioDisplayName = rawAudioCodec.toUpperCase();
    const videoDisplayName = rawVideoCodec.toUpperCase();

    if (isDirectPlay) {
      return {
        type: 'direct_play',
        label: 'Direct Play',
        color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30',
        dot: 'bg-emerald-400',
        title: 'Прямой файл (Direct Play)',
        description: 'Оригинальный файл отдается напрямую без HLS и без перекодирования.',
        videoDesc: `${videoDisplayName} (Оригинал, 0% нагрузки)`,
        audioDesc: `${audioDisplayName} (Прямой звук, 0% нагрузки)`
      };
    }

    if (isDirectVideo) {
      if (isDirectAudio) {
        // Both video and audio are passed 100% losslessly untouched!
        return {
          type: 'direct_stream_lossless',
          label: 'Direct Stream (Оригинал)',
          color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30',
          dot: 'bg-emerald-400',
          title: 'Прямой стрим (Direct Stream • 100% Оригинал)',
          description: 'Видео и звук передаются напрямую в оригинале без сжатия (Direct Stream Copy, 0% нагрузки на GPU/CPU).',
          videoDesc: `${videoDisplayName} (100% Оригинал, Direct Copy)`,
          audioDesc: `${audioDisplayName} (100% Нативный звук, Direct Copy)`
        };
      } else {
        // Video is direct, but audio is converted to universal AAC for PC/browser support
        return {
          type: 'direct_stream_audio_conv',
          label: 'Direct Video + AAC HD',
          color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30',
          dot: 'bg-emerald-400',
          title: 'Прямое видео + Аудио поток (Direct Stream)',
          description: `Видео передается в 100% оригинале без сжатия, аудио (${audioDisplayName}) бережно переводится в AAC 320 kbps для поддержки на ПК/Android.`,
          videoDesc: `${videoDisplayName} (100% Оригинал, Direct Copy)`,
          audioDesc: `AAC 320 kbps (из ${audioDisplayName})`
        };
      }
    }

    return {
      type: 'transcode',
      label: `GPU Transcode (${selectedQuality})`,
      color: 'bg-sky-500/20 text-sky-300 border-sky-500/40 hover:bg-sky-500/30',
      dot: 'bg-sky-400',
      title: 'Аппаратное преобразование (GPU)',
      description: `Видеопоток масштабируется в ${selectedQuality} через аппаратный энкодер видеокарты.`,
      videoDesc: `H.264 ${selectedQuality} (NVIDIA NVENC)`,
      audioDesc: isDirectAudio ? `${audioDisplayName} (Прямой звук)` : `AAC 320 kbps (Синхронизированный поток)`
    };
  }, [isDirectPlay, media.videoCodec, media.audioCodec, selectedQuality, selectedAudioTrack, audioTracks]);

  const hlsRef = useRef<Hls | null>(null);

  const loadStreamSource = useCallback((url: string, isDirect: boolean, shouldPlay: boolean = false, startPos: number = 0) => {
    const video = videoRef.current;
    if (!video) return;

    if (isDirect) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = url;

      // Select correct audio track via AudioTrack API (Safari/iPad)
      const selectAudioTrack = () => {
        const at = (video as any).audioTracks;
        if (at && at.length > 1) {
          // Find which track index in the file matches selectedAudioTrack streamIndex
          // audioTracks from props are ordered by streamIndex; file tracks are ordered sequentially
          const audioTracksList = audioTracks;
          const selectedIdx = audioTracksList.findIndex((t: any) => t.streamIndex === selectedAudioTrack);
          for (let i = 0; i < at.length; i++) {
            at[i].enabled = (i === (selectedIdx >= 0 ? selectedIdx : 0));
          }
        }
      };
      // Seek to initial start position if resuming
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
    } else if (isAppleDevice && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple Safari / iPad / iOS hardware HLS pipeline (Zero CPU, full hardware HEVC/H.264)
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.src = url;
      video.load();
      video.currentTime = startPos;
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
      // PC Chrome / Edge / Firefox / Android via Hls.js MediaSource Extensions
      let hls = hlsRef.current;
      if (!hls) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 60,
          maxBufferLength: 60,
          maxMaxBufferLength: 120,
          autoStartLoad: false,
          maxBufferHole: 1.0,
          nudgeOffset: 0.1,
          nudgeMaxRetry: 5,
        });

        hls.attachMedia(video);

        hls.on(Hls.Events.BUFFER_APPENDED, () => {
          // If video is stuck because currentTime is slightly behind the buffer start
          // (which happens often when seeking to 0s if the audio track has a priming delay)
          if (video.buffered.length > 0) {
            const bufStart = video.buffered.start(0);
            if (video.currentTime < bufStart && (bufStart - video.currentTime) < 2.0) {
              video.currentTime = bufStart;
            }
          }
        });

        let recoveryCount = 0;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) {
            console.warn('[Hls.js Fatal Error]', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                recoveryCount++;
                if (recoveryCount <= 2) {
                  hls?.recoverMediaError();
                }
                break;
            }
          }
        });

        hlsRef.current = hls;
      }

      // We use .once so it only fires for this specific load event,
      // and closure over the CORRECT startPos!
      hls.once(Hls.Events.MANIFEST_PARSED, () => {
        try { video.currentTime = startPos; } catch (e) {}
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

      // Reset currentTime to startPos
      try { video.currentTime = startPos; } catch (e) {}
      hls.loadSource(url);
      hls.startLoad(startPos);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple Safari fallback
      video.src = url;
      video.load();
      try { video.currentTime = startPos; } catch (e) {}
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
      video.src = url;
      video.load();
      if (shouldPlay) {
        video.play().catch(() => {});
      }
    }
  }, [videoRef]);

  const streamInfoRef = useRef({ mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay });

  useEffect(() => {
    streamInfoRef.current = { mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay };
  }, [media.id, selectedQuality, selectedAudioTrack, isAppleDevice, isDirectPlay]);

  // Clean up Hls and terminate solo transcode session on unmount or page exit
  useEffect(() => {
    const endSession = () => {
      const { mediaId, quality, audioIndex, isApple, isDirectPlay } = streamInfoRef.current;
      if (!isDirectPlay && !isWatchTogether) {
        const token = localStorage.getItem('myplex_token');
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const payload = JSON.stringify({ mediaId, quality, audioIndex, isApple });

        // Use sendBeacon for instant, guaranteed delivery on page exit
        try {
          if (navigator.sendBeacon) {
            const blob = new Blob([payload], { type: 'application/json' });
            navigator.sendBeacon(`/api/stream/hls/session/end${tokenParam}`, blob);
          }
        } catch (e) {}

        // Fallback fetch with keepalive
        fetch(`/api/stream/hls/session/end${tokenParam}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: payload,
          keepalive: true
        }).catch(() => {});
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
          videoRef.current.removeAttribute('src');
          videoRef.current.load();
        } catch (e) {}
      }
      
      endSession();
    };
  }, [isWatchTogether]);

  const buildStreamUrl = useCallback((quality: string, audioIndex: number) => {
    const token = localStorage.getItem('myplex_token');
    const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
    const roomParam = isWatchTogether && room?.id ? `roomId=${room.id}` : '';
    
    if (isDirectPlay) {
      const params = [tokenParam, roomParam].filter(Boolean).join('&');
      return `/api/stream/${media.id}/direct${params ? `?${params}` : ''}`;
    }
    // JIT VOD HLS for ALL non-direct streams
    const isAppleParam = isAppleDevice ? '1' : '0';
    const startParam = (initialPosition && initialPosition > 0) ? `startTime=${Math.floor(initialPosition)}` : '';
    const params = [`quality=${quality}`, `audioIndex=${audioIndex}`, `isApple=${isAppleParam}`, startParam, tokenParam, roomParam].filter(Boolean).join('&');
    return `/api/stream/${media.id}/master.m3u8?${params}`;
  }, [media.id, isDirectPlay, isAppleDevice, isWatchTogether, room?.id, initialPosition]);

  // Perform seek
  const doSeek = useCallback((targetTime: number, forcePlayState?: boolean) => {
    const video = videoRef.current;
    if (!video) return;

    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    lastInternalSeekPosRef.current = safePos;
    setCurrentTime(safePos);
    const shouldPlay = forcePlayState !== undefined ? forcePlayState : !video.paused;

    console.log(`[Player] ⚡ Seeking: target=${safePos.toFixed(1)}s`);

    video.currentTime = safePos;
    if (shouldPlay) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [effectiveDuration]);

  // Lazy Web Audio Gain Booster
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
    } catch (e) {
      console.warn('Web Audio Gain setup:', e);
    }
  }, [audioBoost]);

  const setAudioGainBoost = (multiplier: number) => {
    setAudioBoost(multiplier);
    if (!audioContextRef.current && multiplier > 1.0) {
      setupAudioGain();
    }
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = multiplier;
    }
  };

  // Stream Initialization / Track Switching
  useEffect(() => {
    onAttachSeekHandler?.(doSeek);
  }, [doSeek, onAttachSeekHandler]);

  useEffect(() => {
    onAttachGetCurrentTime?.(() => {
      const video = videoRef.current;
      if (!video) return 0;
      return video.currentTime || 0;
    });
  }, [onAttachGetCurrentTime]);

  const prevMediaIdRef = useRef<string>('');

  const isInitialMount = useRef(true);

  // Stream Initialization on media change
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const startPos = Math.max(0, initialPosition || 0);
    const shouldStartPlay = isWatchTogether ? (roomState === 'PLAYING' || !!initialPlaying) : true;

    prevMediaIdRef.current = media.id;
    setCurrentTime(startPos);
    setBufferedTime(startPos);
    isInitialMount.current = false;

    const url = buildStreamUrl(selectedQuality, selectedAudioTrack);
    loadStreamSource(url, isDirectPlay, shouldStartPlay, startPos);
  }, [media.id]);

  // Track switching (Quality or Audio track change) without resetting position
  const prevQualityRef = useRef(selectedQuality);
  const prevAudioTrackRef = useRef(selectedAudioTrack);

  useEffect(() => {
    if (isInitialMount.current) return;
    if (prevQualityRef.current === selectedQuality && prevAudioTrackRef.current === selectedAudioTrack) {
      return;
    }

    const qualityChanged = prevQualityRef.current !== selectedQuality;
    const audioChanged = prevAudioTrackRef.current !== selectedAudioTrack;
    prevQualityRef.current = selectedQuality;
    prevAudioTrackRef.current = selectedAudioTrack;

    const video = videoRef.current;
    if (!video) return;

    // Apple Direct Play: switch audio track instantly via AudioTrack API (no reload needed)
    if (isDirectPlay && isAppleDevice && audioChanged && !qualityChanged) {
      const at = (video as any).audioTracks;
      if (at && at.length > 1) {
        const selectedIdx = audioTracks.findIndex((t: any) => t.streamIndex === selectedAudioTrack);
        for (let i = 0; i < at.length; i++) {
          at[i].enabled = (i === (selectedIdx >= 0 ? selectedIdx : 0));
        }
        console.log(`[Player] 🔊 Switched audio track via AudioTrack API (index=${selectedIdx})`);
        return; // No stream reload needed
      }
    }

    const currentPos = video.currentTime || 0;
    const wasPlaying = !video.paused;
    const url = buildStreamUrl(selectedQuality, selectedAudioTrack);
    loadStreamSource(url, isDirectPlay, wasPlaying, currentPos);
  }, [selectedQuality, selectedAudioTrack, isDirectPlay, buildStreamUrl, loadStreamSource]);

  // Video Events
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    // Strict lockstep sync with native video element
    const actualIsPlaying = !video.paused && !video.ended;
    if (actualIsPlaying !== isPlaying) {
      setIsPlaying(actualIsPlaying);
    }

    const totalPos = video.currentTime;

    if (!isScrubbing) {
      setCurrentTime(totalPos);
    }

    if ((!media.durationSeconds || media.durationSeconds <= 0) && video.duration && !isNaN(video.duration) && isFinite(video.duration)) {
      setDuration(video.duration);
    }

    if (video.buffered.length > 0) {
      const bufEnd = video.buffered.end(video.buffered.length - 1);
      setBufferedTime(bufEnd);
    }
  };

  // Live Watch Progress Reporting (every 6 seconds while playing, on pause, and on unmount)
  const lastReportedProgressRef = useRef<number>(0);

  const reportProgress = useCallback((overridePos?: number) => {
    const video = videoRef.current;
    if (!video || !media?.id) return;
    const pos = overridePos !== undefined ? overridePos : video.currentTime;
    const dur = video.duration || media.durationSeconds || duration || 0;

    if (pos > 5 && dur > 0) {
      lastReportedProgressRef.current = pos;
      apiClient.post('/media/progress', {
        mediaItemId: media.id,
        progressSeconds: Math.floor(pos),
        durationSeconds: Math.floor(dur)
      }).catch(() => {});
    }
  }, [media.id, media.durationSeconds, duration]);

  // Periodic progress sync while playing
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      reportProgress();
    }, 6000);
    return () => clearInterval(timer);
  }, [isPlaying, reportProgress]);

  // Sync progress on window unload or component unmount
  useEffect(() => {
    const handleUnload = () => {
      const video = videoRef.current;
      if (video && video.currentTime > 5 && media?.id) {
        const dur = video.duration || media.durationSeconds || duration || 0;
        const payload = JSON.stringify({
          mediaItemId: media.id,
          progressSeconds: Math.floor(video.currentTime),
          durationSeconds: Math.floor(dur)
        });
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/media/progress', new Blob([payload], { type: 'application/json' }));
        }
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      reportProgress();
    };
  }, [media.id, media.durationSeconds, duration, reportProgress]);

  const stallCheckTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleWaiting = () => {
    setIsBuffering(true);
    onBufferStatusChange?.(false);

    if (stallCheckTimerRef.current) clearTimeout(stallCheckTimerRef.current);
    stallCheckTimerRef.current = setTimeout(() => {
      const video = videoRef.current;
      if (video && !video.paused && video.readyState < 3) {
        console.log('[Player] 🔄 Nudging stalled playback buffer forward by 0.05s...');
        try {
          video.currentTime += 0.05;
          video.play().catch(() => {});
        } catch (e) {}
      }
    }, 1500);
  };

  const handleCanPlay = () => {
    if (stallCheckTimerRef.current) {
      clearTimeout(stallCheckTimerRef.current);
      stallCheckTimerRef.current = null;
    }
    setIsBuffering(false);
    onBufferStatusChange?.(true);
  };

  // Controls Activity Tracker
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

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

      const video = videoRef.current;
      if (!video) return;

      switch (e.key.toLowerCase()) {
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'mediaplaypause':
          e.preventDefault();
          togglePlay();
          break;
        case 'audiovolumeup':
        case 'audiovolumedown':
        case 'audiovolumemute':
        case 'volumeup':
        case 'volumedown':
        case 'volumemute':
          // Strictly prevent Chrome internal media player from intercepting volume keys when focused
          e.preventDefault();
          e.stopPropagation();
          return;
        case 'arrowright':
        case 'l':
          e.preventDefault();
          skip(10);
          break;
        case 'arrowleft':
        case 'j':
          e.preventDefault();
          skip(-10);
          break;
        case 'arrowup':
          e.preventDefault();
          changeVolume(Math.min(1, volume + 0.05));
          break;
        case 'arrowdown':
          e.preventDefault();
          changeVolume(Math.max(0, volume - 0.05));
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // System Media Session API integration (Windows SMTC / macOS Now Playing)
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: media.title,
          artist: media.showTitle || 'SkyCine',
          album: 'SkyCine Cinema Server',
          artwork: media.posterPath ? [{ src: media.posterPath, sizes: '512x512', type: 'image/jpeg' }] : []
        });

        navigator.mediaSession.setActionHandler('play', () => {
          const video = videoRef.current;
          if (video && video.paused) {
            video.play().catch(() => {});
            setIsPlaying(true);
          }
        });
        navigator.mediaSession.setActionHandler('pause', () => {
          const video = videoRef.current;
          if (video && !video.paused) {
            video.pause();
            setIsPlaying(false);
          }
        });
        navigator.mediaSession.setActionHandler('seekbackward', () => skip(-10));
        navigator.mediaSession.setActionHandler('seekforward', () => skip(10));
      } catch (e) {}
    }
  }, [media.id, media.title, media.showTitle, media.posterPath]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    const actualIsPlaying = !video.paused;

    if (actualIsPlaying) {
      video.pause();
      setIsPlaying(false);
      reportProgress();
    } else {
      const p = video.play();
      if (p) {
        p.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else {
        setIsPlaying(true);
      }
    }
  };

  const pendingSeekTargetRef = useRef<number | null>(null);
  const seekDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const triggerSeek = useCallback((targetTime: number) => {
    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    setCurrentTime(safePos);
    setScrubTime(safePos);
    pendingSeekTargetRef.current = safePos;

    if (seekDebounceTimerRef.current) clearTimeout(seekDebounceTimerRef.current);
    seekDebounceTimerRef.current = setTimeout(() => {
      const target = pendingSeekTargetRef.current;
      pendingSeekTargetRef.current = null;
      if (target !== null) {
        setIsScrubbing(false);
        if (isWatchTogether) {
          onSeekRequest?.(target);
        } else {
          doSeek(target);
        }
      }
    }, 150);
  }, [effectiveDuration, isWatchTogether, onSeekRequest, doSeek]);

  // Periodic Watch Together Buffer Reporter
  useEffect(() => {
    if (!isWatchTogether || !onBufferStatusChange) return;

    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;

      let bufSec = 0;
      if (video.buffered.length > 0) {
        bufSec = video.buffered.end(video.buffered.length - 1);
      }
      const cur = video.currentTime;
      const dur = effectiveDuration || video.duration || 1;
      const bufferAhead = Math.max(0, bufSec - cur);
      const isReady = video.readyState >= 3 && (bufferAhead >= 1.5 || video.readyState === 4);
      const bufferPercent = Math.min(100, Math.round((bufSec / dur) * 100));

      onBufferStatusChange(isReady, bufSec, cur, bufferPercent);
    }, 500);

    return () => clearInterval(interval);
  }, [isWatchTogether, effectiveDuration, onBufferStatusChange]);

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const base = pendingSeekTargetRef.current !== null
      ? pendingSeekTargetRef.current
      : video.currentTime;
    const newPos = Math.max(0, Math.min(effectiveDuration, base + seconds));
    triggerSeek(newPos);
  };

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetPos = parseFloat(e.target.value);
    setIsScrubbing(true);
    setScrubTime(targetPos);
  };

  const handleSeekCommit = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const targetPos = parseFloat((e.target as HTMLInputElement).value);
    triggerSeek(targetPos);
  };

  const changeVolume = (val: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = val;
    setVolume(val);
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (isMuted) {
      video.volume = volume || 0.5;
      setIsMuted(false);
    } else {
      video.volume = 0;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onPointerDown={(e) => {
        const el = document.activeElement as HTMLElement;
        if (el && typeof el.blur === 'function' && el.tagName !== 'TEXTAREA') {
          el.blur();
        }
      }}
      className="relative w-full h-full bg-black flex items-center justify-center select-none overflow-hidden group font-sans touch-none focus:outline-none"
      style={{ contain: 'layout paint', transform: 'translateZ(0)' }}
      tabIndex={-1}
    >
      <video
        ref={videoRef}
        onTimeUpdate={handleTimeUpdate}
        onWaiting={handleWaiting}
        onCanPlay={handleCanPlay}
        onCanPlayThrough={() => setIsBuffering(false)}
        onSeeked={() => {
          setIsBuffering(false);
          if (videoRef.current) {
            const paused = videoRef.current.paused;
            setIsPlaying(!paused);
            
            if (isWatchTogether) {
              const currentPos = videoRef.current.currentTime || 0;
              // Ignore seeked events that are caused by our internal programmatic seeks
              if (Math.abs(currentPos - lastInternalSeekPosRef.current) > 1.0) {
                // Debounce native seek to avoid spamming room
                triggerSeek(currentPos);
              }
            }
          }
        }}
        onLoadedData={() => {
          setIsBuffering(false);
          if (videoRef.current) setIsPlaying(!videoRef.current.paused);
        }}
        onPlay={() => {
          setIsPlaying(true);
          if (isWatchTogether && roomState !== 'PLAYING') onPlayRequest?.();
        }}
        onPlaying={() => {
          setIsPlaying(true);
          setIsBuffering(false);
          if (isWatchTogether && roomState !== 'PLAYING') onPlayRequest?.();
        }}
        onPause={() => {
          setIsPlaying(false);
          if (isWatchTogether && roomState !== 'PAUSED') onPauseRequest?.();
        }}
        onEnded={() => setIsPlaying(false)}
        onClick={(e) => {
          (e.currentTarget as HTMLElement).blur();
          togglePlay();
        }}
        onPointerDown={(e) => (e.currentTarget as HTMLElement).blur()}
        className="w-full h-full object-contain cursor-pointer focus:outline-none"
        style={{
          transform: 'translateZ(0)',
          willChange: 'transform',
          backfaceVisibility: 'hidden'
        }}
        tabIndex={-1}
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

      {/* Buffer Barrier Readiness Banner */}
      <BufferBarrierBanner
        isVisible={!!(isWatchTogether && !isPlaying && members.length > 1)}
        members={members}
        isHost={isHost}
        onForcePlay={() => {
          if (isHost) onPlayRequest?.();
        }}
      />

      {/* Floating Reaction Overlay */}
      {reactions.length > 0 && <ReactionOverlay reactions={reactions} />}

      {/* Center Spinner (Buffering Indicator) */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="w-16 h-16 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin shadow-glow-gold"></div>
        </div>
      )}

      {/* Top Controls Overlay */}
      <div
        className={`absolute top-0 left-0 right-0 pt-[max(1.25rem,env(safe-area-inset-top))] pb-12 px-4 sm:px-6 md:px-8 bg-gradient-to-b from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-30 flex items-center justify-between ${
          showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBack();
              }}
              className="p-2.5 min-w-[42px] min-h-[42px] flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 active:bg-white/40 text-white backdrop-blur-md transition-all shrink-0 cursor-pointer active:scale-90"
              title="Назад"
            >
              <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm sm:text-base md:text-lg font-bold text-white tracking-wide truncate max-w-[180px] sm:max-w-md md:max-w-xl drop-shadow-md">
                {media.title}
              </h1>

              {/* Stream Mode Status Badge */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowStatsModal(!showStatsModal);
                }}
                className={`px-2.5 py-1 rounded-md border text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-md transition-all active:scale-95 cursor-pointer ${streamMode.color}`}
                title="Нажмите для просмотра подробных характеристик потока"
              >
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${streamMode.dot}`}></span>
                <span className="hidden sm:inline">{streamMode.label}</span>
                <span className="sm:hidden">{streamMode.label.split(' ')[0]}</span>
              </button>

              {/* Room Live Sync Status Pill */}
              {isWatchTogether && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSyncModal(!showSyncModal);
                  }}
                  className={`px-2.5 py-1 rounded-md border text-[10px] font-bold flex items-center gap-1.5 backdrop-blur-md transition-all active:scale-95 cursor-pointer ${
                    maxRoomLag
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                  }`}
                  title="Мониторинг синхронизации всех участников (нажмите для подробностей)"
                >
                  <Users className="w-3.5 h-3.5 text-cinema-gold" />
                  <span className={`w-1.5 h-1.5 rounded-full ${maxRoomLag ? 'bg-amber-400 animate-ping' : 'bg-emerald-400 animate-pulse'}`}></span>
                  <span>
                    {maxRoomLag
                      ? `Отстает: ${maxRoomLag.username} (${Math.abs(maxRoomLag.diffSec).toFixed(1)}с)`
                      : `В синхроне (${members.length || 1})`}
                  </span>
                </button>
              )}
            </div>

            {media.type === 'EPISODE' && media.seasonNumber && media.episodeNumber && (
              <p className="text-[11px] text-cinema-gold font-semibold tracking-wider uppercase drop-shadow-sm">
                Сезон {media.seasonNumber} • Серия {media.episodeNumber}
              </p>
            )}
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Room Live Sync Monitor Button */}
          {isWatchTogether && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowSyncModal(!showSyncModal);
              }}
              className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl border backdrop-blur-md transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95 ${
                showSyncModal
                  ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                  : maxRoomLag
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
              }`}
              title="Мониторинг задержки и синхронизации зрителей"
            >
              <Users className="w-4 h-4 text-cinema-gold" />
              <span className="hidden sm:inline">
                {maxRoomLag ? `Отставание: ${Math.abs(maxRoomLag.diffSec).toFixed(1)}с` : `Синхрон (${members.length || 1})`}
              </span>
            </button>
          )}

          {/* Stream Diagnostics Info Toggle */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowStatsModal(!showStatsModal);
            }}
            className={`p-2.5 min-w-[42px] min-h-[42px] flex items-center justify-center rounded-xl border backdrop-blur-md transition-all text-xs font-semibold cursor-pointer active:scale-95 ${
              showStatsModal
                ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
            }`}
            title="Техническая информация о потоке"
          >
            <Activity className="w-5 h-5" />
          </button>

          {isWatchTogether && onInvite && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInvite();
              }}
              className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold/30 text-cinema-gold border border-cinema-gold/30 backdrop-blur-md transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95"
              title="Позвать друга в комнату"
            >
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">Позвать</span>
            </button>
          )}

          {isWatchTogether && onToggleSidebar && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleSidebar();
              }}
              className={`px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl border backdrop-blur-md transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer active:scale-95 ${
                isSidebarOpen
                  ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                  : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
              }`}
              title="Открыть чат и список участников"
            >
              <MessageSquare className="w-4 h-4" />
              <span>{isSidebarOpen ? 'Чат ✕' : '💬 Чат'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Stream Diagnostics Modal Popover */}
      {showStatsModal && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-16 right-4 sm:right-8 w-80 bg-cinema-900/95 border border-cinema-gold/30 backdrop-blur-2xl rounded-2xl p-4 shadow-2xl z-50 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cinema-gold" />
              <span className="font-bold text-white tracking-wide">Параметры потока</span>
            </div>
            <button
              onClick={() => setShowStatsModal(false)}
              className="text-slate-400 hover:text-white text-sm font-bold"
            >
              ✕
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {/* Status Pill */}
            <div className={`p-2.5 rounded-xl border ${streamMode.color} flex flex-col gap-1`}>
              <div className="flex items-center gap-1.5 font-bold text-xs">
                <span className={`w-2 h-2 rounded-full ${streamMode.dot}`}></span>
                <span>{streamMode.title}</span>
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">{streamMode.description}</p>
            </div>

            {/* Stream Tech Breakdown */}
            <div className="space-y-2 text-[11px] pt-1">
              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-cinema-gold" /> Видеопоток:
                </span>
                <span className="font-medium text-white">{streamMode.videoDesc}</span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-cinema-gold" /> Аудиопоток:
                </span>
                <span className="font-medium text-white">{streamMode.audioDesc}</span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5 text-cinema-gold" /> Движок клиента:
                </span>
                <span className="font-mono text-cinema-gold text-[10px]">
                  {isDirectPlay ? 'Direct Byte-Range (206)' : isAppleDevice ? 'Apple Native HLS (.m3u8)' : 'HLS.js Stream Engine (.m3u8)'}
                </span>
              </div>

              <div className="flex items-center justify-between text-slate-300">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5 text-cinema-gold" /> Устройство:
                </span>
                <span className="text-slate-300 font-medium">
                  {isAppleDevice ? 'Apple (iPad/iPhone)' : 'PC / Android'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Live Room Sync Modal Popover */}
      {showSyncModal && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-16 right-4 sm:right-28 w-88 max-w-[92vw] bg-cinema-900/95 border border-cinema-gold/30 backdrop-blur-2xl rounded-2xl p-4 shadow-2xl z-50 text-xs text-slate-200 animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-cinema-gold" />
              <span className="font-bold text-white tracking-wide">
                Синхронизация участников ({memberDeltas.length})
              </span>
            </div>
            <button
              onClick={() => setShowSyncModal(false)}
              className="text-slate-400 hover:text-white text-sm font-bold"
            >
              ✕
            </button>
          </div>

          {/* Host Global Sync Button */}
          {isHost && (
            <button
              onClick={() => {
                onForceSyncAll?.();
                setJustSynced(true);
                setTimeout(() => setJustSynced(false), 2000);
              }}
              className="w-full mb-3 py-2 px-3 rounded-xl bg-cinema-gold text-black font-bold flex items-center justify-center gap-2 shadow-glow-gold hover:bg-cinema-gold/90 active:scale-95 transition-all cursor-pointer text-xs"
            >
              <Radio className="w-4 h-4 animate-pulse" />
              <span>{justSynced ? '✓ Все участники выровнены!' : '🎯 Выровнять всех участников на меня'}</span>
            </button>
          )}

          {/* Member Delta Table */}
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1">
            {memberDeltas.map((m: any) => {
              const absDiff = Math.abs(m.diffSec);
              const isSync = absDiff < 0.4;
              const isLagging = m.diffSec < -0.4;
              return (
                <div
                  key={m.userId || m.socketId}
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                    m.isMe
                      ? 'bg-white/10 border-cinema-gold/40'
                      : isLagging
                      ? 'bg-amber-500/10 border-amber-500/30'
                      : 'bg-white/5 border-white/10'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-cinema-gold/20 border border-cinema-gold/40 flex items-center justify-center font-bold text-cinema-gold text-xs shrink-0 overflow-hidden">
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        (m.username?.[0] || 'U').toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-white truncate">
                        <span className="truncate">{m.username}</span>
                        {m.isHostMember && (
                          <span className="text-[9px] bg-cinema-gold/20 text-cinema-gold px-1 rounded font-bold border border-cinema-gold/30 shrink-0">
                            Хост
                          </span>
                        )}
                        {m.isMe && (
                          <span className="text-[9px] bg-sky-500/20 text-sky-300 px-1 rounded font-bold border border-sky-500/30 shrink-0">
                            Вы
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        Позиция: {formatTime(m.pos)} • Пинг: {m.pingMs || 15}мс
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 text-right">
                    <span
                      className={`text-[11px] font-bold font-mono px-2 py-0.5 rounded-md border ${
                        isSync
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          : isLagging
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                          : 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                      }`}
                    >
                      {isSync ? '0.0с' : m.diffSec < 0 ? `-${absDiff.toFixed(1)}с` : `+${m.diffSec.toFixed(1)}с`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 px-4 sm:px-6 md:px-8 pt-6 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-20 flex flex-col gap-2 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div className="relative w-full group/scrub flex items-center">
          {/* Buffer Bar */}
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded-full pointer-events-none"
            style={{ width: `${effectiveDuration > 0 ? (bufferedTime / effectiveDuration) * 100 : 0}%` }}
          />
          {/* Active Progress Bar */}
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-cinema-gold rounded-full pointer-events-none shadow-[0_0_12px_rgba(229,160,13,0.8)]"
            style={{ width: `${effectiveDuration > 0 ? (displayTime / effectiveDuration) * 100 : 0}%` }}
          />
          <input
            type="range"
            min={0}
            max={effectiveDuration || 100}
            step={0.1}
            value={displayTime}
            onInput={handleSeekInput}
            onChange={(e) => {
              handleSeekInput(e);
              triggerSeek(parseFloat(e.target.value));
            }}
            onMouseUp={(e) => {
              handleSeekCommit(e);
              (e.currentTarget as HTMLElement).blur();
            }}
            onTouchEnd={(e) => {
              handleSeekCommit(e);
              (e.currentTarget as HTMLElement).blur();
            }}
            onKeyUp={(e) => {
              handleSeekCommit(e);
              (e.currentTarget as HTMLElement).blur();
            }}
            onPointerUp={(e) => (e.currentTarget as HTMLElement).blur()}
            tabIndex={-1}
            className="w-full h-1.5 bg-transparent appearance-none cursor-pointer focus:outline-none relative z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cinema-gold [&::-webkit-slider-thumb]:shadow-glow-gold [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-125"
          />
        </div>

        {/* Buttons and Stats */}
        <div className="flex items-center justify-between">
          {/* Left Controls: Play, Skip, Volume, Time */}
          <div className="flex items-center gap-4">
            {/* Play/Pause Button with readiness state */}
            {!isPlaying && isWatchTogether && !allMembersReady && members.length > 1 ? (
              <button
                disabled
                tabIndex={-1}
                className="p-2.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 opacity-80 cursor-not-allowed flex items-center justify-center focus:outline-none"
                title="Ожидание загрузки у всех участников..."
              >
                <Clock className="w-5 h-5 animate-pulse" />
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).blur();
                  togglePlay();
                }}
                onPointerDown={(e) => (e.currentTarget as HTMLElement).blur()}
                tabIndex={-1}
                className="p-2.5 rounded-full bg-white/10 hover:bg-cinema-gold hover:text-black text-white transition-all transform active:scale-95 cursor-pointer focus:outline-none"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).blur();
                skip(-10);
              }}
              onPointerDown={(e) => (e.currentTarget as HTMLElement).blur()}
              tabIndex={-1}
              className="p-2 text-slate-300 hover:text-white transition-colors cursor-pointer focus:outline-none"
              title="Назад на 10 секунд"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).blur();
                skip(10);
              }}
              onPointerDown={(e) => (e.currentTarget as HTMLElement).blur()}
              tabIndex={-1}
              className="p-2 text-slate-300 hover:text-white transition-colors cursor-pointer focus:outline-none"
              title="Вперед на 10 секунд"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-2 group/volume">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  (e.currentTarget as HTMLElement).blur();
                  toggleMute();
                }}
                onPointerDown={(e) => (e.currentTarget as HTMLElement).blur()}
                tabIndex={-1}
                className="text-slate-300 hover:text-white transition-colors cursor-pointer focus:outline-none"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-5 h-5 text-red-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>

              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                onPointerUp={(e) => (e.currentTarget as HTMLElement).blur()}
                onMouseUp={(e) => (e.currentTarget as HTMLElement).blur()}
                onTouchEnd={(e) => (e.currentTarget as HTMLElement).blur()}
                tabIndex={-1}
                className="w-16 h-1 bg-white/20 accent-cinema-gold rounded-full cursor-pointer opacity-80 group-hover/volume:opacity-100 transition-opacity focus:outline-none"
              />

              {/* Volume Percentage Display */}
              <span className="text-[11px] font-mono text-slate-300 min-w-[32px] select-none">
                {Math.round((isMuted ? 0 : volume) * 100)}%
              </span>

              {/* Audio Booster Pill */}
              <button
                onClick={() => setAudioGainBoost(audioBoost === 1.0 ? 1.5 : audioBoost === 1.5 ? 2.0 : 1.0)}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                  audioBoost > 1.0
                    ? 'bg-cinema-gold/20 text-cinema-gold border-cinema-gold shadow-glow-gold'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                }`}
                title="Усилитель громкости тихих диалогов (до 200%)"
              >
                {audioBoost > 1.0 ? `⚡ +${Math.round((audioBoost - 1.0) * 100)}%` : 'Boost'}
              </button>
            </div>

            {/* Time Stamp & Watch Together Re-sync */}
            <div className="text-xs text-slate-300 font-mono tracking-wider flex items-center gap-1.5">
              <span>{formatTime(displayTime)}</span>
              <span className="text-slate-500 mx-0.5">/</span>
              <span>{formatTime(effectiveDuration)}</span>

              {isWatchTogether && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isHost) {
                      onForceSyncAll?.();
                    } else {
                      onSyncToHost?.();
                    }
                    setJustSynced(true);
                    setTimeout(() => setJustSynced(false), 2000);
                  }}
                  className={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-0.5 rounded-md border transition-all ml-2 active:scale-95 cursor-pointer ${
                    justSynced
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : isHost
                      ? 'bg-cinema-gold/20 text-cinema-gold border-cinema-gold/40 hover:bg-cinema-gold/30 shadow-glow-gold/30'
                      : 'bg-white/10 text-slate-200 border-white/20 hover:bg-white/20'
                  }`}
                  title={isHost ? "Синхронизировать всех участников на мою текущую секунду" : "Подровнять время с хостом комнаты"}
                >
                  <Radio className="w-3 h-3 animate-pulse text-cinema-gold" />
                  <span>
                    {justSynced
                      ? (isHost ? '✓ Все выровнены!' : 'Синхронизировано ✓')
                      : (isHost ? '👑 Выровнять всех' : '📡 Выровнять')}
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Right Controls: Settings & Fullscreen */}
          <div className="flex items-center gap-3 relative">
            {/* Settings Menu Button */}
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className={`p-2 rounded-lg transition-colors ${
                  showSettingsMenu ? 'bg-cinema-gold text-black' : 'text-slate-300 hover:text-white hover:bg-white/10'
                }`}
                title="Настройки качества, озвучки и субтитров"
              >
                <Settings className="w-5 h-5" />
              </button>

              {/* Popover Settings Panel */}
              {showSettingsMenu && (
                <div className="absolute bottom-12 right-0 w-64 bg-cinema-900/95 border border-white/15 backdrop-blur-xl rounded-2xl p-3 shadow-2xl z-50 text-xs text-slate-200">
                  {activeMenuTab === 'root' && (
                    <div className="flex flex-col gap-1">
                      <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
                        Параметры потока
                      </div>

                      <button
                        onClick={() => setActiveMenuTab('quality')}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Radio className="w-4 h-4 text-cinema-gold" />
                          Качество
                        </span>
                        <span className="text-slate-400 capitalize">{selectedQuality}</span>
                      </button>

                      <button
                        onClick={() => setActiveMenuTab('audio')}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Disc3 className="w-4 h-4 text-cinema-gold" />
                          Аудиодорожка
                        </span>
                        <span className="text-slate-400 truncate max-w-[90px]">
                          {audioTracks.find(t => t.streamIndex === selectedAudioTrack)?.title || audioTracks.find(t => t.streamIndex === selectedAudioTrack)?.language || 'Авто'}
                        </span>
                      </button>

                      <button
                        onClick={() => setActiveMenuTab('subtitles')}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <Subtitles className="w-4 h-4 text-cinema-gold" />
                          Субтитры
                        </span>
                        <span className="text-slate-400">
                          {selectedSubtitleTrack === -1 ? 'Выкл' : 'Вкл'}
                        </span>
                      </button>
                    </div>
                  )}

                  {activeMenuTab === 'quality' && (
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => setActiveMenuTab('root')}
                        className="text-left text-[11px] text-cinema-gold font-semibold mb-1 hover:underline"
                      >
                        ← Назад
                      </button>
                      {['original', '1080p', '720p', '480p'].map((q) => (
                        <button
                          key={q}
                          onClick={() => {
                            setSelectedQuality(q);
                            setShowSettingsMenu(false);
                          }}
                          className={`p-2 rounded-lg text-left capitalize flex items-center justify-between ${
                            selectedQuality === q ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'
                          }`}
                        >
                          <span>{q === 'original' ? 'Оригинал (Исходное)' : q}</span>
                          {selectedQuality === q && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeMenuTab === 'audio' && (
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                      <button
                        onClick={() => setActiveMenuTab('root')}
                        className="text-left text-[11px] text-cinema-gold font-semibold mb-1 hover:underline"
                      >
                        ← Назад
                      </button>
                      {audioTracks.map((t: MediaTrack) => {
                        const isSelected = selectedAudioTrack === t.streamIndex;
                        return (
                          <button
                            key={t.id || t.streamIndex}
                            onClick={() => {
                              setSelectedAudioTrack(t.streamIndex);
                              setShowSettingsMenu(false);
                            }}
                            className={`p-2 rounded-lg text-left flex items-center justify-between ${
                              isSelected ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'
                            }`}
                          >
                            <div className="truncate pr-2">
                              <p className="font-semibold text-xs">{t.title || `Дорожка #${t.streamIndex}`}</p>
                              <p className="text-[10px] text-slate-400 uppercase">{t.language || 'Не указан'} • {t.codec || 'Audio'}</p>
                            </div>
                            {isSelected && <span>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {activeMenuTab === 'subtitles' && (
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                      <button
                        onClick={() => setActiveMenuTab('root')}
                        className="text-left text-[11px] text-cinema-gold font-semibold mb-1 hover:underline"
                      >
                        ← Назад
                      </button>
                      <button
                        onClick={() => {
                          setSelectedSubtitleTrack(-1);
                          setShowSettingsMenu(false);
                        }}
                        className={`p-2 rounded-lg text-left flex items-center justify-between ${
                          selectedSubtitleTrack === -1 ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'
                        }`}
                      >
                        <span>Отключить субтитры</span>
                        {selectedSubtitleTrack === -1 && <span>✓</span>}
                      </button>
                      {subtitleTracks.map((s: MediaTrack, idx: number) => (
                        <button
                          key={s.id || idx}
                          onClick={() => {
                            setSelectedSubtitleTrack(s.streamIndex);
                            setShowSettingsMenu(false);
                          }}
                          className={`p-2 rounded-lg text-left flex items-center justify-between ${
                            selectedSubtitleTrack === s.streamIndex ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <p className="font-semibold text-xs">{s.title || `Субтитры #${idx + 1}`}</p>
                            <p className="text-[10px] text-slate-400 uppercase">{s.language || 'Не указан'}</p>
                          </div>
                          {selectedSubtitleTrack === s.streamIndex && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 text-slate-300 hover:text-white transition-colors"
              title="Полноэкранный режим"
            >
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
