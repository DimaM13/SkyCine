import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiClient } from '../api/client';
import { CustomPlayer } from '../components/player/CustomPlayer';
import { MediaItem } from '../types';

export const DirectPlayerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
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
      <div className="h-[80vh] flex flex-col items-center justify-center gap-3 text-slate-400">
        <div className="w-10 h-10 border-4 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
        <span className="text-xs">Загрузка плеера...</span>
      </div>
    );
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="w-full h-full relative bg-black overflow-hidden select-none touch-none">
      <CustomPlayer media={media} isWatchTogether={false} onBack={handleBack} />
    </div>
  );
};
