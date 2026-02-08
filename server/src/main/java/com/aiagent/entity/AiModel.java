package com.aiagent.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@TableName("ai_model")
public class AiModel {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long providerId;

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

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;
}
