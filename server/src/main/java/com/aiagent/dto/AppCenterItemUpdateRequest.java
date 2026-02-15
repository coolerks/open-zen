package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AppCenterItemUpdateRequest {

    @NotBlank(message = "应用名称不能为空")
    private String name;

    private String iconType;

    private String iconValue;

    // 可选：更新后的应用代码内容。
    private String codeContent;

    // 可选：是否将 codeContent 重置为 originalCodeContent。
    private Boolean resetToOriginal;
}
