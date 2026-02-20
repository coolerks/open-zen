import { get } from './client';
import type { DirectoryBrowseResult } from '../types';

export const filesystemApi = {
  listDirectories: (path?: string) => {
    if (!path || !path.trim()) {
      return get<DirectoryBrowseResult>('/filesystem/directories');
    }
    return get<DirectoryBrowseResult>(`/filesystem/directories?path=${encodeURIComponent(path)}`);
  },
};
