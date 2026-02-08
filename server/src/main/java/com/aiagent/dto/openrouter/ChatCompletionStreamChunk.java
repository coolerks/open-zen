package com.aiagent.dto.openrouter;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class ChatCompletionStreamChunk {

    private String id;

    private String model;

    private List<Choice> choices;

    private ChatCompletionResponse.Usage usage;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Choice {
        private Integer index;
        private Delta delta;

        @JsonProperty("finish_reason")
        private String finishReason;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Delta {
        private String role;
        private String content;

        @JsonAlias({"reasoning", "reasoning_content"})
        private String reasoning;

        @JsonProperty("tool_calls")
        private List<ChatCompletionResponse.ToolCall> toolCalls;
    }
}
