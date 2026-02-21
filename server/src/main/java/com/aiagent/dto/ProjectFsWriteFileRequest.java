package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectFsWriteFileRequest {

    @NotBlank(message = "文件路径不能为空")
    private String path;

    private String content;
}

