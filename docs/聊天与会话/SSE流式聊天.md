# SSE 流式聊天实现

Open Zen 采用 SSE (Server-Sent Events) 实现大模型响应的增量实时下发。

## 接口定义

- **端点**: `POST /api/chat/stream`
- **内容类型**: `text/event-stream`
- **请求负载**: `ChatSendRequest` (含会话 ID、模型、提示词、多模态图片)

## 事件类型

| 事件名 | 负载内容 | 说明 |
| :--- | :--- | :--- |
| `start` | `sessionId`, `modelId`, `modelName` 等 | 会话初始化信息，含上下文统计 |
| `delta` | `content` | 助手回复的正文增量片段 |
| `reasoning` | `reasoning` | 模型的推理内容（如思维链）片段 |
| `done` | `messageId`, `tokenUsage`, `costUsd` 等 | 传输结束，含最终生成的数据库消息 ID 与费用 |
| `error` | `message` | 服务端抛出的异常信息 |

## 前端解析逻辑 (chatApi.ts)

通过 `fetch` 的 `response.body.getReader()` 逐块读取二进制流，并按 `\n\n` 拆分 SSE 事件块。
```typescript
// api/chat.ts
const reader = response.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const blocks = buffer.split('\n\n');
  buffer = blocks.pop() ?? '';
  for (const block of blocks) {
    const { event, data } = parseEventBlock(block);
    // 处理不同 event 类型并回调 handler
  }
}
```

## chatStore 状态管理 (chatStore.ts)

为解决流式吞吐量过大导致的 UI 顿挫，`chatStore` 引入了**双缓冲队列**与**稳定帧率刷新**机制。

1.  **乐观更新**：点击发送后立即向 `messages` 数组插入临时 User 和 Assistant 消息占位。
2.  **流式队列 (streamQueue)**：解析出的 `delta` 和 `reasoning` 片段不直接修改 `messages` 状态，而是推入暂存队列。
3.  **定时刷新 (flushStreamQueue)**：
    - 使用 `setInterval` (32ms) 周期性从队列提取内容。
    - 动态步长：队列堆积越多，单次吐字越多 (通过 `resolveStreamStepSize` 计算)，确保大段响应不积压。
4.  **停止生成**：调用 `AbortController.abort()` 强行中断网络请求，随后后端会自动回收虚拟线程资源。

## 关键交互实现

- **流式滚动**：前端组件监听 `messages` 变化，仅在用户处于页面底部时触发 `scrollToBottom`。
- **停止按钮**：通过 `chatStore.stopStreaming()` 清理 `AbortController` 并重置 UI 状态。
- **错误降级**：若 SSE 过程异常，前端将显示错误 Toast，并重新从后端拉取完整消息列表以同步状态。

## 关键文件定位

- **前端**：`web/src/api/chat.ts` (传输层), `web/src/store/chatStore.ts` (状态流转)
- **后端**：`ChatService.streamMessageInternal` (虚拟线程处理逻辑), `ChatController.stream` (入口)
