package com.aiagent.dto;

import lombok.Data;

@Data
public class ChatSessionCreateRequest {
    private String title;
    private Long agentId;
}
