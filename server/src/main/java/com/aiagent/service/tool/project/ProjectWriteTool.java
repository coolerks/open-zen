package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目文件写入工具。
 * 支持创建新文件或覆盖已有文件。
 */
@Component
@RequiredArgsConstructor
public class ProjectWriteTool implements ToolDefinition {

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "write";
    }

    @Override
    public String getDescription() {
        return "创建新文件或覆盖现有文件。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("path", Map.of(
                "type", "string",
                "description", "项目内相对文件路径，例如 src/index.ts"
        ));
        properties.put("content", Map.of(
                "type", "string",
                "description", "完整文件内容，若文件已存在将被覆盖"
        ));
        properties.put("createParents", Map.of(
                "type", "boolean",
                "description", "父目录不存在时是否自动创建，默认 true"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("path", "content"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: write 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path rootPath = support.resolveProjectRoot(context);
        String rawPath = support.getString(arguments, "path", null);
        if (rawPath == null || rawPath.isBlank()) {
            return "参数 path 不能为空。";
        }

        Object rawContent = arguments == null ? null : arguments.get("content");
        if (rawContent == null) {
            return "参数 content 不能为空。";
        }
        String content = String.valueOf(rawContent);
        boolean createParents = support.getBoolean(arguments, "createParents", true);

        Path filePath = support.resolvePathInsideProject(rootPath, rawPath, false);
        if (Files.exists(filePath) && Files.isDirectory(filePath)) {
            return "目标路径是目录，无法覆盖写入文件。";
        }

        support.writeText(filePath, content, createParents);
        String relativePath = support.toRelativePath(rootPath, filePath);
        int bytes = content.getBytes(StandardCharsets.UTF_8).length;
        return "写入成功: " + relativePath + "（" + bytes + " bytes）";
    }

    @Override
    public boolean projectOnly() {
        return true;
    }
}

