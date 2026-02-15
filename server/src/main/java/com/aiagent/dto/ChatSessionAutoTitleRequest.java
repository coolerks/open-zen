package com.aiagent.dto;

import lombok.Data;

/**
 * 会话自动标题生成请求。
 */
@Data
public class ChatSessionAutoTitleRequest {
    private Long modelId;
    private String firstQuestion;
}
