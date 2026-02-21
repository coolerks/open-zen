package com.aiagent.dto;

import lombok.Data;

@Data
public class ProjectFsFileResponse {

    private String path;

    private String content;

    private Long size;
}

