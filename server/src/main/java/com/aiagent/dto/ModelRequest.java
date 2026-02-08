package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.math.BigDecimal;

@Data
public class ModelRequest {
    @NotNull(message = "供应商ID不能为空")
    private Long providerId;

    @NotBlank(message = "模型Key不能为空")
    private String modelKey;

    @NotBlank(message = "显示名称不能为空")
    private String displayName;

    private Boolean isDefault = false;

    private Boolean supportsTools = false;
    private Boolean supportsVision = false;
    private Boolean supportsReasoning = false;
    private Long contextWindowTokens;
    private Long maxCompletionTokens;
    private BigDecimal inputPrice;
    private BigDecimal outputPrice;
    private BigDecimal cacheReadPrice;
    private BigDecimal cacheWritePrice;
    private String defaultParams;
    private Boolean enabled = true;
}
