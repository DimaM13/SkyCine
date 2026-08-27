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
  onTimeUpdate: (currentTime: number, duration: number) => void;
  onPlayingChange: (isPlaying: boolean) => void;
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
  onTimeUpdate,
  onPlayingChange,
  onAgeRestrictedFallback,
  onAttachSeekHandler,
  onAttachPlayHandler,
  onAttachPauseHandler,
  onAttachGetCurrentTime,
  onAttachGetIsPaused,
}) => {
  const playerRef = useRef<any>(null);
  const containerTargetRef = useRef<HTMLDivElement>(null);
  const isReadyRef = useRef(false);
  const currentTimeRef = useRef(initialPosition || 0);
  const durationRef = useRef(0);

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;

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

  // Sync volume and mute
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

  // Attach handlers
  useEffect(() => {
    onAttachSeekHandler?.((pos: number, shouldPlay?: boolean) => {
      currentTimeRef.current = pos;
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
    disableCaptions,
    onAttachSeekHandler,
    onAttachPlayHandler,
    onAttachPauseHandler,
    onAttachGetCurrentTime,
    onAttachGetIsPaused,
  ]);

  // Load Iframe API script if needed
  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag?.parentNode?.insertBefore(tag, firstScriptTag);
    }
  }, []);

  // Create YouTube Player
  useEffect(() => {
    if (!videoId) return;

    let isDisposed = false;

    const createPlayer = () => {
      if (isDisposed) return;
      if (playerRef.current) {
        try { playerRef.current.destroy(); } catch (e) {}
      }

      if (!containerTargetRef.current) return;
      const targetId = `yt-player-${Date.now()}`;
      containerTargetRef.current.innerHTML = `<div id="${targetId}" style="width:100%;height:100%"></div>`;

      playerRef.current = new window.YT.Player(targetId, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
          cc_load_policy: 0,
          playsinline: 1,
          enablejsapi: 1,
        },
        events: {
          onReady: (event: any) => {
            if (isDisposed) return;
            isReadyRef.current = true;

            const d = event.target.getDuration();
            if (d && d > 0) {
              durationRef.current = d;
              onTimeUpdateRef.current(initialPosition || 0, d);
            }

            disableCaptions(event.target);

            if (initialPosition > 0) {
              event.target.seekTo(initialPosition, true);
            }

            if (roomState === 'PLAYING') {
              try { event.target.playVideo(); } catch (e) {}
            } else {
              try { event.target.pauseVideo(); } catch (e) {}
            }
          },
          onStateChange: (event: any) => {
            if (isDisposed) return;
            disableCaptions(event.target);

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
            if ([101, 150, 100, 153, 2, 5].includes(event.data)) {
              console.warn(`[YouTube] Error ${event.data}, offering 1080p fallback`);
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
        try { playerRef.current.destroy(); } catch (e) {}
        playerRef.current = null;
      }
      isReadyRef.current = false;
    };
  }, [videoId, disableCaptions, initialPosition, roomState]);

  // Periodic poll time
  useEffect(() => {
    const interval = setInterval(() => {
      if (!playerRef.current || !isReadyRef.current) return;
      try {
        const cur = playerRef.current.getCurrentTime() || 0;
        const dur = playerRef.current.getDuration() || durationRef.current || 0;
        currentTimeRef.current = cur;
        if (dur > 0) durationRef.current = dur;
        onTimeUpdateRef.current(cur, dur);
      } catch (e) {}
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none flex items-center justify-center overflow-hidden">
      <div
        ref={containerTargetRef}
        className="w-full h-full scale-[1.01] pointer-events-none [&>iframe]:w-full [&>iframe]:h-full [&>iframe]:border-0"
      />
    </div>
  );
};
