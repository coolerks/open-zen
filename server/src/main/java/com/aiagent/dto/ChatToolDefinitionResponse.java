package com.aiagent.dto;

import lombok.Data;

/**
 * 聊天工具定义响应。
 */
@Data
public class ChatToolDefinitionResponse {
    /**
     * 工具名称（函数名）。
     */
    private String name;

    /**
     * 工具说明。
     */
    private String description;

    /**
     * 是否为记忆类工具。
     */
    private Boolean memoryTool;
}
