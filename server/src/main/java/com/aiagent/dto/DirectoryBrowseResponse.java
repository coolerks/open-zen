package com.aiagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DirectoryBrowseResponse {
    private String currentPath;
    private String parentPath;
    private List<DirectoryEntryResponse> directories;
}
