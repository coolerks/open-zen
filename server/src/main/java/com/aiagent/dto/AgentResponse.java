package com.aiagent.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AgentResponse {
    private Long id;
    private String name;
    private String description;
    private String systemPrompt;
    private String avatarType;
    private String avatarValue;
    private Boolean isDefault;
    private Boolean enabled;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
