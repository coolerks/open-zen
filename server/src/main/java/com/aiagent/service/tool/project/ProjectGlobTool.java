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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 项目文件模式匹配工具。
 * 通过 glob 模式在项目内查找文件，结果按修改时间倒序返回。
 */
@Component
@RequiredArgsConstructor
public class ProjectGlobTool implements ToolDefinition {

    private static final int DEFAULT_LIMIT = 200;
    private static final int MAX_LIMIT = 1000;

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "glob";
    }

    @Override
    public String getDescription() {
        return "按 glob 模式在项目中查找文件，返回按修改时间排序的路径。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("pattern", Map.of(
                "type", "string",
                "description", "glob 模式，例如 **/*.ts 或 src/**/*.java"
        ));
        properties.put("path", Map.of(
                "type", "string",
                "description", "搜索起始目录（项目内相对路径），默认项目根目录"
        ));
        properties.put("limit", Map.of(
                "type", "integer",
                "description", "返回最大数量，默认 200，最大 1000"
        ));
        properties.put("includeDirectories", Map.of(
                "type", "boolean",
                "description", "是否包含目录，默认 false"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("pattern"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: glob 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path projectRoot = support.resolveProjectRoot(context);
        String pattern = support.getString(arguments, "pattern", null);
        if (pattern == null || pattern.isBlank()) {
            return "参数 pattern 不能为空。";
        }

        String basePath = support.getString(arguments, "path", "");
        Path searchRoot = support.resolvePathInsideProject(projectRoot, basePath, true);
        if (!Files.exists(searchRoot) || !Files.isDirectory(searchRoot)) {
            return "目录不存在: " + (basePath == null || basePath.isBlank() ? "." : basePath);
        }

        PathMatcher matcher;
        try {
            matcher = FileSystems.getDefault().getPathMatcher("glob:" + pattern.trim());
        } catch (Exception ex) {
            return "glob 模式不合法: " + ex.getMessage();
        }

        int limit = support.clamp(support.getInt(arguments, "limit", DEFAULT_LIMIT), 1, MAX_LIMIT);
        boolean includeDirectories = support.getBoolean(arguments, "includeDirectories", false);

        List<PathHit> hits = new ArrayList<>();
        try (var stream = Files.walk(searchRoot)) {
            stream.forEach(path -> {
                if (path.equals(searchRoot)) {
                    return;
                }
                try {
                    boolean directory = Files.isDirectory(path);
                    if (directory && !includeDirectories) {
                        return;
                    }
                    if (!directory && !Files.isRegularFile(path)) {
                        return;
                    }

                    Path relativeFromRoot = projectRoot.relativize(path);
                    Path relativeFromSearchRoot = searchRoot.relativize(path);
                    if (!matcher.matches(relativeFromRoot) && !matcher.matches(relativeFromSearchRoot)) {
                        return;
                    }

                    FileTime modifiedTime = Files.getLastModifiedTime(path);
                    String relativePath = support.toRelativePath(projectRoot, path);
                    hits.add(new PathHit(relativePath, modifiedTime.toMillis(), directory));
                } catch (IOException ignored) {
                    // 单个文件读取属性失败时忽略，继续处理其他条目。
                }
            });
        } catch (IOException ex) {
            return "扫描目录失败: " + ex.getMessage();
        }

        hits.sort(Comparator
                .comparingLong(PathHit::lastModifiedMillis).reversed()
                .thenComparing(PathHit::path));

        boolean truncated = hits.size() > limit;
        List<PathHit> visibleHits = truncated ? new ArrayList<>(hits.subList(0, limit)) : hits;

        if (visibleHits.isEmpty()) {
            return "未匹配到任何路径。";
        }

        StringBuilder result = new StringBuilder();
        result.append("匹配模式: ").append(pattern.trim()).append('\n');
        result.append("起始目录: ").append(basePath == null || basePath.isBlank() ? "." : basePath.trim()).append('\n');
        result.append("命中数量: ").append(visibleHits.size());
        if (truncated) {
            result.append("（已按 limit=").append(limit).append(" 截断）");
        }
        result.append("\n\n");
        for (PathHit hit : visibleHits) {
            result.append(hit.directory() ? "dir  " : "file ")
                    .append(hit.path())
                    .append('\n');
        }
        return result.toString().trim();
    }

    @Override
    public boolean projectOnly() {
        return true;
    }

    private record PathHit(String path, long lastModifiedMillis, boolean directory) {
    }
}
