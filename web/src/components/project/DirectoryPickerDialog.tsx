import React, { useCallback, useEffect, useRef, useState } from 'react';
import { filesystemApi } from '../../api/filesystem';
import type { DirectoryBrowseResult, DirectoryEntry } from '../../types';
import { resolveProjectFolderIcon } from '../../utils/projectIcons';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

type DirectoryPickerDialogProps = {
  open: boolean;
  title: string;
  initialPath: string;
  confirmText?: string;
  description?: string;
  onClose: () => void;
  onConfirm: (payload: { path: string; name: string }) => Promise<void> | void;
};

function getDirectoryNameByPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '');
  if (!normalized) {
    return '/';
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

export const DirectoryPickerDialog: React.FC<DirectoryPickerDialogProps> = ({
  open,
  title,
  initialPath,
  confirmText = '确定',
  description,
  onClose,
  onConfirm,
}) => {
  const [pathInput, setPathInput] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadDirectories = useCallback(async (path: string): Promise<DirectoryBrowseResult | null> => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const data = await filesystemApi.listDirectories(path);
      if (requestIdRef.current !== requestId) {
        return null;
      }
      setCurrentPath(data.currentPath);
      setParentPath(data.parentPath);
      setPathInput(data.currentPath);
      setDirectories(data.directories);
      setSelectedPath(data.currentPath);
      return data;
    } catch (loadError: any) {
      if (requestIdRef.current !== requestId) {
        return null;
      }
      setError(loadError?.message ?? '读取目录失败');
      return null;
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const normalizedPath = initialPath.trim() || '~/';
    setPathInput(normalizedPath);
    setSelectedPath(null);
    void loadDirectories(normalizedPath);
  }, [open, initialPath, loadDirectories]);

  const handleOpenPath = async (path: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      setError('请输入路径。');
      return;
    }
    await loadDirectories(normalizedPath);
  };

  const handleConfirm = async () => {
    const normalizedPath = pathInput.trim();
    if (!normalizedPath) {
      setError('请输入路径。');
      return;
    }

    setConfirming(true);
    try {
      const resolved = await loadDirectories(normalizedPath);
      const finalPath = resolved?.currentPath;
      if (!finalPath) {
        return;
      }
      await onConfirm({
        path: finalPath,
        name: getDirectoryNameByPath(finalPath),
      });
    } finally {
      setConfirming(false);
    }
  };

  const normalizedPathInput = pathInput.trim();
  const hasInvalidPathInput = Boolean(error) && normalizedPathInput !== currentPath;
  const disableConfirmButton = loading || confirming || !normalizedPathInput || hasInvalidPathInput;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (confirming) {
          return;
        }
        onClose();
      }}
      title={title}
      size="2xl"
    >
      <div className="space-y-3">
        {description && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
        )}

        <div className="flex items-center gap-2">
          <input
            value={pathInput}
            onChange={(event) => {
              setPathInput(event.target.value);
              setSelectedPath(null);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return;
              }
              event.preventDefault();
              void handleOpenPath(pathInput);
            }}
            disabled={loading || confirming}
            className="h-10 min-w-0 flex-1 rounded-md border border-[rgb(209,209,209)] bg-white px-3 text-sm text-[rgb(13,13,13)] outline-none transition-colors placeholder:text-[rgb(143,143,143)] focus:border-[rgb(148,163,184)] dark:border-slate-700 dark:bg-[#2f2f2f] dark:text-slate-100"
            placeholder="请输入目录绝对路径"
          />
          <Button
            type="button"
            onClick={() => {
              void handleConfirm();
            }}
            disabled={disableConfirmButton}
          >
            {confirming ? '处理中...' : confirmText}
          </Button>
        </div>

        {error && (
          <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-900/20 dark:text-rose-300">
            {error}
          </p>
        )}

        <div className="max-h-[420px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-2 dark:border-slate-700 dark:bg-[#242424]">
          <button
            type="button"
            disabled={!parentPath || loading || confirming}
            onClick={() => {
              if (!parentPath) {
                return;
              }
              void handleOpenPath(parentPath);
            }}
            className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(245,245,245)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-slate-100 dark:hover:bg-[#2a2a2a]"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center text-slate-500">..</span>
            <span>返回上一级</span>
          </button>

          {loading ? (
            <p className="px-2 py-1 text-sm text-slate-400">正在加载目录...</p>
          ) : directories.length === 0 ? (
            <p className="px-2 py-1 text-sm text-slate-400">当前目录下没有子目录。</p>
          ) : (
            <div className="space-y-0.5">
              {directories.map((directory) => {
                const iconUrl = resolveProjectFolderIcon(directory.name, false);
                const isSelected = selectedPath === directory.absolutePath;
                return (
                  <button
                    key={directory.absolutePath}
                    type="button"
                    onClick={() => {
                      setPathInput(directory.absolutePath);
                      setSelectedPath(directory.absolutePath);
                      setError(null);
                    }}
                    onDoubleClick={() => {
                      void handleOpenPath(directory.absolutePath);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-[rgb(13,13,13)] transition-colors dark:text-slate-100 ${
                      isSelected
                        ? 'bg-[rgb(245,245,245)] dark:bg-[#2a2a2a]'
                        : 'hover:bg-[rgb(245,245,245)] dark:hover:bg-[#2a2a2a]'
                    }`}
                    title={directory.absolutePath}
                  >
                    {iconUrl ? (
                      <img src={iconUrl} alt="" className="h-4 w-4 shrink-0" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-200" />
                    )}
                    <span className="truncate">{directory.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-md bg-[rgb(245,245,245)] px-3 py-2 text-xs text-slate-500 dark:bg-[#2a2a2a] dark:text-slate-400">
          当前路径：<span className="font-medium text-slate-700 dark:text-slate-200">{currentPath || '-'}</span>
        </div>
      </div>
    </Dialog>
  );
};
