package com.aiagent.dto;

import jakarta.validation.constraints.AssertTrue;
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

    @AssertTrue(message = "消息内容和图片不能同时为空")
    public boolean isPayloadValid() {
        boolean hasContent = content != null && !content.trim().isEmpty();
        boolean hasImages = images != null && !images.isEmpty();
        return hasContent || hasImages;
    }
}
