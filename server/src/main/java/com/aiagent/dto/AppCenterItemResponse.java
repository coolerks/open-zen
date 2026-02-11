package com.aiagent.dto;

import lombok.Data;

import java.time.LocalDateTime;

@Data
public class AppCenterItemResponse {

    private Long id;

    private String name;

    private String iconType;

    private String iconValue;

    private String sourceKey;

    private Long sourceSessionId;

    private String sourceSessionTitle;

    private Long sourceMessageId;

    private Long sourceModelId;

    private String sourceModelName;

    private String language;

    private String codeContent;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
