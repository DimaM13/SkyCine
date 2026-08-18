import React, { useState, useEffect } from 'react';
import { Settings, Key, Cpu, Zap, UserCheck, CheckCircle2, AlertCircle, Save } from 'lucide-react';
import { apiClient } from '../../api/client';

export const ServerSettingsForm: React.FC = () => {
  const [settings, setSettings] = useState<Record<string, any>>({
    serverName: 'MyPlex Home Cinema',
    tmdbApiKey: '',
    transcodeHardware: 'auto',
    maxTranscodeBitrate: '20000',
    allowPublicRegistration: 'true',
  });
  const [loading, setLoading] = useState(true);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    apiClient.get('/admin/settings')
      .then((res) => {
        if (res.data.settings) {
          setSettings(res.data.settings);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError('');
    setSaveSuccess(false);

    try {
      await apiClient.put('/admin/settings', settings);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err.response?.data?.error || 'Ошибка при сохранении настроек');
    }
  };

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-6">
      {saveSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 animate-fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Настройки сервера успешно сохранены!</span>
        </div>
      )}

      {saveError && (
        <div className="p-4 rounded-2xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col gap-5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Key className="w-4 h-4 text-cinema-gold" />
          Метаданные и постеры (TMDB API)
        </h3>

        <div>
          <label className="text-xs font-semibold text-slate-300 block mb-1">Ключ TMDB API (The Movie Database)</label>
          <input
            type="text"
            placeholder="Вставьте ваш бесплатный API ключ TMDB (v3 auth)"
            value={settings.tmdbApiKey || ''}
            onChange={(e) => setSettings({ ...settings, tmdbApiKey: e.target.value })}
            className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
          />
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            Позволяет автоматически подтягивать постеры в высоком разрешении, фоновые арты, описания фильмов, актёров и рейтинги. Ключ можно получить бесплатно на сайте <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="text-cinema-gold hover:underline">themoviedb.org</a>.
          </p>
        </div>
      </div>

      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col gap-5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cinema-gold" />
          Аппаратное транскодирование и видеокарта (GPU)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Аппаратный энкодер</label>
            <select
              value={settings.transcodeHardware || 'auto'}
              onChange={(e) => setSettings({ ...settings, transcodeHardware: e.target.value })}
              className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold"
            >
              <option value="auto">Автоопределение (Nvidia NVENC / Intel QSV / AMD / CPU)</option>
              <option value="nvenc">Nvidia NVENC (GeForce / RTX / GTX)</option>
              <option value="qsv">Intel QuickSync (QSV)</option>
              <option value="amf">AMD AMF (Radeon GPU)</option>
              <option value="cpu">Только процессор (CPU libx264)</option>
            </select>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Автоопределение проверяет видеокарту и выбирает самый быстрый энкодер
            </span>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Максимальный битрейт стриминга (Кбит/с)</label>
            <input
              type="number"
              value={settings.maxTranscodeBitrate || '20000'}
              onChange={(e) => setSettings({ ...settings, maxTranscodeBitrate: e.target.value })}
              className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold font-mono"
            />
            <span className="text-[10px] text-slate-500 mt-1 block">
              20000 = 20 Мбит/с (1080p 60fps), 40000 = 40 Мбит/с (4K UHD)
            </span>
          </div>
        </div>
      </div>

      <div className="p-6 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col gap-5">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-cinema-gold" />
          Доступ и регистрация пользователей
        </h3>

        <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5">
          <div>
            <span className="text-xs font-bold text-white block">Открытая регистрация</span>
            <span className="text-[11px] text-slate-400">Разрешить друзьям самостоятельно регистрироваться на сайте сервера</span>
          </div>
          <button
            type="button"
            onClick={() => setSettings({ ...settings, allowPublicRegistration: settings.allowPublicRegistration === 'true' ? 'false' : 'true' })}
            className={`w-12 h-6 rounded-full transition-colors relative p-0.5 ${
              settings.allowPublicRegistration === 'true' ? 'bg-cinema-gold' : 'bg-white/20'
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full bg-black transition-transform ${
                settings.allowPublicRegistration === 'true' ? 'translate-x-6' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          type="submit"
          className="px-6 py-3 rounded-2xl bg-cinema-gold text-black font-bold text-xs flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all"
        >
          <Save className="w-4 h-4" />
          <span>Сохранить настройки сервера</span>
        </button>
      </div>
    </form>
  );
};
