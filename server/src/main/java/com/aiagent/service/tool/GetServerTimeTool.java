package com.aiagent.service.tool;

import com.aiagent.service.tool.annotation.AiTool;
import com.aiagent.service.tool.annotation.AiToolMethod;
import com.aiagent.service.tool.annotation.AiToolParam;
import com.aiagent.service.tool.annotation.AiToolResult;
import org.springframework.stereotype.Component;

import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * 日期时间工具示例。
 * 通过注解式工具声明，演示如何扩展内置工具。
 */
@Component
@AiTool(value = "date-time", description = "日期时间相关工具")
public class GetServerTimeTool {

    private static final String DEFAULT_PATTERN = "yyyy-MM-dd";

    @AiToolMethod(
            name = "getCurrentDate",
            description = "获取当前日期，可按时区与格式输出。"
    )
    @AiToolResult(description = "返回当前日期文本，例如 2026-02-16（Monday）")
    public String getCurrentDate(
            @AiToolParam(
                    name = "timezone",
                    description = "IANA 时区，例如 Asia/Shanghai 或 America/New_York；不传则使用系统时区",
                    required = false
            ) String timezone,
            @AiToolParam(
                    name = "pattern",
                    description = "日期格式，默认 yyyy-MM-dd",
                    required = false
            ) String pattern
    ) {
        java.time.ZoneId zoneId;
        try {
            zoneId = (timezone != null && !timezone.isEmpty())
                    ? java.time.ZoneId.of(timezone)
                    : java.time.ZoneId.systemDefault();
        } catch (Exception e) {
            zoneId = java.time.ZoneId.systemDefault();
        }

        String resolvedPattern = (pattern == null || pattern.isBlank()) ? DEFAULT_PATTERN : pattern.trim();
        DateTimeFormatter formatter;
        try {
            formatter = DateTimeFormatter.ofPattern(resolvedPattern);
        } catch (IllegalArgumentException e) {
            formatter = DateTimeFormatter.ofPattern(DEFAULT_PATTERN);
        }

        java.time.ZonedDateTime now = java.time.ZonedDateTime.now(zoneId);
        String dateText = now.format(formatter);
        String weekday = now.getDayOfWeek().getDisplayName(java.time.format.TextStyle.FULL, Locale.ENGLISH);
        return String.format("当前日期：%s（%s），时区：%s", dateText, weekday, zoneId.getId());
    }
}
