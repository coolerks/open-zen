package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

import java.util.List;

@Data
public class ProjectFsWatchInterestsRequest {

    @NotBlank(message = "clientId 不能为空")
    private String clientId;

    /**
     * 当前客户端打开的文件（项目内相对路径）
     */
    private List<String> openFiles;

    /**
     * 当前客户端展开的目录（项目内相对路径）
     */
    private List<String> expandedDirs;
}
