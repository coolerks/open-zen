package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProjectFsWriteFileRequest {

    @NotBlank(message = "文件路径不能为空")
    private String path;

    private String content;

    /**
     * 客户端读取到的文件版本，用于写入前冲突检测。
     */
    private String expectedRevision;

    /**
     * 发起写入的客户端 ID，用于过滤自身写入触发的监听事件。
     */
    private String clientId;
}
