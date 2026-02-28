# 项目总览

Open Zen 是一款面向 AI Agent 场景打造的全栈流式交互平台。它不仅提供了类 ChatGPT 的对话体验，还集成了供应商/模型/智能体管理、自动化工具调用、应用中心以及面向 Code Agent 的项目管理能力。

## 项目定位
- **Agent 原生**：从底层支持工具调用（Function Calling）与用户授权工作流。
- **全栈私有化**：采用 Spring Boot + React 架构，数据存储于本地 H2 数据库，确保隐私与可控。
- **开发者友好**：内置 Monaco Editor、终端仿真（xterm.js）与实时代码预览。

## 技术栈总览

### 后端 (server/)
- **核心框架**：Java 21 + Spring Boot 3.4.1
- **持久层**：MyBatis-Plus 3.5.9 + H2 Database (文件模式)
- **网络通信**：OkHttp 4.12 (模型 API 调用) + WebSocket/SSE (实时流)
- **系统集成**：PTY4J (终端模拟实现)
- **工具库**：Lombok, Jackson

### 前端 (web/)
- **视图框架**：React 18 + TypeScript + Vite 6
- **状态管理**：Zustand (轻量级响应式存储)
- **路由导航**：React Router 6
- **UI 样式**：Tailwind CSS + Lucide Icons
- **核心组件**：
  - **编辑器**：Monaco Editor
  - **渲染**：React Markdown + KaTeX + Mermaid + highlight.js
  - **终端**：xterm.js

## 功能模块地图

| 模块名称 | 对应路由 | 核心功能说明 |
| :--- | :--- | :--- |
| **聊天会话** | `/chat` | SSE 流式对话、消息快照、会话搜索、分享与导出 |
| **模型管理** | `/models` | 供应商配置、模型自动发现、默认模型设置、模型能力标识 |
| **智能体** | `/agents` | 系统/自定义智能体、提示词管理、头像配置 |
| **应用中心** | `/apps` | AI 代码一键固化、Monaco 在线编辑、HTML 实时预览 |
| **项目中心** | `/projects` | 关联本地目录、VS Code 风格文件树、代码 Diff 对比 |

## 项目目录结构

### 后端目录 (`server/`)
- `src/main/java/com/aiagent/`
  - `controller/`: RESTful API 接口定义
  - `service/`: 核心业务逻辑，包含模型适配与工具扫描
  - `entity/` / `mapper/`: 数据库模型与 MyBatis 映射
  - `websocket/`: 终端与实时通信处理
  - `config/`: 安全、加密与跨域配置
- `src/main/resources/`
  - `application.yml`: 环境与数据库配置
  - `schema.sql`: 数据库初始化脚本

### 前端目录 (`web/`)
- `src/`
  - `pages/`: 模块页面组件
  - `components/`: 通用 UI 组件
  - `store/`: Zustand 状态定义
  - `api/`: 请求封装
  - `utils/`: 工具函数（含 Markdown/Mermaid 处理）

## 关键配置文件清单
1. `server/src/main/resources/application.yml`: 后端端口、数据库、API Key 加密密钥配置。
2. `server/pom.xml`: 后端 Maven 依赖管理。
3. `web/package.json`: 前端 NPM 依赖管理。
4. `web/vite.config.ts`: 前端开发服务器与构建配置。
