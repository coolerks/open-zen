package com.aiagent.service.tool;

/**
 * 工具执行上下文。
 * 便于工具读取当前会话等运行时信息。
 */
public record ToolExecutionContext(Long sessionId) {
}
