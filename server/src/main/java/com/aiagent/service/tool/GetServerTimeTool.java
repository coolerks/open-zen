package com.aiagent.service.tool;

import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;

/**
 * A simple built-in tool that returns the current server time.
 * Used to verify that the tool calling pipeline works end-to-end.
 */
@Component
public class GetServerTimeTool implements ToolDefinition {

    @Override
    public String getName() {
        return "getServerTime";
    }

    @Override
    public String getDescription() {
        return "获取当前服务器时间，可指定时区。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new HashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new HashMap<>();
        Map<String, Object> timezone = new HashMap<>();
        timezone.put("type", "string");
        timezone.put("description", "时区，例如 Asia/Shanghai，默认为系统时区");
        properties.put("timezone", timezone);

        schema.put("properties", properties);
        schema.put("required", new String[]{});
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        String tz = arguments != null ? (String) arguments.get("timezone") : null;
        java.time.ZoneId zoneId;
        try {
            zoneId = (tz != null && !tz.isEmpty())
                    ? java.time.ZoneId.of(tz)
                    : java.time.ZoneId.systemDefault();
        } catch (Exception e) {
            zoneId = java.time.ZoneId.systemDefault();
        }

        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(zoneId);
        return String.format("当前服务器时间: %s (时区: %s)",
                now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")),
                zoneId.getId());
    }
}
