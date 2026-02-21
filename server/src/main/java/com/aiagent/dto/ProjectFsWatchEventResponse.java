package com.aiagent.dto;

import lombok.Data;

@Data
public class ProjectFsWatchEventResponse {

    /**
     * 变化类型：create / modify / delete / overflow
     */
    private String kind;

    /**
     * 变化路径（项目内相对路径）
     */
    private String path;

    /**
     * 变化路径所在目录（项目内相对路径）
     */
    private String directoryPath;

    /**
     * 变化目标是否是目录
     */
    private boolean directory;

    /**
     * 事件时间戳（毫秒）
     */
    private long timestamp;
}
