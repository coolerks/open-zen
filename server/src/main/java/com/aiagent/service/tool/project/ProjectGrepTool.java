package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * 项目内容正则检索工具。
 * 支持 regex + glob 组合过滤，并返回命中行号与文本片段。
 */
@Component
@RequiredArgsConstructor
public class ProjectGrepTool implements ToolDefinition {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;
    private static final int MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;
    private static final int MAX_LINE_PREVIEW = 220;

    private static final List<String> BINARY_EXTENSIONS = List.of(
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "pdf",
            "zip", "7z", "rar", "gz", "tar", "jar", "war",
            "mp3", "mp4", "mov", "avi",
            "woff", "woff2", "ttf", "otf",
            "exe", "dll", "so", "dylib", "class"
    );

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "grep";
    }

    @Override
    public String getDescription() {
        return "按正则表达式搜索项目文件内容，支持 glob 文件模式过滤。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("pattern", Map.of(
                "type", "string",
                "description", "正则表达式，例如 TODO|FIXME"
        ));
        properties.put("glob", Map.of(
                "type", "string",
                "description", "文件路径 glob 过滤，默认 **/*"
        ));
        properties.put("path", Map.of(
                "type", "string",
                "description", "搜索起始目录（项目内相对路径），默认项目根目录"
        ));
        properties.put("ignoreCase", Map.of(
                "type", "boolean",
                "description", "是否忽略大小写，默认 false"
        ));
        properties.put("limit", Map.of(
                "type", "integer",
                "description", "返回最大命中数量，默认 200，最大 1000"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("pattern"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: grep 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path projectRoot = support.resolveProjectRoot(context);
        String rawPattern = support.getString(arguments, "pattern", null);
        if (rawPattern == null || rawPattern.isBlank()) {
            return "参数 pattern 不能为空。";
        }

        boolean ignoreCase = support.getBoolean(arguments, "ignoreCase", false);
        Pattern contentPattern;
        try {
            int flags = ignoreCase ? Pattern.CASE_INSENSITIVE : 0;
            contentPattern = Pattern.compile(rawPattern, flags);
        } catch (PatternSyntaxException ex) {
            return "正则表达式不合法: " + ex.getMessage();
        }

        String basePath = support.getString(arguments, "path", "");
        Path searchRoot = support.resolvePathInsideProject(projectRoot, basePath, true);
        if (!Files.exists(searchRoot) || !Files.isDirectory(searchRoot)) {
            return "目录不存在: " + (basePath == null || basePath.isBlank() ? "." : basePath);
        }

        String glob = support.getString(arguments, "glob", "**/*");
        PathMatcher globMatcher;
        try {
            globMatcher = FileSystems.getDefault().getPathMatcher("glob:" + glob);
        } catch (Exception ex) {
            return "glob 模式不合法: " + ex.getMessage();
        }

        int limit = support.clamp(support.getInt(arguments, "limit", DEFAULT_LIMIT), 1, MAX_LIMIT);
        List<GrepHit> hits = new ArrayList<>();
        int scannedFiles = 0;
        int skippedFiles = 0;

        try (var stream = Files.walk(searchRoot)) {
            for (Path file : stream.filter(Files::isRegularFile).toList()) {
                if (hits.size() >= limit) {
                    break;
                }

                String relativePath = support.toRelativePath(projectRoot, file);
                Path relativeFromRoot = projectRoot.relativize(file);
                Path relativeFromSearchRoot = searchRoot.relativize(file);
                if (!globMatcher.matches(relativeFromRoot) && !globMatcher.matches(relativeFromSearchRoot)) {
                    continue;
                }

                scannedFiles += 1;
                if (shouldSkipFile(file)) {
                    skippedFiles += 1;
                    continue;
                }

                List<String> lines;
                try {
                    lines = Files.readAllLines(file, StandardCharsets.UTF_8);
                } catch (IOException ex) {
                    skippedFiles += 1;
                    continue;
                }

                for (int i = 0; i < lines.size(); i++) {
                    if (hits.size() >= limit) {
                        break;
                    }
                    String line = lines.get(i);
                    if (!contentPattern.matcher(line).find()) {
                        continue;
                    }
                    hits.add(new GrepHit(
                            relativePath,
                            i + 1,
                            normalizeLinePreview(line)
                    ));
                }
            }
        } catch (IOException ex) {
            return "遍历目录失败: " + ex.getMessage();
        }

        if (hits.isEmpty()) {
            return "未找到匹配内容。";
        }

        StringBuilder result = new StringBuilder();
        result.append("正则: ").append(rawPattern).append('\n');
        result.append("glob: ").append(glob).append('\n');
        result.append("命中: ").append(hits.size());
        if (hits.size() >= limit) {
            result.append("（已按 limit=").append(limit).append(" 截断）");
        }
        result.append('\n');
        result.append("扫描文件: ").append(scannedFiles).append("，跳过文件: ").append(skippedFiles).append('\n');
        result.append('\n');

        int index = 1;
        for (GrepHit hit : hits) {
            result.append(index++)
                    .append(". ")
                    .append(hit.path())
                    .append(':')
                    .append(hit.lineNumber())
                    .append(" | ")
                    .append(hit.snippet())
                    .append('\n');
        }
        return result.toString().trim();
    }

    @Override
    public boolean projectOnly() {
        return true;
    }

    private boolean shouldSkipFile(Path file) {
        try {
            long size = Files.size(file);
            if (size > MAX_FILE_SIZE_BYTES) {
                return true;
            }
        } catch (IOException ignored) {
            return true;
        }

        String fileName = file.getFileName() == null ? "" : file.getFileName().toString().toLowerCase(Locale.ROOT);
        int dotIndex = fileName.lastIndexOf('.');
        if (dotIndex < 0 || dotIndex == fileName.length() - 1) {
            return false;
        }
        String extension = fileName.substring(dotIndex + 1);
        return BINARY_EXTENSIONS.contains(extension);
    }

    private String normalizeLinePreview(String line) {
        String normalized = line
                .replace('\t', ' ')
                .replace('\r', ' ')
                .replace('\n', ' ')
                .replaceAll("\\s+", " ")
                .trim();
        if (normalized.length() <= MAX_LINE_PREVIEW) {
            return normalized;
        }
        return normalized.substring(0, MAX_LINE_PREVIEW) + "...";
    }

    private record GrepHit(String path, int lineNumber, String snippet) {
    }
}
