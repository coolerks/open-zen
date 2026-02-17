package com.aiagent.service.tool;

import com.aiagent.dto.openrouter.ChatCompletionRequest;

import java.util.Map;

/**
 * 工具定义接口。
 * 每个工具需要提供函数定义并实现执行逻辑。
 */
public interface ToolDefinition {

    /** 工具名称，必须与函数定义里的 name 一致 */
    String getName();

    /** 工具说明 */
    String getDescription();

    /** 工具参数 JSON Schema */
    Map<String, Object> getParametersSchema();

    /** 执行工具并返回结果文本 */
    String execute(Map<String, Object> arguments);

    /**
     * 带执行上下文的工具调用入口。
     * 旧工具无需改造，默认回退到无上下文执行。
     */
    default String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        return execute(arguments);
    }

    /**
     * 是否为“记忆类工具”。
     * 关闭记忆开关时，此类工具不会下发给模型。
     */
    default boolean isMemoryTool() {
        return false;
    }

    /**
     * 在“需要用户授权”模式下，是否允许该工具免授权执行。
     */
    default boolean bypassUserApproval() {
        return false;
    }

    /** 转换为 OpenAI/OpenRouter 兼容工具结构 */
    default ChatCompletionRequest.Tool toRequestTool() {
        ChatCompletionRequest.Tool tool = new ChatCompletionRequest.Tool();
        tool.setType("function");

        ChatCompletionRequest.FunctionDef functionDef = new ChatCompletionRequest.FunctionDef();
        functionDef.setName(getName());
        functionDef.setDescription(getDescription());
        functionDef.setParameters(getParametersSchema());

        tool.setFunction(functionDef);
        return tool;
    }
}
