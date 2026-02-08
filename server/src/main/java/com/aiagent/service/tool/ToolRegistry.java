package com.aiagent.service.tool;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Registry for all available tools.
 * Tools are auto-registered via Spring DI.
 */
@Component
@Slf4j
public class ToolRegistry {

    private final Map<String, ToolDefinition> tools = new HashMap<>();

    public ToolRegistry(List<ToolDefinition> toolDefinitions) {
        for (ToolDefinition tool : toolDefinitions) {
            tools.put(tool.getName(), tool);
            log.info("Registered tool: {}", tool.getName());
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
}
