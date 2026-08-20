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

  // Sync volume and mute
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = isMuted ? 0 : volume;
    videoRef.current.muted = isMuted;
  }, [volume, isMuted]);

  // Poll 1080p download status from backend
  useEffect(() => {
    if (!videoId) return;

    let isMounted = true;
    const pollStatus = async () => {
      try {
        const res = await apiClient.get(`/stream/youtube/download-status/${videoId}?t=${Date.now()}`);
        if (!isMounted) return;

        if (res.data?.status === 'ready') {
          setDownloadStatus('ready');
          setDownloadPercent(100);
          setStreamSrc(`/api/stream/youtube/${videoId}`);
        } else {
          setDownloadStatus(res.data?.status || 'downloading');
          setDownloadPercent(res.data?.percent || 10);
        }
      } catch (e) {
        if (!isMounted) return;
        setDownloadStatus('downloading');
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 1200);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [videoId]);

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
          onPlayingChange(true);
        } else {
          videoRef.current.pause();
          onPlayingChange(false);
        }
      }
    });

    onAttachPlayHandler?.(() => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {});
        onPlayingChange(true);
      }
    });

    onAttachPauseHandler?.(() => {
      if (videoRef.current) {
        videoRef.current.pause();
        onPlayingChange(false);
      }
    });

    onAttachGetCurrentTime?.(() => {
      return videoRef.current?.currentTime || currentTimeRef.current;
    });

    onAttachGetIsPaused?.(() => {
      return videoRef.current ? videoRef.current.paused : true;
    });
  }, [
    onPlayingChange,
    onAttachSeekHandler,
    onAttachPlayHandler,
    onAttachPauseHandler,
    onAttachGetCurrentTime,
    onAttachGetIsPaused,
  ]);

  // Periodic buffer and time tracker
  useEffect(() => {
    const interval = setInterval(() => {
      if (downloadStatus !== 'ready') {
        onBufferStatusChange(false, 0, 0, downloadPercent || 15);
        return;
      }

      const video = videoRef.current;
      if (!video) {
        onBufferStatusChange(true, 5, currentTimeRef.current, 100);
        return;
      }

      const cur = video.currentTime || 0;
      const dur = video.duration || durationRef.current || 1;
      let bufSec = 0;
      if (video.buffered.length > 0) {
        bufSec = video.buffered.end(video.buffered.length - 1);
      }

      currentTimeRef.current = cur;
      if (dur > 0 && !isNaN(dur)) {
        durationRef.current = dur;
      }
      onTimeUpdate(cur, dur);

      const ready = isReady || (video.readyState >= 1) || (bufSec > 0) || !video.paused;
      const bufferPercent = ready ? 100 : Math.min(99, Math.round((bufSec / dur) * 100));

      onBufferStatusChange(ready, bufSec, cur, bufferPercent);
    }, 350);

    return () => clearInterval(interval);
  }, [downloadStatus, downloadPercent, isReady, onTimeUpdate, onBufferStatusChange]);

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
            onPlayerReadyChange(true);
            if (videoRef.current?.duration) {
              durationRef.current = videoRef.current.duration;
              onTimeUpdate(initialPosition || 0, videoRef.current.duration);
            }
            if (initialPosition > 0 && videoRef.current) {
              videoRef.current.currentTime = initialPosition;
            }
            onBufferStatusChange(true, 5, initialPosition || 0, 100);
            if (roomState === 'PLAYING') {
              videoRef.current?.play().catch(() => {});
              onPlayingChange(true);
            } else {
              videoRef.current?.pause();
              onPlayingChange(false);
            }
          }}
          onLoadedData={() => {
            setIsReady(true);
            onPlayerReadyChange(true);
            onBufferStatusChange(true, 5, currentTimeRef.current, 100);
          }}
          onCanPlay={() => {
            setIsReady(true);
            onPlayerReadyChange(true);
            onBufferStatusChange(true, 5, currentTimeRef.current, 100);
          }}
          onPlay={() => onPlayingChange(true)}
          onPause={() => onPlayingChange(false)}
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
