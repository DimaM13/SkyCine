import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Zap } from 'lucide-react';
import { apiClient } from '../../../api/client';

interface YouTubeStreamEngineProps {
  videoId: string;
  roomState: 'PLAYING' | 'PAUSED' | 'BUFFERING';
  initialPosition: number;
  volume: number;
  isMuted: boolean;
  onPlayerReadyChange: (ready: boolean) => void;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onBufferStatusChange: (isReady: boolean, bufferedPos?: number, currentPos?: number, bufferPercent?: number) => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachPlayHandler?: (fn: () => void) => void;
  onAttachPauseHandler?: (fn: () => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  onAttachGetIsPaused?: (fn: () => boolean) => void;
}

export const YouTubeStreamEngine: React.FC<YouTubeStreamEngineProps> = ({
  videoId,
  roomState,
  initialPosition,
  volume,
  isMuted,
  onPlayerReadyChange,
  onTimeUpdate,
  onPlayingChange,
  onBufferStatusChange,
  onAttachSeekHandler,
  onAttachPlayHandler,
  onAttachPauseHandler,
  onAttachGetCurrentTime,
  onAttachGetIsPaused,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamSrc, setStreamSrc] = useState<string>('');
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'ready' | 'error'>('idle');
  const [downloadPercent, setDownloadPercent] = useState<number>(0);
  const [isReady, setIsReady] = useState(false);

  const durationRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(initialPosition || 0);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  const onBufferStatusChangeRef = useRef(onBufferStatusChange);
  onBufferStatusChangeRef.current = onBufferStatusChange;

  const onPlayerReadyChangeRef = useRef(onPlayerReadyChange);
  onPlayerReadyChangeRef.current = onPlayerReadyChange;

  // Sync volume and mute
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = isMuted ? 0 : volume;
    videoRef.current.muted = isMuted;
  }, [volume, isMuted]);

  // Poll 1080p download status from backend (stops once ready)
  useEffect(() => {
    if (!videoId || downloadStatus === 'ready') return;

    let isMounted = true;
    let timer: NodeJS.Timeout | null = null;

    const pollStatus = async () => {
      try {
        const res = await apiClient.get(`/stream/youtube/download-status/${videoId}`);
        if (!isMounted) return;

        if (res.data?.status === 'ready') {
          setDownloadStatus('ready');
          setDownloadPercent(100);
          setStreamSrc(`/api/stream/youtube/${videoId}`);
        } else {
          setDownloadStatus(res.data?.status || 'downloading');
          setDownloadPercent(res.data?.percent || 10);
          timer = setTimeout(pollStatus, 2000);
        }
      } catch (e) {
        if (!isMounted) return;
        setDownloadStatus('downloading');
        timer = setTimeout(pollStatus, 3000);
      }
    };

    pollStatus();

    return () => {
      isMounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [videoId, downloadStatus]);

  // Force load metadata on Safari / iOS when src is ready
  useEffect(() => {
    if (videoRef.current && streamSrc) {
      try {
        videoRef.current.load();
      } catch (e) {}
    }
  }, [streamSrc]);

  // Attach control hooks
  useEffect(() => {
    onAttachSeekHandler?.((pos: number, shouldPlay?: boolean) => {
      currentTimeRef.current = pos;
      if (videoRef.current) {
        videoRef.current.currentTime = pos;
        if (shouldPlay) {
          videoRef.current.play().catch(() => {});
          onPlayingChangeRef.current(true);
        } else {
          videoRef.current.pause();
          onPlayingChangeRef.current(false);
        }
      }
    });

    onAttachPlayHandler?.(() => {
      if (videoRef.current) {
        const p = videoRef.current.play();
        if (p !== undefined) {
          p.then(() => {
            onPlayingChangeRef.current(true);
          }).catch((err) => {
            console.warn('[YouTubeStreamEngine] Autoplay prevented, playing muted to stay in sync:', err);
            if (videoRef.current) {
              videoRef.current.muted = true;
              videoRef.current.play().then(() => {
                onPlayingChangeRef.current(true);
              }).catch(() => {});
            }
          });
        }
      }
    });

    onAttachPauseHandler?.(() => {
      if (videoRef.current) {
        videoRef.current.pause();
        onPlayingChangeRef.current(false);
      }
    });

    onAttachGetCurrentTime?.(() => {
      return videoRef.current?.currentTime || currentTimeRef.current;
    });

    onAttachGetIsPaused?.(() => {
      return videoRef.current ? videoRef.current.paused : true;
    });
  }, [
    onAttachSeekHandler,
    onAttachPlayHandler,
    onAttachPauseHandler,
    onAttachGetCurrentTime,
    onAttachGetIsPaused,
  ]);

  // Periodic time tracking (500ms without spamming room:buffer_status)
  useEffect(() => {
    const interval = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;

      const cur = video.currentTime || 0;
      const dur = video.duration || durationRef.current || 0;

      currentTimeRef.current = cur;
      if (dur > 0 && !isNaN(dur)) {
        durationRef.current = dur;
      }
      onTimeUpdateRef.current(cur, dur);
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-black">
      {downloadStatus === 'ready' && streamSrc ? (
        <video
          ref={videoRef}
          src={streamSrc}
          playsInline
          preload="auto"
          className="w-full h-full object-contain pointer-events-none"
          onLoadedMetadata={() => {
            setIsReady(true);
            onPlayerReadyChangeRef.current(true);
            if (videoRef.current?.duration) {
              durationRef.current = videoRef.current.duration;
              onTimeUpdateRef.current(initialPosition || 0, videoRef.current.duration);
            }
            if (initialPosition > 0 && videoRef.current) {
              videoRef.current.currentTime = initialPosition;
            }
            onBufferStatusChangeRef.current(true, 5, initialPosition || 0, 100);
            if (roomState === 'PLAYING') {
              const p = videoRef.current?.play();
              if (p !== undefined) {
                p.then(() => onPlayingChangeRef.current(true)).catch(() => {
                  if (videoRef.current) {
                    videoRef.current.muted = true;
                    videoRef.current.play().then(() => onPlayingChangeRef.current(true)).catch(() => {});
                  }
                });
              }
            } else {
              videoRef.current?.pause();
              onPlayingChangeRef.current(false);
            }
          }}
          onLoadedData={() => {
            setIsReady(true);
            onPlayerReadyChangeRef.current(true);
            onBufferStatusChangeRef.current(true, 5, currentTimeRef.current, 100);
          }}
          onCanPlay={() => {
            setIsReady(true);
            onPlayerReadyChangeRef.current(true);
            onBufferStatusChangeRef.current(true, 5, currentTimeRef.current, 100);
          }}
          onWaiting={() => {
            onBufferStatusChangeRef.current(false, 0, currentTimeRef.current, 50);
          }}
          onPlay={() => onPlayingChangeRef.current(true)}
          onPause={() => onPlayingChangeRef.current(false)}
        />
      ) : (
        <div className="flex flex-col items-center justify-center gap-4 p-6 text-center max-w-md animate-fade-in z-20">
          <div className="relative">
            <Loader2 className="w-12 h-12 text-cinema-gold animate-spin" />
            <Zap className="w-5 h-5 text-amber-400 absolute inset-0 m-auto fill-current animate-pulse" />
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-white font-bold text-base">Подготовка видео в 1080p Full HD</h3>
            <p className="text-slate-400 text-xs">
              Загружаем видео без возрастных ограничений на сервер SkyCine...
            </p>
          </div>
          <div className="w-full bg-white/10 h-2.5 rounded-full overflow-hidden p-0.5 border border-white/10">
            <div
              className="bg-gradient-to-r from-amber-500 to-cinema-gold h-full rounded-full transition-all duration-300"
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
          <span className="text-cinema-gold font-mono font-bold text-xs">
            {downloadPercent}% готово
          </span>
        </div>
      )}
    </div>
  );
};
