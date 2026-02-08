package com.aiagent.dto;

import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
public class ModelResponse {
    private Long id;
    private Long providerId;
    private String providerName;
    private String modelKey;
    private String displayName;
    private Boolean isDefault;
    private Boolean supportsTools;
    private Boolean supportsVision;
    private Boolean supportsReasoning;
    private Long contextWindowTokens;
    private Long maxCompletionTokens;
    private BigDecimal inputPrice;
    private BigDecimal outputPrice;
    private BigDecimal cacheReadPrice;
    private BigDecimal cacheWritePrice;
    private String defaultParams;
    private Boolean enabled;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
