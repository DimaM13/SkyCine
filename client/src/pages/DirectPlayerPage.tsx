import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { apiClient } from '../api/client';
import { CustomPlayer } from '../components/player/CustomPlayer';
import { MediaItem } from '../types';

export const DirectPlayerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [media, setMedia] = useState<MediaItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    apiClient.get(`/media/item/${id}`)
      .then((res) => setMedia(res.data.media))
      .catch(() => {
        alert('Медиафайл не найден');
        navigate('/');
      })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading || !media) {
    return (
      <div className="h-screen w-screen bg-black flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Загрузка плеера...</span>
      </div>
    );
  }

  const handleBack = () => {
    // For series episodes keep user on the show's episode list, not catalog root
    const mediaAny = media as any;
    const isEpisode = !!(mediaAny?.showTitle || mediaAny?.seasonNumber || mediaAny?.episodeNumber);
    // Try history back first - ShowsPage restores selectedShow/selectedSeason from localStorage
    if (window.history.length > 1) {
      navigate(-1);
      // Fallback if history back didn't stay inside app (e.g., direct link) - ensure shows page
      setTimeout(() => {
        if (isEpisode && window.location.pathname.startsWith('/watch')) {
          navigate('/shows');
        }
      }, 300);
      return;
    }
    if (isEpisode) navigate('/shows');
    else if ((media as any)?.type === 'MOVIE' || (media as any)?.libraryType === 'movies') navigate('/movies');
    else navigate('/');
  };

  // Determine initial position: URL query ?start= overrides saved progress; otherwise use saved userProgress
  const queryParams = new URLSearchParams(location.search);
  const startParam = queryParams.get('start');

  let initialPosition = 0;
  if (startParam !== null) {
    initialPosition = parseFloat(startParam) || 0;
  } else if ((media as any).userProgress && (media as any).userProgress > 15) {
    initialPosition = (media as any).userProgress;
  }

  return (
    <div className="w-full h-full relative bg-black overflow-hidden select-none touch-none">
      <CustomPlayer
        key={`${media.id}_${initialPosition}`}
        media={media}
        initialPosition={initialPosition}
        isWatchTogether={false}
        onBack={handleBack}
      />
    </div>
  );
};
