package com.aiagent.dto;

import lombok.Data;

import java.util.List;

@Data
public class ProjectFsDirectoryResponse {

    private String path;

    private List<ProjectFsEntryResponse> entries;
}

