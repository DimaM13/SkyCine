import React, { useEffect, useRef, useCallback } from 'react';

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YouTubeIFrameEngineProps {
  videoId: string;
  roomState: 'PLAYING' | 'PAUSED' | 'BUFFERING';
  initialPosition: number;
  volume: number;
  isMuted: boolean;
  onPlayerReadyChange: (ready: boolean) => void;
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
  onBufferStatusChange: (isReady: boolean, bufferedPos?: number, currentPos?: number, bufferPercent?: number) => void;
  onAgeRestrictedFallback: () => void;
  onAttachSeekHandler?: (fn: (pos: number, shouldPlay?: boolean) => void) => void;
  onAttachPlayHandler?: (fn: () => void) => void;
  onAttachPauseHandler?: (fn: () => void) => void;
  onAttachGetCurrentTime?: (fn: () => number) => void;
  onAttachGetIsPaused?: (fn: () => boolean) => void;
}

export const YouTubeIFrameEngine: React.FC<YouTubeIFrameEngineProps> = ({
  videoId,
  roomState,
  initialPosition,
  volume,
  isMuted,
  onPlayerReadyChange,
  onTimeUpdate,
  onPlayingChange,
  onBufferStatusChange,
  onAgeRestrictedFallback,
  onAttachSeekHandler,
  onAttachPlayHandler,
  onAttachPauseHandler,
  onAttachGetCurrentTime,
  onAttachGetIsPaused,
}) => {
  const playerRef = useRef<any>(null);
  const isReadyRef = useRef(false);
  const isSeekingRef = useRef(false);
  const seekTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(initialPosition || 0);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

  const onBufferStatusChangeRef = useRef(onBufferStatusChange);
  onBufferStatusChangeRef.current = onBufferStatusChange;

  const onPlayerReadyChangeRef = useRef(onPlayerReadyChange);
  onPlayerReadyChangeRef.current = onPlayerReadyChange;

  const onAgeRestrictedFallbackRef = useRef(onAgeRestrictedFallback);
  onAgeRestrictedFallbackRef.current = onAgeRestrictedFallback;

  const disableCaptions = useCallback((player: any) => {
    if (!player) return;
    try {
      if (player.unloadModule) {
        player.unloadModule('captions');
        player.unloadModule('cc');
      }
      if (player.setOption) {
        player.setOption('captions', 'track', {});
        player.setOption('cc', 'track', {});
        player.setOption('captions', 'fontSize', 0);
      }
    } catch (e) {}
  }, []);

  const markSeeking = useCallback(() => {
    isSeekingRef.current = true;
    if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
    seekTimeoutRef.current = setTimeout(() => {
      isSeekingRef.current = false;
    }, 700);
  }, []);

  useEffect(() => {
    if (!playerRef.current || !isReadyRef.current) return;
    try {
      if (isMuted || volume === 0) {
        playerRef.current.mute();
      } else {
        playerRef.current.unMute();
        playerRef.current.setVolume(Math.round(volume * 100));
      }
    } catch (e) {}
  }, [volume, isMuted]);

  useEffect(() => {
    onAttachSeekHandler?.((pos: number, shouldPlay?: boolean) => {
      currentTimeRef.current = pos;
      markSeeking();

      if (playerRef.current && isReadyRef.current) {
        try {
          playerRef.current.seekTo(pos, true);
          if (shouldPlay) {
            playerRef.current.playVideo();
          } else {
            playerRef.current.pauseVideo();
          }
          disableCaptions(playerRef.current);
        } catch (e) {}
      }
    });

    onAttachPlayHandler?.(() => {
      if (playerRef.current && isReadyRef.current) {
        try {
          playerRef.current.playVideo();
          disableCaptions(playerRef.current);
        } catch (e) {}
      }
    });

    onAttachPauseHandler?.(() => {
      if (playerRef.current && isReadyRef.current) {
        try {
          playerRef.current.pauseVideo();
        } catch (e) {}
      }
    });

    onAttachGetCurrentTime?.(() => {
      if (playerRef.current && isReadyRef.current) {
        try {
          return playerRef.current.getCurrentTime() || currentTimeRef.current;
        } catch (e) {}
      }
      return currentTimeRef.current;
    });

    onAttachGetIsPaused?.(() => {
      if (playerRef.current && isReadyRef.current) {
        try {
          const state = playerRef.current.getPlayerState();
          return state !== 1;
        } catch (e) {}
      }
      return true;
    });
  }, [
    markSeeking,
    disableCaptions,
    onAttachSeekHandler,
    onAttachPlayHandler,
    onAttachPauseHandler,
    onAttachGetCurrentTime,
    onAttachGetIsPaused,
  ]);

  const prevRoomStateRef = useRef<string>(roomState);
  useEffect(() => {
    if (prevRoomStateRef.current !== roomState) {
      prevRoomStateRef.current = roomState;
      if (playerRef.current && isReadyRef.current) {
        try {
          if (roomState === 'PLAYING') {
            playerRef.current.playVideo();
          } else if (roomState === 'PAUSED') {
            playerRef.current.pauseVideo();
          }
        } catch (e) {}
      }
    }
  }, [roomState]);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  useEffect(() => {
    if (!videoId) return;

    let isDisposed = false;

    const createPlayer = () => {
      if (isDisposed) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
      }

      playerRef.current = new window.YT.Player('yt-iframe-subplayer-target', {
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          cc_lang_pref: 'none',
          playsinline: 1,
          enablejsapi: 1,
          origin: typeof window !== 'undefined' ? window.location.origin : undefined,
        },
        events: {
          onReady: (event: any) => {
            if (isDisposed) return;
            isReadyRef.current = true;
            isSeekingRef.current = false;
            onPlayerReadyChangeRef.current(true);

            const d = event.target.getDuration();
            if (d && d > 0) {
              durationRef.current = d;
              onTimeUpdateRef.current(initialPosition || 0, d);
            }

            disableCaptions(event.target);

            if (initialPosition > 0) {
              event.target.seekTo(initialPosition, true);
            }

            if (prevRoomStateRef.current === 'PLAYING') {
              event.target.playVideo();
            } else {
              event.target.pauseVideo();
            }

            onBufferStatusChangeRef.current(true, initialPosition, initialPosition, 100);
          },
          onStateChange: (event: any) => {
            if (isDisposed) return;
            disableCaptions(event.target);

            if (event.data === 1 || event.data === 2 || event.data === 0 || event.data === 5 || event.data === -1) {
              isSeekingRef.current = false;
            }

            if (event.data === 1) {
              onPlayingChangeRef.current(true);
              const d = event.target.getDuration();
              if (d && d > 0) {
                durationRef.current = d;
                onTimeUpdateRef.current(event.target.getCurrentTime() || 0, d);
              }
            } else if (event.data === 2 || event.data === 0) {
              onPlayingChangeRef.current(false);
            }
          },
          onError: (event: any) => {
            if (event.data === 101 || event.data === 150 || event.data === 100 || event.data === 153 || event.data === 2 || event.data === 5) {
              console.warn(`[YouTube IFrame] Embed error code ${event.data}, falling back to server stream`);
              onAgeRestrictedFallbackRef.current();
            }
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = () => {
        createPlayer();
      };
    }

    return () => {
      isDisposed = true;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch (e) {}
        playerRef.current = null;
      }
      isReadyRef.current = false;
      onPlayerReadyChangeRef.current(false);
    };
  }, [videoId, disableCaptions, initialPosition]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || !isReadyRef.current) return;

      try {
        const cur = playerRef.current.getCurrentTime() || 0;
        const dur = playerRef.current.getDuration() || durationRef.current || 0;

        currentTimeRef.current = cur;
        if (dur > 0) {
          durationRef.current = dur;
        }
        onTimeUpdateRef.current(cur, dur);
      } catch (e) {}
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center overflow-hidden">
      <div id="yt-iframe-subplayer-target" className="w-full h-full scale-[1.01] pointer-events-none" />
    </div>
  );
};
