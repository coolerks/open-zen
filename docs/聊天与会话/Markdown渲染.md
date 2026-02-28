# Markdown 渲染管线实现

Open Zen 拥有工业级的 Markdown 渲染能力，专为 AI 场景定制。

## 渲染核心 (ReactMarkdown)

前端使用 `ReactMarkdown` 作为基础引擎，集成了以下插件生态：
- **GFM**: `remark-gfm` (表格、任务列表、链接)。
- **数学公式**: `remark-math` + `rehype-katex` (KaTeX 高性能渲染)。
- **高亮**: 自定义语法 `==内容==` 渲染为 `<mark>` 标签。
- **Mermaid**: 自定义 `pre` 渲染器拦截 `language-mermaid` 代码块。

## 性能优化 (Streaming 模式)

为解决流式输出导致的频繁重渲染及性能开销：
- **定时提交 (StreamingMessageMarkdown)**：流式内容不会直接驱动重渲染。
- **动态阈值**：基于内容长度计算重渲染间隔 (`resolveStreamMarkdownInterval`)。
- **强制提交**：当未提交字符超过 120 字或遇到自然换行时，强制触发 UI 更新。

## 代码块工具栏 (CodeBlock)

每个代码块上方均带有一个多功能工具栏：
- **语言识别**：通过 `highlight.js` 实现自动语言检测与高亮。
- **运行 HTML**：支持一键运行 `html` 代码（通过 `Blob` 预览）。
- **复制与下载**：标准文本处理逻辑。
- **添加到应用中心**：
  - 检测到 HTML 代码块时显示。
  - 通过 `sourceKey` (格式: `msg-{id}-code-{index}`) 确保唯一性。
  - 点击后保存代码至 `app_center_item` 表。

## Mermaid 图表与工具栏 (MermaidBlock)

Mermaid 图表支持完整的功能增强：
- **动态渲染**：支持暗色/亮色主题实时切换。
- **语法校验**：渲染失败时展示友好的错误提示。
- **图像导出**：
  - 支持 `SVG`, `PNG`, `JPEG` 格式。
  - 采用 `Canvas` + `DOMParser` 实现导出，支持高分辨率图像。
  - 提供 `Mermaid` 源码复制功能。

## 关键文件定位

- **前端渲染主逻辑**：`web/src/pages/ChatPage.tsx`
- **Mermaid 处理组件**：`MermaidBlock`
- **代码块组件**：`CodeBlock`
- **样式定义**：`web/src/styles/index.css` (含 Markdown 排版规则)
- **KaTeX 样式**：前端通过 `katexCssText` 动态注入。
