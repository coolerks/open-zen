import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import ignore, { type Ignore } from 'ignore';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { DirectoryPickerDialog } from '../components/project/DirectoryPickerDialog';
import { projectFilesystemApi } from '../api/projectFilesystem';
import { useProjectStore } from '../store/projectStore';
import { useThemeStore } from '../store/themeStore';
import { resolveMonacoLanguageByFileName, resolveProjectFileIcon, resolveProjectFolderIcon } from '../utils/projectIcons';
import type { ProjectItem } from '../types';
import { ArrowLeft, Columns2, FilePlus2, Files, FolderPlus, FolderRoot, Info, Link, RefreshCw, Search } from 'lucide-react';

type ExplorerEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
};

type EditorGroupId = 'left' | 'right';

type OpenFileTab = {
  path: string;
  name: string;
  content: string;
  language: string;
  loadError: string | null;
};

type GroupDiffView = {
  leftPath: string;
  rightPath: string;
};

type EditorGroupState = {
  tabs: string[];
  activeTabPath: string | null;
  diffView: GroupDiffView | null;
};

type ExplorerDragPayload = {
  kind: 'file' | 'directory';
  path: string;
  name: string;
};

type PendingExplorerEdit = {
  mode: 'create' | 'rename';
  kind: 'file' | 'directory';
  parentPath: string;
  targetPath: string | null;
  value: string;
  error: string | null;
  submitting: boolean;
};

type ContextMenuAction = {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

type GlobalCodeSearchResult = {
  path: string;
  name: string;
  lineNumber: number;
  snippet: string;
  matchByName: boolean;
};

type ProjectSidebarView = 'explorer' | 'search';

type ProjectsPageProps = {
  routeProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onRequestCreateProject: () => void;
  onBackToChat: () => void;
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
const PROJECT_EDITOR_SPLIT_RATIO_STORAGE_KEY = 'project.editor.split.ratio';
const PROJECT_EXPLORER_MIN_WIDTH = 300;
const PROJECT_EXPLORER_MAX_WIDTH = 640;
const PROJECT_EDITOR_SPLIT_MIN_RATIO = 0.24;
const PROJECT_EDITOR_SPLIT_MAX_RATIO = 0.76;
const PROJECT_EDITOR_SPLIT_SNAP_RATIO = 0.5;
const PROJECT_EDITOR_SPLIT_SNAP_THRESHOLD = 0.02;
const PROJECT_GLOBAL_SEARCH_MAX_RESULTS = 200;
const PROJECT_GLOBAL_SEARCH_MAX_FILE_BYTES = 1024 * 1024;
const PROJECT_GLOBAL_SEARCH_MAX_SNIPPET_LENGTH = 140;

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

function readStoredEditorSplitRatio(): number {
  if (typeof window === 'undefined') {
    return PROJECT_EDITOR_SPLIT_SNAP_RATIO;
  }
  const raw = window.localStorage.getItem(PROJECT_EDITOR_SPLIT_RATIO_STORAGE_KEY);
  if (!raw) {
    return PROJECT_EDITOR_SPLIT_SNAP_RATIO;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return PROJECT_EDITOR_SPLIT_SNAP_RATIO;
  }
  return Math.min(PROJECT_EDITOR_SPLIT_MAX_RATIO, Math.max(PROJECT_EDITOR_SPLIT_MIN_RATIO, parsed));
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

function splitParentPathAndName(path: string): { parentPath: string; name: string } {
  const segments = path.split('/').filter(Boolean);
  const name = segments.pop() ?? '';
  return {
    parentPath: segments.join('/'),
    name,
  };
}

function isPathEqualOrChild(path: string, basePath: string): boolean {
  if (!basePath) {
    return true;
  }
  return path === basePath || path.startsWith(`${basePath}/`);
}

function isValidExplorerEntryName(input: string): boolean {
  if (!input.trim()) {
    return false;
  }
  return !/[\\/]/.test(input);
}

function remapPathByPrefix(path: string, sourcePath: string, targetPath: string | null): string | null {
  if (path === sourcePath) {
    return targetPath;
  }
  if (!path.startsWith(`${sourcePath}/`)) {
    return path;
  }
  if (targetPath == null) {
    return null;
  }
  return `${targetPath}${path.slice(sourcePath.length)}`;
}

function remapRecordByPathPrefix<T>(
  record: Record<string, T>,
  sourcePath: string,
  targetPath: string | null,
): Record<string, T> {
  const next: Record<string, T> = {};
  Object.entries(record).forEach(([key, value]) => {
    const mapped = remapPathByPrefix(key, sourcePath, targetPath);
    if (mapped == null) {
      return;
    }
    next[mapped] = value;
  });
  return next;
}

type ExplorerPermissionStatus = 'granted' | 'denied' | 'prompt';

type ExplorerReadableFile = {
  text: () => Promise<string>;
  size: number;
};

type ExplorerWritableFile = {
  write: (data: unknown) => Promise<void>;
  close: () => Promise<void>;
};

type ExplorerFileHandle = {
  kind: 'file';
  name: string;
  getFile: () => Promise<ExplorerReadableFile>;
  createWritable: () => Promise<ExplorerWritableFile>;
};

type ExplorerDirectoryHandle = {
  kind: 'directory';
  name: string;
  queryPermission?: (_options: { mode: 'read' | 'readwrite' }) => Promise<ExplorerPermissionStatus>;
  requestPermission?: (_options: { mode: 'read' | 'readwrite' }) => Promise<ExplorerPermissionStatus>;
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<ExplorerDirectoryHandle>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<ExplorerFileHandle>;
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>;
  entries: () => AsyncIterableIterator<[string, ExplorerHandle]>;
};

type ExplorerHandle = ExplorerDirectoryHandle | ExplorerFileHandle;

function normalizeRelativeExplorerPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized;
}

function toWritableString(input: unknown): Promise<string> {
  if (typeof input === 'string') {
    return Promise.resolve(input);
  }
  if (input instanceof Blob) {
    return input.text();
  }
  if (
    input &&
    typeof input === 'object' &&
    'text' in input &&
    typeof (input as { text: () => Promise<string> | string }).text === 'function'
  ) {
    return Promise.resolve((input as { text: () => Promise<string> | string }).text()).then((value) => String(value));
  }
  return Promise.resolve(String(input ?? ''));
}

class ServerProjectWritableFile implements ExplorerWritableFile {
  private content = '';

  constructor(
    private readonly projectId: string,
    private readonly path: string,
  ) {}

  async write(data: unknown): Promise<void> {
    this.content = await toWritableString(data);
  }

  async close(): Promise<void> {
    await projectFilesystemApi.writeFile(this.projectId, {
      path: this.path,
      content: this.content,
    });
  }
}

class ServerProjectFileHandle implements ExplorerFileHandle {
  readonly kind = 'file' as const;
  readonly name: string;

  constructor(
    private readonly projectId: string,
    public readonly path: string,
  ) {
    this.name = getFileNameByPath(path);
  }

  async getFile(): Promise<ExplorerReadableFile> {
    const data = await projectFilesystemApi.readFile(this.projectId, this.path);
    return {
      size: data.size ?? new Blob([data.content]).size,
      text: async () => data.content,
    };
  }

  async createWritable(): Promise<ExplorerWritableFile> {
    return new ServerProjectWritableFile(this.projectId, this.path);
  }
}

class ServerProjectDirectoryHandle implements ExplorerDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly name: string;

  constructor(
    private readonly projectId: string,
    public readonly path: string,
    name?: string,
  ) {
    this.name = name ?? (path ? getFileNameByPath(path) : '');
  }

  async queryPermission(): Promise<ExplorerPermissionStatus> {
    return 'granted';
  }

  async requestPermission(): Promise<ExplorerPermissionStatus> {
    return 'granted';
  }

  private normalizeChildPath(name: string): string {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('名称不能为空。');
    }
    return normalizeRelativeExplorerPath(joinPath(this.path, cleanName));
  }

  private async findChildByName(name: string): Promise<{ name: string; path: string; kind: 'file' | 'directory' } | null> {
    const data = await projectFilesystemApi.listEntries(this.projectId, this.path);
    const child = data.entries.find((entry) => entry.name === name);
    if (!child) {
      return null;
    }
    return {
      name: child.name,
      path: normalizeRelativeExplorerPath(child.path),
      kind: child.kind,
    };
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<ExplorerDirectoryHandle> {
    const childPath = this.normalizeChildPath(name);
    if (options?.create) {
      await projectFilesystemApi.createEntry(this.projectId, {
        parentPath: this.path,
        name: name.trim(),
        kind: 'directory',
      });
      return new ServerProjectDirectoryHandle(this.projectId, childPath, name.trim());
    }
    const child = await this.findChildByName(name.trim());
    if (!child || child.kind !== 'directory') {
      throw new Error(`目录不存在：${name}`);
    }
    return new ServerProjectDirectoryHandle(this.projectId, child.path, child.name);
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<ExplorerFileHandle> {
    const childPath = this.normalizeChildPath(name);
    if (options?.create) {
      await projectFilesystemApi.createEntry(this.projectId, {
        parentPath: this.path,
        name: name.trim(),
        kind: 'file',
      });
      return new ServerProjectFileHandle(this.projectId, childPath);
    }
    const child = await this.findChildByName(name.trim());
    if (!child || child.kind !== 'file') {
      throw new Error(`文件不存在：${name}`);
    }
    return new ServerProjectFileHandle(this.projectId, child.path);
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const childPath = this.normalizeChildPath(name);
    await projectFilesystemApi.deleteEntry(this.projectId, childPath, options?.recursive === true);
  }

  async *entries(): AsyncIterableIterator<[string, ExplorerHandle]> {
    const data = await projectFilesystemApi.listEntries(this.projectId, this.path);
    for (const entry of data.entries) {
      const entryPath = normalizeRelativeExplorerPath(entry.path);
      if (entry.kind === 'directory') {
        yield [entry.name, new ServerProjectDirectoryHandle(this.projectId, entryPath, entry.name)];
      } else {
        yield [entry.name, new ServerProjectFileHandle(this.projectId, entryPath)];
      }
    }
  }
}

function createProjectRootHandle(projectId: string): ExplorerDirectoryHandle {
  return new ServerProjectDirectoryHandle(projectId, '', '');
}

async function resolveDirectoryHandleByPath(
  rootHandle: ExplorerDirectoryHandle,
  path: string,
): Promise<ExplorerDirectoryHandle> {
  let current = rootHandle;
  const segments = path.split('/').filter(Boolean);
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment);
  }
  return current;
}

async function resolveFileHandleByPath(
  rootHandle: ExplorerDirectoryHandle,
  filePath: string,
): Promise<ExplorerFileHandle> {
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

async function detectEntryKind(
  directoryHandle: ExplorerDirectoryHandle,
  name: string,
): Promise<'file' | 'directory' | null> {
  try {
    await directoryHandle.getFileHandle(name);
    return 'file';
  } catch {
    // 忽略，继续检查目录。
  }
  try {
    await directoryHandle.getDirectoryHandle(name);
    return 'directory';
  } catch {
    return null;
  }
}

async function moveExplorerEntry(
  projectId: string,
  sourcePath: string,
  kind: 'file' | 'directory',
  targetDirectoryPath: string,
  targetName?: string,
): Promise<string> {
  const { parentPath: sourceParentPath, name: sourceName } = splitParentPathAndName(sourcePath);
  const name = (targetName ?? sourceName).trim();
  if (!sourceName) {
    throw new Error('不支持移动根目录。');
  }
  if (!name) {
    throw new Error('目标名称不能为空。');
  }
  if (sourceParentPath === targetDirectoryPath) {
    if (name === sourceName) {
      return sourcePath;
    }
  }
  if (kind === 'directory' && isPathEqualOrChild(targetDirectoryPath, sourcePath)) {
    throw new Error('不能将目录移动到自身或其子目录中。');
  }

  const moved = await projectFilesystemApi.moveEntry(projectId, {
    sourcePath,
    targetDirectoryPath,
    targetName: name,
  });
  return normalizeRelativeExplorerPath(moved.path || joinPath(targetDirectoryPath, name));
}

async function readDirectoryEntries(
  rootHandle: ExplorerDirectoryHandle,
  directoryPath: string,
): Promise<ExplorerEntry[]> {
  const directoryHandle = await resolveDirectoryHandleByPath(rootHandle, directoryPath);
  const entries: ExplorerEntry[] = [];
  for await (const [name, handle] of directoryHandle.entries()) {
    entries.push({
      name,
      path: joinPath(directoryPath, name),
      kind: handle.kind,
    });
  }

  return sortExplorerEntries(entries);
}

async function readRootGitignoreMatcher(
  rootHandle: ExplorerDirectoryHandle,
): Promise<Ignore | null> {
  try {
    const gitignoreHandle = await rootHandle.getFileHandle('.gitignore');
    const file = await gitignoreHandle.getFile();
    const content = await file.text();
    return ignore().add(content);
  } catch {
    return null;
  }
}

function shouldIgnoreByGitignore(
  matcher: Ignore | null,
  relativePath: string,
  kind: 'file' | 'directory',
): boolean {
  if (!matcher || !relativePath) {
    return false;
  }
  const normalized = kind === 'directory' ? `${relativePath.replace(/\/+$/, '')}/` : relativePath;
  return matcher.ignores(normalized);
}

function isLikelyBinaryFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const extension = lower.includes('.') ? lower.split('.').pop() ?? '' : '';
  return BINARY_EXTENSIONS.has(extension);
}

function extractMatchedLineSnippet(
  content: string,
  matchIndex: number,
): { lineNumber: number; snippet: string } {
  let lineNumber = 1;
  for (let i = 0; i < matchIndex; i += 1) {
    if (content.charCodeAt(i) === 10) {
      lineNumber += 1;
    }
  }
  const lineStart = content.lastIndexOf('\n', matchIndex) + 1;
  const lineEndIndex = content.indexOf('\n', matchIndex);
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex;
  const rawLine = content.slice(lineStart, lineEnd).trim();
  if (rawLine.length <= PROJECT_GLOBAL_SEARCH_MAX_SNIPPET_LENGTH) {
    return { lineNumber, snippet: rawLine };
  }
  const half = Math.floor((PROJECT_GLOBAL_SEARCH_MAX_SNIPPET_LENGTH - 3) / 2);
  const localIndex = Math.max(0, matchIndex - lineStart);
  const from = Math.max(0, localIndex - half);
  const to = Math.min(rawLine.length, from + PROJECT_GLOBAL_SEARCH_MAX_SNIPPET_LENGTH - 3);
  const snippet = `${from > 0 ? '...' : ''}${rawLine.slice(from, to)}${to < rawLine.length ? '...' : ''}`;
  return { lineNumber, snippet };
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
  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.8 8H4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M7.1 5.7L4.8 8L7.1 10.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RefreshIcon: React.FC = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.8 5V2.9H9.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M11.7 3.5C10.9 2.6 9.8 2.1 8.5 2.1C6.2 2.1 4.4 3.9 4.4 6.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M4.2 11V13.1H6.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.3 12.5C5.1 13.4 6.2 13.9 7.5 13.9C9.8 13.9 11.6 12.1 11.6 9.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const FolderSelectIcon: React.FC = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2.4 5.3C2.4 4.64 2.94 4.1 3.6 4.1H5.9L7 5.3H12.4C13.06 5.3 13.6 5.84 13.6 6.5V11.7C13.6 12.36 13.06 12.9 12.4 12.9H3.6C2.94 12.9 2.4 12.36 2.4 11.7V5.3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 7.3V10.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M6.6 8.9L8 10.3L9.4 8.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NewProjectActionIcon: React.FC = () => (
  <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M2.4 5.3C2.4 4.64 2.94 4.1 3.6 4.1H5.9L7 5.3H12.4C13.06 5.3 13.6 5.84 13.6 6.5V11.7C13.6 12.36 13.06 12.9 12.4 12.9H3.6C2.94 12.9 2.4 12.36 2.4 11.7V5.3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M8 7.1V10.1M6.5 8.6H9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const CompareSelectedFilesIcon: React.FC = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.6}
    stroke="currentColor"
    className="h-4 w-4"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5h6v13h-6zM13.5 5.5h6v13h-6z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 12h3" />
  </svg>
);

const SearchCodeIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
    <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ActivityFilesIcon: React.FC = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="5" width="12" height="15" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
    <path d="M8 3.8H18C19.1 3.8 20 4.7 20 5.8V17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ActivitySearchIcon: React.FC = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.8" />
    <path d="M16 16L20 20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

function getFileNameByPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function createEmptyGroups(): Record<EditorGroupId, EditorGroupState> {
  return {
    left: { tabs: [], activeTabPath: null, diffView: null },
    right: { tabs: [], activeTabPath: null, diffView: null },
  };
}

function hasGroupContent(group: EditorGroupState): boolean {
  return group.tabs.length > 0 || group.diffView != null;
}

const ProjectsPage: React.FC<ProjectsPageProps> = ({
  routeProjectId,
  onSelectProject,
  onRequestCreateProject,
  onBackToChat,
}) => {
  const { theme } = useThemeStore();
  const {
    items,
    error,
    updateDirectory,
    getLastRealDirectoryPath,
    setLastRealDirectoryPath,
    clearError,
  } = useProjectStore();

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

  const [rootHandle, setRootHandle] = useState<ExplorerDirectoryHandle | null>(null);
  const [childrenMap, setChildrenMap] = useState<Record<string, ExplorerEntry[]>>({});
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [activeSidebarView, setActiveSidebarView] = useState<ProjectSidebarView>('explorer');
  const [globalSearchKeyword, setGlobalSearchKeyword] = useState('');
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalCodeSearchResult[]>([]);
  const [globalSearching, setGlobalSearching] = useState(false);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [searchIncludeGitignored, setSearchIncludeGitignored] = useState(false);
  const [gitignoreMatcher, setGitignoreMatcher] = useState<Ignore | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<Record<string, OpenFileTab>>({});
  const [groups, setGroups] = useState<Record<EditorGroupId, EditorGroupState>>(() => createEmptyGroups());
  const [activeGroup, setActiveGroup] = useState<EditorGroupId>('left');
  const rightGroupVisible = hasGroupContent(groups.right);
  const [selectedFilePaths, setSelectedFilePaths] = useState<string[]>([]);
  const [loadingFileMap, setLoadingFileMap] = useState<Record<string, boolean>>({});
  const [savingFileMap, setSavingFileMap] = useState<Record<string, boolean>>({});
  const [dirtyFileMap, setDirtyFileMap] = useState<Record<string, boolean>>({});
  const [saveErrorMap, setSaveErrorMap] = useState<Record<string, string | null>>({});
  const [dragOverDirectoryPath, setDragOverDirectoryPath] = useState<string | null>(null);
  const [draggingTab, setDraggingTab] = useState<{ path: string; fromGroup: EditorGroupId } | null>(null);
  const [editorSplitRatio, setEditorSplitRatio] = useState<number>(() => readStoredEditorSplitRatio());
  const [resizingEditorSplit, setResizingEditorSplit] = useState(false);
  const [tabStripScrolling, setTabStripScrolling] = useState<Record<EditorGroupId, boolean>>({
    left: false,
    right: false,
  });
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    actions: ContextMenuAction[];
  } | null>(null);
  const [pendingExplorerEdit, setPendingExplorerEdit] = useState<PendingExplorerEdit | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{
    entry: ExplorerEntry | null;
    submitting: boolean;
    error: string | null;
  }>({
    entry: null,
    submitting: false,
    error: null,
  });
  const [pendingMoveDialog, setPendingMoveDialog] = useState<{
    payload: ExplorerDragPayload;
    targetDirectoryPath: string;
    submitting: boolean;
    error: string | null;
  } | null>(null);
  const [directoryPickerState, setDirectoryPickerState] = useState<{
    open: boolean;
    initialPath: string;
  }>({
    open: false,
    initialPath: '~/',
  });
  const [directoryInfoDialogOpen, setDirectoryInfoDialogOpen] = useState(false);
  const [selectedDirectoryPath, setSelectedDirectoryPath] = useState<string | null>(null);
  const draggingExplorerEntryRef = useRef<ExplorerDragPayload | null>(null);
  const [explorerWidth, setExplorerWidth] = useState<number>(() => readStoredExplorerWidth());
  const [explorerCollapsed, setExplorerCollapsed] = useState<boolean>(() => readStoredExplorerCollapsed());
  const [resizingExplorer, setResizingExplorer] = useState(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);
  const explorerWidthRef = useRef(explorerWidth);
  const editorSplitRatioRef = useRef(editorSplitRatio);
  const editorSplitStartXRef = useRef(0);
  const editorSplitStartRatioRef = useRef(editorSplitRatio);
  const editorSplitContainerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const pendingExplorerInputRef = useRef<HTMLInputElement | null>(null);
  const pendingExplorerComposingRef = useRef(false);
  const pendingExplorerFocusKeyRef = useRef<string | null>(null);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const globalSearchKeywordRef = useRef('');
  const globalSearchTaskSeqRef = useRef(0);
  const editorInstanceRef = useRef<Record<EditorGroupId, any | null>>({
    left: null,
    right: null,
  });
  const openTabsRef = useRef<Record<string, OpenFileTab>>({});
  const dirtyFileMapRef = useRef<Record<string, boolean>>({});
  const saveTimerRef = useRef<Record<string, number | null>>({});
  const saveVersionRef = useRef<Record<string, number>>({});
  const tabStripScrollTimerRef = useRef<Record<EditorGroupId, number | null>>({
    left: null,
    right: null,
  });

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
    editorSplitRatioRef.current = editorSplitRatio;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PROJECT_EDITOR_SPLIT_RATIO_STORAGE_KEY, String(editorSplitRatio));
    }
  }, [editorSplitRatio]);

  useEffect(() => {
    globalSearchKeywordRef.current = globalSearchKeyword;
  }, [globalSearchKeyword]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    dirtyFileMapRef.current = dirtyFileMap;
  }, [dirtyFileMap]);

  useEffect(() => {
    if (explorerCollapsed || activeSidebarView !== 'search') {
      return;
    }
    const timer = window.setTimeout(() => {
      globalSearchInputRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeSidebarView, explorerCollapsed]);

  useEffect(() => {
    if (!pendingExplorerEdit) {
      pendingExplorerFocusKeyRef.current = null;
      pendingExplorerComposingRef.current = false;
      return;
    }
    const focusKey = `${pendingExplorerEdit.mode}:${pendingExplorerEdit.parentPath}:${pendingExplorerEdit.targetPath ?? ''}:${pendingExplorerEdit.kind}`;
    if (pendingExplorerFocusKeyRef.current === focusKey) {
      return;
    }
    pendingExplorerFocusKeyRef.current = focusKey;
    const timer = window.setTimeout(() => {
      const input = pendingExplorerInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      if (pendingExplorerEdit.value) {
        input.select();
      } else {
        input.setSelectionRange(0, 0);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    pendingExplorerEdit?.kind,
    pendingExplorerEdit?.mode,
    pendingExplorerEdit?.parentPath,
    pendingExplorerEdit?.targetPath,
    pendingExplorerEdit?.value,
  ]);

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

  useEffect(() => {
    return () => {
      Object.values(saveTimerRef.current).forEach((timerId) => {
        if (timerId != null) {
          window.clearTimeout(timerId);
        }
      });
      saveTimerRef.current = {};
    };
  }, []);

  const syncEditorsWhenCentered = useCallback(() => {
    if (!rightGroupVisible) {
      return;
    }
    if (groups.left.diffView || groups.right.diffView) {
      return;
    }
    const sourceGroup: EditorGroupId = activeGroup === 'right' ? 'right' : 'left';
    const targetGroup: EditorGroupId = sourceGroup === 'left' ? 'right' : 'left';
    const sourceEditor = editorInstanceRef.current[sourceGroup];
    const targetEditor = editorInstanceRef.current[targetGroup];
    if (!sourceEditor || !targetEditor) {
      return;
    }
    // 分栏回中线时，将另一侧视图同步到相同行，便于左右对照阅读。
    const position = sourceEditor.getPosition?.();
    if (position?.lineNumber != null) {
      targetEditor.revealLineInCenter?.(position.lineNumber);
      targetEditor.setPosition?.(position);
    }
    const scrollTop = sourceEditor.getScrollTop?.();
    const scrollLeft = sourceEditor.getScrollLeft?.();
    if (typeof scrollTop === 'number') {
      targetEditor.setScrollTop?.(scrollTop);
    }
    if (typeof scrollLeft === 'number') {
      targetEditor.setScrollLeft?.(scrollLeft);
    }
  }, [activeGroup, groups.left.diffView, groups.right.diffView, rightGroupVisible]);

  useEffect(() => {
    if (!resizingEditorSplit) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      const container = editorSplitContainerRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) {
        return;
      }
      const deltaX = event.clientX - editorSplitStartXRef.current;
      let nextRatio = editorSplitStartRatioRef.current + deltaX / rect.width;
      nextRatio = Math.max(PROJECT_EDITOR_SPLIT_MIN_RATIO, Math.min(PROJECT_EDITOR_SPLIT_MAX_RATIO, nextRatio));
      if (Math.abs(nextRatio - PROJECT_EDITOR_SPLIT_SNAP_RATIO) <= PROJECT_EDITOR_SPLIT_SNAP_THRESHOLD) {
        nextRatio = PROJECT_EDITOR_SPLIT_SNAP_RATIO;
      }
      setEditorSplitRatio(nextRatio);
    };

    const onMouseUp = () => {
      setResizingEditorSplit(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (Math.abs(editorSplitRatioRef.current - PROJECT_EDITOR_SPLIT_SNAP_RATIO) <= PROJECT_EDITOR_SPLIT_SNAP_THRESHOLD) {
        setEditorSplitRatio(PROJECT_EDITOR_SPLIT_SNAP_RATIO);
        syncEditorsWhenCentered();
      }
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
  }, [resizingEditorSplit, syncEditorsWhenCentered]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeMenu = (event: Event) => {
      if (contextMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const closeByEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', closeByEsc);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', closeByEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (activeGroup === 'right' && !hasGroupContent(groups.right)) {
      setActiveGroup('left');
      return;
    }
    if (activeGroup === 'left' && !hasGroupContent(groups.left) && hasGroupContent(groups.right)) {
      setActiveGroup('right');
    }
  }, [activeGroup, groups.left, groups.right]);

  useEffect(() => {
    const leftHasContent = hasGroupContent(groups.left);
    const rightHasContent = hasGroupContent(groups.right);
    if (leftHasContent || !rightHasContent) {
      return;
    }

    // 当左栏已清空但右栏仍有内容时，自动将右栏归并为主栏，避免出现空白左栏。
    setGroups((prev) => {
      if (hasGroupContent(prev.left) || !hasGroupContent(prev.right)) {
        return prev;
      }
      return {
        left: { ...prev.right },
        right: { tabs: [], activeTabPath: null, diffView: null },
      };
    });
    setActiveGroup('left');
  }, [groups.left, groups.right]);

  const loadDirectoryAtPath = useCallback(
    async (path: string, handle: ExplorerDirectoryHandle) => {
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

  const clearAutoSaveTimer = useCallback((filePath: string) => {
    const timerId = saveTimerRef.current[filePath];
    if (timerId != null) {
      window.clearTimeout(timerId);
    }
    saveTimerRef.current[filePath] = null;
  }, []);

  const ensureProjectWritable = useCallback(async (): Promise<boolean> => {
    if (!rootHandle) {
      setTreeError('项目目录尚未加载，无法写入。');
      return false;
    }
    return true;
  }, [rootHandle]);

  const persistFileContent = useCallback(
    async (filePath: string, targetVersion: number): Promise<boolean> => {
      if (!rootHandle) {
        return false;
      }
      const tab = openTabsRef.current[filePath];
      if (!tab || tab.loadError || isLikelyBinaryFile(tab.name)) {
        return false;
      }
      const writable = await ensureProjectWritable();
      if (!writable) {
        return false;
      }
      setSavingFileMap((prev) => ({ ...prev, [filePath]: true }));
      setSaveErrorMap((prev) => ({ ...prev, [filePath]: null }));
      try {
        const fileHandle = await resolveFileHandleByPath(rootHandle, filePath);
        const writer = await fileHandle.createWritable();
        await writer.write(tab.content);
        await writer.close();
        if ((saveVersionRef.current[filePath] ?? 0) === targetVersion) {
          setDirtyFileMap((prev) => ({ ...prev, [filePath]: false }));
        }
        return true;
      } catch (saveError: any) {
        setSaveErrorMap((prev) => ({
          ...prev,
          [filePath]: saveError?.message ?? `保存文件失败: ${filePath}`,
        }));
        return false;
      } finally {
        setSavingFileMap((prev) => ({ ...prev, [filePath]: false }));
      }
    },
    [ensureProjectWritable, rootHandle],
  );

  const scheduleAutoSave = useCallback(
    (filePath: string) => {
      clearAutoSaveTimer(filePath);
      const nextVersion = (saveVersionRef.current[filePath] ?? 0) + 1;
      saveVersionRef.current[filePath] = nextVersion;
      setDirtyFileMap((prev) => ({ ...prev, [filePath]: true }));
      saveTimerRef.current[filePath] = window.setTimeout(() => {
        saveTimerRef.current[filePath] = null;
        void persistFileContent(filePath, nextVersion);
      }, 500);
    },
    [clearAutoSaveTimer, persistFileContent],
  );

  const handleEditorContentChange = useCallback(
    (filePath: string | null, nextContent: string) => {
      if (!filePath) {
        return;
      }
      let changed = false;
      setOpenTabs((prev) => {
        const target = prev[filePath];
        if (!target || target.loadError || target.content === nextContent) {
          return prev;
        }
        changed = true;
        return {
          ...prev,
          [filePath]: {
            ...target,
            content: nextContent,
          },
        };
      });
      if (!changed) {
        return;
      }
      setSaveErrorMap((prev) => ({ ...prev, [filePath]: null }));
      scheduleAutoSave(filePath);
    },
    [scheduleAutoSave],
  );

  const flushPendingSavesUnderPath = useCallback(
    async (path: string) => {
      const candidates = Object.keys(openTabsRef.current).filter((tabPath) => isPathEqualOrChild(tabPath, path));
      for (const tabPath of candidates) {
        clearAutoSaveTimer(tabPath);
        if (!dirtyFileMapRef.current[tabPath]) {
          continue;
        }
        const flushVersion = (saveVersionRef.current[tabPath] ?? 0) + 1;
        saveVersionRef.current[tabPath] = flushVersion;
        // 先落盘，避免后续重命名/移动路径后丢失编辑内容。
        await persistFileContent(tabPath, flushVersion);
      }
    },
    [clearAutoSaveTimer, persistFileContent],
  );

  const remapExplorerStateByPath = useCallback((sourcePath: string, targetPath: string | null) => {
    setChildrenMap((prev) => {
      const next: Record<string, ExplorerEntry[]> = {};
      Object.entries(prev).forEach(([directoryPath, entries]) => {
        const mappedDirectoryPath = remapPathByPrefix(directoryPath, sourcePath, targetPath);
        if (mappedDirectoryPath == null) {
          return;
        }
        next[mappedDirectoryPath] = entries
          .map((entry) => {
            const mappedEntryPath = remapPathByPrefix(entry.path, sourcePath, targetPath);
            if (mappedEntryPath == null) {
              return null;
            }
            if (mappedEntryPath === entry.path) {
              return entry;
            }
            return {
              ...entry,
              path: mappedEntryPath,
              name: getFileNameByPath(mappedEntryPath),
            };
          })
          .filter((entry): entry is ExplorerEntry => entry != null);
      });
      return next;
    });
    setExpandedMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
    setLoadingMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
    setSelectedDirectoryPath((prev) => {
      if (prev == null) {
        return prev;
      }
      return remapPathByPrefix(prev, sourcePath, targetPath);
    });
  }, []);

  const remapOpenEditorsByPath = useCallback(
    (sourcePath: string, targetPath: string | null) => {
      setOpenTabs((prev) => {
        const next: Record<string, OpenFileTab> = {};
        Object.entries(prev).forEach(([path, tab]) => {
          const mapped = remapPathByPrefix(path, sourcePath, targetPath);
          if (mapped == null) {
            return;
          }
          next[mapped] =
            mapped === path
              ? tab
              : {
                ...tab,
                path: mapped,
                name: getFileNameByPath(mapped),
              };
        });
        return next;
      });
      setLoadingFileMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
      setSavingFileMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
      setDirtyFileMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
      setSaveErrorMap((prev) => remapRecordByPathPrefix(prev, sourcePath, targetPath));
      setSelectedFilePaths((prev) =>
        prev
          .map((path) => remapPathByPrefix(path, sourcePath, targetPath))
          .filter((path): path is string => path != null),
      );
      setGroups((prev) => {
        const remapGroup = (group: EditorGroupState): EditorGroupState => {
          const dedupTabs = new Set<string>();
          const nextTabs = group.tabs
            .map((tabPath) => remapPathByPrefix(tabPath, sourcePath, targetPath))
            .filter((tabPath): tabPath is string => {
              if (tabPath == null || dedupTabs.has(tabPath)) {
                return false;
              }
              dedupTabs.add(tabPath);
              return true;
            });
          const nextActive = group.activeTabPath
            ? remapPathByPrefix(group.activeTabPath, sourcePath, targetPath)
            : null;
          const nextDiff = group.diffView
            ? {
              leftPath: remapPathByPrefix(group.diffView.leftPath, sourcePath, targetPath),
              rightPath: remapPathByPrefix(group.diffView.rightPath, sourcePath, targetPath),
            }
            : null;
          return {
            tabs: nextTabs,
            activeTabPath: nextDiff == null ? nextActive : null,
            diffView:
              nextDiff && nextDiff.leftPath && nextDiff.rightPath
                ? { leftPath: nextDiff.leftPath, rightPath: nextDiff.rightPath }
                : null,
          };
        };
        return {
          left: remapGroup(prev.left),
          right: remapGroup(prev.right),
        };
      });

      const nextSaveVersion: Record<string, number> = {};
      Object.entries(saveVersionRef.current).forEach(([path, version]) => {
        const mapped = remapPathByPrefix(path, sourcePath, targetPath);
        if (mapped != null) {
          nextSaveVersion[mapped] = version;
        }
      });
      saveVersionRef.current = nextSaveVersion;

      const nextTimers: Record<string, number | null> = {};
      Object.entries(saveTimerRef.current).forEach(([path, timerId]) => {
        const mapped = remapPathByPrefix(path, sourcePath, targetPath);
        if (mapped == null) {
          if (timerId != null) {
            window.clearTimeout(timerId);
          }
          return;
        }
        if (timerId == null) {
          nextTimers[mapped] = null;
          return;
        }
        if (mapped === path) {
          nextTimers[mapped] = timerId;
          return;
        }
        window.clearTimeout(timerId);
        nextTimers[mapped] = null;
      });
      saveTimerRef.current = nextTimers;
    },
    [],
  );

  const refreshDirectoryEntries = useCallback(
    async (directoryPath: string) => {
      if (!rootHandle) {
        return;
      }
      try {
        await loadDirectoryAtPath(directoryPath, rootHandle);
      } catch (refreshError: any) {
        setTreeError(refreshError?.message ?? `刷新目录失败: ${directoryPath || activeProject?.rootDirName || ''}`);
      }
    },
    [activeProject?.rootDirName, loadDirectoryAtPath, rootHandle],
  );

  const reloadActiveProjectTree = useCallback(async () => {
    if (!activeProject) {
      globalSearchTaskSeqRef.current += 1;
      setGlobalSearchKeyword('');
      setGlobalSearchResults([]);
      setGlobalSearching(false);
      setGlobalSearchError(null);
      setRootHandle(null);
      setGitignoreMatcher(null);
      setChildrenMap({});
      setExpandedMap({});
      setLoadingMap({});
      setTreeError(null);
      setOpenTabs({});
      setGroups(createEmptyGroups());
      setActiveGroup('left');
      setSelectedFilePaths([]);
      setSelectedDirectoryPath(null);
      setLoadingFileMap({});
      setSavingFileMap({});
      setDirtyFileMap({});
      setSaveErrorMap({});
      setDragOverDirectoryPath(null);
      setPendingExplorerEdit(null);
      setDeleteDialog({ entry: null, submitting: false, error: null });
      setPendingMoveDialog(null);
      Object.values(saveTimerRef.current).forEach((timerId) => {
        if (timerId != null) {
          window.clearTimeout(timerId);
        }
      });
      saveTimerRef.current = {};
      saveVersionRef.current = {};
      return;
    }

    setLoadingRoot(true);
    setTreeError(null);
    setGlobalSearchResults([]);
    setGlobalSearchError(null);
    globalSearchTaskSeqRef.current += 1;
    setGlobalSearching(false);
    setContextMenu(null);
    setOpenTabs({});
    setGroups(createEmptyGroups());
    setActiveGroup('left');
    setSelectedFilePaths([]);
    setSelectedDirectoryPath(null);
    setLoadingFileMap({});
    setSavingFileMap({});
    setDirtyFileMap({});
    setSaveErrorMap({});
    setDragOverDirectoryPath(null);
    setPendingExplorerEdit(null);
    setDeleteDialog({ entry: null, submitting: false, error: null });
    setPendingMoveDialog(null);
    Object.values(saveTimerRef.current).forEach((timerId) => {
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
    });
    saveTimerRef.current = {};
    saveVersionRef.current = {};

    try {
      const handle = createProjectRootHandle(activeProject.id);
      setRootHandle(handle);
      setGitignoreMatcher(await readRootGitignoreMatcher(handle));
      setChildrenMap({});
      setExpandedMap({ '': true });
      await loadDirectoryAtPath('', handle);
    } catch (loadError: any) {
      setRootHandle(null);
      setGitignoreMatcher(null);
      setChildrenMap({});
      setExpandedMap({});
      setTreeError(loadError?.message ?? '加载项目目录失败');
    } finally {
      setLoadingRoot(false);
    }
  }, [activeProject, loadDirectoryAtPath]);

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

  const handleCreateExplorerEntry = useCallback(
    async (parentPath: string, kind: 'file' | 'directory') => {
      setPendingExplorerEdit({
        mode: 'create',
        kind,
        parentPath,
        targetPath: null,
        value: '',
        error: null,
        submitting: false,
      });
      setTreeError(null);
      setExpandedMap((prev) => ({ ...prev, [parentPath]: true }));
      if (rootHandle && !childrenMap[parentPath]) {
        try {
          await loadDirectoryAtPath(parentPath, rootHandle);
        } catch (loadError: any) {
          setTreeError(loadError?.message ?? `加载目录失败: ${parentPath || activeProject?.rootDirName || ''}`);
        }
      }
    },
    [activeProject?.rootDirName, childrenMap, loadDirectoryAtPath, rootHandle],
  );

  const handleRenameExplorerEntry = useCallback((entry: ExplorerEntry) => {
    const { parentPath } = splitParentPathAndName(entry.path);
    setPendingExplorerEdit({
      mode: 'rename',
      kind: entry.kind,
      parentPath,
      targetPath: entry.path,
      value: entry.name,
      error: null,
      submitting: false,
    });
    setTreeError(null);
  }, []);

  const handleDeleteExplorerEntry = useCallback((entry: ExplorerEntry) => {
    setDeleteDialog({
      entry,
      submitting: false,
      error: null,
    });
  }, []);

  const handleCancelPendingExplorerEdit = useCallback(() => {
    pendingExplorerComposingRef.current = false;
    setPendingExplorerEdit(null);
  }, []);

  const handleSubmitPendingExplorerEdit = useCallback(async () => {
    const draft = pendingExplorerEdit;
    if (!draft || draft.submitting || !rootHandle || !activeProject) {
      return;
    }
    const nextName = draft.value.trim();
    if (!nextName) {
      setPendingExplorerEdit(null);
      return;
    }
    if (!isValidExplorerEntryName(nextName)) {
      setPendingExplorerEdit((prev) => (prev ? { ...prev, error: '名称不能为空，且不能包含 / 或 \\。' } : prev));
      return;
    }
    const writable = await ensureProjectWritable();
    if (!writable) {
      return;
    }
    setPendingExplorerEdit((prev) => (prev ? { ...prev, submitting: true, error: null } : prev));
    try {
      const parentHandle = await resolveDirectoryHandleByPath(rootHandle, draft.parentPath);
      const existingKind = await detectEntryKind(parentHandle, nextName);
      if (draft.mode === 'rename') {
        const originalPath = draft.targetPath;
        if (!originalPath) {
          setPendingExplorerEdit(null);
          return;
        }
        const { name: originalName } = splitParentPathAndName(originalPath);
        if (nextName === originalName) {
          setPendingExplorerEdit(null);
          return;
        }
        if (existingKind) {
          setPendingExplorerEdit((prev) =>
            prev
              ? {
                ...prev,
                submitting: false,
                error: `此位置已存在文件或文件夹 ${nextName}，请使用其他名称。`,
              }
              : prev,
          );
          return;
        }
        await flushPendingSavesUnderPath(originalPath);
        const movedPath = await moveExplorerEntry(activeProject.id, originalPath, draft.kind, draft.parentPath, nextName);
        remapExplorerStateByPath(originalPath, movedPath);
        remapOpenEditorsByPath(originalPath, movedPath);
        setPendingExplorerEdit(null);
        setTreeError(null);
        await refreshDirectoryEntries(draft.parentPath);
        return;
      }

      if (existingKind) {
        setPendingExplorerEdit((prev) =>
          prev
            ? {
              ...prev,
              submitting: false,
              error: `此位置已存在文件或文件夹 ${nextName}，请使用其他名称。`,
            }
            : prev,
        );
        return;
      }

      if (draft.kind === 'directory') {
        await parentHandle.getDirectoryHandle(nextName, { create: true });
      } else {
        await parentHandle.getFileHandle(nextName, { create: true });
      }
      setPendingExplorerEdit(null);
      setTreeError(null);
      await refreshDirectoryEntries(draft.parentPath);
    } catch (editError: any) {
      setPendingExplorerEdit((prev) =>
        prev
          ? {
            ...prev,
            submitting: false,
            error: editError?.message ?? '保存失败，请重试',
          }
          : prev,
      );
    }
  }, [
    activeProject,
    ensureProjectWritable,
    flushPendingSavesUnderPath,
    pendingExplorerEdit,
    refreshDirectoryEntries,
    remapExplorerStateByPath,
    remapOpenEditorsByPath,
    rootHandle,
  ]);

  const handlePendingExplorerInputBlur = useCallback(() => {
    // 处理中文输入法候选词确认：合成阶段不提交，等待合成结束后再由用户显式回车/失焦。
    window.setTimeout(() => {
      if (pendingExplorerComposingRef.current) {
        return;
      }
      void handleSubmitPendingExplorerEdit();
    }, 0);
  }, [handleSubmitPendingExplorerEdit]);

  const handlePendingExplorerInputKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const nativeEvent = event.nativeEvent as KeyboardEvent & { isComposing?: boolean; keyCode?: number };
      if (nativeEvent.isComposing || nativeEvent.keyCode === 229 || pendingExplorerComposingRef.current) {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancelPendingExplorerEdit();
      }
    },
    [handleCancelPendingExplorerEdit],
  );

  const handlePendingExplorerCompositionStart = useCallback(() => {
    pendingExplorerComposingRef.current = true;
  }, []);

  const handlePendingExplorerCompositionEnd = useCallback(() => {
    // 部分浏览器会在 compositionend 后紧接一个 Enter，延后一帧避免误提交。
    window.setTimeout(() => {
      pendingExplorerComposingRef.current = false;
    }, 0);
  }, []);

  const handleConfirmDeleteExplorerEntry = useCallback(async () => {
    const entry = deleteDialog.entry;
    if (!entry || !rootHandle) {
      return;
    }
    const writable = await ensureProjectWritable();
    if (!writable) {
      return;
    }
    setDeleteDialog((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await flushPendingSavesUnderPath(entry.path);
      const { parentPath, name } = splitParentPathAndName(entry.path);
      if (!name) {
        setDeleteDialog((prev) => ({ ...prev, submitting: false, error: '不支持删除根目录。' }));
        return;
      }
      const parentHandle = await resolveDirectoryHandleByPath(rootHandle, parentPath);
      await parentHandle.removeEntry(name, { recursive: entry.kind === 'directory' });
      remapExplorerStateByPath(entry.path, null);
      remapOpenEditorsByPath(entry.path, null);
      setDeleteDialog({ entry: null, submitting: false, error: null });
      setTreeError(null);
      await refreshDirectoryEntries(parentPath);
    } catch (deleteError: any) {
      setDeleteDialog((prev) => ({
        ...prev,
        submitting: false,
        error: deleteError?.message ?? '删除失败',
      }));
    }
  }, [
    deleteDialog.entry,
    ensureProjectWritable,
    flushPendingSavesUnderPath,
    refreshDirectoryEntries,
    remapExplorerStateByPath,
    remapOpenEditorsByPath,
    rootHandle,
  ]);

  const performMoveExplorerEntryToDirectory = useCallback(
    async (payload: ExplorerDragPayload, targetDirectoryPath: string) => {
      if (!rootHandle || !activeProject) {
        return;
      }
      const writable = await ensureProjectWritable();
      if (!writable) {
        return;
      }
      const { parentPath } = splitParentPathAndName(payload.path);
      if (parentPath === targetDirectoryPath) {
        return;
      }
      if (payload.kind === 'directory' && isPathEqualOrChild(targetDirectoryPath, payload.path)) {
        return;
      }
      try {
        await flushPendingSavesUnderPath(payload.path);
        const nextPath = await moveExplorerEntry(activeProject.id, payload.path, payload.kind, targetDirectoryPath);
        remapExplorerStateByPath(payload.path, nextPath);
        remapOpenEditorsByPath(payload.path, nextPath);
        setPendingExplorerEdit((prev) => {
          if (!prev) {
            return prev;
          }
          if (isPathEqualOrChild(prev.parentPath, payload.path) || (prev.targetPath && isPathEqualOrChild(prev.targetPath, payload.path))) {
            return null;
          }
          return prev;
        });
        setTreeError(null);
        await Promise.all([refreshDirectoryEntries(parentPath), refreshDirectoryEntries(targetDirectoryPath)]);
      } catch (moveError: any) {
        setTreeError(moveError?.message ?? '移动失败');
        throw moveError;
      }
    },
    [
      activeProject,
      ensureProjectWritable,
      flushPendingSavesUnderPath,
      refreshDirectoryEntries,
      remapExplorerStateByPath,
      remapOpenEditorsByPath,
      rootHandle,
    ],
  );

  const handleRequestMoveExplorerEntryToDirectory = useCallback((payload: ExplorerDragPayload, targetDirectoryPath: string) => {
    const { parentPath } = splitParentPathAndName(payload.path);
    if (parentPath === targetDirectoryPath) {
      return;
    }
    if (payload.kind === 'directory' && isPathEqualOrChild(targetDirectoryPath, payload.path)) {
      return;
    }
    setPendingMoveDialog({
      payload,
      targetDirectoryPath,
      submitting: false,
      error: null,
    });
  }, []);

  const handleConfirmMoveExplorerEntry = useCallback(async () => {
    if (!pendingMoveDialog) {
      return;
    }
    setPendingMoveDialog((prev) => (prev ? { ...prev, submitting: true, error: null } : prev));
    try {
      await performMoveExplorerEntryToDirectory(pendingMoveDialog.payload, pendingMoveDialog.targetDirectoryPath);
      setPendingMoveDialog(null);
    } catch (moveError: any) {
      setPendingMoveDialog((prev) =>
        prev
          ? {
            ...prev,
            submitting: false,
            error: moveError?.message ?? '移动失败',
          }
          : prev,
      );
    }
  }, [pendingMoveDialog, performMoveExplorerEntryToDirectory]);

  const ensureTabReady = useCallback(
    async (filePath: string, fileName: string): Promise<OpenFileTab | null> => {
      if (!rootHandle) {
        return null;
      }
      const cached = openTabs[filePath];
      if (cached && !cached.loadError) {
        return cached;
      }
      const nextName = fileName || getFileNameByPath(filePath);
      setLoadingFileMap((prev) => ({ ...prev, [filePath]: true }));
      try {
        let tab: OpenFileTab;
        if (isLikelyBinaryFile(nextName)) {
          tab = {
            path: filePath,
            name: nextName,
            content: `该文件可能是二进制文件，暂不支持文本预览。\n路径：${filePath}`,
            language: 'plaintext',
            loadError: null,
          };
        } else {
          const fileHandle = await resolveFileHandleByPath(rootHandle, filePath);
          const file = await fileHandle.getFile();
          const text = await file.text();
          tab = {
            path: filePath,
            name: nextName,
            content: text,
            language: resolveMonacoLanguageByFileName(nextName),
            loadError: null,
          };
        }
        setOpenTabs((prev) => ({ ...prev, [filePath]: tab }));
        return tab;
      } catch (openError: any) {
        const errorTab: OpenFileTab = {
          path: filePath,
          name: nextName,
          content: '',
          language: resolveMonacoLanguageByFileName(nextName),
          loadError: openError?.message ?? `读取文件失败: ${filePath}`,
        };
        setOpenTabs((prev) => ({ ...prev, [filePath]: errorTab }));
        return errorTab;
      } finally {
        setLoadingFileMap((prev) => ({ ...prev, [filePath]: false }));
      }
    },
    [openTabs, rootHandle],
  );

  const openFileInGroup = useCallback(
    async (filePath: string, fileName: string, groupId: EditorGroupId) => {
      const tab = await ensureTabReady(filePath, fileName);
      if (!tab) {
        return;
      }
      setGroups((prev) => {
        const group = prev[groupId];
        const nextTabs = group.tabs.includes(filePath) ? group.tabs : [...group.tabs, filePath];
        return {
          ...prev,
          [groupId]: {
            ...group,
            tabs: nextTabs,
            activeTabPath: filePath,
            diffView: null,
          },
        };
      });
      setActiveGroup(groupId);
      setTreeError(null);
    },
    [ensureTabReady],
  );

  const closeTabInGroup = useCallback((groupId: EditorGroupId, filePath: string) => {
    setGroups((prev) => {
      const group = prev[groupId];
      if (!group.tabs.includes(filePath) && group.diffView?.leftPath !== filePath && group.diffView?.rightPath !== filePath) {
        return prev;
      }
      const nextTabs = group.tabs.filter((item) => item !== filePath);
      let nextActive = group.activeTabPath;
      if (group.activeTabPath === filePath) {
        const index = group.tabs.indexOf(filePath);
        nextActive = nextTabs[index] ?? nextTabs[index - 1] ?? nextTabs[nextTabs.length - 1] ?? null;
      }
      const nextDiff =
        group.diffView && (group.diffView.leftPath === filePath || group.diffView.rightPath === filePath)
          ? null
          : group.diffView;
      return {
        ...prev,
        [groupId]: {
          ...group,
          tabs: nextTabs,
          activeTabPath: nextDiff ? null : nextActive,
          diffView: nextDiff,
        },
      };
    });
  }, []);

  const closeOtherTabsInGroup = useCallback((groupId: EditorGroupId, keepFilePath: string) => {
    setGroups((prev) => {
      const group = prev[groupId];
      const hasTarget = group.tabs.includes(keepFilePath);
      if (!hasTarget) {
        return prev;
      }
      return {
        ...prev,
        [groupId]: {
          tabs: [keepFilePath],
          activeTabPath: keepFilePath,
          diffView: null,
        },
      };
    });
  }, []);

  const closeAllTabsInGroup = useCallback((groupId: EditorGroupId) => {
    setGroups((prev) => ({
      ...prev,
      [groupId]: {
        tabs: [],
        activeTabPath: null,
        diffView: null,
      },
    }));
  }, []);

  const splitTabToGroup = useCallback(
    async (filePath: string, fromGroupId: EditorGroupId, targetGroupId: EditorGroupId) => {
      const sourceTab = openTabs[filePath];
      const tabName = sourceTab?.name ?? getFileNameByPath(filePath);
      await openFileInGroup(filePath, tabName, targetGroupId);
      setActiveGroup(targetGroupId);
      if (fromGroupId === targetGroupId) {
        return;
      }
    },
    [openFileInGroup, openTabs],
  );

  const moveTabToGroup = useCallback(
    async (filePath: string, fromGroupId: EditorGroupId, targetGroupId: EditorGroupId) => {
      const sourceTab = openTabs[filePath];
      const tabName = sourceTab?.name ?? getFileNameByPath(filePath);
      await openFileInGroup(filePath, tabName, targetGroupId);
      if (fromGroupId !== targetGroupId) {
        closeTabInGroup(fromGroupId, filePath);
      }
      setActiveGroup(targetGroupId);
    },
    [closeTabInGroup, openFileInGroup, openTabs],
  );

  const openDiffInGroup = useCallback(
    async (leftPath: string, rightPath: string, groupId: EditorGroupId) => {
      const leftName = openTabs[leftPath]?.name ?? getFileNameByPath(leftPath);
      const rightName = openTabs[rightPath]?.name ?? getFileNameByPath(rightPath);
      const [leftTab, rightTab] = await Promise.all([
        ensureTabReady(leftPath, leftName),
        ensureTabReady(rightPath, rightName),
      ]);
      if (!leftTab || !rightTab) {
        return;
      }
      setGroups((prev) => {
        const group = prev[groupId];
        const nextTabs = [...group.tabs];
        if (!nextTabs.includes(leftPath)) {
          nextTabs.push(leftPath);
        }
        if (!nextTabs.includes(rightPath)) {
          nextTabs.push(rightPath);
        }
        return {
          ...prev,
          [groupId]: {
            ...group,
            tabs: nextTabs,
            activeTabPath: null,
            diffView: { leftPath, rightPath },
          },
        };
      });
      setActiveGroup(groupId);
    },
    [ensureTabReady, openTabs],
  );

  const handleOpenFile = useCallback(
    async (filePath: string, fileName: string, groupId?: EditorGroupId) => {
      const targetGroup: EditorGroupId = groupId ?? (rightGroupVisible ? activeGroup : 'left');
      await openFileInGroup(filePath, fileName, targetGroup);
      setSelectedFilePaths([filePath]);
    },
    [activeGroup, openFileInGroup, rightGroupVisible],
  );

  const toggleMultiSelectFilePath = useCallback((filePath: string) => {
    setSelectedFilePaths((prev) => {
      if (prev.includes(filePath)) {
        return prev.filter((item) => item !== filePath);
      }
      if (prev.length >= 2) {
        // 文件树多选最多允许 2 个，超过时保留最近一次已选与当前项。
        return [prev[prev.length - 1], filePath];
      }
      return [...prev, filePath];
    });
  }, []);

  const handleCompareSelectedFiles = useCallback(() => {
    if (selectedFilePaths.length !== 2) {
      return;
    }
    void openDiffInGroup(selectedFilePaths[0], selectedFilePaths[1], activeGroup);
  }, [activeGroup, openDiffInGroup, selectedFilePaths]);

  const createTargetDirectoryPath = useMemo(() => selectedDirectoryPath ?? '', [selectedDirectoryPath]);

  const handleCreateFileFromToolbar = useCallback(() => {
    void handleCreateExplorerEntry(createTargetDirectoryPath, 'file');
  }, [createTargetDirectoryPath, handleCreateExplorerEntry]);

  const handleCreateFolderFromToolbar = useCallback(() => {
    void handleCreateExplorerEntry(createTargetDirectoryPath, 'directory');
  }, [createTargetDirectoryPath, handleCreateExplorerEntry]);

  const revealLineInEditor = useCallback((groupId: EditorGroupId, lineNumber: number) => {
    if (lineNumber <= 0) {
      return;
    }
    let attempts = 0;
    const tryReveal = () => {
      const editor = editorInstanceRef.current[groupId];
      if (editor) {
        editor.revealLineInCenter?.(lineNumber);
        editor.setPosition?.({ lineNumber, column: 1 });
        return;
      }
      if (attempts >= 10) {
        return;
      }
      attempts += 1;
      window.setTimeout(tryReveal, 50);
    };
    tryReveal();
  }, []);

  const handleOpenGlobalSearchResult = useCallback(
    async (result: GlobalCodeSearchResult) => {
      const targetGroup: EditorGroupId = rightGroupVisible ? activeGroup : 'left';
      await handleOpenFile(result.path, result.name, targetGroup);
      revealLineInEditor(targetGroup, result.lineNumber);
    },
    [activeGroup, handleOpenFile, revealLineInEditor, rightGroupVisible],
  );

  const runGlobalCodeSearch = useCallback(
    async (inputKeyword?: string) => {
      if (!rootHandle) {
        return;
      }
      const effectiveKeyword = (inputKeyword ?? globalSearchKeywordRef.current).trim();
      if (!effectiveKeyword) {
        globalSearchTaskSeqRef.current += 1;
        setGlobalSearchResults([]);
        setGlobalSearchError(null);
        setGlobalSearching(false);
        return;
      }

      const searchSeq = globalSearchTaskSeqRef.current + 1;
      globalSearchTaskSeqRef.current = searchSeq;
      const searchKeywordLower = effectiveKeyword.toLocaleLowerCase();
      setGlobalSearching(true);
      setGlobalSearchError(null);

      const resultItems: GlobalCodeSearchResult[] = [];
      const resultIndexByPath = new Map<string, number>();
      let scannedFileCount = 0;
      const gitignoreMatcher = searchIncludeGitignored ? null : await readRootGitignoreMatcher(rootHandle);

      const isSearchExpired = () => globalSearchTaskSeqRef.current !== searchSeq;

      const addOrUpdateResult = (item: GlobalCodeSearchResult) => {
        if (resultItems.length >= PROJECT_GLOBAL_SEARCH_MAX_RESULTS && !resultIndexByPath.has(item.path)) {
          return;
        }
        const existingIndex = resultIndexByPath.get(item.path);
        if (existingIndex == null) {
          resultIndexByPath.set(item.path, resultItems.length);
          resultItems.push(item);
          return;
        }
        if (!item.matchByName) {
          resultItems[existingIndex] = item;
        }
      };

      const walkDirectory = async (
        directoryHandle: ExplorerDirectoryHandle,
        currentPath: string,
      ): Promise<void> => {
        if (isSearchExpired() || resultItems.length >= PROJECT_GLOBAL_SEARCH_MAX_RESULTS) {
          return;
        }
        const iterator = directoryHandle.entries();
        for await (const [entryName, entryHandle] of iterator) {
          if (isSearchExpired() || resultItems.length >= PROJECT_GLOBAL_SEARCH_MAX_RESULTS) {
            return;
          }
          const entryPath = joinPath(currentPath, entryName);
          const entryKind = entryHandle.kind as 'file' | 'directory';
          if (!searchIncludeGitignored && shouldIgnoreByGitignore(gitignoreMatcher, entryPath, entryKind)) {
            continue;
          }
          if (entryKind === 'directory') {
            await walkDirectory(entryHandle as ExplorerDirectoryHandle, entryPath);
            continue;
          }

          scannedFileCount += 1;
          if (scannedFileCount % 40 === 0) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
            if (isSearchExpired()) {
              return;
            }
          }

          const fileNameLower = entryName.toLocaleLowerCase();
          const filePathLower = entryPath.toLocaleLowerCase();
          const hitByName = fileNameLower.includes(searchKeywordLower) || filePathLower.includes(searchKeywordLower);
          if (hitByName) {
            addOrUpdateResult({
              path: entryPath,
              name: entryName,
              lineNumber: 1,
              snippet: `文件名匹配：${entryPath}`,
              matchByName: true,
            });
          }

          if (isLikelyBinaryFile(entryName)) {
            continue;
          }

          try {
            const fileHandle = entryHandle as ExplorerFileHandle;
            const file = await fileHandle.getFile();
            if (file.size > PROJECT_GLOBAL_SEARCH_MAX_FILE_BYTES) {
              continue;
            }
            const content = await file.text();
            const matchIndex = content.toLocaleLowerCase().indexOf(searchKeywordLower);
            if (matchIndex >= 0) {
              const { lineNumber, snippet } = extractMatchedLineSnippet(content, matchIndex);
              addOrUpdateResult({
                path: entryPath,
                name: entryName,
                lineNumber,
                snippet,
                matchByName: false,
              });
            }
          } catch {
            // 某些文件可能无法读取，忽略后继续搜索其它文件。
          }
        }
      };

      try {
        await walkDirectory(rootHandle, '');
        if (isSearchExpired()) {
          return;
        }
        setGlobalSearchResults(resultItems);
        setGlobalSearching(false);
      } catch (searchError: any) {
        if (isSearchExpired()) {
          return;
        }
        setGlobalSearchResults([]);
        setGlobalSearching(false);
        setGlobalSearchError(searchError?.message ?? '全局搜索失败');
      }
    },
    [rootHandle, searchIncludeGitignored],
  );

  useEffect(() => {
    if (activeSidebarView !== 'search') {
      return;
    }
    const keyword = globalSearchKeyword.trim();
    if (!keyword) {
      return;
    }
    void runGlobalCodeSearch(keyword);
  }, [activeSidebarView, globalSearchKeyword, runGlobalCodeSearch, searchIncludeGitignored]);

  const handleRebindDirectory = () => {
    if (!activeProject) {
      return;
    }
    const lastPath = getLastRealDirectoryPath();
    const initialPath = lastPath || activeProject.realDirPath || '~/';
    setDirectoryPickerState({
      open: true,
      initialPath,
    });
  };

  const handleConfirmRebindDirectory = useCallback(
    async (payload: { path: string; name: string }) => {
      if (!activeProject) {
        return;
      }

      await updateDirectory(activeProject.id, {
        realDirPath: payload.path,
        rootDirName: payload.name,
      });
      setLastRealDirectoryPath(payload.path);
      setDirectoryPickerState((prev) => ({ ...prev, open: false }));
      setTreeError(null);
      clearError();
      void reloadActiveProjectTree();
    },
    [activeProject, updateDirectory, setLastRealDirectoryPath, clearError, reloadActiveProjectTree],
  );

  const handleExplorerResizeStart = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    resizeStartXRef.current = event.clientX;
    resizeStartWidthRef.current = explorerWidthRef.current;
    setResizingExplorer(true);
  };

  const handleSwitchSidebarView = useCallback(
    (nextView: ProjectSidebarView) => {
      if (explorerCollapsed) {
        setExplorerCollapsed(false);
        setActiveSidebarView(nextView);
        return;
      }
      if (activeSidebarView === nextView) {
        setExplorerCollapsed(true);
        return;
      }
      setActiveSidebarView(nextView);
    },
    [activeSidebarView, explorerCollapsed],
  );

  const handleEditorSplitResizeStart = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!rightGroupVisible) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    editorSplitStartXRef.current = event.clientX;
    editorSplitStartRatioRef.current = editorSplitRatioRef.current;
    setResizingEditorSplit(true);
  };

  const parseTabDragPayload = useCallback(
    (event: React.DragEvent): { path: string; fromGroup: EditorGroupId } | null => {
      const raw = event.dataTransfer.getData('application/x-aiagent-tab');
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { path?: string; fromGroup?: EditorGroupId };
          if (parsed && typeof parsed.path === 'string' && (parsed.fromGroup === 'left' || parsed.fromGroup === 'right')) {
            return { path: parsed.path, fromGroup: parsed.fromGroup };
          }
        } catch {
          // 拖拽载荷解析失败时回退到当前拖拽态。
        }
      }
      return draggingTab;
    },
    [draggingTab],
  );

  const parseExplorerDragPayload = useCallback((event: React.DragEvent): ExplorerDragPayload | null => {
    const raw = event.dataTransfer.getData('application/x-aiagent-explorer-node');
    if (!raw) {
      return draggingExplorerEntryRef.current;
    }
    try {
      const parsed = JSON.parse(raw) as { kind?: string; path?: string; name?: string };
      if ((parsed.kind !== 'file' && parsed.kind !== 'directory') || typeof parsed.path !== 'string') {
        return draggingExplorerEntryRef.current;
      }
      return {
        kind: parsed.kind,
        path: parsed.path,
        name: typeof parsed.name === 'string' ? parsed.name : getFileNameByPath(parsed.path),
      };
    } catch {
      return draggingExplorerEntryRef.current;
    }
  }, []);

  const reorderTabsInGroup = useCallback((groupId: EditorGroupId, draggedPath: string, targetPath: string) => {
    if (draggedPath === targetPath) {
      return;
    }
    setGroups((prev) => {
      const group = prev[groupId];
      const fromIndex = group.tabs.indexOf(draggedPath);
      const toIndex = group.tabs.indexOf(targetPath);
      if (fromIndex < 0 || toIndex < 0) {
        return prev;
      }
      const nextTabs = [...group.tabs];
      nextTabs.splice(fromIndex, 1);
      const insertIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      nextTabs.splice(insertIndex, 0, draggedPath);
      return {
        ...prev,
        [groupId]: {
          ...group,
          tabs: nextTabs,
        },
      };
    });
  }, []);

  const markTabStripScrolling = useCallback((groupId: EditorGroupId) => {
    setTabStripScrolling((prev) => ({ ...prev, [groupId]: true }));
    const timer = tabStripScrollTimerRef.current[groupId];
    if (timer != null) {
      window.clearTimeout(timer);
    }
    tabStripScrollTimerRef.current[groupId] = window.setTimeout(() => {
      setTabStripScrolling((prev) => ({ ...prev, [groupId]: false }));
      tabStripScrollTimerRef.current[groupId] = null;
    }, 700);
  }, []);

  useEffect(() => {
    return () => {
      const leftTimer = tabStripScrollTimerRef.current.left;
      const rightTimer = tabStripScrollTimerRef.current.right;
      if (leftTimer != null) {
        window.clearTimeout(leftTimer);
      }
      if (rightTimer != null) {
        window.clearTimeout(rightTimer);
      }
    };
  }, []);

  const openContextMenuAt = useCallback((event: React.MouseEvent, actions: ContextMenuAction[]) => {
    event.preventDefault();
    if (actions.length === 0) {
      return;
    }
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      actions,
    });
  }, []);

  const clearGroupDiff = useCallback((groupId: EditorGroupId) => {
    setGroups((prev) => ({
      ...prev,
      [groupId]: {
        ...prev[groupId],
        diffView: null,
      },
    }));
  }, []);

  const openTabContextMenu = useCallback(
    (event: React.MouseEvent, groupId: EditorGroupId, filePath: string) => {
      const canSplitLeft = groupId !== 'left';
      const canSplitRight = groupId !== 'right';
      const actions: ContextMenuAction[] = [
        {
          key: 'close',
          label: '关闭',
          onSelect: () => closeTabInGroup(groupId, filePath),
        },
        {
          key: 'close-others',
          label: '关闭其他',
          onSelect: () => closeOtherTabsInGroup(groupId, filePath),
        },
        {
          key: 'close-all',
          label: '全部关闭',
          onSelect: () => closeAllTabsInGroup(groupId),
        },
        {
          key: 'split-left',
          label: '向左拆分',
          disabled: !canSplitLeft,
          onSelect: () => {
            void splitTabToGroup(filePath, groupId, 'left');
          },
        },
        {
          key: 'split-right',
          label: '向右拆分',
          disabled: !canSplitRight,
          onSelect: () => {
            void splitTabToGroup(filePath, groupId, 'right');
          },
        },
      ];
      openContextMenuAt(event, actions);
    },
    [closeAllTabsInGroup, closeOtherTabsInGroup, closeTabInGroup, openContextMenuAt, splitTabToGroup],
  );

  const openExplorerContextMenu = useCallback(
    (event: React.MouseEvent, node: ExplorerEntry) => {
      if (node.kind === 'directory') {
        setSelectedDirectoryPath(node.path);
        openContextMenuAt(event, [
          {
            key: 'toggle-dir',
            label: expandedMap[node.path] ? '折叠目录' : '展开目录',
            onSelect: () => {
              void handleToggleDirectory(node.path);
            },
          },
          {
            key: 'new-file',
            label: '新建文件',
            onSelect: () => {
              void handleCreateExplorerEntry(node.path, 'file');
            },
          },
          {
            key: 'new-folder',
            label: '新建文件夹',
            onSelect: () => {
              void handleCreateExplorerEntry(node.path, 'directory');
            },
          },
          {
            key: 'rename-dir',
            label: '重命名',
            onSelect: () => {
              void handleRenameExplorerEntry(node);
            },
          },
          {
            key: 'delete-dir',
            label: '删除',
            danger: true,
            onSelect: () => {
              void handleDeleteExplorerEntry(node);
            },
          },
        ]);
        return;
      }

      setSelectedDirectoryPath(null);
      const effectiveSelection = selectedFilePaths.includes(node.path) ? selectedFilePaths : [node.path];
      if (!selectedFilePaths.includes(node.path)) {
        setSelectedFilePaths([node.path]);
      }
      const canCompare = effectiveSelection.length === 2;
      const isOpenInAnyGroup = groups.left.tabs.includes(node.path) || groups.right.tabs.includes(node.path);
      openContextMenuAt(event, [
        {
          key: 'open',
          label: '打开',
          onSelect: () => {
            void openFileInGroup(node.path, node.name, activeGroup);
          },
        },
        {
          key: 'open-left',
          label: '在左侧打开',
          onSelect: () => {
            void openFileInGroup(node.path, node.name, 'left');
          },
        },
        {
          key: 'open-right',
          label: '在右侧打开',
          onSelect: () => {
            void openFileInGroup(node.path, node.name, 'right');
          },
        },
        {
          key: 'compare-selected',
          label: '对比所选文件',
          disabled: !canCompare,
          onSelect: () => {
            if (effectiveSelection.length !== 2) {
              return;
            }
            void openDiffInGroup(effectiveSelection[0], effectiveSelection[1], activeGroup);
          },
        },
        {
          key: 'close',
          label: '关闭',
          disabled: !isOpenInAnyGroup,
          onSelect: () => {
            closeTabInGroup('left', node.path);
            closeTabInGroup('right', node.path);
          },
        },
        {
          key: 'rename',
          label: '重命名',
          onSelect: () => {
            void handleRenameExplorerEntry(node);
          },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onSelect: () => {
            void handleDeleteExplorerEntry(node);
          },
        },
      ]);
    },
    [
      activeGroup,
      closeTabInGroup,
      expandedMap,
      groups.left.tabs,
      groups.right.tabs,
      handleCreateExplorerEntry,
      handleDeleteExplorerEntry,
      handleRenameExplorerEntry,
      handleToggleDirectory,
      openContextMenuAt,
      openDiffInGroup,
      openFileInGroup,
      selectedFilePaths,
    ],
  );

  const openExplorerRootContextMenu = useCallback(
    (event: React.MouseEvent) => {
      setSelectedDirectoryPath('');
      openContextMenuAt(event, [
        {
          key: 'root-new-file',
          label: '新建文件',
          onSelect: () => {
            void handleCreateExplorerEntry('', 'file');
          },
        },
        {
          key: 'root-new-folder',
          label: '新建文件夹',
          onSelect: () => {
            void handleCreateExplorerEntry('', 'directory');
          },
        },
        {
          key: 'root-refresh',
          label: '刷新目录',
          onSelect: () => {
            void refreshDirectoryEntries('');
          },
        },
      ]);
    },
    [handleCreateExplorerEntry, openContextMenuAt, refreshDirectoryEntries],
  );

  const renderExplorerNodes = (directoryPath: string, depth: number, ancestorIgnored = false): React.ReactNode => {
    const nodes = childrenMap[directoryPath] ?? [];
    const shouldRenderCreateInput =
      pendingExplorerEdit?.mode === 'create' && pendingExplorerEdit.parentPath === directoryPath;
    const rows: React.ReactNode[] = [];

    nodes.forEach((node) => {
      const isDirectory = node.kind === 'directory';
      const ignoredByGitignore =
        ancestorIgnored || shouldIgnoreByGitignore(gitignoreMatcher, node.path, node.kind);
      const expanded = expandedMap[node.path] === true;
      const isRenamingNode =
        pendingExplorerEdit?.mode === 'rename' && pendingExplorerEdit.targetPath === node.path;
      const isSelectedDirectory = isDirectory && selectedDirectoryPath === node.path;
      const isSelectedFile = !isDirectory && selectedFilePaths.includes(node.path);
      const isActiveFile =
        !isDirectory &&
        ((groups.left.diffView == null && groups.left.activeTabPath === node.path) ||
          (groups.right.diffView == null && groups.right.activeTabPath === node.path));
      const loadingChildren = isDirectory && loadingMap[node.path] === true;
      const iconUrl = isDirectory
        ? resolveProjectFolderIcon(node.name, expanded)
        : resolveProjectFileIcon(node.name);
      const isLoadingFile = !isDirectory && loadingFileMap[node.path] === true;

      rows.push(
        <div key={`${node.kind}:${node.path}`}>
          {isRenamingNode ? (
            <div className="px-2">
              <div
                className="flex h-[24px] w-full items-center gap-1 rounded-md px-2"
                style={{ paddingLeft: `${depth * 16 + 8}px` }}
              >
                {isDirectory ? <TreeChevronIcon expanded={expanded} /> : <span className="inline-block h-3.5 w-3.5 shrink-0" />}
                {iconUrl ? (
                  <img src={iconUrl} alt="" className="h-4 w-4 shrink-0" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-200" />
                )}
                <input
                  ref={pendingExplorerInputRef}
                  value={pendingExplorerEdit?.value ?? ''}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setPendingExplorerEdit((prev) =>
                      prev
                        ? {
                          ...prev,
                          value: nextValue,
                          error: null,
                        }
                        : prev,
                    );
                  }}
                  onBlur={handlePendingExplorerInputBlur}
                  onKeyDown={handlePendingExplorerInputKeyDown}
                  onCompositionStart={handlePendingExplorerCompositionStart}
                  onCompositionEnd={handlePendingExplorerCompositionEnd}
                  className="h-5 min-w-0 flex-1 rounded-sm border border-[rgb(148,163,184)] bg-white px-1 text-xs text-[rgb(13,13,13)] outline-none focus:border-[rgb(59,130,246)]"
                />
              </div>
              {pendingExplorerEdit?.error && (
                <div className="mt-1 px-2" style={{ paddingLeft: `${depth * 16 + 34}px` }}>
                  <p className="rounded-sm bg-rose-800 px-2 py-1 text-[11px] leading-4 text-white">
                    {pendingExplorerEdit.error}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              draggable
              onClick={(event) => {
                if (isDirectory) {
                  setSelectedDirectoryPath(node.path);
                  void handleToggleDirectory(node.path);
                  return;
                }
                setSelectedDirectoryPath(null);
                if (event.metaKey || event.ctrlKey || event.shiftKey) {
                  toggleMultiSelectFilePath(node.path);
                  return;
                }
                setSelectedFilePaths([node.path]);
                void handleOpenFile(node.path, node.name);
              }}
              onDragStart={(event) => {
                const payload: ExplorerDragPayload = { kind: node.kind, path: node.path, name: node.name };
                draggingExplorerEntryRef.current = payload;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('application/x-aiagent-explorer-node', JSON.stringify(payload));
                event.dataTransfer.setData('text/plain', node.path);
              }}
              onDragEnd={() => {
                draggingExplorerEntryRef.current = null;
                setDragOverDirectoryPath(null);
              }}
              onDragOver={(event) => {
                if (!isDirectory) {
                  return;
                }
                const payload = parseExplorerDragPayload(event);
                if (!payload) {
                  return;
                }
                if (payload.path === node.path) {
                  return;
                }
                if (payload.kind === 'directory' && isPathEqualOrChild(node.path, payload.path)) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = 'move';
                if (dragOverDirectoryPath !== node.path) {
                  setDragOverDirectoryPath(node.path);
                }
              }}
              onDragLeave={(event) => {
                if (!isDirectory) {
                  return;
                }
                const nextTarget = event.relatedTarget as Node | null;
                if (nextTarget && event.currentTarget.contains(nextTarget)) {
                  return;
                }
                if (dragOverDirectoryPath === node.path) {
                  setDragOverDirectoryPath(null);
                }
              }}
              onDrop={(event) => {
                if (!isDirectory) {
                  return;
                }
                const payload = parseExplorerDragPayload(event);
                if (!payload) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setDragOverDirectoryPath(null);
                handleRequestMoveExplorerEntryToDirectory(payload, node.path);
              }}
              onContextMenu={(event) => {
                openExplorerContextMenu(event, node);
              }}
              className={`flex h-[24px] w-full items-center gap-1 rounded-md px-2 text-left text-xs transition-colors ${isDirectory && dragOverDirectoryPath === node.path
                ? 'bg-[rgb(239,239,239)] text-[rgb(13,13,13)]'
                : isSelectedDirectory || isSelectedFile || isActiveFile
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
              <span className={`truncate ${ignoredByGitignore ? 'text-[rgb(143,143,143)]' : ''}`}>{node.name}</span>
              {isLoadingFile && (
                <span className={`ml-1 text-xs ${ignoredByGitignore ? 'text-[rgb(143,143,143)]' : 'text-slate-400'}`}>读取中...</span>
              )}
            </button>
          )}
          {isDirectory && expanded && (
            <>
              {loadingChildren && (
                <p className={`px-3 py-1 text-xs ${ignoredByGitignore ? 'text-[rgb(143,143,143)]' : 'text-slate-400'}`}>
                  加载中...
                </p>
              )}
              {renderExplorerNodes(node.path, depth + 1, ignoredByGitignore)}
            </>
          )}
        </div>,
      );
    });

    if (shouldRenderCreateInput) {
      const pendingIconUrl =
        pendingExplorerEdit.kind === 'directory'
          ? resolveProjectFolderIcon('new-folder', false)
          : resolveProjectFileIcon('new-file.txt');
      rows.push(
        <div key={`pending-create:${directoryPath || '__root__'}`}>
          <div className="px-2">
            <div className="flex h-[24px] w-full items-center gap-1 rounded-md px-2" style={{ paddingLeft: `${depth * 16 + 8}px` }}>
              {pendingExplorerEdit.kind === 'directory' ? (
                <TreeChevronIcon expanded={false} />
              ) : (
                <span className="inline-block h-3.5 w-3.5 shrink-0" />
              )}
              {pendingIconUrl ? (
                <img src={pendingIconUrl} alt="" className="h-4 w-4 shrink-0" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-sm bg-slate-200" />
              )}
              <input
                ref={pendingExplorerInputRef}
                value={pendingExplorerEdit.value}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setPendingExplorerEdit((prev) =>
                    prev
                      ? {
                        ...prev,
                        value: nextValue,
                        error: null,
                      }
                      : prev,
                  );
                }}
                onBlur={handlePendingExplorerInputBlur}
                onKeyDown={handlePendingExplorerInputKeyDown}
                onCompositionStart={handlePendingExplorerCompositionStart}
                onCompositionEnd={handlePendingExplorerCompositionEnd}
                className="h-5 min-w-0 flex-1 rounded-sm border border-[rgb(148,163,184)] bg-white px-1 text-xs text-[rgb(13,13,13)] outline-none focus:border-[rgb(59,130,246)]"
                placeholder={pendingExplorerEdit.kind === 'directory' ? '新建文件夹' : '新建文件'}
              />
            </div>
          </div>
          {pendingExplorerEdit.error && (
            <div className="mt-1 px-2" style={{ paddingLeft: `${depth * 16 + 34}px` }}>
              <p className="rounded-sm bg-rose-800 px-2 py-1 text-[11px] leading-4 text-white">
                {pendingExplorerEdit.error}
              </p>
            </div>
          )}
        </div>,
      );
    }

    if (rows.length === 0) {
      return null;
    }
    return rows;
  };

  const renderRootNode = (): React.ReactNode => {
    if (!activeProject) {
      return null;
    }

    const rootExpanded = expandedMap[''] !== false;
    const rootIconUrl = resolveProjectFolderIcon(activeProject.rootDirName, rootExpanded);
    const rootChildren = childrenMap[''] ?? [];
    const rootLoading = loadingRoot || loadingMap[''] === true;
    const hasRootPendingCreate = pendingExplorerEdit?.mode === 'create' && pendingExplorerEdit.parentPath === '';

    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setSelectedDirectoryPath('');
            void handleToggleDirectory('');
          }}
          onContextMenu={openExplorerRootContextMenu}
          onDragOver={(event) => {
            const payload = parseExplorerDragPayload(event);
            if (!payload) {
              return;
            }
            if (payload.path === '' || splitParentPathAndName(payload.path).parentPath === '') {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            if (dragOverDirectoryPath !== '') {
              setDragOverDirectoryPath('');
            }
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget as Node | null;
            if (nextTarget && event.currentTarget.contains(nextTarget)) {
              return;
            }
            if (dragOverDirectoryPath === '') {
              setDragOverDirectoryPath(null);
            }
          }}
          onDrop={(event) => {
            const payload = parseExplorerDragPayload(event);
            if (!payload) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            setDragOverDirectoryPath(null);
            handleRequestMoveExplorerEntryToDirectory(payload, '');
          }}
          className={`flex h-[24px] w-full items-center gap-1 rounded-md px-2 text-left text-xs text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] ${dragOverDirectoryPath === '' || selectedDirectoryPath === '' ? 'bg-[rgb(239,239,239)]' : ''
            }`}
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
            ) : rootChildren.length === 0 && !hasRootPendingCreate ? (
              <p className="px-3 py-1 text-xs text-slate-400">目录为空，或暂未读取到文件。</p>
            ) : (
              renderExplorerNodes('', 1)
            )}
          </>
        )}
      </div>
    );
  };

  const selectedDirectoryLabel = useMemo(() => {
    if (selectedDirectoryPath == null || selectedDirectoryPath === '') {
      return '根目录';
    }
    return getFileNameByPath(selectedDirectoryPath);
  }, [selectedDirectoryPath]);

  const associatedDirectoryAbsolutePath = useMemo(() => {
    if (!activeProject) {
      return '-';
    }
    return activeProject.realDirPath || '未关联真实目录';
  }, [activeProject]);

  const moveDialogTargetLabel = useMemo(() => {
    if (!pendingMoveDialog) {
      return '';
    }
    if (pendingMoveDialog.targetDirectoryPath === '') {
      return activeProject?.rootDirName ?? '根目录';
    }
    return getFileNameByPath(pendingMoveDialog.targetDirectoryPath);
  }, [activeProject?.rootDirName, pendingMoveDialog]);

  const renderGroupContent = (groupId: EditorGroupId): React.ReactNode => {
    const group = groups[groupId];
    if (group.diffView) {
      const leftTab = openTabs[group.diffView.leftPath];
      const rightTab = openTabs[group.diffView.rightPath];
      if (!leftTab || !rightTab) {
        return <div className="flex h-full items-center justify-center text-sm text-slate-400">Diff 文件未就绪</div>;
      }
      if (leftTab.loadError || rightTab.loadError) {
        return (
          <div className="h-full overflow-y-auto p-4 text-sm text-rose-500">
            {leftTab.loadError || rightTab.loadError || '文件读取失败'}
          </div>
        );
      }
      return (
        <DiffEditor
          height="100%"
          language={leftTab.language || rightTab.language || 'plaintext'}
          original={leftTab.content}
          modified={rightTab.content}
          theme={theme === 'dark' ? 'vs-dark' : 'vs'}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            automaticLayout: true,
            scrollBeyondLastLine: false,
            renderSideBySide: true,
            originalEditable: false,
            readOnly: true,
          }}
        />
      );
    }

    if (!group.activeTabPath) {
      return <div className="flex h-full items-center justify-center text-sm text-slate-400">请在左侧选择文件打开</div>;
    }

    const activeTab = openTabs[group.activeTabPath];
    if (!activeTab) {
      return <div className="flex h-full items-center justify-center text-sm text-slate-400">文件未加载</div>;
    }
    if (activeTab.loadError) {
      return <div className="h-full overflow-y-auto p-4 text-sm text-rose-500">{activeTab.loadError}</div>;
    }
    const readOnlyByType = isLikelyBinaryFile(activeTab.name);
    return (
      <Editor
        height="100%"
        language={activeTab.language}
        value={activeTab.content}
        theme={theme === 'dark' ? 'vs-dark' : 'vs'}
        onChange={(value) => {
          if (readOnlyByType) {
            return;
          }
          handleEditorContentChange(group.activeTabPath, value ?? '');
        }}
        onMount={(editor) => {
          editorInstanceRef.current[groupId] = editor;
          editor.onDidFocusEditorText(() => {
            setActiveGroup(groupId);
          });
          editor.onDidDispose(() => {
            if (editorInstanceRef.current[groupId] === editor) {
              editorInstanceRef.current[groupId] = null;
            }
          });
        }}
        options={{
          readOnly: readOnlyByType,
          minimap: { enabled: true },
          fontSize: 13,
          wordWrap: 'on',
          automaticLayout: true,
          scrollBeyondLastLine: false,
        }}
      />
    );
  };

  const renderEditorGroup = (groupId: EditorGroupId, extraClassName = ''): React.ReactNode => {
    const group = groups[groupId];
    const diffLabel = group.diffView
      ? `${getFileNameByPath(group.diffView.leftPath)} ↔ ${getFileNameByPath(group.diffView.rightPath)}`
      : null;
    const hasAnyTab = group.tabs.length > 0 || group.diffView != null;
    return (
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${extraClassName}`}
        onMouseDown={() => setActiveGroup(groupId)}
        onDragOver={(event) => {
          const tabPayload = parseTabDragPayload(event);
          const explorerPayload = parseExplorerDragPayload(event);
          const canDropExplorerFile = explorerPayload?.kind === 'file';
          if (!tabPayload && !canDropExplorerFile) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = canDropExplorerFile ? 'copy' : 'move';
        }}
        onDrop={(event) => {
          const explorerPayload = parseExplorerDragPayload(event);
          if (explorerPayload) {
            event.preventDefault();
            if (explorerPayload.kind === 'file') {
              void handleOpenFile(explorerPayload.path, explorerPayload.name, groupId);
            }
            setDraggingTab(null);
            return;
          }
          const payload = parseTabDragPayload(event);
          if (!payload) {
            return;
          }
          event.preventDefault();
          if (payload.fromGroup !== groupId) {
            void moveTabToGroup(payload.path, payload.fromGroup, groupId);
          }
          setDraggingTab(null);
        }}
      >
        <div
          className={`project-tab-scroll flex h-9 items-center gap-0 overflow-x-auto overflow-y-hidden border-b border-[rgb(209,209,209)] bg-white px-1 ${draggingTab && draggingTab.fromGroup !== groupId ? 'bg-[rgb(245,245,245)]' : ''
            } ${tabStripScrolling[groupId] ? 'is-scrolling' : ''}`}
          onScroll={() => {
            markTabStripScrolling(groupId);
          }}
          onDragOver={(event) => {
            const tabPayload = parseTabDragPayload(event);
            const explorerPayload = parseExplorerDragPayload(event);
            const canDropExplorerFile = explorerPayload?.kind === 'file';
            if (!tabPayload && !canDropExplorerFile) {
              return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = canDropExplorerFile ? 'copy' : 'move';
          }}
          onDrop={(event) => {
            event.preventDefault();
            const explorerPayload = parseExplorerDragPayload(event);
            if (explorerPayload) {
              if (explorerPayload.kind === 'file') {
                void handleOpenFile(explorerPayload.path, explorerPayload.name, groupId);
              }
              setDraggingTab(null);
              return;
            }
            const payload = parseTabDragPayload(event);
            if (!payload) {
              return;
            }
            if (payload.fromGroup !== groupId) {
              void moveTabToGroup(payload.path, payload.fromGroup, groupId);
            }
            setDraggingTab(null);
          }}
        >
          {group.tabs.map((tabPath) => {
            const tab = openTabs[tabPath];
            const tabName = tab?.name ?? getFileNameByPath(tabPath);
            const isActive = group.diffView == null && group.activeTabPath === tabPath;
            const isDirty = dirtyFileMap[tabPath] === true;
            const isSaving = savingFileMap[tabPath] === true;
            const saveError = saveErrorMap[tabPath];
            return (
              <div
                key={`${groupId}:${tabPath}`}
                onContextMenu={(event) => openTabContextMenu(event, groupId, tabPath)}
                draggable
                onDragStart={(event) => {
                  const payload = { path: tabPath, fromGroup: groupId };
                  setDraggingTab(payload);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('application/x-aiagent-tab', JSON.stringify(payload));
                  event.dataTransfer.setData('text/plain', tabPath);
                }}
                onDragEnd={() => {
                  setDraggingTab(null);
                }}
                onDragOver={(event) => {
                  const payload = parseTabDragPayload(event);
                  if (!payload) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const payload = parseTabDragPayload(event);
                  if (!payload) {
                    return;
                  }
                  if (payload.fromGroup === groupId) {
                    reorderTabsInGroup(groupId, payload.path, tabPath);
                  } else {
                    void moveTabToGroup(payload.path, payload.fromGroup, groupId).then(() => {
                      reorderTabsInGroup(groupId, payload.path, tabPath);
                    });
                  }
                  setDraggingTab(null);
                }}
                className={`group flex h-6 max-w-[220px] shrink-0 items-center rounded-md border px-2 text-sm ${isActive
                  ? 'border-[rgb(209,209,209)] bg-[rgb(245,245,245)] text-[rgb(13,13,13)]'
                  : 'border-transparent bg-transparent text-slate-500 hover:bg-[rgb(245,245,245)]'
                  }`}
                title={saveError ? `${tabPath}\n保存失败：${saveError}` : tabPath}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  onClick={() => {
                    setGroups((prev) => ({
                      ...prev,
                      [groupId]: {
                        ...prev[groupId],
                        activeTabPath: tabPath,
                        diffView: null,
                      },
                    }));
                    setActiveGroup(groupId);
                  }}
                >
                  {tabName}
                </button>
                {saveError ? (
                  <span className="ml-1 text-[10px] leading-none text-rose-500" title={saveError}>
                    !
                  </span>
                ) : isSaving ? (
                  <span className="ml-1 text-[10px] leading-none text-slate-400" title="保存中">
                    …
                  </span>
                ) : isDirty ? (
                  <span className="ml-1 text-[10px] leading-none text-amber-500" title="未保存">
                    ●
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded text-sm leading-none text-slate-400 hover:bg-[rgb(234,234,234)] hover:text-[rgb(13,13,13)]"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTabInGroup(groupId, tabPath);
                  }}
                  title="关闭"
                >
                  ×
                </button>
              </div>
            );
          })}

          {diffLabel && (
            <div
              className="group flex h-8 max-w-[280px] shrink-0 items-center rounded-md border border-[rgb(209,209,209)] bg-[rgb(245,245,245)] px-2 text-sm text-[rgb(13,13,13)]"
              onContextMenu={(event) => {
                openContextMenuAt(event, [
                  {
                    key: 'close-diff',
                    label: '关闭',
                    onSelect: () => clearGroupDiff(groupId),
                  },
                  {
                    key: 'close-all',
                    label: '全部关闭',
                    onSelect: () => closeAllTabsInGroup(groupId),
                  },
                ]);
              }}
              title={diffLabel}
            >
              <span className="min-w-0 flex-1 truncate">{diffLabel}</span>
              <button
                type="button"
                className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded text-xs leading-none text-slate-400 hover:bg-[rgb(234,234,234)] hover:text-[rgb(13,13,13)]"
                onClick={(event) => {
                  event.stopPropagation();
                  clearGroupDiff(groupId);
                }}
                title="关闭"
              >
                ×
              </button>
            </div>
          )}
          {!hasAnyTab && <div className="px-2 text-xs text-slate-400">未打开文件</div>}
        </div>
        <div className="min-h-0 flex-1">{renderGroupContent(groupId)}</div>
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 overflow-hidden">
        <div
          className={`flex w-12 shrink-0 flex-col items-center border-r border-[rgb(209,209,209)] py-2 ${theme === 'dark' ? 'bg-[#1b1b1b]' : 'bg-[#f5f5f5]'
            }`}
        >
          <button
            type="button"
            onClick={() => handleSwitchSidebarView('explorer')}
            className={`relative mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${!explorerCollapsed && activeSidebarView === 'explorer' && theme === 'dark'
              ? 'bg-[#2a2a2a] text-slate-100'
              : !explorerCollapsed && activeSidebarView === 'explorer'
                ? 'border border-[rgb(209,209,209)] bg-white text-[rgb(13,13,13)]'
                : theme === 'dark'
                  ? 'text-slate-300 hover:bg-[#2a2a2a]'
                  : 'text-[rgb(13,13,13)] hover:bg-[rgb(239,239,239)]'
              }`}
            title="资源管理器"
          >
            {!explorerCollapsed && activeSidebarView === 'explorer' && (
              <span className="absolute left-[-1px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[#2563eb]" />
            )}
            <Files className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleSwitchSidebarView('search')}
            className={`relative mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${!explorerCollapsed && activeSidebarView === 'search' && theme === 'dark'
              ? 'bg-[#2a2a2a] text-slate-100'
              : !explorerCollapsed && activeSidebarView === 'search'
                ? 'border border-[rgb(209,209,209)] bg-white text-[rgb(13,13,13)]'
                : theme === 'dark'
                  ? 'text-slate-300 hover:bg-[#2a2a2a]'
                  : 'text-[rgb(13,13,13)] hover:bg-[rgb(239,239,239)]'
              }`}
            title="搜索"
          >
            {!explorerCollapsed && activeSidebarView === 'search' && (
              <span className="absolute left-[-1px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r bg-[#2563eb]" />
            )}
            <Search className="w-4 h-4" />
          </button>
        </div>

        {!explorerCollapsed && (
          <aside
            className="relative flex shrink-0 flex-col border-r border-[rgb(209,209,209)] bg-[#f7f7f8]"
            style={{ width: `${explorerWidth}px` }}
          >
            <div className="flex h-10 items-center px-2">
              <button
                type="button"
                onClick={onBackToChat}
                className="text-xs inline-flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 font-normal text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
              >
                <ArrowLeft className="w-4 h-4" />
                <span className="leading-none [word-break:keep-all]">返回</span>
              </button>
              <div className="ml-auto flex shrink-0 items-center gap-0.5">
                {activeSidebarView === 'explorer' && (
                  <>
                    <button
                      type="button"
                      onClick={handleCreateFileFromToolbar}
                      disabled={!activeProject}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                      title={`新建文件（目标：${selectedDirectoryLabel}）`}
                    >
                      <FilePlus2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCreateFolderFromToolbar}
                      disabled={!activeProject}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                      title={`新建文件夹（目标：${selectedDirectoryLabel}）`}
                    >
                      <FolderPlus className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCompareSelectedFiles}
                      disabled={selectedFilePaths.length !== 2}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                      title={selectedFilePaths.length === 2 ? '对比所选文件' : '先在文件树中多选两个文件'}
                    >
                      <Columns2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                {activeSidebarView === 'explorer' && (
                  <button
                    type="button"
                    onClick={() => {
                      void reloadActiveProjectTree();
                    }}
                    disabled={!activeProject || loadingRoot}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="刷新目录"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                {activeSidebarView === 'explorer' && (
                  <button
                    type="button"
                    onClick={() => void handleRebindDirectory()}
                    disabled={!activeProject}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="重新关联目录"
                  >
                    <Link className="w-4 h-4" />
                  </button>
                )}
                {activeSidebarView === 'explorer' && (
                  <button
                    type="button"
                    onClick={onRequestCreateProject}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
                    title="新建项目"
                  >
                    <FolderRoot className="w-4 h-4" />
                  </button>
                )}
                {activeSidebarView === 'explorer' && (
                  <button
                    type="button"
                    onClick={() => setDirectoryInfoDialogOpen(true)}
                    disabled={!activeProject}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="查看关联目录信息"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="px-3 py-1 text-xs font-semibold tracking-wide text-slate-500">
              {activeSidebarView === 'search' ? '搜索' : '资源管理器'}
            </div>

            {activeSidebarView === 'search' && (
              <div className="px-2 py-2">
                <div className="flex items-center gap-1.5">
                  <div className="relative min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">
                      <Search className="w-4 h-4" />
                    </span>
                    <input
                      ref={globalSearchInputRef}
                      value={globalSearchKeyword}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setGlobalSearchKeyword(nextValue);
                        if (!nextValue.trim()) {
                          globalSearchTaskSeqRef.current += 1;
                          setGlobalSearchResults([]);
                          setGlobalSearching(false);
                          setGlobalSearchError(null);
                        }
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter') {
                          return;
                        }
                        event.preventDefault();
                        void runGlobalCodeSearch(event.currentTarget.value);
                      }}
                      placeholder="搜索代码"
                      className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white pl-8 pr-8 text-xs text-[rgb(13,13,13)] outline-none transition-colors placeholder:text-[rgb(143,143,143)] focus:border-[rgb(148,163,184)]"
                    />
                    {globalSearchKeyword && (
                      <button
                        type="button"
                        onClick={() => {
                          globalSearchTaskSeqRef.current += 1;
                          setGlobalSearchKeyword('');
                          setGlobalSearchResults([]);
                          setGlobalSearching(false);
                          setGlobalSearchError(null);
                        }}
                        className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-sm text-slate-400 hover:bg-[rgb(239,239,239)] hover:text-[rgb(13,13,13)]"
                        title="清空搜索"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void runGlobalCodeSearch(globalSearchKeyword);
                    }}
                    disabled={!globalSearchKeyword.trim()}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[rgb(209,209,209)] bg-white text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)] disabled:cursor-not-allowed disabled:opacity-40"
                    title="执行搜索"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                </div>

                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 px-0.5 text-[11px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={searchIncludeGitignored}
                    onChange={(event) => {
                      setSearchIncludeGitignored(event.target.checked);
                    }}
                    className="h-3.5 w-3.5 rounded border-[rgb(209,209,209)] text-[rgb(13,13,13)] focus:ring-0"
                  />
                  <span>包含 .gitignore 忽略项</span>
                </label>
              </div>
            )}

            {(error || treeError) && (
              <div className="bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {treeError || error}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto px-1">
              {!activeProject ? (
                <div className="space-y-3 px-2 py-3">
                  <p className="text-sm text-slate-500">未打开项目</p>
                  <Button size="sm" onClick={onRequestCreateProject}>
                    新建项目
                  </Button>
                </div>
              ) : activeSidebarView === 'search' ? (
                globalSearchKeyword.trim().length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-400">输入关键字后按 Enter 搜索代码</p>
                ) : globalSearching ? (
                  <p className="px-2 py-2 text-xs text-slate-400">正在全局搜索...</p>
                ) : globalSearchError ? (
                  <p className="px-2 py-2 text-xs text-rose-500">{globalSearchError}</p>
                ) : globalSearchResults.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-slate-400">未搜索到匹配代码</p>
                ) : (
                  <div className="space-y-1">
                    {globalSearchResults.map((result) => (
                      <button
                        key={`${result.path}:${result.lineNumber}`}
                        type="button"
                        onClick={() => {
                          void handleOpenGlobalSearchResult(result);
                        }}
                        className="flex w-full flex-col rounded-md px-2 py-1.5 text-left text-xs text-[rgb(13,13,13)] transition-colors hover:bg-[rgb(239,239,239)]"
                        title={`${result.path}:${result.lineNumber}`}
                      >
                        <span className="truncate font-medium">{result.name}</span>
                        <span className="truncate text-[11px] text-slate-400">{result.path}</span>
                        <span className="mt-0.5 truncate text-[11px] text-slate-500">
                          第 {result.lineNumber} 行 · {result.snippet}
                        </span>
                      </button>
                    ))}
                  </div>
                )
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
          ) : rightGroupVisible ? (
            <div ref={editorSplitContainerRef} className="flex h-full min-h-0 min-w-0">
              <div className="flex h-full min-h-0 min-w-0 sh  rink-0 overflow-hidden" style={{ flexBasis: `${editorSplitRatio * 100}%` }}>
                {renderEditorGroup('left')}
              </div>
              <button
                type="button"
                aria-label="调整编辑区分栏宽度"
                onMouseDown={handleEditorSplitResizeStart}
                className="relative z-10 h-full w-[7px] shrink-0 cursor-col-resize bg-transparent hover:bg-slate-300/60"
              >
                <span className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded bg-slate-300/90" />
              </button>
              <div className="flex h-full min-h-0 min-w-0 shrink-0 overflow-hidden" style={{ flexBasis: `${(1 - editorSplitRatio) * 100}%` }}>
                {renderEditorGroup('right')}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-0 min-w-0">{renderEditorGroup('left')}</div>
          )}
        </div>
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[120] min-w-[180px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.actions.map((action) => (
            <button
              key={action.key}
              type="button"
              disabled={action.disabled}
              className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors ${action.disabled
                ? 'cursor-not-allowed text-slate-300'
                : action.danger
                  ? 'text-rose-500 hover:bg-rose-50'
                  : 'text-[rgb(13,13,13)] hover:bg-[rgb(245,245,245)]'
                }`}
              onClick={() => {
                if (action.disabled) {
                  return;
                }
                action.onSelect();
                setContextMenu(null);
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      <Dialog
        open={deleteDialog.entry != null}
        onClose={() => {
          if (deleteDialog.submitting) {
            return;
          }
          setDeleteDialog({ entry: null, submitting: false, error: null });
        }}
        title="确认删除"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[rgb(13,13,13)]">
            {`确定删除${deleteDialog.entry?.kind === 'directory' ? '文件夹' : '文件'} “${deleteDialog.entry?.name ?? ''}” 吗？`}
          </p>
          <p className="text-xs text-slate-500">
            {deleteDialog.entry?.kind === 'directory'
              ? '删除文件夹会同时移除其所有子文件与子目录，此操作不可撤销。'
              : '删除后不可撤销。'}
          </p>
          {deleteDialog.error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{deleteDialog.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={deleteDialog.submitting}
              onClick={() => {
                setDeleteDialog({ entry: null, submitting: false, error: null });
              }}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={deleteDialog.submitting}
              onClick={() => {
                void handleConfirmDeleteExplorerEntry();
              }}
            >
              {deleteDialog.submitting ? '删除中...' : '确认删除'}
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={pendingMoveDialog != null}
        onClose={() => {
          if (pendingMoveDialog?.submitting) {
            return;
          }
          setPendingMoveDialog(null);
        }}
        title="确认移动"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-[rgb(13,13,13)]">
            将
            <span className="font-semibold"> {pendingMoveDialog?.payload.name ?? ''} </span>
            移动到
            <span className="font-semibold"> {moveDialogTargetLabel} </span>
            吗？
          </p>
          <p className="text-xs text-slate-500">
            目录移动会同时移动其所有子文件和子目录。
          </p>
          {pendingMoveDialog?.error && (
            <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{pendingMoveDialog.error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={pendingMoveDialog?.submitting}
              onClick={() => setPendingMoveDialog(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={pendingMoveDialog?.submitting}
              onClick={() => {
                void handleConfirmMoveExplorerEntry();
              }}
            >
              {pendingMoveDialog?.submitting ? '移动中...' : '确认移动'}
            </Button>
          </div>
        </div>
      </Dialog>
      <DirectoryPickerDialog
        open={directoryPickerState.open}
        title="重新关联真实目录"
        initialPath={directoryPickerState.initialPath}
        description="选择目标目录后点击确定，将更新项目关联的真实目录。"
        onClose={() => {
          setDirectoryPickerState((prev) => ({ ...prev, open: false }));
        }}
        onConfirm={handleConfirmRebindDirectory}
      />
      <Dialog
        open={directoryInfoDialogOpen}
        onClose={() => setDirectoryInfoDialogOpen(false)}
        title="关联目录信息"
        size="sm"
      >
        <div className="space-y-2 text-sm text-[rgb(13,13,13)]">
          <p>
            项目：<span className="font-semibold">{activeProject?.name ?? '-'}</span>
          </p>
          <p className="break-all">
            关联目录：<span className="font-semibold">{associatedDirectoryAbsolutePath}</span>
          </p>
        </div>
      </Dialog>
    </div>
  );
};

export default ProjectsPage;
