package com.aiagent.dto;

import lombok.Data;

import java.math.BigDecimal;

/**
 * 会话上下文与成本统计信息。
 */
@Data
public class ChatSessionContextStatsResponse {
    private Long sessionId;
    private Long modelId;
    private String modelName;

    private Integer contextUsedTokens;
    private Long contextWindowTokens;
    private Double contextUsageRatio;

    private BigDecimal inputPrice;
    private BigDecimal outputPrice;
    private BigDecimal cacheReadPrice;
    private BigDecimal cacheWritePrice;

    private Long sessionPromptTokens;
    private Long sessionCompletionTokens;
    private Long sessionCacheReadTokens;
    private Long sessionCacheWriteTokens;
    private BigDecimal sessionCostUsd;
}
