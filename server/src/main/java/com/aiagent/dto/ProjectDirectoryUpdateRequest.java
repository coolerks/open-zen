package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectDirectoryUpdateRequest {

    @NotBlank(message = "真实目录不能为空")
    private String realDirPath;

    private String rootDirName;
}
