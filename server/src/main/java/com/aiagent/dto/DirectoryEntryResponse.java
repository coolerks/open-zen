package com.aiagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DirectoryEntryResponse {
    private String name;
    private String absolutePath;
    private boolean hidden;
}
