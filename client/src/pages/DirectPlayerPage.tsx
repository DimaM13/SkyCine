import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CustomPlayer, EpisodeNavItem } from '../components/player/CustomPlayer';
import { MediaItem } from '../types';

export const DirectPlayerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [episodeNav, setEpisodeNav] = useState<{ prev: EpisodeNavItem | null; next: EpisodeNavItem | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setEpisodeNav(null);
    apiClient.get(`/media/item/${id}`)
      .then((res) => setMedia(res.data.media))
      .catch(() => {
        alert('Медиафайл не найден');
        navigate('/');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Для серий: соседние серии (отсортированы по season/episode на сервере) —
  // кнопки prev/next и авто-переход в плеере. Строго в рамках своей библиотеки,
  // иначе серии одноимённых шоу из разных библиотек смешивались.
  const showTitle = (media as any)?.showTitle as string | undefined;
  const mediaLibraryId = (media as any)?.libraryId as string | undefined;
  useEffect(() => {
    if (!showTitle || !media?.id) {
      setEpisodeNav(null);
      return;
    }
    let stale = false;
    apiClient.get(`/media/shows/${encodeURIComponent(showTitle)}/episodes`, {
      params: mediaLibraryId ? { libraryId: mediaLibraryId } : undefined,
    })
      .then((res) => {
        if (stale) return;
        const episodes: any[] = res.data.episodes || [];
        const idx = episodes.findIndex((e) => e.id === media.id);
        if (idx < 0) return;
        const brief = (e: any): EpisodeNavItem => ({
          id: e.id,
          title: e.title || '',
          seasonNumber: e.seasonNumber ?? undefined,
          episodeNumber: e.episodeNumber ?? undefined,
          stillPath: e.stillPath ?? null,
        });
        setEpisodeNav({
          prev: idx > 0 ? brief(episodes[idx - 1]) : null,
          next: idx < episodes.length - 1 ? brief(episodes[idx + 1]) : null,
        });
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [media?.id, showTitle, mediaLibraryId]);

  // Откуда пришли в плеер: все handlePlayDirect передают state { from }.
  // Сохраняем в ref при первом появлении, чтобы переходы prev/next внутри
  // плеера (replace + тот же from) его не затирали.
  // (Хуки обязаны стоять до раннего return, иначе меняется их порядок.)
  const returnToRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    const from = (location.state as any)?.from;
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('/watch')) {
      returnToRef.current = from;
    }
  }, [location.state]);

  if (loading || !media) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Загрузка плеера...</span>
      </div>
    );
  }

  const handleBack = () => {
    const mediaAny = media as any;
    const isEpisode = !!(mediaAny?.showTitle || mediaAny?.seasonNumber || mediaAny?.episodeNumber);
    const saved = returnToRef.current;
    // Доверяем только внутренним путям (не /watch, не /rooms/:code).
    if (saved && saved.startsWith('/') && !saved.startsWith('/watch') && !/^\/rooms\/[^/]+$/.test(saved)) {
      navigate(saved, { replace: true });
      return;
    }
    // Fallback по типу медиа: эпизод — в свою библиотеку (точный контекст),
    // иначе на глобальную страницу сериалов; фильмы — в фильмы.
    if (isEpisode) {
      if (mediaAny?.libraryId) navigate(`/library/${mediaAny.libraryId}`, { replace: true });
      else navigate('/shows', { replace: true });
    }
    else if ((media as any)?.type === 'MOVIE' || (media as any)?.libraryType === 'movies') {
      if (mediaAny?.libraryId) navigate(`/library/${mediaAny.libraryId}`, { replace: true });
      else navigate('/movies', { replace: true });
    }
    else if ((media as any)?.type === 'VIDEO') {
      if (mediaAny?.libraryId) navigate(`/library/${mediaAny.libraryId}`, { replace: true });
      else navigate('/', { replace: true });
    }
    else navigate('/', { replace: true });
  };

  // Determine initial position: URL query ?start= overrides saved progress; otherwise use saved userProgress
  const queryParams = new URLSearchParams(location.search);
  const startParam = queryParams.get('start');

  const dur = media?.durationSeconds || 0;
  let initialPosition = 0;
  if (startParam !== null) {
    initialPosition = Math.max(0, parseFloat(startParam) || 0);
  } else if ((media as any).userProgress && (media as any).userProgress > 5) {
    const progress = (media as any).userProgress;
    const isCompleted = (media as any).userCompleted;
    // Only resume if progress is within video bounds and not marked completed
    if (!isCompleted && (dur === 0 || progress < dur - 10)) {
      initialPosition = progress;
    }
  }

  // Ensure initialPosition never exceeds video duration
  if (dur > 0 && initialPosition >= dur - 2) {
    initialPosition = 0;
  }

  const isDesktop = typeof window !== 'undefined' && Boolean((window as any).desktopPlayer?.isDesktop);

  return (
    <div className={`w-full h-full relative ${isDesktop ? 'bg-transparent' : 'bg-black'} overflow-hidden select-none touch-none`}>
      <CustomPlayer
        key={media.id}
        media={media}
        initialPosition={initialPosition}
        isWatchTogether={false}
        onBack={handleBack}
        episodeNav={episodeNav || undefined}
        onPlayEpisode={(epId) => navigate(`/watch/${epId}`, {
          // replace: история не копит /watch/ep1 -> /watch/ep2, иначе Back
          // сначала откатывался на предыдущую серию и только потом выходил.
          replace: true,
          state: returnToRef.current ? { from: returnToRef.current } : undefined,
        })}
      />
    </div>
  );
};
