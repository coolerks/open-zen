package com.aiagent.service.modelcatalog;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 统一的模型发现结果，用于屏蔽不同供应商接口差异。
 */
@Data
public class DiscoveredModelInfo {
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
