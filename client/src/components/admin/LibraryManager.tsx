import React, { useState, useEffect } from 'react';
import {
  FolderPlus, Trash2, RefreshCw, Film, Tv, Video,
  CheckCircle2, AlertCircle, Lock, FolderOpen, FileVideo, Plus
} from 'lucide-react';
import { apiClient } from '../../api/client';
import { Library } from '../../types';
import { LibraryAccessModal } from './LibraryAccessModal';
import { FilePickerModal } from './FilePickerModal';

export const LibraryManager: React.FC = () => {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddLibModal, setShowAddLibModal] = useState(false);
  const [scanStatus, setScanStatus] = useState<any>({ isScanning: false });
  const [selectedLibForAccess, setSelectedLibForAccess] = useState<{ id: string; name: string } | null>(null);

  // Form State (Create Library)
  const [libName, setLibName] = useState('');
  const [libType, setLibType] = useState<'MOVIES' | 'SHOWS' | 'VIDEOS'>('MOVIES');
  const [libPath, setLibPath] = useState('');
  const [showFolderPickerForNewLib, setShowFolderPickerForNewLib] = useState(false);
  const [libErrorMsg, setLibErrorMsg] = useState('');
  const [libSuccessMsg, setLibSuccessMsg] = useState('');
  const [isCreatingLib, setIsCreatingLib] = useState(false);

  // Add Folder to existing Library state
  const [targetLibForFolder, setTargetLibForFolder] = useState<Library | null>(null);
  const [showFolderPickerForExistingLib, setShowFolderPickerForExistingLib] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Form State (+ Add Media: Movie file / Series folder / Video file)
  const [showAddMediaModal, setShowAddMediaModal] = useState(false);
  const [mediaAddMode, setMediaAddMode] = useState<'MOVIE' | 'SHOW' | 'VIDEO'>('MOVIE');
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
        const libs: Library[] = res.data.libraries || [];
        setLibraries(libs);
        if (libs.length > 0 && !mediaLibId) {
          setMediaLibId(libs[0].id);
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

  const handleCreateLibrary = async (e: React.FormEvent) => {
    e.preventDefault();
    setLibErrorMsg('');
    setLibSuccessMsg('');
    setIsCreatingLib(true);

    try {
      await apiClient.post('/libraries', {
        name: libName.trim(),
        type: libType,
        path: libPath.trim() || undefined,
      });

      setLibSuccessMsg('Библиотека успешно создана!');
      setLibName('');
      setLibPath('');
      setTimeout(() => {
        setShowAddLibModal(false);
        setLibSuccessMsg('');
      }, 1000);
      fetchLibraries();
    } catch (err: any) {
      setLibErrorMsg(err.response?.data?.error || 'Ошибка создания библиотеки');
    } finally {
      setIsCreatingLib(false);
    }
  };

  const handleAddFolderToLibrary = async (selectedFolderPath: string) => {
    if (!targetLibForFolder) return;
    setActionNotice(null);

    try {
      const res = await apiClient.post('/libraries/add-folder', {
        libraryId: targetLibForFolder.id,
        folderPath: selectedFolderPath.trim(),
      });
      setActionNotice({
        type: 'success',
        msg: res.data.message || `Папка успешно добавлена в библиотеку «${targetLibForFolder.name}»!`,
      });
      fetchLibraries();
      fetchScanStatus();
    } catch (err: any) {
      setActionNotice({
        type: 'error',
        msg: err.response?.data?.error || 'Ошибка добавления папки в библиотеку',
      });
    } finally {
      setTargetLibForFolder(null);
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
      } else if (mediaAddMode === 'SHOW') {
        const res = await apiClient.post('/libraries/add-show-folder', {
          folderPath: mediaPath.trim(),
          showTitle: mediaTitle.trim() || undefined,
          libraryId: mediaLibId || undefined,
        });
        setMediaSuccessMsg(res.data.message || 'Сериал успешно добавлен!');
      } else {
        // VIDEO
        const res = await apiClient.post('/libraries/add-file', {
          filePath: mediaPath.trim(),
          title: mediaTitle.trim() || undefined,
          type: 'VIDEO',
          libraryId: mediaLibId || undefined,
        });
        setMediaSuccessMsg(`Видео «${res.data.mediaItem?.title || 'Видео'}» успешно добавлено!`);
      }

      setMediaPath('');
      setMediaTitle('');
      setTimeout(() => {
        setShowAddMediaModal(false);
        setMediaSuccessMsg('');
      }, 1500);
      fetchLibraries();
    } catch (err: any) {
      setMediaErrorMsg(err.response?.data?.error || 'Ошибка добавления контента');
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
    } catch (err: any) {
      alert(err.response?.data?.error || 'Ошибка сканирования');
    }
  };

  const handleScanAll = async () => {
    try {
      await apiClient.post('/libraries/scan-all');
      fetchScanStatus();
    } catch (err) {}
  };

  const getLibraryIcon = (type: string) => {
    switch (type) {
      case 'SHOWS':
        return Tv;
      case 'VIDEOS':
        return Video;
      case 'MOVIES':
      default:
        return Film;
    }
  };

  const getLibraryTypeLabel = (type: string) => {
    switch (type) {
      case 'SHOWS':
        return 'Сериалы';
      case 'VIDEOS':
        return 'Обычные видео';
      case 'MOVIES':
      default:
        return 'Фильмы';
    }
  };

  // Filter libraries matching current mediaAddMode
  const filteredLibrariesForAdd = libraries.filter((lib) => {
    if (mediaAddMode === 'MOVIE') return lib.type === 'MOVIES';
    if (mediaAddMode === 'SHOW') return lib.type === 'SHOWS';
    return lib.type === 'VIDEOS';
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-6 rounded-3xl bg-cinema-900 border border-white/10">
        <div>
          <h3 className="text-base font-bold text-white">Управление библиотеками и контентом</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Создавайте библиотеки без привязки к папкам, а затем добавляйте папки или отдельные файлы
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleScanAll}
            disabled={scanStatus.isScanning}
            className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 border border-white/10 transition-colors disabled:opacity-50 cursor-pointer"
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
            className="px-4 py-2.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-2 border border-white/15 backdrop-blur-md transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 text-cinema-gold" />
            <span>+ Добавить контент</span>
          </button>

          <button
            onClick={() => {
              setLibErrorMsg('');
              setLibSuccessMsg('');
              setShowAddLibModal(true);
            }}
            className="px-4 py-2.5 rounded-2xl bg-cinema-gold text-black text-xs font-bold flex items-center gap-2 shadow-glow-gold hover:bg-yellow-400 transition-all cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>+ Создать библиотеку</span>
          </button>
        </div>
      </div>

      {/* Action Notice Alert Banner */}
      {actionNotice && (
        <div
          className={`p-4 rounded-2xl border text-xs flex items-center justify-between gap-3 ${
            actionNotice.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center gap-2">
            {actionNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            )}
            <span>{actionNotice.msg}</span>
          </div>
          <button
            onClick={() => setActionNotice(null)}
            className="text-slate-400 hover:text-white text-xs font-bold"
          >
            ✕
          </button>
        </div>
      )}

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

      {/* Libraries Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading ? (
          <div className="col-span-2 p-12 flex justify-center items-center">
            <div className="w-8 h-8 border-2 border-cinema-gold/20 border-t-cinema-gold rounded-full animate-spin"></div>
          </div>
        ) : libraries.length === 0 ? (
          <div className="col-span-2 p-12 rounded-3xl bg-cinema-900 border border-white/10 text-center text-slate-400">
            <FolderPlus className="w-12 h-12 text-cinema-gold/40 mx-auto mb-3" />
            <h4 className="text-sm font-bold text-white mb-1">Медиатека пуста</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              Нажмите «Создать библиотеку», выберите тип (Фильмы, Сериалы или Обычные видео) и наполняйте её
            </p>
            <button
              onClick={() => setShowAddLibModal(true)}
              className="px-4 py-2 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 cursor-pointer"
            >
              Создать первую библиотеку
            </button>
          </div>
        ) : (
          libraries.map((lib) => {
            const Icon = getLibraryIcon(lib.type);
            const typeLabel = getLibraryTypeLabel(lib.type);

            return (
              <div
                key={lib.id}
                className="p-5 rounded-3xl bg-cinema-900 border border-white/10 flex flex-col justify-between group hover:border-cinema-gold/40 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 rounded-2xl bg-cinema-gold/20 text-cinema-gold">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">{lib.name}</h4>
                        <span className="text-[11px] text-cinema-gold font-semibold uppercase tracking-wider">
                          {typeLabel}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedLibForAccess({ id: lib.id, name: lib.name })}
                        className="px-2.5 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500 text-amber-300 hover:text-black border border-amber-500/30 text-xs font-bold transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                        title="Настроить доступ пользователей к этой библиотеке"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Доступ</span>
                      </button>

                      {lib.path && (
                        <button
                          onClick={() => handleScanLibrary(lib.id)}
                          className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer"
                          title="Запустить повторное сканирование папки"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={() => handleDeleteLibrary(lib.id)}
                        className="p-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer"
                        title="Удалить библиотеку"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Info details */}
                  <div className="mt-4 pt-3 border-t border-white/10 flex flex-col gap-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Основная папка:</span>
                      {lib.path ? (
                        <span className="font-mono text-slate-300 text-[11px] truncate max-w-[240px]" title={lib.path}>
                          {lib.path}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">Не привязана</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 text-[11px]">Элементов в базе:</span>
                      <span className="font-semibold text-slate-200">{lib.itemCount || 0}</span>
                    </div>
                    {lib.lastScannedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 text-[11px]">Последний скан:</span>
                        <span className="text-slate-400 text-[10px]">
                          {new Date(lib.lastScannedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Library Quick Action Toolbar */}
                <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2">
                  <button
                    onClick={() => {
                      setTargetLibForFolder(lib);
                      setShowFolderPickerForExistingLib(true);
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-cinema-gold/10 hover:bg-cinema-gold hover:text-black text-cinema-gold font-bold text-xs flex items-center justify-center gap-1.5 border border-cinema-gold/30 transition-all cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>+ Добавить папку</span>
                  </button>

                  <button
                    onClick={() => {
                      setMediaLibId(lib.id);
                      if (lib.type === 'SHOWS') setMediaAddMode('SHOW');
                      else if (lib.type === 'VIDEOS') setMediaAddMode('VIDEO');
                      else setMediaAddMode('MOVIE');
                      setShowAddMediaModal(true);
                    }}
                    className="flex-1 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/15 text-slate-200 font-bold text-xs flex items-center justify-center gap-1.5 border border-white/10 transition-all cursor-pointer"
                  >
                    <FileVideo className="w-3.5 h-3.5 text-cinema-gold" />
                    <span>+ Добавить файл</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Create Library */}
      {showAddLibModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Создание библиотеки</h3>
            <p className="text-xs text-slate-400 mb-5">
              Укажите название и тип медиатеки. Папки или файлы можно прикрепить сейчас или в любой момент позже.
            </p>

            {libErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{libErrorMsg}</span>
              </div>
            )}

            {libSuccessMsg && (
              <div className="p-3 mb-4 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{libSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleCreateLibrary} className="flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Название библиотеки</label>
                <input
                  type="text"
                  required
                  placeholder="Например: Фильмы, Сериалы или Личные видео"
                  value={libName}
                  onChange={(e) => setLibName(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">Тип контента</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setLibType('MOVIES')}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-1 border transition-all cursor-pointer ${
                      libType === 'MOVIES'
                        ? 'bg-cinema-gold text-black border-cinema-gold font-bold shadow-glow-gold'
                        : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Film className="w-4 h-4" />
                    <span>Фильмы</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLibType('SHOWS')}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-1 border transition-all cursor-pointer ${
                      libType === 'SHOWS'
                        ? 'bg-cinema-gold text-black border-cinema-gold font-bold shadow-glow-gold'
                        : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Tv className="w-4 h-4" />
                    <span>Сериалы</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLibType('VIDEOS')}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex flex-col items-center justify-center gap-1 border transition-all cursor-pointer ${
                      libType === 'VIDEOS'
                        ? 'bg-cinema-gold text-black border-cinema-gold font-bold shadow-glow-gold'
                        : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Video className="w-4 h-4" />
                    <span>Обычные видео</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Путь к папке на сервере <span className="text-slate-500 font-normal">(необязательно)</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Например: D:\Movies или оставьте пустым"
                    value={libPath}
                    onChange={(e) => setLibPath(e.target.value)}
                    className="flex-1 bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowFolderPickerForNewLib(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/30 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
                    title="Выбрать папку через проводник"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Обзор...</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddLibModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isCreatingLib}
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isCreatingLib ? 'Создание...' : 'Создать библиотеку'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Add Media Item or Show Folder */}
      {showAddMediaModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-cinema-900 border border-white/15 rounded-3xl w-full max-w-lg p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-1">Добавление контента</h3>
            <p className="text-xs text-slate-400 mb-4">
              Выберите видеофайл фильма, ролика или укажите целую папку с сериалом
            </p>

            {/* Mode Tabs */}
            <div className="grid grid-cols-3 gap-2 mb-4">
              <button
                type="button"
                onClick={() => {
                  setMediaAddMode('MOVIE');
                  setMediaPath('');
                  setMediaTitle('');
                }}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
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
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                  mediaAddMode === 'SHOW'
                    ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Tv className="w-4 h-4" />
                <span>Сериал (папка)</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMediaAddMode('VIDEO');
                  setMediaPath('');
                  setMediaTitle('');
                }}
                className={`py-2.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer ${
                  mediaAddMode === 'VIDEO'
                    ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                    : 'bg-cinema-950 text-slate-400 border-white/10 hover:text-white'
                }`}
              >
                <Video className="w-4 h-4" />
                <span>Видео (файл)</span>
              </button>
            </div>

            {mediaErrorMsg && (
              <div className="p-3 mb-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{mediaErrorMsg}</span>
              </div>
            )}

            {mediaSuccessMsg && (
              <div className="p-3 mb-4 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{mediaSuccessMsg}</span>
              </div>
            )}

            <form onSubmit={handleAddMedia} className="flex flex-col gap-4">
              {/* Target Library Selector */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Целевая библиотека
                </label>
                {filteredLibrariesForAdd.length === 0 ? (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
                    Нет созданных библиотек для типа «{getLibraryTypeLabel(mediaAddMode === 'MOVIE' ? 'MOVIES' : (mediaAddMode === 'SHOW' ? 'SHOWS' : 'VIDEOS'))}». Создайте библиотеку сначала.
                  </div>
                ) : (
                  <select
                    value={mediaLibId}
                    onChange={(e) => setMediaLibId(e.target.value)}
                    className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cinema-gold cursor-pointer"
                  >
                    {filteredLibrariesForAdd.map((lib) => (
                      <option key={lib.id} value={lib.id}>
                        {lib.name} ({getLibraryTypeLabel(lib.type)})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Path Input */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  {mediaAddMode === 'SHOW' ? 'Путь к папке с сериалом' : 'Путь к видеофайлу'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder={
                      mediaAddMode === 'SHOW'
                        ? 'Например: D:\\Serials\\Reign'
                        : 'Например: D:\\Movies\\Inception.mkv'
                    }
                    value={mediaPath}
                    onChange={(e) => setMediaPath(e.target.value)}
                    className="flex-1 bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowMediaPicker(true)}
                    className="px-3.5 py-2.5 rounded-xl bg-cinema-gold/15 hover:bg-cinema-gold text-cinema-gold hover:text-black border border-cinema-gold/30 text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 active:scale-95 cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Обзор...</span>
                  </button>
                </div>
              </div>

              {/* Title input */}
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Название <span className="text-slate-500 font-normal">(необязательно, определится автоматически)</span>
                </label>
                <input
                  type="text"
                  placeholder={
                    mediaAddMode === 'SHOW'
                      ? 'Например: Царство'
                      : 'Например: Начало'
                  }
                  value={mediaTitle}
                  onChange={(e) => setMediaTitle(e.target.value)}
                  className="w-full bg-cinema-950 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cinema-gold"
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAddMediaModal(false)}
                  className="px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isAddingMedia || !mediaPath.trim()}
                  className="px-5 py-2.5 rounded-xl bg-cinema-gold text-black text-xs font-bold shadow-glow-gold hover:bg-yellow-400 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isAddingMedia ? 'Обработка...' : 'Добавить'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* File Picker Modals */}
      {showFolderPickerForNewLib && (
        <FilePickerModal
          isOpen={showFolderPickerForNewLib}
          onClose={() => setShowFolderPickerForNewLib(false)}
          onSelect={(selPath) => {
            setLibPath(selPath);
            if (!libName.trim()) {
              const parts = selPath.split(/[\\/]/).filter(Boolean);
              const last = parts[parts.length - 1];
              if (last && !last.endsWith(':')) setLibName(last);
            }
            setShowFolderPickerForNewLib(false);
          }}
          mode="folders"
          title="Выбор папки для новой библиотеки"
        />
      )}

      {showFolderPickerForExistingLib && targetLibForFolder && (
        <FilePickerModal
          isOpen={showFolderPickerForExistingLib}
          onClose={() => {
            setShowFolderPickerForExistingLib(false);
            setTargetLibForFolder(null);
          }}
          onSelect={(selPath) => {
            setShowFolderPickerForExistingLib(false);
            handleAddFolderToLibrary(selPath);
          }}
          mode="folders"
          title={`Добавление папки в библиотеку «${targetLibForFolder.name}»`}
        />
      )}

      {showMediaPicker && (
        <FilePickerModal
          isOpen={showMediaPicker}
          onClose={() => setShowMediaPicker(false)}
          onSelect={(selPath) => {
            handleSelectMedia(selPath);
            setShowMediaPicker(false);
          }}
          mode={mediaAddMode === 'SHOW' ? 'folders' : 'files'}
          title={mediaAddMode === 'SHOW' ? 'Выбор папки с сериалом' : 'Выбор видеофайла'}
        />
      )}

      {/* Library User Access Modal */}
      {selectedLibForAccess && (
        <LibraryAccessModal
          libraryId={selectedLibForAccess.id}
          libraryName={selectedLibForAccess.name}
          isOpen={!!selectedLibForAccess}
          onClose={() => setSelectedLibForAccess(null)}
        />
      )}
    </div>
  );
};
