package com.aiagent.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ProviderResponse {
    private Long id;
    private String name;
    private String baseUrl;
    private Boolean apiKeySet;  // only show whether API key is configured, never return plaintext
    private Boolean enabled;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
