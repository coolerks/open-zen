package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectFsMoveEntryRequest {

    @NotBlank(message = "源路径不能为空")
    private String sourcePath;

    private String targetDirectoryPath;

    private String targetName;
}

