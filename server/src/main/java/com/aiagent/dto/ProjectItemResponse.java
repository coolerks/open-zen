package com.aiagent.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class ProjectItemResponse {
    private String id;
    private String name;
    private String description;
    private String rootDirName;
    private String realDirPath;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
