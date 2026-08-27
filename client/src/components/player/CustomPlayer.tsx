import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize,
  RotateCcw, RotateCw, Settings, MessageSquare,
  Users, Radio, Disc3, Subtitles, Volume1,
  ArrowLeft, Share2, Activity, Cpu, Film, Music
} from 'lucide-react';
import { MediaItem, MediaTrack, RoomState } from '../../types';
import { ReactionOverlay } from './ReactionOverlay';
import { apiClient } from '../../api/client';

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
  onSeekRequest?: (pos: number) => void;
  onSyncToHost?: () => void;
  onForceSyncAll?: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  onBack?: () => void;
  onInvite?: () => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  initialPosition?: number;
  videoRef?: React.RefObject<HTMLVideoElement>;
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
  onAttachGetCurrentTime,
  videoRef: externalVideoRef,
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
  const [bufferedTime, setBufferedTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioBoost, setAudioBoost] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

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
  const [activeMenuTab, setActiveMenuTab] = useState<'root' | 'quality' | 'audio' | 'subtitles'>('root');

  const isAppleDevice = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }, []);

  useEffect(() => {
    setSelectedAudioTrack(defaultAudioTrackIndex);
  }, [defaultAudioTrackIndex]);

  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    if (isAppleDevice) {
      const isNativeAppleAudio = ['aac', 'mp3', 'opus', 'ac3', 'eac3', 'alac'].some(c => rawAudioCodec.includes(c));
      const isNativeAppleVideo = ['h264', 'hevc', 'h265', 'vp8', 'vp9'].includes(rawVideoCodec);
      return isNativeAppleAudio && isNativeAppleVideo;
    } else {
      const isNativePcAudio = ['aac', 'mp3', 'opus', 'vorbis', 'flac', 'wav'].some(c => rawAudioCodec.includes(c));
      const isNativePcVideo = ['h264', 'hevc', 'h265', 'vp8', 'vp9', 'av1'].includes(rawVideoCodec);
      return isNativePcAudio && isNativePcVideo;
    }
  }, [media.filePath, media.audioCodec, media.videoCodec, selectedQuality, audioTracks, selectedAudioTrack, isAppleDevice]);

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
      if (isAppleDevice && video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native Apple Safari / iPad HLS Pipeline
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
        video.src = url;
        video.load();
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
      } else if (Hls.isSupported()) {
        // PC / Android Hls.js MediaSource Pipeline
        let hls = hlsRef.current;
        if (!hls) {
          hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            backBufferLength: 30,
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
            autoStartLoad: false,
            maxBufferHole: 0.5,
            nudgeOffset: 0.1,
            nudgeMaxRetry: 3,
          });

          hls.attachMedia(video);

          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
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
  }, [videoRef, isAppleDevice]);

  const streamInfoRef = useRef({ mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay });
  useEffect(() => {
    streamInfoRef.current = { mediaId: media.id, quality: selectedQuality, audioIndex: selectedAudioTrack, isApple: isAppleDevice, isDirectPlay };
  }, [media.id, selectedQuality, selectedAudioTrack, isAppleDevice, isDirectPlay]);

  // Clean up Hls and terminate FFmpeg session on unmount or page exit
  useEffect(() => {
    const endSession = () => {
      const { mediaId, quality, audioIndex, isApple, isDirectPlay } = streamInfoRef.current;
      if (!isDirectPlay && !isWatchTogether) {
        const token = localStorage.getItem('myplex_token');
        const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
        const payload = JSON.stringify({ mediaId, quality, audioIndex, isApple });

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
    const params = [`quality=${quality}`, `audioIndex=${audioIndex}`, `isApple=${isAppleParam}`, startParam, tokenParam, roomParam].filter(Boolean).join('&');
    return `/api/stream/${media.id}/master.m3u8?${params}`;
  }, [media.id, isDirectPlay, isAppleDevice, isWatchTogether, room?.id]);

  const doSeek = useCallback((targetTime: number, forcePlayState?: boolean) => {
    const video = videoRef.current;
    if (!video) return;

    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    setCurrentTime(safePos);
    const shouldPlay = forcePlayState !== undefined ? forcePlayState : !video.paused;

    try { video.currentTime = safePos; } catch (e) {}
    if (shouldPlay) {
      video.play().catch(() => {});
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, [effectiveDuration, videoRef]);

  useEffect(() => {
    onAttachSeekHandler?.(doSeek);
  }, [doSeek, onAttachSeekHandler]);

  useEffect(() => {
    onAttachGetCurrentTime?.(() => {
      return videoRef.current?.currentTime || 0;
    });
  }, [onAttachGetCurrentTime, videoRef]);

  const isInitialMount = useRef(true);

  // Initial load
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const startPos = Math.max(0, initialPosition || 0);
    const shouldStartPlay = isWatchTogether ? (roomState === 'PLAYING') : true;

    setCurrentTime(startPos);
    setBufferedTime(startPos);
    isInitialMount.current = false;

    const url = buildStreamUrl(selectedQuality, selectedAudioTrack, startPos);
    loadStreamSource(url, isDirectPlay, shouldStartPlay, startPos);
  }, [media.id]);

  // Sync playback when roomState changes in Watch Together
  useEffect(() => {
    if (!isWatchTogether) return;
    const video = videoRef.current;
    if (!video) return;

    if (roomState === 'PLAYING') {
      if (video.paused) {
        video.play().then(() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }).catch(() => {});
      }
    } else if (roomState === 'PAUSED') {
      if (!video.paused) {
        video.pause();
        setIsPlaying(false);
      }
    }
  }, [roomState, isWatchTogether, videoRef]);

  // Quality or audio track switch
  const prevQualityRef = useRef(selectedQuality);
  const prevAudioTrackRef = useRef(selectedAudioTrack);

  useEffect(() => {
    if (isInitialMount.current) return;
    if (prevQualityRef.current === selectedQuality && prevAudioTrackRef.current === selectedAudioTrack) {
      return;
    }

    prevQualityRef.current = selectedQuality;
    prevAudioTrackRef.current = selectedAudioTrack;

    const video = videoRef.current;
    if (!video) return;

    const currentPos = video.currentTime || 0;
    const wasPlaying = !video.paused;
    const url = buildStreamUrl(selectedQuality, selectedAudioTrack, currentPos);
    loadStreamSource(url, isDirectPlay, wasPlaying, currentPos);
  }, [selectedQuality, selectedAudioTrack, isDirectPlay, buildStreamUrl, loadStreamSource, videoRef]);

  // Video Time Update
  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const actualIsPlaying = !video.paused && !video.ended;
    if (actualIsPlaying !== isPlaying) {
      setIsPlaying(actualIsPlaying);
    }

    const totalPos = video.currentTime || 0;
    if (!isScrubbing) {
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

  // Watch Progress Reporting
  const reportProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video || !media?.id) return;
    const pos = video.currentTime || 0;
    const dur = video.duration || media.durationSeconds || duration || 0;

    if (pos > 5 && dur > 0) {
      apiClient.post('/media/progress', {
        mediaItemId: media.id,
        progressSeconds: Math.floor(pos),
        durationSeconds: Math.floor(dur)
      }).catch(() => {});
    }
  }, [media.id, media.durationSeconds, duration, videoRef]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      reportProgress();
    }, 6000);
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

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isWatchTogether) {
      if (isPlaying) {
        onPauseRequest?.();
      } else {
        onPlayRequest?.();
      }
      return;
    }

    if (!video.paused) {
      video.pause();
      setIsPlaying(false);
      reportProgress();
    } else {
      video.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const lastSeekTimeRef = useRef<number>(0);

  const triggerSeek = (targetTime: number) => {
    const now = Date.now();
    if (now - lastSeekTimeRef.current < 250) return;
    lastSeekTimeRef.current = now;

    const safePos = Math.max(0, Math.min(effectiveDuration, targetTime));
    setCurrentTime(safePos);
    setScrubTime(safePos);
    setIsScrubbing(false);

    if (isWatchTogether) {
      onSeekRequest?.(safePos);
    } else {
      doSeek(safePos);
    }
  };

  const skip = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const newPos = Math.max(0, Math.min(effectiveDuration, (video.currentTime || 0) + seconds));
    triggerSeek(newPos);
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
      className="relative w-full h-full bg-black flex items-center justify-center select-none overflow-hidden group font-sans touch-none"
    >
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
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
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

      {/* Floating Reaction Overlay */}
      {reactions.length > 0 && <ReactionOverlay reactions={reactions} />}

      {/* Buffering Spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
          <div className="w-14 h-14 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        </div>
      )}

      {/* Top Header Controls */}
      <div
        className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/90 via-black/50 to-transparent transition-opacity duration-300 z-30 flex items-center justify-between ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              onClick={onBack}
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-all cursor-pointer shrink-0"
              title="Назад"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-sm sm:text-base font-bold text-white truncate max-w-xs sm:max-w-md md:max-w-xl">
              {media.title}
            </h1>
            {media.type === 'EPISODE' && media.seasonNumber && media.episodeNumber && (
              <p className="text-[11px] text-cinema-gold font-semibold uppercase">
                Сезон {media.seasonNumber} • Серия {media.episodeNumber}
              </p>
            )}
          </div>
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {isWatchTogether && onInvite && (
            <button
              onClick={onInvite}
              className="px-3 py-1.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold/30 text-cinema-gold border border-cinema-gold/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              title="Пригласить друзей"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Позвать</span>
            </button>
          )}

          {isWatchTogether && onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                isSidebarOpen ? 'bg-cinema-gold text-black border-cinema-gold' : 'bg-white/10 text-slate-200 border-white/15 hover:bg-white/20'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>Чат</span>
            </button>
          )}

          <button
            onClick={() => setShowStatsModal(!showStatsModal)}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 text-xs cursor-pointer"
            title="Инфо о потоке"
          >
            <Activity className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stream Stats Modal */}
      {showStatsModal && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute top-16 right-4 w-72 bg-cinema-900/95 border border-cinema-gold/30 backdrop-blur-2xl rounded-2xl p-4 shadow-2xl z-50 text-xs text-slate-200"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-3">
            <span className="font-bold text-white flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-cinema-gold" /> Параметры потока
            </span>
            <button onClick={() => setShowStatsModal(false)} className="text-slate-400 hover:text-white">✕</button>
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-slate-400">Видео:</span>
              <span className="text-white font-mono">{media.videoCodec?.toUpperCase() || 'H264'} ({selectedQuality})</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Звук:</span>
              <span className="text-white font-mono">{media.audioCodec?.toUpperCase() || 'AAC'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Движок:</span>
              <span className="text-cinema-gold font-mono">{isDirectPlay ? 'Direct Play' : isAppleDevice ? 'Apple Native HLS' : 'Hls.js Engine'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Controls Bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent transition-opacity duration-300 z-20 flex flex-col gap-2 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrubber */}
        <div className="relative w-full flex items-center">
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-white/20 rounded-full pointer-events-none"
            style={{ width: `${effectiveDuration > 0 ? (bufferedTime / effectiveDuration) * 100 : 0}%` }}
          />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-cinema-gold rounded-full pointer-events-none"
            style={{ width: `${effectiveDuration > 0 ? (displayTime / effectiveDuration) * 100 : 0}%` }}
          />
          <input
            type="range"
            min={0}
            max={effectiveDuration || 100}
            step={0.1}
            value={displayTime}
            onPointerDown={() => setIsScrubbing(true)}
            onInput={(e) => {
              setIsScrubbing(true);
              setScrubTime(parseFloat((e.target as HTMLInputElement).value));
            }}
            onChange={(e) => {
              setScrubTime(parseFloat(e.target.value));
            }}
            onPointerUp={(e) => {
              triggerSeek(parseFloat((e.target as HTMLInputElement).value));
            }}
            className="w-full h-1.5 bg-transparent appearance-none cursor-pointer relative z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cinema-gold"
          />
        </div>

        {/* Action Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="p-2.5 rounded-full bg-white/10 hover:bg-cinema-gold hover:text-black text-white transition-all cursor-pointer"
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <button onClick={() => skip(-10)} className="p-2 text-slate-300 hover:text-white cursor-pointer" title="Назад 10с">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={() => skip(10)} className="p-2 text-slate-300 hover:text-white cursor-pointer" title="Вперед 10с">
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume */}
            <div className="flex items-center gap-2">
              <button onClick={toggleMute} className="text-slate-300 hover:text-white cursor-pointer">
                {isMuted || volume === 0 ? <VolumeX className="w-5 h-5 text-red-400" /> : volume < 0.5 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => changeVolume(parseFloat(e.target.value))}
                className="w-16 h-1 bg-white/20 accent-cinema-gold rounded-full cursor-pointer"
              />
              <button
                onClick={() => setAudioGainBoost(audioBoost === 1.0 ? 1.5 : audioBoost === 1.5 ? 2.0 : 1.0)}
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded border transition-colors ${
                  audioBoost > 1.0 ? 'bg-cinema-gold/20 text-cinema-gold border-cinema-gold' : 'bg-white/5 text-slate-400 border-white/10'
                }`}
                title="Усилитель звука до 200%"
              >
                {audioBoost > 1.0 ? `+${Math.round((audioBoost - 1.0) * 100)}%` : 'Boost'}
              </button>
            </div>

            {/* Time Stamp & Sync button */}
            <div className="text-xs text-slate-300 font-mono tracking-wider flex items-center gap-1.5">
              <span>{formatTime(displayTime)}</span>
              <span className="text-slate-500">/</span>
              <span>{formatTime(effectiveDuration)}</span>

              {isWatchTogether && (
                <button
                  onClick={() => {
                    if (isHost) onForceSyncAll?.();
                    else onSyncToHost?.();
                    setJustSynced(true);
                    setTimeout(() => setJustSynced(false), 2000);
                  }}
                  className="px-2 py-0.5 rounded-md border text-[10px] font-bold bg-white/10 hover:bg-white/20 text-cinema-gold border-cinema-gold/30 cursor-pointer ml-2"
                >
                  {justSynced ? '✓ Выровнено' : isHost ? '👑 Выровнять всех' : '📡 Выровнять'}
                </button>
              )}
            </div>
          </div>

          {/* Right: Settings & Fullscreen */}
          <div className="flex items-center gap-3 relative">
            <div className="relative">
              <button
                onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                className={`p-2 rounded-lg transition-colors ${showSettingsMenu ? 'bg-cinema-gold text-black' : 'text-slate-300 hover:text-white'}`}
                title="Настройки качества и звука"
              >
                <Settings className="w-5 h-5" />
              </button>

              {showSettingsMenu && (
                <div className="absolute bottom-12 right-0 w-64 bg-cinema-900/95 border border-white/15 backdrop-blur-xl rounded-2xl p-3 shadow-2xl z-50 text-xs text-slate-200">
                  {activeMenuTab === 'root' && (
                    <div className="flex flex-col gap-1">
                      <div className="text-[11px] font-semibold text-slate-400 px-2 py-1 uppercase">Настройки потока</div>
                      <button onClick={() => setActiveMenuTab('quality')} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10">
                        <span className="flex items-center gap-2"><Radio className="w-4 h-4 text-cinema-gold" /> Качество</span>
                        <span className="text-slate-400 capitalize">{selectedQuality}</span>
                      </button>
                      <button onClick={() => setActiveMenuTab('audio')} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10">
                        <span className="flex items-center gap-2"><Disc3 className="w-4 h-4 text-cinema-gold" /> Аудиодорожка</span>
                        <span className="text-slate-400 truncate max-w-[80px]">#{selectedAudioTrack}</span>
                      </button>
                      <button onClick={() => setActiveMenuTab('subtitles')} className="flex items-center justify-between p-2 rounded-lg hover:bg-white/10">
                        <span className="flex items-center gap-2"><Subtitles className="w-4 h-4 text-cinema-gold" /> Субтитры</span>
                        <span className="text-slate-400">{selectedSubtitleTrack === -1 ? 'Выкл' : 'Вкл'}</span>
                      </button>
                    </div>
                  )}

                  {activeMenuTab === 'quality' && (
                    <div className="flex flex-col gap-1">
                      <button onClick={() => setActiveMenuTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1">← Назад</button>
                      {['original', '1080p', '720p', '480p'].map((q) => (
                        <button
                          key={q}
                          onClick={() => { setSelectedQuality(q); setShowSettingsMenu(false); }}
                          className={`p-2 rounded-lg text-left capitalize flex justify-between ${selectedQuality === q ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
                        >
                          <span>{q === 'original' ? 'Оригинал' : q}</span>
                          {selectedQuality === q && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeMenuTab === 'audio' && (
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                      <button onClick={() => setActiveMenuTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1">← Назад</button>
                      {audioTracks.map((t: MediaTrack) => (
                        <button
                          key={t.streamIndex}
                          onClick={() => { setSelectedAudioTrack(t.streamIndex); setShowSettingsMenu(false); }}
                          className={`p-2 rounded-lg text-left flex justify-between ${selectedAudioTrack === t.streamIndex ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
                        >
                          <div className="truncate pr-2">
                            <p className="font-semibold text-xs">{t.title || `Дорожка #${t.streamIndex}`}</p>
                            <p className="text-[10px] text-slate-400 uppercase">{t.language || 'und'} • {t.codec}</p>
                          </div>
                          {selectedAudioTrack === t.streamIndex && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}

                  {activeMenuTab === 'subtitles' && (
                    <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
                      <button onClick={() => setActiveMenuTab('root')} className="text-left text-[11px] text-cinema-gold font-semibold mb-1">← Назад</button>
                      <button
                        onClick={() => { setSelectedSubtitleTrack(-1); setShowSettingsMenu(false); }}
                        className={`p-2 rounded-lg text-left flex justify-between ${selectedSubtitleTrack === -1 ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
                      >
                        <span>Отключить субтитры</span>
                        {selectedSubtitleTrack === -1 && <span>✓</span>}
                      </button>
                      {subtitleTracks.map((s: MediaTrack) => (
                        <button
                          key={s.streamIndex}
                          onClick={() => { setSelectedSubtitleTrack(s.streamIndex); setShowSettingsMenu(false); }}
                          className={`p-2 rounded-lg text-left flex justify-between ${selectedSubtitleTrack === s.streamIndex ? 'bg-cinema-gold/20 text-cinema-gold font-bold' : 'hover:bg-white/10'}`}
                        >
                          <span>{s.title || `Субтитры #${s.streamIndex}`}</span>
                          {selectedSubtitleTrack === s.streamIndex && <span>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button onClick={toggleFullscreen} className="p-2 text-slate-300 hover:text-white cursor-pointer">
              {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
