# Open Zen — AGENTS.md

AI Agent 流式交互平台（聊天 + 工具调用 + 应用中心 + 项目中心）。
全栈项目：Java 21 + Spring Boot 3.4.1 后端，React 18 + TypeScript 前端。

---

## AI Agent 开发工作流（必读）

接到任何需求后，**严格按以下顺序执行**，不要跳步：

### Step 1: 分析需求与现有代码

1. **理解需求** — 明确要做什么、影响哪些模块、边界在哪里。
2. **阅读相关代码** — 找到涉及的 Controller / Service / Entity / DTO / 前端页面 / Store，通读并理解其逻辑。
3. **分析需求与已有代码的关系** — 确认是新增功能、修改现有功能、还是修复 Bug。明确哪些文件需要改动、哪些不能动。
4. **查看相似功能的实现** — 在项目中找到类似功能的代码，作为模板参考。例如要新增 API，先看 `ProviderController` + `ProviderService` 的完整实现。

**禁止未分析就动手写代码。**

### Step 2: 编写代码

1. **严格遵循已有代码风格** — 本项目没有 ESLint / Prettier / Checkstyle，代码风格靠已有代码保持一致。
2. **遵循分层架构** — Controller 只做 HTTP 映射，Service 放业务逻辑，Mapper 只做数据访问。
3. **遵循本文档中「代码风格与约定」章节的所有约定**。
4. **最小化改动** — 只改需求要求的部分，不要顺手重构不相关的代码。修 Bug 时尤其注意。

### Step 3: 编译 & 构建验证

代码写完后，**必须执行编译和构建**，确保没有编译错误：

- 后端：在 `server` 目录下执行 Maven 测试，同时验证编译和现有测试。
- 前端：在 `web` 目录下先做 TypeScript 类型检查，再执行构建。
- **编译不通过 → 要立刻修复。**

### Step 4: 自测（单元测试）

1. **后端改动** — 必须为新增/修改的 Service 和 Controller 编写或更新单元测试。
   - 参考 ✅ `server/src/test/java/com/aiagent/service/ChatServiceTest.java`
   - 参考 ✅ `server/src/test/java/com/aiagent/controller/ChatControllerTest.java`
   - 命名规范：`test<方法名>_<场景>` (如 `testGetMessages_returnsEmptyList`)。
2. **前端改动** — 项目暂无前端测试框架。确保 TypeScript 类型检查和构建通过即可。
3. **执行全部测试** — 确保所有测试通过（包括已有测试）。

### Step 5: 提交代码

**🚫 AI Agent 不要执行 git commit / git push。** 代码提交由用户手动完成。

你可以执行 `git diff` 或 `git status` 帮助用户确认改动范围，但绝不主动提交。

### Step 6: 编写文档

文档位于docs目录下，需要写功能迭代说明和模块设计文档
---

## 功能开发 Checklist（新增 API 端到端示例）

以新增一个 REST API 为例，完整流程如下：

| # | 步骤 | 文件 | 说明 |
|---|------|------|------|
| 1 | Entity | `entity/XxxEntity.java` | MyBatis-Plus 实体，`@TableName`、`@TableId(type=IdType.AUTO)` |
| 2 | schema.sql | `resources/schema.sql` | 追加 `CREATE TABLE IF NOT EXISTS` 或 `ALTER TABLE ADD COLUMN IF NOT EXISTS` |
| 3 | Mapper | `mapper/XxxMapper.java` | 继承 `BaseMapper<XxxEntity>`，通常无需额外方法 |
| 4 | DTO | `dto/XxxRequest.java` / `dto/XxxResponse.java` | 请求/响应数据载体，加 `@NotBlank` 等校验注解 |
| 5 | Service | `service/XxxService.java` | 业务逻辑，调用 Mapper，做 Entity ↔ DTO 转换 |
| 6 | Controller | `controller/XxxController.java` | `@RestController` + `@RequestMapping("/api/xxx")`，返回 `ApiResult<T>` |
| 7 | 前端 Types | `web/src/types/index.ts` | 与后端 DTO 对应的 TypeScript 接口 |
| 8 | 前端 API | `web/src/api/xxx.ts` | 使用 `get` / `post` / `put` / `del` 封装 |
| 9 | 前端 Store | `web/src/store/xxxStore.ts` | Zustand store，管理状态和异步 Action |
| 10 | 前端 UI | `web/src/pages/` 或 `web/src/components/` | React 组件，使用 `ui/` 下的基础组件 |
| 11 | 测试 | `test/java/com/aiagent/` | Service 和 Controller 的 JUnit 测试 |
| 12 | 验证 | 执行后端测试 + 前端类型检查 + 前端构建 | 全部通过才算完成 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Java 21, Spring Boot 3.4.1, Maven, MyBatis-Plus 3.5.9, H2, Lombok, OkHttp |
| 前端 | React 18.3, TypeScript 5.6, Vite 6, Zustand 5, Tailwind CSS 3, React Router 6 |
| 数据库 | H2 |
| 测试 | JUnit 5 + Spring Boot Test + MockMvc + OkHttp MockWebServer |

---

## 项目结构

```
/
├── server/                         # Spring Boot 后端（Maven 模块）
│   ├── pom.xml
│   ├── src/main/java/com/aiagent/
│   │   ├── AiAgentApplication.java
│   │   ├── config/                 # Spring 配置（CORS、WebSocket 等）
│   │   ├── controller/             # REST 控制器（@RestController）
│   │   ├── dto/                    # 请求/响应 DTO（无业务逻辑）
│   │   │   └── openrouter/         # OpenRouter 专用 DTO
│   │   ├── entity/                 # MyBatis-Plus 实体（@TableName）
│   │   ├── mapper/                 # MyBatis-Plus Mapper（extends BaseMapper<T>）
│   │   ├── service/                # 业务逻辑
│   │   │   ├── tool/               # AI 工具定义与注册
│   │   │   │   ├── annotation/     # @AiTool, @AiToolMethod, @AiToolParam, @AiToolResult
│   │   │   │   └── project/        # 项目级工具（read/write/edit/bash/glob/grep）
│   │   │   └── modelcatalog/       # 供应商无关的模型发现适配器
│   │   ├── util/                   # EncryptionUtil, TokenEstimator
│   │   └── websocket/              # WebSocket 处理器（终端）
│   └── src/
│       ├── main/resources/
│       │   ├── application.yml     # 主配置（端口 8080，H2 文件库）
│       │   └── schema.sql          # DDL；每次启动执行（CREATE TABLE IF NOT EXISTS）
│       └── test/
│           ├── java/com/aiagent/   # 测试代码，镜像 main 包结构
│           └── resources/application-test.yml  # 内存 H2，@ActiveProfiles("test")
│
├── web/                            # React 前端（Vite）
│   ├── package.json
│   ├── vite.config.ts              # 代理：/api → http://localhost:8080
│   ├── tailwind.config.js
│   └── src/
│       ├── api/                    # 按领域封装的 fetch 请求
│       │   └── client.ts           # 基础 request()，使用 ApiResult<T> 响应信封
│       ├── components/
│       │   ├── chat/               # 聊天 UI 组件
│       │   ├── layout/             # 头部、外壳
│       │   ├── models/             # 供应商 & 模型管理 UI
│       │   ├── project/            # 项目中心组件
│       │   ├── terminal/           # xterm.js 终端
│       │   └── ui/                 # 通用组件：Button, Dialog, Input, Select, Toggle
│       ├── pages/                  # 路由级页面（ChatPage, ModelsPage 等）
│       ├── store/                  # Zustand 状态管理（每个领域一个 store）
│       ├── types/                  # 共享 TypeScript 类型（index.ts）
│       └── utils/                  # projectIcons.ts, 工具函数
│
├── data/                           # H2 数据库文件（已 gitignore）
├── docs/                           # 项目文档 & 截图
├── prompt.md                       # 原始脚手架提示词（仅供参考）
└── AGENTS.md                       # 本文件
```

---

## 代码风格与约定

### 后端（Java）

**包结构** — 严格遵循 `com.aiagent.<层级>`：
- `controller` — 仅做 HTTP 映射，不含业务逻辑，委托给 service
- `service` — 所有业务逻辑
- `mapper` — 仅 MyBatis-Plus `BaseMapper<T>` 扩展
- `dto` — 纯数据载体，使用 Jackson/Lombok 注解或者直接用 record
- `entity` — `@TableName`、`@TableId`、Lombok `@Data`/`@Builder`

**响应信封** — 所有 REST 响应必须使用 `ApiResult<T>`：
```java
// ✅ 正确
return ApiResult.success(chatService.getSessions());

// ❌ 错误 — 禁止从 Controller 直接返回原始对象
return chatService.getSessions();
```

**异常处理** — 使用 `GlobalExceptionHandler`；Service 层抛出 `RuntimeException` 子类；禁止吞掉异常。

**API Key 安全** — 供应商 `apiKey` 通过 `EncryptionUtil` AES 加密存储。禁止日志输出、序列化或返回原始密钥。DTO 层对 `apiKey` 字段返回 `"***"` 或 `null`。

**工具扩展** — 新工具必须使用注解模式：
```java
// ✅ 正确：在类和方法上添加注解
@AiTool(name = "myTool", description = "...")
public class MyTool {
    @AiToolMethod(description = "...")
    public String doSomething(@AiToolParam(name = "input") String input) { ... }
}
// 注册为 Spring @Component 即可 — ToolAnnotationScanner 自动扫描注册
```

**流式输出** — SSE 聊天使用 `SseEmitter`；禁止阻塞 Servlet 线程。上游流式调用使用 `WebClient`。

**测试** — 所有测试类使用 `@SpringBootTest` + `@ActiveProfiles("test")`（内存 H2）。Controller 测试使用 `@AutoConfigureMockMvc` + `MockMvc`。参考 ✅ `server/src/test/java/com/aiagent/controller/ChatControllerTest.java`。

### 前端（TypeScript / React）

**API 调用** — 必须使用 `web/src/api/` 下的类型化封装：
```typescript
// ✅ 正确
import { get, post } from './client';
export const getSessions = () => get<ChatSession[]>('/chat/sessions');

// ❌ 错误 — 禁止在组件中直接调用 fetch()
```

**状态管理** — 使用 `web/src/store/` 下的 Zustand store。每个领域一个 store，保持扁平结构，避免深层嵌套。

**组件** — 仅使用函数组件，禁止 class 组件。使用 `web/src/components/ui/` 下的基础组件（Button, Dialog, Input, Select, Toggle），不要使用裸 HTML。

**样式** — 仅使用 Tailwind CSS 工具类。除非 Tailwind 无法满足动态值，否则禁止 `style={{}}`。禁止引入 Ant Design 或 MUI。

**类型** — 共享类型定义在 `web/src/types/index.ts`。所有 API 响应必须标注类型，禁止使用 `any`。

**暗色模式** — 应用通过 `themeStore` 支持明/暗切换。添加样式时同步添加 `dark:` 变体类。参考 `web/src/store/themeStore.ts`。

---

## 测试

### 后端测试模式

| 测试类型 | 注解 | 适用场景 |
|----------|------|----------|
| Service 单元测试 | `@SpringBootTest` + `@ActiveProfiles("test")` | 测试 Service 逻辑（内存 H2） |
| Controller 集成测试 | `@SpringBootTest` + `@AutoConfigureMockMvc` + `@ActiveProfiles("test")` | 端到端 HTTP 测试 |
| HTTP 客户端 Mock | `MockWebServer`（OkHttp） | 测试 `OpenRouterClient`，不依赖真实 API |

**参考实现：**
- ✅ `server/src/test/java/com/aiagent/service/ChatServiceTest.java`
- ✅ `server/src/test/java/com/aiagent/controller/ChatControllerTest.java`
- ✅ `server/src/test/java/com/aiagent/service/OpenRouterClientTest.java`

测试命名规范：`test<方法名>_<场景>`（如 `testGetMessages_returnsEmptyList`）。

### 前端

项目暂未配置前端自动化测试框架。对 UI 改动，需确认：
1. 明色模式和暗色模式均正常
2. TypeScript 类型检查通过
3. 构建成功

---

## 架构说明

### 聊天请求流程
```
前端 → POST /api/chat/stream (SSE)
     → ChatController
     → ChatService（保存用户消息、构建上下文）
     → OpenRouterClient（流式请求上游供应商）
     → 工具调用拦截 → ToolRegistry → 工具执行 → 重新提交
     → 保存助手消息 + 工具结果
     → SSE 分块返回前端
```

### 工具系统
- `ToolRegistry` 持有所有已注册的 `ToolDefinition` 对象。
- `ToolAnnotationScanner` 启动时扫描 Spring 上下文中带 `@AiTool` 注解的 Bean 并自动注册。
- 工具默认需要用户授权，可通过 `ToolDefinition.requiresApproval` 控制为自动执行。
- 项目级工具（`ProjectReadTool`、`ProjectWriteTool` 等）在沙箱化的项目目录内运行，禁止越权访问。

### 模型目录 / 发现
- `ModelCatalogService` 委托给 `ModelCatalogAdapter` 实现。
- `OpenRouterModelCatalogAdapter` 拉取 `/models` 并对 OpenRouter 特有字段做增强解析。
- 新增供应商：实现 `ModelCatalogAdapter` 接口并注册为 Spring Bean。

### 加密
- `EncryptionUtil` 使用 AES 加密供应商 API Key 后存入数据库。
- 密钥配置在 `application.yml` 的 `aiagent.encryption.secret`。
- **生产环境务必通过环境变量覆盖此密钥** — 禁止提交真实密钥。

### 前端路由

| 路径 | 页面 |
|------|------|
| `/chat`、`/chat/:sessionId` | 聊天 |
| `/models` | 供应商 + 模型管理 |
| `/agents` | 智能体管理 |
| `/apps` | 应用中心 |
| `/projects`、`/projects/:projectId` | 项目中心 |

### 浏览器限制
- 项目中心使用 **File System Access API** — 需要 Chromium 内核浏览器。
- 项目元数据存储在 `localStorage` + `IndexedDB`，不经过后端。

---

## Git 工作流

- `main` — 稳定分支，所有测试必须通过
- `feature/*` — 新功能（从 main 分支）
- `fix/*` — Bug 修复

**提交信息格式：** `<类型>: <简短祈使句描述>`

类型包括：feat | fix | refactor | test | docs | chore

**提交前须确保：** 后端全部测试通过、前端 TypeScript 类型检查通过、前端构建成功。

---

## 安全与权限

| 类别 | 规则 |
|------|------|
| ✅ 始终可以 | 编辑 `server/src/`、`web/src/` 中的文件；执行测试和构建；读取任何文件 |
| ✅ 始终可以 | 新增 `@AiTool` 实现；按现有模式新增 API |
| ⚠️ 先确认 | 修改 `schema.sql`（DDL 变更影响现有数据）；修改 `application.yml` 默认值；新增 Maven/npm 依赖 |
| ⚠️ 先确认 | 变更 `ApiResult<T>` 信封约定；修改 `EncryptionUtil`（影响已存储的密钥） |
| 🚫 禁止 | 提交密钥或 API Key；在 API 响应中返回原始 `apiKey`；绕过 `GlobalExceptionHandler`；无理由使用 `@SuppressWarnings("unchecked")`；引入 Ant Design 或 MUI |
| 🚫 禁止 | 项目级工具写入项目目录之外的文件 |
| 🚫 禁止 | 在 `schema.sql` 中删除或截断表；使用 `ALTER TABLE DROP COLUMN` |

---

## AI 助手注意事项

1. **Schema 只做加法** — `schema.sql` 使用 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE ADD COLUMN IF NOT EXISTS`。新增字段用此方式，禁止使用 DROP。

2. **API Key 必须加密** — 持久化 `Provider` 时，必须先调用 `EncryptionUtil.encrypt()` 再保存；使用时必须先 `EncryptionUtil.decrypt()`。参考 `ProviderService`。

3. **`ApiResult<T>` 是唯一合法的 Controller 返回类型** — `ApiResult.success(data)` 或 `ApiResult.error(message)`。前端 `client.ts` 依赖此信封。

4. **SSE 流式输出** — 聊天流返回 `text/event-stream`。前端使用原生 `ReadableStream` 解析。不要修改内容类型或分块格式，除非前后端同步更新。

5. **测试使用独立 Profile** — `@ActiveProfiles("test")` 激活 `application-test.yml`，使用内存 H2。真实数据 `./data/aiagent` 不会被测试触及。

6. **工具调用可能是多轮的** — `ChatService` 循环处理工具调用响应，直到模型返回非工具调用消息。不要短路此循环。

7. **MyBatis-Plus 自动填充** — `MyBatisMetaHandler` 自动填充 `createdAt` / `updatedAt`。禁止在 Service 代码中手动设置这些字段。

8. **前端代理** — 开发环境下 `vite.config.ts` 将 `/api/*` 代理到 `http://localhost:8080`。`client.ts` 的 base URL 是 `/api`。前后端必须同时运行才能完整体验。

9. **项目工具沙箱化** — `ProjectToolSupport` 将所有路径解析为项目根目录的相对路径，并拒绝路径穿越。禁止弱化这些检查。

10. **无国际化** — UI 仅中文。所有面向用户的字符串保持中文。

11. **必须写开发文档和迭代说明** — 迭代文档位于 `docs/功能迭代说明.md`，各个模块文档位于对应的文件夹内。
