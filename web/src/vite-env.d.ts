/// <reference types="vite/client" />

declare module '*?raw' {
  const content: string;
  export default content;
}

// 文件系统访问 API 的补充类型，兼容部分 TS DOM 声明缺失的场景。
declare type FileSystemPermissionMode = 'read' | 'readwrite';
declare type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

declare interface FileSystemHandlePermissionDescriptor {
  mode?: FileSystemPermissionMode;
}

declare interface FileSystemDirectoryHandle {
  queryPermission?: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<FileSystemPermissionState>;
  requestPermission?: (
    descriptor?: FileSystemHandlePermissionDescriptor,
  ) => Promise<FileSystemPermissionState>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
}
