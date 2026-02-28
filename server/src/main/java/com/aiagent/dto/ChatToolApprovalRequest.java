package com.aiagent.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.Data;

@Data
public class ChatToolApprovalRequest {
    @NotNull(message = "工具调用消息ID不能为空")
    private Long assistantMessageId;

    @NotNull(message = "授权决策不能为空")
    private Boolean approved;

    /**
     * 授权后继续执行时的工具轮次上限。
     * 为空时走服务端默认值。
     */
    @Min(value = 1, message = "maxToolRounds 必须大于 0")
    @Max(value = 500, message = "maxToolRounds 超出允许范围")
    private Integer maxToolRounds;
}
