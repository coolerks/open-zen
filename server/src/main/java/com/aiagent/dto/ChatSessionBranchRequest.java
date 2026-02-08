package com.aiagent.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class ChatSessionBranchRequest {
    @NotNull(message = "分支消息ID不能为空")
    private Long messageId;

    private String title;
}
