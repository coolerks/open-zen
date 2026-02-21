import { del, get, post, put } from './client';
import type {
  ProjectFsDirectoryResult,
  ProjectFsEntry,
  ProjectFsFileMetaResult,
  ProjectFsFileResult,
} from '../types';

type CreateEntryRequest = {
  parentPath: string;
  name: string;
  kind: 'file' | 'directory';
};

type WriteFileRequest = {
  path: string;
  content: string;
  expectedRevision?: string | null;
  clientId?: string;
};

type MoveEntryRequest = {
  sourcePath: string;
  targetDirectoryPath: string;
  targetName?: string;
};

type WatchInterestsRequest = {
  clientId: string;
  openFiles: string[];
  expandedDirs: string[];
};

function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

export const projectFilesystemApi = {
  listEntries: (projectId: string, path: string) =>
    get<ProjectFsDirectoryResult>(
      `/projects/${encodeProjectId(projectId)}/filesystem/entries?path=${encodeURIComponent(path)}`,
    ),

  readFile: (projectId: string, path: string) =>
    get<ProjectFsFileResult>(
      `/projects/${encodeProjectId(projectId)}/filesystem/file?path=${encodeURIComponent(path)}`,
    ),

  readFileWithOptions: (projectId: string, path: string, allowLargeFile: boolean) =>
    get<ProjectFsFileResult>(
      `/projects/${encodeProjectId(projectId)}/filesystem/file?path=${encodeURIComponent(path)}&allowLargeFile=${allowLargeFile ? 'true' : 'false'}`,
    ),

  writeFile: (projectId: string, payload: WriteFileRequest) =>
    put<ProjectFsFileResult>(`/projects/${encodeProjectId(projectId)}/filesystem/file`, payload),

  readFileMeta: (projectId: string, path: string) =>
    get<ProjectFsFileMetaResult>(
      `/projects/${encodeProjectId(projectId)}/filesystem/file/meta?path=${encodeURIComponent(path)}`,
    ),

  createEntry: (projectId: string, payload: CreateEntryRequest) =>
    post<ProjectFsEntry>(`/projects/${encodeProjectId(projectId)}/filesystem/entries`, payload),

  deleteEntry: (projectId: string, path: string, recursive: boolean) =>
    del<void>(
      `/projects/${encodeProjectId(projectId)}/filesystem/entries?path=${encodeURIComponent(path)}&recursive=${recursive ? 'true' : 'false'}`,
    ),

  moveEntry: (projectId: string, payload: MoveEntryRequest) =>
    post<ProjectFsEntry>(`/projects/${encodeProjectId(projectId)}/filesystem/entries/move`, payload),

  openWatchStream: (projectId: string, clientId: string) =>
    new EventSource(
      `/api/projects/${encodeProjectId(projectId)}/filesystem/stream?clientId=${encodeURIComponent(clientId)}`,
    ),

  updateWatchInterests: (projectId: string, payload: WatchInterestsRequest) =>
    post<void>(`/projects/${encodeProjectId(projectId)}/filesystem/stream/interests`, payload),
};
