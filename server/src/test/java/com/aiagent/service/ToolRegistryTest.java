package com.aiagent.service;

import com.aiagent.service.tool.GetServerTimeTool;
import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class ToolRegistryTest {

    @Autowired
    private ToolRegistry toolRegistry;

    @Test
    void testGetServerTimeToolRegistered() {
        assertTrue(toolRegistry.hasTool("getCurrentDate"));
    }

    @Test
    void testGetAllTools() {
        assertFalse(toolRegistry.getAllTools().isEmpty());
    }

    @Test
    void testGetToolByName() {
        ToolDefinition tool = toolRegistry.getTool("getCurrentDate");
        assertNotNull(tool);
        assertEquals("getCurrentDate", tool.getName());
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
        String result = tool.getCurrentDate("Asia/Shanghai", "yyyy-MM-dd HH:mm:ss");
        assertNotNull(result);
        assertTrue(result.contains("当前日期"));
        assertTrue(result.contains("Asia/Shanghai"));
    }

    @Test
    void testGetServerTimeExecutionDefaultTimezone() {
        GetServerTimeTool tool = new GetServerTimeTool();
        String result = tool.getCurrentDate(null, null);
        assertNotNull(result);
        assertTrue(result.contains("当前日期"));
    }

    @Test
    void testGetServerTimeExecutionNullArgs() {
        GetServerTimeTool tool = new GetServerTimeTool();
        String result = tool.getCurrentDate("", "");
        assertNotNull(result);
        assertTrue(result.contains("当前日期"));
    }

    @Test
    void testToolToRequestFormat() {
        ToolDefinition tool = toolRegistry.getTool("getCurrentDate");
        var requestTool = tool.toRequestTool();
        assertEquals("function", requestTool.getType());
        assertEquals("getCurrentDate", requestTool.getFunction().getName());
        assertNotNull(requestTool.getFunction().getDescription());
        assertNotNull(requestTool.getFunction().getParameters());
    }
}
