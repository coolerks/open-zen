package com.aiagent.dto;

import lombok.Data;

@Data
public class ProjectFsFileResponse {

    private String path;

    private String content;

    private Long size;

    /**
     * 文件修订版本（用于冲突检测）
     */
    private String revision;
}
