package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AppCenterItemCreateRequest {

    @NotBlank(message = "应用名称不能为空")
    private String name;

    private String iconType;

    private String iconValue;

    @NotBlank(message = "来源标识不能为空")
    private String sourceKey;

    private Long sourceSessionId;

    private String sourceSessionTitle;

    private Long sourceMessageId;

    private Long sourceModelId;

    private String sourceModelName;

    @NotBlank(message = "代码语言不能为空")
    private String language;

    @NotBlank(message = "应用代码不能为空")
    private String codeContent;
}
