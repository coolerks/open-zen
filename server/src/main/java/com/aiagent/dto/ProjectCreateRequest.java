package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectCreateRequest {

    @NotBlank(message = "项目名称不能为空")
    private String name;

    private String description;

    @NotBlank(message = "真实目录不能为空")
    private String realDirPath;

    private String rootDirName;
}
