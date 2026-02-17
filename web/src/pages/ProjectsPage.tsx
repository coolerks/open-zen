import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Button } from '../components/ui/Button';
import { useProjectStore } from '../store/projectStore';
import { useThemeStore } from '../store/themeStore';
import { resolveMonacoLanguageByFileName, resolveProjectFileIcon, resolveProjectFolderIcon } from '../utils/projectIcons';
import type { ProjectItem } from '../types';

type ExplorerEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
};

type ProjectsPageProps = {
  routeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onRequestCreateProject: () => void;
  onBackToChat: () => void;
};

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'zip',
  '7z',
  'rar',
  'gz',
  'tar',
  'mp3',
  'mp4',
  'mov',
  'avi',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'exe',
  'dll',
  'so',
  'dylib',
]);

const PROJECT_EXPLORER_WIDTH_STORAGE_KEY = 'project.explorer.width';
const PROJECT_EXPLORER_COLLAPSED_STORAGE_KEY = 'project.explorer.collapsed';
const PROJECT_EXPLORER_MIN_WIDTH = 220;
const PROJECT_EXPLORER_MAX_WIDTH = 640;

function readStoredExplorerWidth(): number {
  if (typeof window === 'undefined') {
    return 320;
  }
  const raw = window.localStorage.getItem(PROJECT_EXPLORER_WIDTH_STORAGE_KEY);
  if (!raw) {
    return 320;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return 320;
  }
  return Math.min(PROJECT_EXPLORER_MAX_WIDTH, Math.max(PROJECT_EXPLORER_MIN_WIDTH, parsed));
}

function readStoredExplorerCollapsed(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.localStorage.getItem(PROJECT_EXPLORER_COLLAPSED_STORAGE_KEY) === '1';
}

function sortExplorerEntries(entries: ExplorerEntry[]): ExplorerEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' });
  });
}

function joinPath(parentPath: string, name: string): string {
  if (!parentPath) {
    return name;
  }
  return `${parentPath}/${name}`;
}

async function ensureDirectoryReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    if (typeof handle.queryPermission === 'function') {
      const status = await handle.queryPermission({ mode: 'read' });
      if (status === 'granted') {
        return true;
      }
    }

    if (typeof handle.requestPermission === 'function') {
      const requested = await handle.requestPermission({ mode: 'read' });
      return requested === 'granted';
    }

    return true;
  } catch {
    // 某些浏览器没有实现权限 API，默认尝试继续读取。
    return true;
  }
}

async function resolveDirectoryHandleByPath(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  let current = rootHandle;
  const segments = path.split('/').filter(Boolean);
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

async function resolveFileHandleByPath(
  rootHandle: FileSystemDirectoryHandle,
  filePath: string,
): Promise<FileSystemFileHandle> {
  const segments = filePath.split('/').filter(Boolean);
  if (segments.length === 0) {
    throw new Error('无效文件路径');
  }
  const fileName = segments.pop() as string;
  let current = rootHandle;
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current.getFileHandle(fileName);
}

async function readDirectoryEntries(
  rootHandle: FileSystemDirectoryHandle,
  directoryPath: string,
): Promise<ExplorerEntry[]> {
  const directoryHandle = await resolveDirectoryHandleByPath(rootHandle, directoryPath);
  const entries: ExplorerEntry[] = [];
  const iterator = directoryHandle.entries?.();
  if (!iterator) {
    throw new Error('当前浏览器不支持目录遍历，请升级浏览器后重试。');
  }

  // 通过浏览器文件系统 API 读取目录项。
  for await (const [name, handle] of iterator) {
    entries.push({
      name,
      path: joinPath(directoryPath, name),
      kind: handle.kind,
    });
  }

  return sortExplorerEntries(entries);
}

function isLikelyBinaryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const extension = lower.includes('.') ? lower.split('.').pop() ?? '' : '';
  return BINARY_EXTENSIONS.has(extension);
}

const TreeChevronIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
    viewBox="0 0 20 20"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M7.5 5.5L12.5 10L7.5 14.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const BackToChatIcon: React.FC = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9.2 5.2L4.4 10L9.2 14.8" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.9 10H16.2" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M15.5 6.7V3.9M15.5 3.9H12.7M15.5 3.9L13.5 5.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.5 13.3V16.1M4.5 16.1H7.3M4.5 16.1L6.5 14.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6.8 6.2C7.6 5.2 8.8 4.5 10.2 4.5C12.8 4.5 14.9 6.6 14.9 9.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M13.2 13.8C12.4 14.8 11.2 15.5 9.8 15.5C7.2 15.5 5.1 13.4 5.1 10.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const FolderSelectIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.6 6.2C3.6 5.43 4.23 4.8 5 4.8H8.2L9.5 6.2H15C15.77 6.2 16.4 6.83 16.4 7.6V14.8C16.4 15.57 15.77 16.2 15 16.2H5C4.23 16.2 3.6 15.57 3.6 14.8V6.2Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 9.1V13.3M10 9.1L8.3 10.8M10 9.1L11.7 10.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NewProjectActionIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.6 6.3C3.6 5.53 4.23 4.9 5 4.9H8.1L9.4 6.3H15C15.77 6.3 16.4 6.93 16.4 7.7V14.7C16.4 15.47 15.77 16.1 15 16.1H5C4.23 16.1 3.6 15.47 3.6 14.7V6.3Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 8.6V12.4M8.1 10.5H11.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const ActivityFilesIcon: React.FC = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="5" width="12" height="15" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 3.8H18C19.1 3.8 20 4.7 20 5.8V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ProjectsPage: React.FC<ProjectsPageProps> = ({
  routeProjectId,
  onSelectProject,
  onRequestCreateProject,
  onBackToChat,
}) => {
  const { theme } = useThemeStore();
  const { items, error, getDirectoryHandle, updateDirectory, clearError } = useProjectStore();

  const activeProject: ProjectItem | null = useMemo(() => {
    if (!routeProjectId) {
      return null;
    }
    return items.find((item) => item.id === routeProjectId) ?? null;
  }, [items, routeProjectId]);

  useEffect(() => {
    if (routeProjectId) {
      return;
    }
    if (items.length === 0) {
      return;
    }
    onSelectProject(items[0].id);
  }, [routeProjectId, items, onSelectProject]);

  const [rootHandle, setRootHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [childrenMap, setChildrenMap] = useState<Record<string, ExplorerEntry[]>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileName, setActiveFileName] = useState<string | null>(null);
  const [activeFileContent, setActiveFileContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState<number>(() => readStoredExplorerWidth());
  const [explorerCollapsed, setExplorerCollapsed] = useState<boolean>(() => readStoredExplorerCollapsed());
  const [resizingExplorer, setResizingExplorer] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const explorerWidthRef = useRef(explorerWidth);

  useEffect(() => {
    explorerWidthRef.current = explorerWidth;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PROJECT_EXPLORER_WIDTH_STORAGE_KEY, String(explorerWidth));
    }
  }, [explorerWidth]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(PROJECT_EXPLORER_COLLAPSED_STORAGE_KEY, explorerCollapsed ? '1' : '0');
  }, [explorerCollapsed]);

  useEffect(() => {
    if (!resizingExplorer) {
      return;
    }

    // 项目模式下支持拖拽侧栏宽度。
    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - resizeStartXRef.current;
      const nextWidth = resizeStartWidthRef.current + deltaX;
      const boundedWidth = Math.min(PROJECT_EXPLORER_MAX_WIDTH, Math.max(PROJECT_EXPLORER_MIN_WIDTH, nextWidth));
      setExplorerWidth(boundedWidth);
    };

    const onMouseUp = () => {
      setResizingExplorer(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizingExplorer]);

  const loadDirectoryAtPath = useCallback(
    async (path: string, handle: FileSystemDirectoryHandle) => {
      setLoadingMap((prev) => ({ ...prev, [path]: true }));
      try {
        const entries = await readDirectoryEntries(handle, path);
        setChildrenMap((prev) => ({ ...prev, [path]: entries }));
      } finally {
        setLoadingMap((prev) => ({ ...prev, [path]: false }));
      }
    },
    [],
  );

  const reloadActiveProjectTree = useCallback(async () => {
    if (!activeProject) {
      setRootHandle(null);
      setChildrenMap({});
      setExpandedMap({});
      setLoadingMap({});
      setTreeError(null);
      setActiveFilePath(null);
      setActiveFileName(null);
      setActiveFileContent('');
      setPreviewError(null);
      return;
    }

    setLoadingRoot(true);
    setTreeError(null);
    setPreviewError(null);
    setActiveFilePath(null);
    setActiveFileName(null);
    setActiveFileContent('');

    try {
      const handle = await getDirectoryHandle(activeProject.id);
      if (!handle) {
        setRootHandle(null);
        setChildrenMap({});
        setExpandedMap({});
        setTreeError('项目目录未关联或权限已失效，请点击“重新关联目录”。');
        return;
      }

      const granted = await ensureDirectoryReadPermission(handle);
      if (!granted) {
        setRootHandle(null);
        setChildrenMap({});
        setExpandedMap({});
        setTreeError('读取项目目录需要权限，请重新关联目录并授权。');
        return;
      }

      setRootHandle(handle);
      setChildrenMap({});
      setExpandedMap({ '': true });
      await loadDirectoryAtPath('', handle);
    } catch (loadError: any) {
      setRootHandle(null);
      setChildrenMap({});
      setExpandedMap({});
      setTreeError(loadError?.message ?? '加载项目目录失败');
    } finally {
      setLoadingRoot(false);
    }
  }, [activeProject, getDirectoryHandle, loadDirectoryAtPath]);

  useEffect(() => {
    void reloadActiveProjectTree();
  }, [reloadActiveProjectTree]);

  const handleToggleDirectory = async (nodePath: string) => {
    if (!rootHandle) {
      return;
    }

    const willExpand = !expandedMap[nodePath];
    setExpandedMap((prev) => ({ ...prev, [nodePath]: willExpand }));
    if (!willExpand) {
      return;
    }
    if (childrenMap[nodePath]) {
      return;
    }

    try {
      await loadDirectoryAtPath(nodePath, rootHandle);
    } catch (loadError: any) {
      setTreeError(loadError?.message ?? `加载目录失败: ${nodePath || activeProject?.rootDirName || ''}`);
    }
  };

  const handleOpenFile = async (filePath: string, fileName: string) => {
    if (!rootHandle) {
      return;
    }

    setActiveFilePath(filePath);
    setActiveFileName(fileName);
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      if (isLikelyBinaryFile(fileName)) {
        setActiveFileContent(`该文件可能是二进制文件，暂不支持文本预览。\n路径：${filePath}`);
        return;
      }
      const fileHandle = await resolveFileHandleByPath(rootHandle, filePath);
      const file = await fileHandle.getFile();
      const text = await file.text();
      setActiveFileContent(text);
    } catch (openError: any) {
      setActiveFileContent('');
      setPreviewError(openError?.message ?? `读取文件失败: ${filePath}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRebindDirectory = async () => {
    if (!activeProject) {
      return;
    }
    const pickerWindow = window as DirectoryPickerWindow;
    if (!pickerWindow.showDirectoryPicker) {
      setTreeError('当前浏览器不支持文件夹选择器，请使用 Chromium 内核浏览器。');
      return;
    }

    try {
      const selectedHandle = await pickerWindow.showDirectoryPicker({ mode: 'read' });
      await updateDirectory(activeProject.id, selectedHandle);
      await reloadActiveProjectTree();
      clearError();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return;
      }
      setTreeError(error?.message ?? '重新关联目录失败');
    }
  };

  const handleExplorerResizeStart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = explorerWidthRef.current;
    setResizingExplorer(true);
  };

  const renderExplorerNodes = (directoryPath: string, depth: number): React.ReactNode => {
    const nodes = childrenMap[directoryPath] ?? [];
    if (nodes.length === 0) {
      return null;
    }

    return nodes.map((node) => {
      const isDirectory = node.kind === 'directory';
      const expanded = expandedMap[node.path] === true;
      const isActiveFile = !isDirectory && activeFilePath === node.path;
      const loadingChildren = isDirectory && loadingMap[node.path] === true;
      const iconUrl = isDirectory
        ? resolveProjectFolderIcon(node.name, expanded)
        : resolveProjectFileIcon(node.name);

      return (
        <div key={`${node.kind}:${node.path}`}>
          <button
            type="button"
            onClick={() => {
              if (isDirectory) {
                void handleToggleDirectory(node.path);
                return;
              }
              void handleOpenFile(node.path, node.name);
            }}
            className={`flex h-[30px] w-full items-center gap-1 rounded-md px-2 text-left text-sm transition-colors ${
              isActiveFile
                ? 'bg-[rgb(234,234,234)] text-[rgb(13,13,13)]'
                : 'text-[rgb(13,13,13)] hover:bg-[rgb(239,239,239)]'
            }`}
            style={{ paddingLeft: `${depth * 16 + 8}px` }}
            title={node.path}
          >
            {isDirectory ? <TreeChevronIcon expanded={expanded} /> : <span className="inline-block h-3.5 w-3.5 shrink-0" />}
            {iconUrl ? (
              <img src={iconUrl} alt="" className="h-4 w-4 shrink-0" />
            ) : (
              <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-200" />
            )}
            <span className="truncate">{node.name}</span>
          </button>

          {isDirectory && expanded && (
            <>
              {loadingChildren && <p className="px-3 py-1 text-xs text-slate-400">加载中...</p>}
              {renderExplorerNodes(node.path, depth + 1)}
            </>
          )}
        </div>
      );
    });
  };

  const renderRootNode = (): React.ReactNode => {
    if (!activeProject) {
      return null;
    }

    const rootExpanded = expandedMap[''] !== false;
    const rootIconUrl = resolveProjectFolderIcon(activeProject.rootDirName, rootExpanded);
    const rootChildren = childrenMap[''] ?? [];
    const rootLoading = loadingRoot || loadingMap[''] === true;

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            void handleToggleDirectory('');
          }}
          className="flex h-[30px] w-full items-center gap-1 rounded-md px-2 text-left text-sm text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
          title={activeProject.rootDirName}
        >
          <TreeChevronIcon expanded={rootExpanded} />
          {rootIconUrl ? (
            <img src={rootIconUrl} alt="" className="h-4 w-4 shrink-0" />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-200" />
          )}
          <span className="truncate font-medium">{activeProject.rootDirName}</span>
        </button>

        {rootExpanded && (
          <>
            {rootLoading ? (
              <p className="px-3 py-1 text-xs text-slate-400">正在加载目录...</p>
            ) : rootChildren.length === 0 ? (
              <p className="px-3 py-1 text-xs text-slate-400">目录为空，或暂未读取到文件。</p>
            ) : (
              renderExplorerNodes('', 1)
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden">
        <div
          className={`flex w-12 shrink-0 flex-col items-center border-r border-[rgb(209,209,209)] py-2 ${
            theme === 'dark' ? 'bg-[#1b1b1b]' : 'bg-[#f5f5f5]'
          }`}
        >
          <button
            type="button"
            onClick={() => setExplorerCollapsed((prev) => !prev)}
            className={`relative mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
              !explorerCollapsed && theme === 'dark'
                ? 'bg-[#2a2a2a] text-slate-100'
                : !explorerCollapsed
                  ? 'border border-[rgb(209,209,209)] bg-white text-[rgb(13,13,13)]'
                  : theme === 'dark'
                    ? 'text-slate-300 hover:bg-[#2a2a2a]'
                    : 'text-[rgb(13,13,13)] hover:bg-[rgb(239,239,239)]'
            }`}
            title={explorerCollapsed ? '展开文件面板' : '收起文件面板'}
          >
            {!explorerCollapsed && (
              <span className="absolute left-[-1px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[#2563eb]" />
            )}
            <ActivityFilesIcon />
          </button>
        </div>

        {!explorerCollapsed && (
        <aside
          className="relative flex shrink-0 flex-col border-r border-[rgb(209,209,209)] bg-[#f7f7f8]"
          style={{ width: `${explorerWidth}px` }}
        >
          <div className="flex h-12 items-center justify-between border-b border-[rgb(209,209,209)] px-2">
            <button
              type="button"
              onClick={onBackToChat}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
            >
              <BackToChatIcon />
              <span>返回</span>
            </button>
            <button
              type="button"
              onClick={() => {
                void reloadActiveProjectTree();
              }}
              disabled={!activeProject || loadingRoot}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
              title="刷新目录"
            >
              <RefreshIcon />
            </button>
            <button
              type="button"
              onClick={() => void handleRebindDirectory()}
              disabled={!activeProject}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
              title="重新关联目录"
            >
              <FolderSelectIcon />
            </button>
            <button
              type="button"
              onClick={onRequestCreateProject}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
              title="新建项目"
            >
              <NewProjectActionIcon />
            </button>
          </div>

          <div className="border-b border-[rgb(209,209,209)] px-3 py-2 text-xs font-semibold tracking-wide text-slate-500">
            资源管理器
          </div>

          {(error || treeError) && (
            <div className="border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {treeError || error}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {!activeProject ? (
              <div className="space-y-3 px-2 py-3">
                <p className="text-sm text-slate-500">未打开项目</p>
                <Button size="sm" onClick={onRequestCreateProject}>
                  新建项目
                </Button>
              </div>
            ) : (
              renderRootNode()
            )}
          </div>

          <button
            type="button"
            aria-label="调整侧栏宽度"
            onMouseDown={handleExplorerResizeStart}
            className="absolute right-[-3px] top-0 h-full w-[6px] cursor-col-resize bg-transparent hover:bg-slate-300/60"
          />
        </aside>
        )}

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {!activeProject ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              左侧返回聊天或创建项目后开始
            </div>
          ) : previewError ? (
            <div className="h-full overflow-y-auto p-4 text-sm text-rose-500">{previewError}</div>
          ) : !activeFilePath ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              请在左侧资源管理器中选择文件进行预览
            </div>
          ) : previewLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">
              正在读取文件...
            </div>
          ) : (
            <Editor
              height="100%"
              language={resolveMonacoLanguageByFileName(activeFileName ?? activeFilePath)}
              value={activeFileContent}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              options={{
                readOnly: true,
                minimap: { enabled: true },
                fontSize: 13,
                wordWrap: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ProjectsPage;
