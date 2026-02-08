package com.aiagent.dto;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 模型发现接口返回项。
 */
@Data
public class ModelDiscoveryItemResponse {
    private String modelKey;
    private String displayName;
    private Boolean supportsTools;
    private Boolean supportsVision;
    private Boolean supportsReasoning;
    private Long contextWindowTokens;
    private Long maxCompletionTokens;
    private BigDecimal inputPrice;
    private BigDecimal outputPrice;
    private BigDecimal cacheReadPrice;
    private BigDecimal cacheWritePrice;
}
