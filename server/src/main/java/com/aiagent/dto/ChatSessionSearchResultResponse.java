package com.aiagent.dto;

import lombok.Data;

import java.time.LocalDateTime;

/**
 * 聊天搜索结果。
 */
@Data
public class ChatSessionSearchResultResponse {
    private Long sessionId;
    private String title;
    private String snippet;
    private Long matchedMessageId;
    /**
     * 命中来源：title / message / both。
     */
    private String matchedBy;
    private LocalDateTime matchedAt;
}
