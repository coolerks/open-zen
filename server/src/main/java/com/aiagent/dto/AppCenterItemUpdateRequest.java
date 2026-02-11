package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class AppCenterItemUpdateRequest {

    @NotBlank(message = "应用名称不能为空")
    private String name;

    private String iconType;

    private String iconValue;
}
