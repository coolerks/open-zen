你是一个资深的全栈工程师和软件架构师，正在为“网页端在线 AI 聊天工具”编写可落地的工程方案与代码。项目目标是逐步实现 AI Agent 应用（类似 Claude Code / Codex 的体验），但当前阶段必须先完成：1) 在线聊天工具；2) 在线模型/供应商管理；3) 基于 OpenRouter 的 Chat Completions 测试联通。

【强制技术栈】
- 前端：React + TypeScript + Vite + Zustand + Monaco Editor，可辅助 Tailwind CSS。禁止使用 Ant Design（过重）,UI组件库自行选择，风格统一即可，需要实现浅色模式和深色模式的切换。
- 后端：Java 21 + Spring Boot（若你认为 Boot 4 生态不匹配，请用“当前最新稳定版本”并在 README 解释偏差） + Maven + H2 数据库 + MyBatis-Plus+其他你认为需要引入的技术栈。
- 目标：前后端分离，后端提供 REST API；前端调用后端 API；后端再调用 OpenRouter。
- 必须要写单元测试，精确到方法级别，所有接口必须经过mvn的测试通过。

【当前阶段的功能范围（必须优先实现）】
A. 模型供应商管理（Provider）
- 支持添加/编辑/禁用 Provider（例如 openrouter、openai、claude、openrouter、github copilot 等）。
- Provider 字段建议：id、name、baseUrl、apiKey（加密/至少不明文回显）、enabled、createdAt、updatedAt。
- 目前先实现 openrouter 供应商即可，但架构必须可扩展到其他供应商。

B. 模型管理（Model）
- 支持添加/编辑/启用/禁用 Model，并绑定到 Provider。
- Model 字段建议：id、providerId、modelKey（如 qwen/qwen3-coder:free）、displayName、capabilities（如 tools/vision flags）、defaultParams（temperature、top_p、max_tokens 等 JSON）、enabled、createdAt、updatedAt。
- 要支持：工具调用（不含视觉）与 工具调用+视觉 两类能力标记（例如 supportsTools、supportsVision）。

C. 在线聊天（Chat）
- 支持创建会话、会话列表、消息发送与流式输出（若流式复杂可先非流式，保留可升级设计）。
- 每次发送消息时，必须选择一个已启用的 Model（来自 Model 管理）。
- 后端负责把消息转成 OpenRouter Chat Completions 格式，携带 Authorization Bearer key。
- 聊天消息建议表结构：chat_session、chat_message；保存用户消息与助手消息；保留 token 用量字段可选。

D. 工具调用（Function calling / tools）
- 当前仅需要“文本工具调用”（不含视觉），但要把架构做成可扩展（后续可加入 vision 模型）。
- 先提供一个简单内置工具：例如 “searchDocs” 或 “runSqlPreview” 或 “getServerTime”，用于验证 tools 能跑通。
- 注意：OpenRouter 的 tools 格式与 OpenAI 兼容度很高，但你必须根据 OpenRouter 文档/返回结构做兼容解析；如果不确定，输出你采用的最小可行 JSON 结构，并说明如何从响应里解析 tool call。
后端配置文件应该足够简单，禁止在配置文件配置模型等信息，直接在线配置即可。

【UI/交互要求】
- 不用 Ant Design。尽量用 Tailwind + 自己封装简单组件（Button/Input/Dialog/Table）。
- 无需 i18n，只支持中文即可。
- 页面最少：
  1) /models：Provider 管理 + Model 管理（同页或分 tabs）
  2) /chat：左侧会话列表，右侧聊天区；顶部可选择模型；输入框支持多行；可选 Monaco 作为“代码模式输入”。
- 对敏感字段（apiKey）：
  - 前端只能看到“已设置/未设置”的状态，不回显明文；
  - 更新时允许重新输入覆盖。


【输出格式要求（你必须遵守）】
1) 先给出“项目目录结构（前端/后端）”与“关键依赖列表”；
2) 再给出“数据库表结构（SQL 或 MyBatis-Plus 实体字段说明）”；
3) 再给出“后端核心代码”：Entity、Mapper、Service、Controller、OpenRouterClient（含请求/响应 DTO）；
4) 再给出“前端核心代码”：Zustand store、API client、主要页面组件；
5) 每一步都要可运行，避免伪代码；如果代码太长，按模块分批输出，并明确每个文件的路径；
6) 遇到不确定的 OpenRouter 字段/工具调用结构时：
   - 不要编造；给出最小可行实现，并把可能需要调整的字段标记为 TODO；
7) 默认用中文解释。

【重要：当前测试目标】
先实现 openrouter provider 的最小可行联通：
- 能在 /models 页面配置 openrouter apiKey
- 选择某个 free model（如 qwen/qwen3-coder:free）
- 在 /chat 页面发送消息并拿到回复
完成后再逐步增强（流式、工具调用、更完善的 agent）。

现在开始：请输出第一批内容：项目目录结构 + 依赖清单 + 数据库表设计（含字段与索引）。
