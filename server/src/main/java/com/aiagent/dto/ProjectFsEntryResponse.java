package com.aiagent.dto;

import lombok.Data;

@Data
public class ProjectFsEntryResponse {

    private String name;

    private String path;

    private String kind;

    private Boolean hidden;
}

