# 项目中心 (Project Center)

项目中心是 Open Zen 的核心功能模块之一，为用户提供类 IDE 的本地代码资源管理、预览、对比与实时同步能力。它是构建 Code Agent（编程智能体）能力的基础。

## 模块总览

项目中心允许用户将本地文件系统中的目录关联到 Open Zen 中。用户可以在浏览器内高效地浏览项目结构、阅读代码、搜索内容，并在多个文件之间进行对比。

### 核心特性

- **本地关联**：通过浏览器 File System Access API 直接访问本地目录，不上传代码到服务器。
- **IDE 体验**：VS Code 风格的资源管理器、多标签页编辑器、双栏分栏布局。
- **实时同步**：基于 SSE (Server-Sent Events) 与 Java NIO WatchService 实现的文件系统变更实时感应。
- **全局搜索**：支持文件名与内容搜索，自动遵循 `.gitignore` 规则。
- **文件对比**：内置 Monaco DiffEditor，支持任意两个文件的版本或内容对比。

## 核心文件清单

### 后端 (Java/Spring Boot)
- `ProjectController.java`: 项目元数据 CRUD 接口。
- `ProjectFilesystemController.java`: 文件系统操作接口（读取、写入、搜索、同步）。
- `ProjectFilesystemService.java`: 文件系统逻辑实现（基于 `java.nio.file`）。
- `ProjectFilesystemWatchService.java`: 实时监听服务，管理 SSE 连接与变更分发。

### 前端 (React/TypeScript)
- `ProjectsPage.tsx`: 项目中心主页面，包含布局、状态管理与核心交互逻辑。
- `projectStore.ts`: 项目元数据状态管理（Zustand）。
- `projectFilesystem.ts`: 文件系统 API 封装。
- `projectIcons.ts`: 文件/文件夹图标映射与语言识别工具。

### 数据库
- `project_item` 表：存储项目元数据（ID、名称、本地绝对路径等）。

## 已知约束与限制

1. **浏览器兼容性**：
   - 依赖 **File System Access API**（如 `showDirectoryPicker`）。
   - 目前仅 **Chromium** 内核浏览器（Chrome, Edge, Brave 等）完整支持该特性。
   - 在非支持浏览器上，部分本地写回或高级权限功能可能会受限。

2. **代码隐私**：
   - Open Zen 仅保存项目的目录路径和元数据。
   - 代码内容通过后端流式读取或前端直接访问（取决于配置），不会持久化存储在应用数据库中。

3. **性能阈值**：
   - **大文件**：打开超过 1MB 的文件会弹出确认提示，以防浏览器内存溢出。
   - **搜索限制**：全局搜索结果上限默认为 200 条，单文件搜索大小限制为 1MB。
   - **监听规模**：实时同步仅针对已打开的文件和已展开的目录注册监听，避免监听过多导致系统资源耗尽。
