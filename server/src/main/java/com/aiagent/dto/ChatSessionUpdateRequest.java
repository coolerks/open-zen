package com.aiagent.dto;

import lombok.Data;

@Data
public class ChatSessionUpdateRequest {
    private String title;
    private Long modelId;
    private Long agentId;
}
