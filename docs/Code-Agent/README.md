# Code Agent 模块总览

> 项目路径：`/Users/songxiaoxu/Project/ai-agent`  
> 最后更新：2026-02-28

---

## 一、什么是 Code Agent

Code Agent 是 Open Zen 项目中心（`/projects`）专属的 AI 能力模块。  
普通聊天（`/chat`）中 AI 只能进行文本对话；**项目聊天**中，AI 额外获得一组操作本地文件系统的工具，可以读写代码、执行命令、搜索内容，从而完成真实的编码任务。

核心特征：
- **工具与会话绑定**：Code Agent 工具通过 `chat_session.project_id` 字段与项目绑定，只有项目聊天才会下发这些工具给 LLM。
- **沙箱隔离**：所有工具的路径参数均为项目内相对路径，后端统一在 `ProjectToolSupport` 中做越界校验（`!resolved.startsWith(rootPath)` 即抛异常），LLM 无法访问项目目录之外的文件。
- **projectOnly 标记**：每个 Code Agent 工具实现 `ToolDefinition.projectOnly()` 返回 `true`，`ChatService` 的工具筛选逻辑 `filter(tool -> projectChat || !tool.projectOnly())` 保证普通聊天看不到这些工具。

---

## 二、核心文件清单

### 后端

| 文件 | 说明 |
|------|------|
| `server/src/main/java/com/aiagent/controller/ProjectChatController.java` | 项目聊天 REST 控制器，路径前缀 `/api/projects/{projectId}/chat` |
| `server/src/main/java/com/aiagent/service/ChatService.java` | 聊天核心服务，含工具过滤逻辑 `resolveAvailableTools()` |
| `server/src/main/java/com/aiagent/service/tool/ToolDefinition.java` | 工具接口，定义 `projectOnly()` / `bypassUserApproval()` 等契约 |
| `server/src/main/java/com/aiagent/service/tool/ToolRegistry.java` | 工具注册中心，Spring 启动时扫描所有 `ToolDefinition` Bean |
| `server/src/main/java/com/aiagent/service/tool/ToolExecutionContext.java` | 工具执行上下文（携带 `sessionId` / `projectId`） |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectToolSupport.java` | 项目工具公共能力：路径越界防护、参数解析、原子写文件 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectBashTool.java` | `bash` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectReadTool.java` | `read` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectEditTool.java` | `edit` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectWriteTool.java` | `write` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectGrepTool.java` | `grep` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectGlobTool.java` | `glob` 工具 |
| `server/src/main/java/com/aiagent/service/tool/project/ProjectListTool.java` | `list` 工具 |
| `server/src/main/java/com/aiagent/service/ProjectFilesystemService.java` | 项目文件系统服务，提供 `resolveProjectRootPathForWatch()` |
| `server/src/main/resources/schema.sql` | `chat_session.project_id`、`enabled_tool_names` 字段定义 |

### 前端

| 文件 | 说明 |
|------|------|
| `web/src/pages/ProjectsPage.tsx` | 项目中心页面（含聊天面板入口） |
| `web/src/components/project/ProjectChatPanel.tsx` | 项目聊天面板组件 |
| `web/src/api/projectFilesystem.ts` | 项目文件系统 API 封装 |
| `web/src/store/projectStore.ts` | 项目状态管理（localStorage + IndexedDB） |

---

## 三、Code Agent 与普通聊天的区别

| 对比维度 | 普通聊天 | 项目聊天（Code Agent） |
|----------|----------|-----------------------|
| 接口路径 | `/api/chat/*` | `/api/projects/{projectId}/chat/*` |
| 会话 `project_id` 字段 | `NULL` | 当前项目 ID |
| 下发给 LLM 的工具 | 通用工具（时间、记忆等） | 通用工具 + 7 个 Code Agent 工具 |
| 路径约束 | 无 | 所有路径限制在项目根目录内 |
| 文件系统访问 | 无 | bash/read/edit/write/grep/glob/list |
| 工具列表接口 | `GET /api/chat/tools` | `GET /api/projects/{projectId}/chat/tools` |
| 工具白名单过滤 | 不含 `projectOnly=true` 的工具 | 含 `projectOnly=true` 的工具 |
| 会话列表查询 | `project_id IS NULL` | `project_id = {projectId}` |

### 关键代码节点

```java
// ChatService.resolveAvailableTools()：projectOnly 工具的过滤逻辑
List<ToolDefinition> allTools = toolRegistry.getAllTools().stream()
    .filter(tool -> projectChat || !tool.projectOnly())
    .toList();

// ChatService.listToolDefinitions()：工具定义列表过滤
.filter(tool -> projectChat || !tool.projectOnly())
```

---

## 四、7 个 Code Agent 工具速览

| 工具名 | 类 | 核心功能 |
|--------|----|---------|
| `bash` | `ProjectBashTool` | 在项目目录执行 shell 命令 |
| `read` | `ProjectReadTool` | 分段读取文件内容 |
| `edit` | `ProjectEditTool` | 精确字符串替换修改文件 |
| `write` | `ProjectWriteTool` | 创建或覆盖文件 |
| `grep` | `ProjectGrepTool` | 正则搜索文件内容 |
| `glob` | `ProjectGlobTool` | 按 glob 模式查找文件路径 |
| `list` | `ProjectListTool` | 列出目录条目（含递归、过滤） |

详细参数与实现见 [工具详解.md](./工具详解.md)。

---

## 五、工具执行链路（简化）

```
前端 POST /api/projects/{projectId}/chat/stream
  └── ProjectChatController.stream()
        └── ChatService.streamProjectMessage()
              └── prepareSendContext()     ← 注入 projectId，过滤工具
              └── runCompletionWithTools() ← 工具调用闭环（最多 100 轮）
                    └── executeToolCall()
                          └── tool.execute(arguments, ToolExecutionContext)
                                └── ProjectToolSupport.resolveProjectRoot()  ← 路径解析 + 越界校验
                                └── 具体工具逻辑
```

工具结果作为 `tool` 角色消息写入 `chat_message` 表，并在下一轮请求时回传给 LLM。

---

## 六、相关文档

- [项目聊天.md](./项目聊天.md) — 项目聊天的接口、会话绑定、上下文注入详解
- [工具详解.md](./工具详解.md) — 7 个工具的完整参数、输出格式、安全约束
- [../工具列表.md](../工具列表.md) — 工具参数速查（原始文档）
