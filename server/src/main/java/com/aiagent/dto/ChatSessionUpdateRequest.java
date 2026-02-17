package com.aiagent.dto;

import lombok.Data;

import java.util.List;

@Data
public class ChatSessionUpdateRequest {
    private String title;
    private Long modelId;
    private Long agentId;
    private List<String> enabledToolNames;
}
