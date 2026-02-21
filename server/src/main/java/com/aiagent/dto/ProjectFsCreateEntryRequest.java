package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectFsCreateEntryRequest {

    private String parentPath;

    @NotBlank(message = "名称不能为空")
    private String name;

    @NotBlank(message = "类型不能为空")
    private String kind;
}

