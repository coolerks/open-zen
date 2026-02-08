package com.aiagent.dto.openrouter;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.math.BigDecimal;
import java.util.List;

/**
 * OpenRouter Chat Completions 响应体。
 * 字段结构与 OpenAI Chat Completions 兼容。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class ChatCompletionResponse {

    private String id;

    private String object;

    private Long created;

    private String model;

    private List<Choice> choices;

    private Usage usage;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Choice {
        private Integer index;
        private Message message;

        @JsonProperty("finish_reason")
        private String finishReason;  // 结束原因：stop / tool_calls / length 等
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Message {
        private String role;
        private String content;

        private String reasoning;

        @JsonProperty("reasoning_content")
        private String reasoningContent;

        @JsonProperty("tool_calls")
        private List<ToolCall> toolCalls;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class ToolCall {
        private String id;
        private String type;
        private FunctionCall function;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class FunctionCall {
        private String name;
        private String arguments;  // JSON 字符串
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Usage {
        @JsonProperty("prompt_tokens")
        private Integer promptTokens;

        @JsonProperty("completion_tokens")
        private Integer completionTokens;

        @JsonProperty("total_tokens")
        private Integer totalTokens;

        @JsonProperty("prompt_tokens_details")
        private PromptTokensDetails promptTokensDetails;

        @JsonProperty("completion_tokens_details")
        private CompletionTokensDetails completionTokensDetails;

        private BigDecimal cost;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class PromptTokensDetails {
        @JsonAlias({"cached_tokens", "cache_read_tokens", "input_cache_read_tokens"})
        private Integer cacheReadTokens;

        @JsonAlias({"cache_write_tokens", "input_cache_write_tokens"})
        private Integer cacheWriteTokens;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class CompletionTokensDetails {
        @JsonAlias({"reasoning_tokens"})
        private Integer reasoningTokens;
    }
}
