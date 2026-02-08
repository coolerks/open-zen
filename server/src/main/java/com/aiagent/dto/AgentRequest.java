package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AgentRequest {

    @NotBlank(message = "智能体名称不能为空")
    private String name;

    private String description;

    @NotBlank(message = "系统提示词不能为空")
    private String systemPrompt;

    private String avatarType;

    private String avatarValue;

    private Boolean enabled = true;
}
