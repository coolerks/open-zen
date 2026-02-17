package com.aiagent.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

@Data
public class ChatToolApprovalRequest {
    @NotNull(message = "工具调用消息ID不能为空")
    private Long assistantMessageId;

    @NotNull(message = "授权决策不能为空")
    private Boolean approved;
}
