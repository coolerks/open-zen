package com.aiagent.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Data
@TableName("chat_message")
public class ChatMessage {

    @TableId(type = IdType.AUTO)
    private Long id;

    private Long sessionId;

    private String role;

    private String content;

    private String toolCalls;

    private String toolCallId;

    private Integer tokenUsage;

    private Integer promptTokens;

    private Integer completionTokens;

    private Integer cacheReadTokens;

    private Integer cacheWriteTokens;

    private BigDecimal costUsd;

    private Long modelId;

    private String modelName;

    private Long agentId;

    private String agentName;

    private String agentAvatarType;

    private String agentAvatarValue;

    private String reasoningContent;

    private Long reasoningDurationMs;

    private String imageUrls;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
