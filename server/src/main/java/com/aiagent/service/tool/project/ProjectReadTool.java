package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目文件读取工具。
 * 仅允许读取当前项目目录内文件，支持 offset + limit 的分段读取。
 */
@Component
@RequiredArgsConstructor
public class ProjectReadTool implements ToolDefinition {

    private static final int DEFAULT_OFFSET = 1;
    private static final int DEFAULT_LIMIT = 2000;
    private static final int MAX_LIMIT = 2000;
    private static final int MAX_SINGLE_LINE_BYTES = 50 * 1024;

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "read";
    }

    @Override
    public String getDescription() {
        return "读取项目内文件内容，支持按行分段读取。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();

        properties.put("path", Map.of(
                "type", "string",
                "description", "项目内相对路径，例如 src/main/java/App.java"
        ));
        properties.put("offset", Map.of(
                "type", "integer",
                "description", "起始行号（1-based），默认 1"
        ));
        properties.put("limit", Map.of(
                "type", "integer",
                "description", "读取行数，默认 2000，最大 2000"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("path"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: read 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path rootPath = support.resolveProjectRoot(context);
        String rawPath = support.getString(arguments, "path", null);
        if (rawPath == null || rawPath.isBlank()) {
            return "参数 path 不能为空。";
        }

        Path filePath = support.resolvePathInsideProject(rootPath, rawPath, false);
        if (!Files.exists(filePath) || Files.isDirectory(filePath)) {
            return "文件不存在: " + rawPath;
        }

        int offset = Math.max(DEFAULT_OFFSET, support.getInt(arguments, "offset", DEFAULT_OFFSET));
        int limit = support.clamp(support.getInt(arguments, "limit", DEFAULT_LIMIT), 1, MAX_LIMIT);

        List<String> lines;
        try {
            lines = Files.readAllLines(filePath, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            return "读取文件失败: " + ex.getMessage();
        }

        int total = lines.size();
        String relativePath = support.toRelativePath(rootPath, filePath);
        if (total == 0) {
            return "文件 " + relativePath + " 为空。";
        }
        if (offset > total) {
            return "文件 " + relativePath + " 共 " + total + " 行，offset=" + offset + " 超出范围。";
        }

        int startLine = offset;
        int endLine = Math.min(total, offset + limit - 1);

        for (int lineNo = startLine; lineNo <= endLine; lineNo++) {
            String line = lines.get(lineNo - 1);
            int lineBytes = line.getBytes(StandardCharsets.UTF_8).length;
            if (lineBytes > MAX_SINGLE_LINE_BYTES) {
                int currentKb = (int) Math.ceil(lineBytes / 1024.0d);
                int limitKb = (int) Math.ceil(MAX_SINGLE_LINE_BYTES / 1024.0d);
                return "第" + lineNo + "行内容共" + currentKb + "kb，超出" + limitKb + "Kb限制，请更换方式读取";
            }
        }

        StringBuilder builder = new StringBuilder();
        builder.append("文件: ").append(relativePath).append('\n');
        builder.append("当前内容为").append(startLine).append('-').append(endLine)
                .append("行，共").append(total).append("行").append('\n');
        builder.append('\n');
        for (int lineNo = startLine; lineNo <= endLine; lineNo++) {
            builder.append(lineNo).append("| ").append(lines.get(lineNo - 1)).append('\n');
        }

        if (endLine < total) {
            builder.append('\n')
                    .append("当前内容为").append(startLine).append('-').append(endLine)
                    .append("行，共").append(total)
                    .append("行，可传递offset参数继续查看后续内容");
        }
        return builder.toString().trim();
    }

    @Override
    public boolean projectOnly() {
        return true;
    }
}

