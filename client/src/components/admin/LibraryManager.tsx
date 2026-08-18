import React, { useState, useEffect } from 'react';
import { FolderPlus, Trash2, RefreshCw, Film, Tv, CheckCircle2, AlertCircle, Lock, FolderOpen } from 'lucide-react';
import { apiClient } from '../../api/client';
import { Library } from '../../types';
import { LibraryAccessModal } from './LibraryAccessModal';
import { FilePickerModal } from './FilePickerModal';

export const LibraryManager: React.FC = () => {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddFileModal, setShowAddFileModal] = useState(false);
  const [scanStatus, setScanStatus] = useState<any>({ isScanning: false });
  const [selectedLibForAccess, setSelectedLibForAccess] = useState<{ id: string; name: string } | null>(null);

  // File & Folder Picker state
  const [showFolderPickerForLib, setShowFolderPickerForLib] = useState(false);
  const [showFilePickerForSingle, setShowFilePickerForSingle] = useState(false);

  // Form State (Folder)
  const [name, setName] = useState('');
  const [type, setType] = useState<'MOVIES' | 'SHOWS'>('MOVIES');
  const [folderPath, setFolderPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Form State (Single Movie / Series Folder)
  const [showAddMediaModal, setShowAddMediaModal] = useState(false);
  const [mediaAddMode, setMediaAddMode] = useState<'MOVIE' | 'SHOW'>('MOVIE');
  const [mediaPath, setMediaPath] = useState('');
  const [mediaTitle, setMediaTitle] = useState('');
  const [mediaLibId, setMediaLibId] = useState('');
  const [mediaErrorMsg, setMediaErrorMsg] = useState('');
  const [mediaSuccessMsg, setMediaSuccessMsg] = useState('');
  const [isAddingMedia, setIsAddingMedia] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);

  const fetchLibraries = () => {
    apiClient.get('/libraries')
      .then((res) => {
        setLibraries(res.data.libraries || []);
        if (res.data.libraries?.length > 0 && !mediaLibId) {
          setMediaLibId(res.data.libraries[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const fetchScanStatus = () => {
    apiClient.get('/libraries/scan-status')
      .then((res) => setScanStatus(res.data))
      .catch(() => {});
  };

  useEffect(() => {
    fetchLibraries();
    const interval = setInterval(fetchScanStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleAddLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    try {
      await apiClient.post('/libraries', {
        name,
        type,
        path: folderPath,
      });

      setSuccessMsg('Библиотека добавлена и сканирование запущено!');
      setName('');
      setFolderPath('');
      setShowAddModal(false);
      fetchLibraries();
    } catch (err: any) {
      setErrorMsg(err.response?.data?.error || 'Ошибка добавления библиотеки');
    }
  };

  const handleSelectLibFolder = (selectedPath: string) => {
    setFolderPath(selectedPath);
    if (!name.trim()) {
      const parts = selectedPath.split(/[\\/]/).filter(Boolean);
      const last = parts[parts.length - 1];
      if (last && !last.endsWith(':')) {
        setName(last);
      }
    }
  };

  const handleSelectMedia = (selectedPath: string) => {
    setMediaPath(selectedPath);
    const lastPart = selectedPath.split(/[\\/]/).pop() || '';
    const cleanName = lastPart.replace(/\.[^/.]+$/, '').replace(/[._]/g, ' ');
    if (!mediaTitle.trim()) {
      setMediaTitle(cleanName);
    }
  };

  const handleAddMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    setMediaErrorMsg('');
    setMediaSuccessMsg('');
    setIsAddingMedia(true);

    try {
      if (mediaAddMode === 'MOVIE') {
        const res = await apiClient.post('/libraries/add-file', {
          filePath: mediaPath.trim(),
          title: mediaTitle.trim() || undefined,
          type: 'MOVIE',
          libraryId: mediaLibId || undefined,
        });
        setMediaSuccessMsg(`Фильм «${res.data.mediaItem?.title || 'Фильм'}» успешно добавлен!`);
      } else {
        const res = await apiClient.post('/libraries/add-show-folder', {
          folderPath: mediaPath.trim(),
          showTitle: mediaTitle.trim() || undefined,
          libraryId: mediaLibId || undefined,
        });
        setMediaSuccessMsg(res.data.message || 'Сериал успешно добавлен!');
      }

      setMediaPath('');
      setMediaTitle('');
      setTimeout(() => {
        setShowAddMediaModal(false);
        setMediaSuccessMsg('');
      }, 1500);
      fetchLibraries();
    } catch (err: any) {
      setMediaErrorMsg(err.response?.data?.error || 'Ошибка добавления медиа');
    } finally {
      setIsAddingMedia(false);
    }
  };

  const handleDeleteLibrary = async (id: string) => {
    if (!confirm('Вы уверены, что хотите удалить эту библиотеку? Медиафайлы на диске не будут затронуты.')) return;
    try {
      await apiClient.delete(`/libraries/${id}`);
      fetchLibraries();
    } catch (err) {}
  };

  const handleScanLibrary = async (id: string) => {
    try {
      await apiClient.post(`/libraries/${id}/scan`);
      fetchScanStatus();
    } catch (err) {}
  };

  const handleScanAll = async () => {
    try {
      await apiClient.post('/libraries/scan-all');
      fetchScanStatus();
    } catch (err) {}
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-3xl bg-cinema-900 border border-white/10">
        <div>
          <h3 className="text-base font-bold text-white">Папки и библиотеки медиа</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Укажите пути к локальным папкам с фильмами и сериалами на сервере
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleScanAll}
            disabled={scanStatus.isScanning}
            className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 border border-white/10 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanStatus.isScanning ? 'animate-spin' : ''}`} />
            <span>{scanStatus.isScanning ? 'Сканирование...' : 'Сканировать всё'}</span>
          </button>

          <button
            onClick={() => {
              setMediaErrorMsg('');
              setMediaSuccessMsg('');
              setShowAddMediaModal(true);
            }}
            className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 border border-white/15 backdrop-blur-md transition-all"
          >
            <Film className="w-4 h-4 text-cinema-gold" />
            <span>+ Добавить фильм / сериал</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2.5 rounded-2xl bg-cinema-gold text-black text-xs font-bold flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all"
          >
            <FolderPlus className="w-4 h-4" />
            <span>+ Создать библиотеку</span>
          </button>
        </div>
      </div>

      {/* Live Scanning Banner */}
      {scanStatus.isScanning && (
        <div className="p-4 rounded-2xl bg-cinema-gold/10 border border-cinema-gold/30 flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-cinema-gold animate-spin" />
            <div>
              <span className="text-xs font-bold text-cinema-gold block">
                Сканирование библиотеки: {scanStatus.progress?.libraryName}
              </span>
              <span className="text-[11px] text-slate-300">
                Файл: {scanStatus.progress?.currentFile || 'Поиск файлов...'} ({scanStatus.progress?.scannedFiles} из {scanStatus.progress?.totalFiles})
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Libraries List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {libraries.length === 0 ? (
          <div className="col-span-2 p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
            <FolderPlus className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Нет настроенных библиотек</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Нажмите «Добавить папку», чтобы указать директорию с фильмами (например, D:/Movies)
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 rounded-xl bg-cinema-gold text-black text-xs font-bold"
            >
              Добавить первую библиотеку
            </button>
          </div>
        ) : (
          libraries.map((lib) => (
            <div
              key={lib.id}
              className="p-5 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col justify-between group hover:border-cinema-gold/40 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 rounded-2xl bg-cinema-gold/20 text-cinema-gold">
                    {lib.type === 'MOVIES' ? <Film className="w-5 h-5" /> : <Tv className="w-5 h-5" />}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">{lib.name}</h4>
                    <span className="text-[11px] text-cinema-gold font-semibold uppercase tracking-wider">
                      {lib.type === 'MOVIES' ? 'Фильмы' : 'Сериалы'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedLibForAccess({ id: lib.id, name: lib.name })}
                    className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-black border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1 active:scale-95"
                    title="Настроить доступ пользователей к этой библиотеке"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Доступ</span>
                  </button>

                  <button
                    onClick={() => handleScanLibrary(lib.id)}
                    className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition-colors"
                    title="Запустить сканирование этой папки"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteLibrary(lib.id)}
                    className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors"
                    title="Удалить библиотеку"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-white/10 flex flex-col gap-1 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Путь:</span>
                  <span className="font-mono text-slate-300 text-[11px] truncate max-w-[250px]">{lib.path}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Элементов в базе:</span>
                  <span className="font-semibold text-slate-200">{lib.itemCount || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[11px]">Последний скан:</span>
                  <span className="text-slate-400 text-[10px]">
                    {lib.lastScannedAt ? new Date(lib.lastScannedAt).toLocaleString() : 'Еще не сканировалась'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Library Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Добавление медиа-папки</h3>
            <p className="text-xs text-slate-400 mb-5">Укажите параметры и путь к папке на сервере</p>

            {errorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleAddLibrary} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Название библиотеки</label>
                <input
                  type="text"
                  required
                  placeholder="Например: Мои Фильмы 4K"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Тип контента</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setType('MOVIES')}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
                      type === 'MOVIES'
                        ? 'bg-cinema-gold text-black border-cinema-gold font-bold shadow-glow-gold'
                        : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Film className="w-4 h-4" />
                    <span>Фильмы</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setType('SHOWS')}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 border transition-all ${
                      type === 'SHOWS'
                        ? 'bg-cinema-gold text-black border-cinema-gold font-bold shadow-glow-gold'
                        : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Tv className="w-4 h-4" />
                    <span>Сериалы</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Путь к папке на диске</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Например: D:\Movies или C:\Media\Cinema"
                    value={folderPath}
                    onChange={(e) => setFolderPath(e.target.value)}
                    className="flex-1 bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFolderPickerForLib(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/30 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95"
                    title="Выбрать папку через проводник"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Обзор...</span>
                  </button>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Сервер поддерживает любые вложенные подпапки, MKV, MP4, AVI и другие форматы
                </span>
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all"
                >
                  Сохранить и сканировать
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Movie or Series Modal */}
      {showAddMediaModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-lg p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Добавление фильма или сериала</h3>
            <p className="text-xs text-slate-400 mb-4">
              Выберите видеофайл фильма или укажите целую папку с сериалом со всеми сезонами и сериями
            </p>

            {/* Kind Selector Tabs */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setMediaAddMode('MOVIE');
                  setMediaPath('');
                  setMediaTitle('');
                }}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 border transition-all ${
                  mediaAddMode === 'MOVIE'
                    ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Film className="w-4 h-4" />
                <span>Фильм (файл)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMediaAddMode('SHOW');
                  setMediaPath('');
                  setMediaTitle('');
                }}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 border transition-all ${
                  mediaAddMode === 'SHOW'
                    ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>Сериал (папка с сериями)</span>
              </button>
            </div>

            {mediaSuccessMsg && (
              <div className="p-3 mb-4 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{mediaSuccessMsg}</span>
              </div>
            )}

            {mediaErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{mediaErrorMsg}</span>
              </div>
            )}

            <form onSubmit={handleAddMedia} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {mediaAddMode === 'MOVIE' ? 'Прямой путь к видеофайлу фильма' : 'Путь к папке с сериалом'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder={
                      mediaAddMode === 'MOVIE'
                        ? 'Например: D:\\Downloads\\Avatar.2022.1080p.mkv'
                        : 'Например: D:\\Series\\Breaking Bad'
                    }
                    value={mediaPath}
                    onChange={(e) => setMediaPath(e.target.value)}
                    className="flex-1 bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMediaPicker(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/30 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95"
                    title={mediaAddMode === 'MOVIE' ? 'Выбрать видеофайл через проводник' : 'Выбрать папку сериала через проводник'}
                  >
                    {mediaAddMode === 'MOVIE' ? <Film className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
                    <span>Обзор...</span>
                  </button>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {mediaAddMode === 'MOVIE'
                    ? 'Поддерживаются: .mkv, .mp4, .avi, .mov, .webm, .ts и др.'
                    : '💡 Сервер автоматически найдёт все сезоны и серии внутри папки, упорядочит их и загрузит описания/постеры с TMDB.'}
                </span>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {mediaAddMode === 'MOVIE' ? 'Название фильма (необязательно)' : 'Название сериала (необязательно)'}
                </label>
                <input
                  type="text"
                  placeholder="Оставьте пустым для автоопределения"
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              {libraries.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1">В какую библиотеку добавить</label>
                  <select
                    value={mediaLibId}
                    onChange={(e) => setMediaLibId(e.target.value)}
                    className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold"
                  >
                    {libraries
                      .filter((lib) => (mediaAddMode === 'MOVIE' ? lib.type === 'MOVIES' : lib.type === 'SHOWS'))
                      .map((lib) => (
                        <option key={lib.id} value={lib.id}>
                          {lib.name} ({lib.type === 'MOVIES' ? 'Фильмы' : 'Сериалы'})
                        </option>
                      ))}
                    <option value="">Автоматически (создать или определить)</option>
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddMediaModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isAddingMedia || !mediaPath.trim()}
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {isAddingMedia ? (
                    'Анализ и добавление...'
                  ) : mediaAddMode === 'MOVIE' ? (
                    'Добавить фильм'
                  ) : (
                    'Добавить сериал со всеми сериями'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Library Access Modal */}
      <LibraryAccessModal
        libraryId={selectedLibForAccess?.id || null}
        libraryName={selectedLibForAccess?.name || ''}
        isOpen={!!selectedLibForAccess}
        onClose={() => setSelectedLibForAccess(null)}
      />

      {/* Folder Picker for Library Creation */}
      <FilePickerModal
        isOpen={showFolderPickerForLib}
        onClose={() => setShowFolderPickerForLib(false)}
        onSelect={handleSelectLibFolder}
        initialPath={folderPath || undefined}
        mode="folders"
        title="Выбор папки медиатеки"
      />

      {/* File/Folder Picker for Single Media Item (Movie File or Series Folder) */}
      <FilePickerModal
        isOpen={showMediaPicker}
        onClose={() => setShowMediaPicker(false)}
        onSelect={handleSelectMedia}
        initialPath={mediaPath || undefined}
        mode={mediaAddMode === 'MOVIE' ? 'files' : 'folders'}
        title={mediaAddMode === 'MOVIE' ? 'Выбор видеофайла фильма' : 'Выбор папки с сериалом'}
      />
    </div>
  );
};
