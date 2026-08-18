import React, { useState, useEffect } from 'react';
import {
  X,
  Folder,
  Film,
  HardDrive,
  ChevronRight,
  ArrowUp,
  Search,
  Check,
  FolderPlus,
  Tv,
} from 'lucide-react';
import { apiClient } from '../../api/client';

interface FilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selectedPath: string) => void;
  initialPath?: string;
  mode?: 'folders' | 'files' | 'all';
  title?: string;
}

export const FilePickerModal: React.FC<FilePickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  initialPath,
  mode = 'folders',
  title = 'Выбор папки на сервере',
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [drives, setDrives] = useState<string[]>([]);
  const [directories, setDirectories] = useState<{ name: string; path: string }[]>([]);
  const [files, setFiles] = useState<{ name: string; path: string; size: number; isVideo: boolean }[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const fetchPath = (targetPath?: string) => {
    setLoading(true);
    setSelectedFilePath(null);
    apiClient.get('/admin/fs/browse', {
      params: {
        path: targetPath || undefined,
        mode,
      },
    })
      .then((res) => {
        setCurrentPath(res.data.currentPath || '');
        setParentPath(res.data.parentPath || null);
        setDrives(res.data.drives || []);
        setDirectories(res.data.directories || []);
        setFiles(res.data.files || []);
      })
      .catch((err) => {
        console.error('FS browse error:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    if (isOpen) {
      fetchPath(initialPath);
    }
  }, [isOpen, initialPath, mode]);

  if (!isOpen) return null;

  const handleDriveClick = (drive: string) => {
    fetchPath(drive);
  };

  const handleDirClick = (dirPath: string) => {
    fetchPath(dirPath);
  };

  const handleUpClick = () => {
    if (parentPath) {
      fetchPath(parentPath);
    }
  };

  const handleSelectCurrentFolder = () => {
    onSelect(currentPath);
    onClose();
  };

  const handleSelectFile = (filePath: string) => {
    onSelect(filePath);
    onClose();
  };

  // Format breadcrumbs: e.g. "D:\Movies\Action" -> parts
  const pathParts = currentPath
    ? currentPath.split(/[\\/]/).filter(Boolean)
    : [];

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} ГБ`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} МБ`;
  };

  const filteredDirs = directories.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-3xl bg-cinema-900 border border-white/10 p-6 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cinema-gold/20 flex items-center justify-center text-cinema-gold border border-cinema-gold/30">
              {mode === 'files' ? <Film className="w-5 h-5" /> : <FolderPlus className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">{title}</h3>
              <p className="text-xs text-slate-400">
                {mode === 'files'
                  ? 'Выберите видеофайл (.mkv, .mp4, .avi) для добавления'
                  : 'Выберите каталог на диске сервера'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drives Row */}
        {drives.length > 0 && (
          <div className="flex items-center gap-2 mt-3 shrink-0 overflow-x-auto pb-1">
            <span className="text-[11px] font-semibold text-slate-400 shrink-0 mr-1 flex items-center gap-1">
              <HardDrive className="w-3.5 h-3.5 text-cinema-gold" /> Диски:
            </span>
            {drives.map((drive) => {
              const isActive = currentPath.toUpperCase().startsWith(drive.toUpperCase().replace(/\\$/, ''));
              return (
                <button
                  key={drive}
                  onClick={() => handleDriveClick(drive)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 border ${
                    isActive
                      ? 'bg-cinema-gold text-black border-cinema-gold shadow-glow-gold'
                      : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>{drive}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Breadcrumb & Up Button */}
        <div className="flex items-center gap-2 mt-3 p-2.5 rounded-2xl bg-black/40 border border-white/10 shrink-0 overflow-hidden">
          <button
            onClick={handleUpClick}
            disabled={!parentPath}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition-colors shrink-0"
            title="На уровень выше"
          >
            <ArrowUp className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-1 overflow-x-auto text-xs text-slate-300 font-mono scrollbar-none">
            {pathParts.map((part, index) => {
              // Construct subpath
              const isWindowsDrive = index === 0 && /^[A-Za-z]:$/.test(part);
              let subPath = '';
              if (isWindowsDrive) {
                subPath = `${part}\\`;
              } else {
                subPath = (pathParts[0].includes(':') ? pathParts[0] + '\\' : '/') + pathParts.slice(1, index + 1).join('\\');
              }

              const isLast = index === pathParts.length - 1;

              return (
                <React.Fragment key={index}>
                  {index > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                  <button
                    onClick={() => fetchPath(subPath)}
                    className={`px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors shrink-0 ${
                      isLast ? 'text-cinema-gold font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {part}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="my-2.5 shrink-0">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Фильтр в текущей папке..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cinema-gold"
            />
          </div>
        </div>

        {/* Directory & File List */}
        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-1.5 min-h-[220px]">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-xs">
              <div className="w-5 h-5 border-2 border-cinema-gold/30 border-t-cinema-gold rounded-full animate-spin mr-2" />
              Чтение файловой системы...
            </div>
          ) : filteredDirs.length === 0 && filteredFiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs">
              <Folder className="w-8 h-8 text-slate-600 mb-2 opacity-50" />
              <span>Папка пуста или нет подходящих элементов</span>
            </div>
          ) : (
            <>
              {/* Directories */}
              {filteredDirs.map((dir) => (
                <div
                  key={dir.path}
                  onClick={() => handleDirClick(dir.path)}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-cinema-gold/30 flex items-center justify-between cursor-pointer group transition-all"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 group-hover:bg-amber-500/20 transition-colors">
                      <Folder className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-semibold text-white truncate">{dir.name}</span>
                  </div>

                  <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-cinema-gold group-hover:translate-x-0.5 transition-all shrink-0" />
                </div>
              ))}

              {/* Files */}
              {filteredFiles.map((file) => {
                const isSelected = selectedFilePath === file.path;
                return (
                  <div
                    key={file.path}
                    onClick={() => setSelectedFilePath(file.path)}
                    onDoubleClick={() => handleSelectFile(file.path)}
                    className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-cinema-gold/15 border-cinema-gold text-white'
                        : 'bg-white/5 hover:bg-white/10 border-white/5 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                        <Film className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-medium truncate block">{file.name}</span>
                        {file.size > 0 && (
                          <span className="text-[10px] text-slate-400 block font-mono">
                            {formatFileSize(file.size)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 ml-2">
                      <div
                        className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-cinema-gold border-cinema-gold text-black'
                            : 'border-white/20 bg-black/40 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 mt-3 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="text-[11px] text-slate-400 truncate max-w-full sm:max-w-[320px] font-mono">
            {selectedFilePath ? (
              <span className="text-cinema-gold">Файл: {selectedFilePath}</span>
            ) : (
              <span>Папка: {currentPath}</span>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 text-xs font-semibold transition-colors"
            >
              Отмена
            </button>

            {mode === 'files' ? (
              <button
                onClick={() => selectedFilePath && handleSelectFile(selectedFilePath)}
                disabled={!selectedFilePath}
                className="px-5 py-2 rounded-xl bg-cinema-gold text-black font-bold text-xs shadow-glow-gold hover:bg-yellow-400 active:scale-95 transition-all disabled:opacity-40"
              >
                Выбрать файл
              </button>
            ) : (
              <button
                onClick={handleSelectCurrentFolder}
                disabled={!currentPath}
                className="px-5 py-2 rounded-xl bg-cinema-gold text-black font-bold text-xs shadow-glow-gold hover:bg-yellow-400 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>Выбрать эту папку</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
