package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.FileSystems;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.PathMatcher;
import java.nio.file.attribute.FileTime;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目目录列表工具。
 * 在项目目录内列出文件与目录，支持 glob 过滤与递归遍历。
 */
@Component
@RequiredArgsConstructor
public class ProjectListTool implements ToolDefinition {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 2000;
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "list";
    }

    @Override
    public String getDescription() {
        return "列出项目目录内容，支持 glob 模式过滤与递归选项。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("path", Map.of(
                "type", "string",
                "description", "起始目录（项目内相对路径），默认项目根目录"
        ));
        properties.put("glob", Map.of(
                "type", "string",
                "description", "路径 glob 过滤，默认非递归为 *，递归为 **/*"
        ));
        properties.put("recursive", Map.of(
                "type", "boolean",
                "description", "是否递归列出子目录，默认 false"
        ));
        properties.put("includeHidden", Map.of(
                "type", "boolean",
                "description", "是否包含隐藏文件/目录（名称以 . 开头），默认 false"
        ));
        properties.put("includeFiles", Map.of(
                "type", "boolean",
                "description", "是否包含文件，默认 true"
        ));
        properties.put("includeDirectories", Map.of(
                "type", "boolean",
                "description", "是否包含目录，默认 true"
        ));
        properties.put("limit", Map.of(
                "type", "integer",
                "description", "最大返回数量，默认 200，最大 2000"
        ));

        schema.put("properties", properties);
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: list 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path projectRoot = support.resolveProjectRoot(context);
        String basePath = support.getString(arguments, "path", "");
        boolean recursive = support.getBoolean(arguments, "recursive", false);
        String rawGlobPattern = support.getString(arguments, "glob", "");
        String globPattern = rawGlobPattern.isBlank()
                ? (recursive ? "**/*" : "*")
                : rawGlobPattern.trim();
        boolean includeHidden = support.getBoolean(arguments, "includeHidden", false);
        boolean includeFiles = support.getBoolean(arguments, "includeFiles", true);
        boolean includeDirectories = support.getBoolean(arguments, "includeDirectories", true);
        int limit = support.clamp(support.getInt(arguments, "limit", DEFAULT_LIMIT), 1, MAX_LIMIT);

        if (!includeFiles && !includeDirectories) {
            return "参数 includeFiles 与 includeDirectories 不能同时为 false。";
        }

        Path searchRoot = support.resolvePathInsideProject(projectRoot, basePath, true);
        if (!Files.exists(searchRoot) || !Files.isDirectory(searchRoot)) {
            return "目录不存在: " + (basePath == null || basePath.isBlank() ? "." : basePath);
        }

        List<PathMatcher> matchers;
        try {
            matchers = buildMatchers(globPattern);
        } catch (Exception ex) {
            return "glob 模式不合法: " + ex.getMessage();
        }

        int maxDepth = recursive ? Integer.MAX_VALUE : 1;
        List<ListEntry> entries = new ArrayList<>();
        int scanned = 0;

        try (var stream = Files.walk(searchRoot, maxDepth)) {
            for (Path path : stream.toList()) {
                if (path.equals(searchRoot)) {
                    continue;
                }

                boolean directory = Files.isDirectory(path);
                if (directory && !includeDirectories) {
                    continue;
                }
                if (!directory && !includeFiles) {
                    continue;
                }
                if (!directory && !Files.isRegularFile(path)) {
                    continue;
                }

                Path relativeFromRoot = projectRoot.relativize(path);
                Path relativeFromSearchRoot = searchRoot.relativize(path);
                if (!matchesAny(matchers, relativeFromRoot, relativeFromSearchRoot)) {
                    continue;
                }

                String relativePath = support.toRelativePath(projectRoot, path);
                if (!includeHidden && containsHiddenSegment(relativePath)) {
                    continue;
                }

                scanned += 1;
                long size = 0L;
                long modifiedMillis = 0L;
                try {
                    if (!directory) {
                        size = Files.size(path);
                    }
                    FileTime modified = Files.getLastModifiedTime(path);
                    modifiedMillis = modified.toMillis();
                } catch (IOException ignored) {
                    // 读取属性失败时保留默认值。
                }

                entries.add(new ListEntry(relativePath, directory, size, modifiedMillis));
            }
        } catch (IOException ex) {
            return "遍历目录失败: " + ex.getMessage();
        }

        entries.sort(Comparator
                .comparingLong(ListEntry::modifiedMillis).reversed()
                .thenComparing(ListEntry::path));

        boolean truncated = entries.size() > limit;
        List<ListEntry> limitedEntries = truncated ? entries.subList(0, limit) : entries;

        if (limitedEntries.isEmpty()) {
            return "目录为空或没有匹配项。";
        }

        StringBuilder result = new StringBuilder();
        result.append("目录: ").append(basePath == null || basePath.isBlank() ? "." : basePath.trim()).append('\n');
        result.append("glob: ").append(globPattern.trim()).append('\n');
        result.append("递归: ").append(recursive ? "是" : "否").append('\n');
        result.append("匹配数量: ").append(limitedEntries.size());
        if (truncated) {
            result.append("（已按 limit=").append(limit).append(" 截断）");
        }
        result.append('\n');
        result.append("扫描条目: ").append(scanned).append('\n');
        result.append('\n');

        int index = 1;
        for (ListEntry entry : limitedEntries) {
            String time = entry.modifiedMillis() <= 0
                    ? "-"
                    : LocalDateTime.ofInstant(
                    java.time.Instant.ofEpochMilli(entry.modifiedMillis()),
                    ZoneId.systemDefault()
            ).format(TIME_FORMATTER);
            result.append(index++)
                    .append(". ")
                    .append(entry.directory() ? "dir " : "file ")
                    .append(entry.path());
            if (!entry.directory()) {
                result.append(" (").append(entry.size()).append(" bytes)");
            }
            result.append(" [mtime ").append(time).append(']');
            result.append('\n');
        }
        return result.toString().trim();
    }

    /**
     * 构建 glob 匹配器列表：
     * 1) 保留用户给定模式；
     * 2) 兼容 Java PathMatcher 在根目录文件上对“双星目录通配”模式的匹配差异（补充 **）。
     */
    private List<PathMatcher> buildMatchers(String globPattern) {
        String normalizedPattern = globPattern == null ? "" : globPattern.trim();
        if (normalizedPattern.isBlank()) {
            normalizedPattern = "*";
        }
        List<PathMatcher> matchers = new ArrayList<>();
        matchers.add(FileSystems.getDefault().getPathMatcher("glob:" + normalizedPattern));
        if ("**/*".equals(normalizedPattern)) {
            matchers.add(FileSystems.getDefault().getPathMatcher("glob:**"));
        }
        return matchers;
    }

    /**
     * 只要任意 matcher 命中“相对项目根”或“相对起始目录”路径，即视为匹配。
     */
    private boolean matchesAny(List<PathMatcher> matchers, Path relativeFromRoot, Path relativeFromSearchRoot) {
        if (matchers == null || matchers.isEmpty()) {
            return true;
        }
        Path fileNameFromRoot = relativeFromRoot != null ? relativeFromRoot.getFileName() : null;
        Path fileNameFromSearchRoot = relativeFromSearchRoot != null ? relativeFromSearchRoot.getFileName() : null;
        for (PathMatcher matcher : matchers) {
            if (matcher.matches(relativeFromRoot) || matcher.matches(relativeFromSearchRoot)) {
                return true;
            }
            if (fileNameFromRoot != null && matcher.matches(fileNameFromRoot)) {
                return true;
            }
            if (fileNameFromSearchRoot != null && matcher.matches(fileNameFromSearchRoot)) {
                return true;
            }
        }
        return false;
    }

    @Override
    public boolean projectOnly() {
        return true;
    }

    private boolean containsHiddenSegment(String relativePath) {
        if (relativePath == null || relativePath.isBlank()) {
            return false;
        }
        String[] segments = relativePath.split("/");
        for (String segment : segments) {
            if (segment.startsWith(".")) {
                return true;
            }
        }
        return false;
    }

    private record ListEntry(String path, boolean directory, long size, long modifiedMillis) {
    }
}
