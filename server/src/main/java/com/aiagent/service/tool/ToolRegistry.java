package com.aiagent.service.tool;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Registry for all available tools.
 * Tools are auto-registered via Spring DI.
 */
@Component
@Slf4j
public class ToolRegistry {

    private final Map<String, ToolDefinition> tools = new LinkedHashMap<>();

    public ToolRegistry(List<ToolDefinition> toolDefinitions,
                        ToolAnnotationScanner toolAnnotationScanner) {
        for (ToolDefinition tool : toolDefinitions) {
            registerTool(tool, "bean");
        }
        for (ToolDefinition tool : toolAnnotationScanner.scan()) {
            registerTool(tool, "annotation");
        }
    }

    public ToolDefinition getTool(String name) {
        return tools.get(name);
    }

    public List<ToolDefinition> getAllTools() {
        return List.copyOf(tools.values());
    }

    public boolean hasTool(String name) {
        return tools.containsKey(name);
    }

    /**
     * 注册工具并校验名称冲突，避免大模型调用到不确定版本。
     */
    private void registerTool(ToolDefinition tool, String source) {
        if (tool == null) {
            return;
        }
        String name = tool.getName() == null ? "" : tool.getName().trim();
        if (name.isEmpty()) {
            throw new IllegalStateException("工具名称不能为空");
        }
        if (tools.containsKey(name)) {
            throw new IllegalStateException("工具名称重复: " + name);
        }
        tools.put(name, tool);
        log.info("Registered tool [{}]: {}", source, name);
    }
}
