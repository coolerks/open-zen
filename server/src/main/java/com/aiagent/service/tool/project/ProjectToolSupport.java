package com.aiagent.service.tool.project;

import com.aiagent.service.ProjectFilesystemService;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Map;

/**
 * 项目工具公共能力：
 * 1) 解析并校验项目上下文；
 * 2) 统一做路径越界防护；
 * 3) 提供常用参数解析与文件读写能力。
 */
@Component
@RequiredArgsConstructor
public class ProjectToolSupport {

    private final ProjectFilesystemService projectFilesystemService;

    public String requireProjectId(ToolExecutionContext context) {
        if (context == null || context.projectId() == null || context.projectId().trim().isEmpty()) {
            throw new RuntimeException("当前工具仅支持项目聊天，会话缺少项目上下文。");
        }
        return context.projectId().trim();
    }

    public Path resolveProjectRoot(ToolExecutionContext context) {
        String projectId = requireProjectId(context);
        return projectFilesystemService.resolveProjectRootPathForWatch(projectId);
    }

    public Path resolvePathInsideProject(Path rootPath, String rawPath, boolean allowRootPath) {
        String normalized = normalizeRelativePath(rawPath);
        Path resolved;
        try {
            resolved = normalized.isEmpty() ? rootPath : rootPath.resolve(normalized).normalize();
        } catch (InvalidPathException ex) {
            throw new RuntimeException("路径不合法。");
        }
        if (!resolved.startsWith(rootPath)) {
            throw new RuntimeException("路径越界，禁止访问项目目录之外的文件。");
        }
        if (!allowRootPath && resolved.equals(rootPath)) {
            throw new RuntimeException("该操作不允许直接作用于项目根目录。");
        }
        return resolved;
    }

    public String toRelativePath(Path rootPath, Path path) {
        if (path.equals(rootPath)) {
            return "";
        }
        return rootPath.relativize(path).toString().replace('\\', '/');
    }

    public String normalizeRelativePath(String rawPath) {
        if (rawPath == null) {
            return "";
        }
        String normalized = rawPath.trim().replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/") && !normalized.isEmpty()) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    public String normalizeEntryName(String rawName) {
        if (rawName == null) {
            throw new RuntimeException("名称不能为空。");
        }
        String normalized = rawName.trim();
        if (normalized.isEmpty() || ".".equals(normalized) || "..".equals(normalized)
                || normalized.contains("/") || normalized.contains("\\")) {
            throw new RuntimeException("名称不合法，不能包含 / 或 \\\\。");
        }
        return normalized;
    }

    public int getInt(Map<String, Object> arguments, String key, int defaultValue) {
        if (arguments == null || key == null) {
            return defaultValue;
        }
        Object raw = arguments.get(key);
        if (raw == null) {
            return defaultValue;
        }
        if (raw instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(raw).trim());
        } catch (Exception ex) {
            return defaultValue;
        }
    }

    public boolean getBoolean(Map<String, Object> arguments, String key, boolean defaultValue) {
        if (arguments == null || key == null) {
            return defaultValue;
        }
        Object raw = arguments.get(key);
        if (raw == null) {
            return defaultValue;
        }
        if (raw instanceof Boolean value) {
            return value;
        }
        String text = String.valueOf(raw).trim();
        if ("true".equalsIgnoreCase(text) || "1".equals(text)) {
            return true;
        }
        if ("false".equalsIgnoreCase(text) || "0".equals(text)) {
            return false;
        }
        return defaultValue;
    }

    public String getString(Map<String, Object> arguments, String key, String defaultValue) {
        if (arguments == null || key == null) {
            return defaultValue;
        }
        Object raw = arguments.get(key);
        if (raw == null) {
            return defaultValue;
        }
        String text = String.valueOf(raw).trim();
        return text.isEmpty() ? defaultValue : text;
    }

    public String readText(Path filePath) {
        if (!Files.exists(filePath) || Files.isDirectory(filePath)) {
            throw new RuntimeException("文件不存在。");
        }
        try {
            return Files.readString(filePath, StandardCharsets.UTF_8);
        } catch (IOException ex) {
            throw new RuntimeException("读取文件失败: " + ex.getMessage());
        }
    }

    public void writeText(Path filePath, String content, boolean createParents) {
        Path parent = filePath.getParent();
        if (parent == null) {
            throw new RuntimeException("目标路径不合法。");
        }
        try {
            if (createParents) {
                Files.createDirectories(parent);
            } else if (!Files.exists(parent) || !Files.isDirectory(parent)) {
                throw new RuntimeException("目标目录不存在。");
            }
        } catch (IOException ex) {
            throw new RuntimeException("准备目标目录失败: " + ex.getMessage());
        }

        Path tempPath = null;
        try {
            tempPath = Files.createTempFile(parent, ".openzen-project-tool-", ".tmp");
            Files.writeString(
                    tempPath,
                    content == null ? "" : content,
                    StandardCharsets.UTF_8,
                    StandardOpenOption.TRUNCATE_EXISTING
            );
            try {
                Files.move(tempPath, filePath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ex) {
                Files.move(tempPath, filePath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException ex) {
            throw new RuntimeException("写入文件失败: " + ex.getMessage());
        } finally {
            if (tempPath != null) {
                try {
                    Files.deleteIfExists(tempPath);
                } catch (IOException ignored) {
                    // 临时文件清理失败不影响主流程
                }
            }
        }
    }

    public int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}

