package com.aiagent.dto;

import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

import java.util.List;

@Data
public class ChatSendRequest {
    @NotNull(message = "会话ID不能为空")
    private Long sessionId;

    @NotNull(message = "模型ID不能为空")
    private Long modelId;

    private String content;

    private List<String> images;

    @Min(value = 1, message = "maxTokens 必须大于 0")
    @Max(value = 2_000_000, message = "maxTokens 超出允许范围")
    private Integer maxTokens;

    @DecimalMin(value = "0.0", message = "temperature 不能小于 0")
    @DecimalMax(value = "2.0", message = "temperature 不能大于 2")
    private Double temperature;

    /**
     * 工具调用权限模式：
     * - require_approval：调用前需要用户授权（默认）
     * - auto：允许模型自动调用
     */
    private String toolPermissionMode;

    @AssertTrue(message = "消息内容和图片不能同时为空")
    public boolean isPayloadValid() {
        boolean hasContent = content != null && !content.trim().isEmpty();
        boolean hasImages = images != null && !images.isEmpty();
        return hasContent || hasImages;
    }
}
