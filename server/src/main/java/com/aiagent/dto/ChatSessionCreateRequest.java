package com.aiagent.dto;

import lombok.Data;

@Data
public class ChatSessionCreateRequest {
    private String title;
    private Long agentId;
    /**
     * 是否创建为临时会话：
     * - true：临时会话（不出现在会话列表）
     * - false/null：普通会话
     */
    private Boolean temporary;
}
