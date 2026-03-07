package com.aiagent.dto.openrouter;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

/**
 * OpenRouter Chat Completions 请求体。
 * 字段结构与 OpenOpen Zen Completions 兼容。
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
@JsonInclude(JsonInclude.Include.NON_NULL)
public class ChatCompletionRequest {

    private String model;

    private List<Message> messages;

    private Double temperature;

    @JsonProperty("top_p")
    private Double topP;

    @JsonProperty("max_tokens")
    private Integer maxTokens;

    private Boolean stream;

    private List<Tool> tools;

    @JsonProperty("tool_choice")
    private Object toolChoice;  // 工具选择策略："auto" | "none" | 指定函数对象

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Message {
        private String role;       // system / user / assistant / tool
        private Object content;    // 文本字符串或视觉消息列表

        @JsonProperty("tool_calls")
        private List<ToolCall> toolCalls;  // assistant 角色工具调用列表

        @JsonProperty("tool_call_id")
        private String toolCallId;  // tool 角色对应的调用 ID
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Tool {
        private String type = "function";
        private FunctionDef function;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class FunctionDef {
        private String name;
        private String description;
        private Object parameters;  // JSON Schema 对象
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class ToolCall {
        private String id;
        private String type = "function";
        private FunctionCall function;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class FunctionCall {
        private String name;
        private String arguments;  // JSON 字符串
    }
}
