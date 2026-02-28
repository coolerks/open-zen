package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目文件精确替换工具。
 * 用 oldText -> newText 的方式修改已有文件。
 */
@Component
@RequiredArgsConstructor
public class ProjectEditTool implements ToolDefinition {

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "edit";
    }

    @Override
    public String getDescription() {
        return "通过精确字符串替换编辑现有文件。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("path", Map.of(
                "type", "string",
                "description", "项目内相对文件路径"
        ));
        properties.put("oldText", Map.of(
                "type", "string",
                "description", "待替换的原始文本，必须精确匹配"
        ));
        properties.put("newText", Map.of(
                "type", "string",
                "description", "替换后的文本"
        ));
        properties.put("replaceAll", Map.of(
                "type", "boolean",
                "description", "是否替换全部匹配，默认 false（仅替换首个）"
        ));
        properties.put("expectedOccurrences", Map.of(
                "type", "integer",
                "description", "期望命中次数，传入后若不一致会拒绝替换"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("path", "oldText", "newText"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: edit 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path rootPath = support.resolveProjectRoot(context);

        String rawPath = support.getString(arguments, "path", null);
        if (rawPath == null || rawPath.isBlank()) {
            return "参数 path 不能为空。";
        }
        String oldText = getRawString(arguments, "oldText");
        String newText = getRawString(arguments, "newText");
        if (oldText == null || oldText.isEmpty()) {
            return "参数 oldText 不能为空字符串。";
        }
        if (newText == null) {
            return "参数 newText 不能为空。";
        }

        Path filePath = support.resolvePathInsideProject(rootPath, rawPath, false);
        String originalContent = support.readText(filePath);

        int hitCount = countOccurrences(originalContent, oldText);
        if (hitCount <= 0) {
            return "未找到需要替换的 oldText。";
        }

        int expectedOccurrences = support.getInt(arguments, "expectedOccurrences", -1);
        if (expectedOccurrences >= 0 && expectedOccurrences != hitCount) {
            return "命中次数不符合预期，实际命中 " + hitCount + " 次，expectedOccurrences=" + expectedOccurrences;
        }

        boolean replaceAll = support.getBoolean(arguments, "replaceAll", false);
        String updatedContent;
        int replacedCount;
        if (replaceAll) {
            updatedContent = originalContent.replace(oldText, newText);
            replacedCount = hitCount;
        } else {
            updatedContent = replaceFirst(originalContent, oldText, newText);
            replacedCount = 1;
        }

        support.writeText(filePath, updatedContent, false);
        String relativePath = support.toRelativePath(rootPath, filePath);
        return "编辑成功: " + relativePath + "，共替换 " + replacedCount + " 处文本。";
    }

    @Override
    public boolean projectOnly() {
        return true;
    }

    private String getRawString(Map<String, Object> arguments, String key) {
        if (arguments == null || key == null) {
            return null;
        }
        Object value = arguments.get(key);
        return value == null ? null : String.valueOf(value);
    }

    private int countOccurrences(String text, String target) {
        int count = 0;
        int index = 0;
        while (index >= 0) {
            index = text.indexOf(target, index);
            if (index < 0) {
                break;
            }
            count += 1;
            index += target.length();
        }
        return count;
    }

    private String replaceFirst(String text, String oldText, String newText) {
        int index = text.indexOf(oldText);
        if (index < 0) {
            return text;
        }
        return text.substring(0, index) + newText + text.substring(index + oldText.length());
    }
}

