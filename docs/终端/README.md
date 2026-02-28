# 终端功能模块开发文档

Open Zen 项目在项目中心内置了高性能的终端功能，支持多标签页管理、高度动态调整、跨平台 Shell 接入以及主题/字体自定义。该模块通过 WebSocket 实现前端 xterm.js 与后端 PTY 进程的实时双向通信。

## 1. 功能概述

- **内置终端面板**：集成在项目中心底部，支持一键切换显示/隐藏。
- **多终端标签页**：支持同时打开多个终端窗口，可自由新建、关闭和切换。
- **工作目录联动**：新建终端时，默认进入当前打开项目的工作目录。
- **布局高度自适应**：支持鼠标拖动调整终端面板高度，最大可达窗口高度的 70%。
- **持久化配置**：自动保存终端高度和自定义字体设置，提升使用体验。

## 2. 后端实现

后端基于 Spring Boot WebSocket 和 PTY4J 库实现。

### 核心逻辑
- **PTY 进程管理**：使用 `PTY4J` 创建跨平台的原生 Shell 进程（Windows 下优先尝试 PowerShell，回退至 cmd；Unix-like 系统使用 `$SHELL` 或 `/bin/sh`）。
- **WebSocket 桥接**：
    - **接口**：`/api/terminal/{tabId}?cwd=...`
    - **输入流**：监听 WebSocket 消息，将 `input` 类型的数据写入 PTY 进程的 `OutputStream`。
    - **输出流**：开启独立线程轮询 PTY 进程的 `InputStream`，并将读取到的字节流通过 WebSocket 推送至前端。
- **窗口调整**：实现 `resize` 指令，同步更新后端 PTY 进程的 `WinSize`。

### 核心类
- `TerminalWebSocketHandler`：处理 WebSocket 连接生命周期，解析前端指令（input/resize）。
- `TerminalService`：负责 PTY 进程的创建、销毁、工作目录设置及 Shell 指令获取。
- `WebSocketConfig`：配置 WebSocket 端点与允许跨域。

## 3. 前端实现

前端基于 xterm.js 及其插件生态构建，通过 Zustand 进行状态管理。

### 核心逻辑
- **终端 UI (xterm.js)**：
    - 使用 `@xterm/addon-fit` 自动适配容器尺寸。
    - 使用 `@xterm/addon-web-links` 自动识别并点击链接。
    - 渲染层支持 WebGL (可选) 或 DOM 渲染。
- **状态管理 (terminalStore)**：
    - 维护终端的打开状态、高度、标签页列表、当前活动标签。
    - 管理 `fontFamily` 等持久化配置（存储于 `localStorage`）。
- **交互功能**：
    - **拖拽缩放**：监听 `onMouseDown` 事件实现面板高度拖动，并实时触发 `fit()` 重绘终端。
    - **主题同步**：监听系统/应用主题变化，动态更新 xterm.js 的 `theme` 选项。
    - **自动重连**：组件挂载时建立 WebSocket 连接，并在卸载时自动清理资源（dispose/close）。

### 核心组件
- `Terminal.tsx`：终端渲染核心组件，包含 xterm 实例初始化、WebSocket 绑定和 UI 布局。
- `terminalStore.ts`：定义终端全局状态及增删改查逻辑。
- `ProjectsPage.tsx`：将终端组件集成到项目页面布局中，传递当前项目路径作为默认工作目录。

## 4. 布局与集成

终端在项目中心采用 `flex-column` 布局，其位置固定在页面底部。

- **布局规则**：终端面板开启时，会向上推动代码编辑区和文件资源管理器，而侧边导航栏保持固定宽度不受影响。
- **尺寸限制**：面板高度被限制在 100px 到窗口高度 70% 之间，防止布局崩溃。

## 5. 核心文件清单

| 模块 | 文件路径 | 说明 |
| :--- | :--- | :--- |
| **后端** | `server/src/main/java/com/aiagent/websocket/TerminalWebSocketHandler.java` | WebSocket 处理器 |
| | `server/src/main/java/com/aiagent/service/TerminalService.java` | PTY 进程服务 |
| | `server/src/main/java/com/aiagent/config/WebSocketConfig.java` | WebSocket 端点配置 |
| | `server/pom.xml` | 定义 `pty4j` 和 `spring-boot-starter-websocket` 依赖 |
| **前端** | `web/src/components/terminal/Terminal.tsx` | 终端 UI 组件 |
| | `web/src/store/terminalStore.ts` | 终端状态 Store |
| | `web/src/pages/ProjectsPage.tsx` | 终端集成入口 |
| | `web/package.json` | 定义 `@xterm/xterm` 及其插件依赖 |
