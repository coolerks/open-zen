# 聊天与会话模块总览

Open Zen 的核心模块，提供类 ChatGPT 的交互体验，涵盖从前端 UI 渲染到后端大模型流式集成的全链路实现。

## 功能范围

1.  **流式交互**：基于 SSE (Server-Sent Events) 实现，支持文本增量、推理内容、工具调用状态的实时下发。
2.  **会话管理**：支持会话的 CRUD、无限层级的会话分支 (Branch)、完整克隆 (Copy) 以及临时会话模式。
3.  **消息生命周期**：记录详细的消息快照（模型、智能体配置），支持多模态（图片）输入与处理。
4.  **自动化增强**：首轮对话自动异步生成标题，失败自动降级。
5.  **知识消费**：支持会话全文搜索、Markdown 全要素渲染（含公式与图表）、PDF/MD 导出。
6.  **上下文控制**：精细化的上下文窗口统计与压缩策略，支持模型参数动态调整。

## 核心文件清单

### 后端 (Java/Spring Boot)
- `ChatController.java`: 暴露 REST API 与 SSE 端点。
- `ChatService.java`: 核心业务逻辑，包括流式处理、会话克隆、工具调用闭环。
- `OpenRouterClient.java`: 与大模型供应商（OpenRouter 等）通信的底层客户端。
- `schema.sql`: 数据库 DDL，包含 `chat_session` 和 `chat_message` 表定义。

### 前端 (React/TypeScript)
- `ChatPage.tsx`: 聊天主页面，承载复杂的渲染管线与交互状态。
- `chatStore.ts`: 基于 Zustand 的状态中心，管理消息队列、流式缓冲与乐观更新。
- `chat.ts`: 封装后端 API 调用，含 SSE 解析逻辑。
- `index.ts` (Types): 模块相关数据结构定义。

## 数据模型关系

- **ChatSession (1) : (N) ChatMessage**
- 每个会话绑定一个智能体 (`agent_id`) 和当前选择的模型 (`model_id`)。
- 消息通过 `session_id` 关联会话，并持久化生成时的模型快照。
