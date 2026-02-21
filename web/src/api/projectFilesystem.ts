import { del, get, post, put } from './client';
import type { ProjectFsDirectoryResult, ProjectFsEntry, ProjectFsFileResult } from '../types';

type CreateEntryRequest = {
  parentPath: string;
  name: string;
  kind: 'file' | 'directory';
};

type WriteFileRequest = {
  path: string;
  content: string;
};

type MoveEntryRequest = {
  sourcePath: string;
  targetDirectoryPath: string;
  targetName?: string;
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

  writeFile: (projectId: string, payload: WriteFileRequest) =>
    put<ProjectFsFileResult>(`/projects/${encodeProjectId(projectId)}/filesystem/file`, payload),

  createEntry: (projectId: string, payload: CreateEntryRequest) =>
    post<ProjectFsEntry>(`/projects/${encodeProjectId(projectId)}/filesystem/entries`, payload),

  deleteEntry: (projectId: string, path: string, recursive: boolean) =>
    del<void>(
      `/projects/${encodeProjectId(projectId)}/filesystem/entries?path=${encodeURIComponent(path)}&recursive=${recursive ? 'true' : 'false'}`,
    ),

  moveEntry: (projectId: string, payload: MoveEntryRequest) =>
    post<ProjectFsEntry>(`/projects/${encodeProjectId(projectId)}/filesystem/entries/move`, payload),
};
