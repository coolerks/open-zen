package com.aiagent.dto;

import lombok.Data;

@Data
public class ProjectFsFileMetaResponse {

    private String path;

    private Long size;

    /**
     * 文件修订版本（用于冲突检测）
     */
    private String revision;

    /**
     * 是否超过前端直接打开阈值
     */
    private boolean tooLarge;

    /**
     * 大文件打开阈值（字节）
     */
    private Long largeFileThresholdBytes;
}
