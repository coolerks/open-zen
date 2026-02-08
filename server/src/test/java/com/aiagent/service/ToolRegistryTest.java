package com.aiagent.service;

import com.aiagent.service.tool.GetServerTimeTool;
import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class ToolRegistryTest {

    @Autowired
    private ToolRegistry toolRegistry;

    @Test
    void testGetServerTimeToolRegistered() {
        assertTrue(toolRegistry.hasTool("getServerTime"));
    }

    @Test
    void testGetAllTools() {
        assertFalse(toolRegistry.getAllTools().isEmpty());
    }

    @Test
    void testGetToolByName() {
        ToolDefinition tool = toolRegistry.getTool("getServerTime");
        assertNotNull(tool);
        assertEquals("getServerTime", tool.getName());
        assertNotNull(tool.getDescription());
        assertNotNull(tool.getParametersSchema());
    }

    @Test
    void testGetUnknownTool() {
        assertNull(toolRegistry.getTool("nonexistentTool"));
        assertFalse(toolRegistry.hasTool("nonexistentTool"));
    }

    @Test
    void testGetServerTimeExecution() {
        GetServerTimeTool tool = new GetServerTimeTool();
        String result = tool.execute(Map.of("timezone", "Asia/Shanghai"));
        assertNotNull(result);
        assertTrue(result.contains("当前服务器时间"));
        assertTrue(result.contains("Asia/Shanghai"));
    }

    @Test
    void testGetServerTimeExecutionDefaultTimezone() {
        GetServerTimeTool tool = new GetServerTimeTool();
        String result = tool.execute(Map.of());
        assertNotNull(result);
        assertTrue(result.contains("当前服务器时间"));
    }

    @Test
    void testGetServerTimeExecutionNullArgs() {
        GetServerTimeTool tool = new GetServerTimeTool();
        String result = tool.execute(null);
        assertNotNull(result);
        assertTrue(result.contains("当前服务器时间"));
    }

    @Test
    void testToolToRequestFormat() {
        ToolDefinition tool = toolRegistry.getTool("getServerTime");
        var requestTool = tool.toRequestTool();
        assertEquals("function", requestTool.getType());
        assertEquals("getServerTime", requestTool.getFunction().getName());
        assertNotNull(requestTool.getFunction().getDescription());
        assertNotNull(requestTool.getFunction().getParameters());
    }
}
