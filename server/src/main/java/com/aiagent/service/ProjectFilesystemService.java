package com.aiagent.service;

import com.aiagent.dto.ProjectFsCreateEntryRequest;
import com.aiagent.dto.ProjectFsDirectoryResponse;
import com.aiagent.dto.ProjectFsEntryResponse;
import com.aiagent.dto.ProjectFsFileResponse;
import com.aiagent.dto.ProjectFsFileMetaResponse;
import com.aiagent.dto.ProjectFsMoveEntryRequest;
import com.aiagent.dto.ProjectFsWriteFileRequest;
import com.aiagent.entity.ProjectItem;
import com.aiagent.mapper.ProjectItemMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Base64;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;

@Service
@RequiredArgsConstructor
public class ProjectFilesystemService {

    private static final String INVALID_RELATIVE_PATH_MESSAGE = "项目内路径不合法。";
    private static final String INVALID_NAME_MESSAGE = "名称不合法，不能包含 / 或 \\。";
    private static final String DIRECTORY_NOT_FOUND_MESSAGE = "目录不存在，请重新关联真实目录。";
    private static final String FILE_NOT_FOUND_MESSAGE = "文件不存在。";
    private static final long FILE_PREVIEW_SIZE_LIMIT_BYTES = 1024L * 1024L;

    private final ProjectItemMapper projectItemMapper;
    private final ProjectFilesystemWatchService projectFilesystemWatchService;

    public ProjectFsDirectoryResponse listEntries(String projectId, String rawRelativePath) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path directoryPath = resolvePathInsideProject(rootPath, rawRelativePath);
        if (!Files.exists(directoryPath) || !Files.isDirectory(directoryPath)) {
            throw new RuntimeException(DIRECTORY_NOT_FOUND_MESSAGE);
        }

        List<ProjectFsEntryResponse> entries;
        try (var stream = Files.list(directoryPath)) {
            entries = stream
                    .map(path -> toEntry(rootPath, path))
                    .sorted(Comparator
                            .comparing((ProjectFsEntryResponse entry) -> "directory".equals(entry.getKind()) ? 0 : 1)
                            .thenComparing(ProjectFsEntryResponse::getName, String.CASE_INSENSITIVE_ORDER))
                    .toList();
        } catch (IOException ex) {
            throw new RuntimeException("读取目录失败，请检查权限后重试。");
        }

        ProjectFsDirectoryResponse response = new ProjectFsDirectoryResponse();
        response.setPath(toRelativePath(rootPath, directoryPath));
        response.setEntries(entries);
        return response;
    }

    public ProjectFsFileMetaResponse readFileMeta(String projectId, String rawRelativePath) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path filePath = resolvePathInsideProject(rootPath, rawRelativePath);
        if (!Files.exists(filePath) || Files.isDirectory(filePath)) {
            throw new RuntimeException(FILE_NOT_FOUND_MESSAGE);
        }

        try {
            long size = Files.size(filePath);
            ProjectFsFileMetaResponse response = new ProjectFsFileMetaResponse();
            response.setPath(toRelativePath(rootPath, filePath));
            response.setSize(size);
            response.setRevision(resolveFileRevision(filePath));
            response.setTooLarge(size > FILE_PREVIEW_SIZE_LIMIT_BYTES);
            response.setLargeFileThresholdBytes(FILE_PREVIEW_SIZE_LIMIT_BYTES);
            return response;
        } catch (IOException ex) {
            throw new RuntimeException("读取文件信息失败，请检查权限后重试。");
        }
    }

    public ProjectFsFileResponse readFile(String projectId, String rawRelativePath, boolean allowLargeFile) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path filePath = resolvePathInsideProject(rootPath, rawRelativePath);
        if (!Files.exists(filePath) || Files.isDirectory(filePath)) {
            throw new RuntimeException(FILE_NOT_FOUND_MESSAGE);
        }

        try {
            long size = Files.size(filePath);
            if (!allowLargeFile && size > FILE_PREVIEW_SIZE_LIMIT_BYTES) {
                throw new RuntimeException("文件较大（超过 1MB），请确认后再打开。");
            }
            byte[] bytes = Files.readAllBytes(filePath);
            ProjectFsFileResponse response = new ProjectFsFileResponse();
            response.setPath(toRelativePath(rootPath, filePath));

            // Check if file is binary (image file) by extension
            String fileName = filePath.getFileName().toString().toLowerCase(Locale.ROOT);
            boolean isBinaryImage = fileName.endsWith(".png") || fileName.endsWith(".jpg") ||
                                   fileName.endsWith(".jpeg") || fileName.endsWith(".gif") ||
                                   fileName.endsWith(".webp") || fileName.endsWith(".bmp") ||
                                   fileName.endsWith(".ico");

            if (isBinaryImage) {
                // For binary image files, encode as base64
                response.setContent(Base64.getEncoder().encodeToString(bytes));
            } else {
                // For text files, use UTF-8
                response.setContent(new String(bytes, StandardCharsets.UTF_8));
            }

            response.setSize((long) bytes.length);
            response.setRevision(resolveFileRevision(filePath));
            return response;
        } catch (IOException ex) {
            throw new RuntimeException("读取文件失败，请检查权限后重试。");
        }
    }

    public ProjectFsFileResponse writeFile(String projectId, ProjectFsWriteFileRequest request) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path filePath = resolvePathInsideProject(rootPath, request.getPath());
        if (Files.exists(filePath) && Files.isDirectory(filePath)) {
            throw new RuntimeException("目标路径是目录，无法写入文件。");
        }

        Path parentPath = filePath.getParent();
        if (parentPath == null || !Files.exists(parentPath) || !Files.isDirectory(parentPath)) {
            throw new RuntimeException("目标目录不存在。");
        }

        String content = request.getContent() == null ? "" : request.getContent();
        if (Files.exists(filePath)) {
            String expectedRevision = request.getExpectedRevision() == null ? "" : request.getExpectedRevision().trim();
            String currentRevision = resolveFileRevision(filePath);
            if (!expectedRevision.isEmpty() && !expectedRevision.equals(currentRevision)) {
                throw new RuntimeException("文件已被其他编辑器修改，请先刷新后再保存。");
            }
        }
        Path tempPath = null;
        try {
            tempPath = Files.createTempFile(parentPath, ".openzen-write-", ".tmp");
            Files.writeString(tempPath, content, StandardCharsets.UTF_8, StandardOpenOption.TRUNCATE_EXISTING);
            try {
                Files.move(tempPath, filePath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (AtomicMoveNotSupportedException ex) {
                Files.move(tempPath, filePath, StandardCopyOption.REPLACE_EXISTING);
            }
            ProjectFsFileResponse response = new ProjectFsFileResponse();
            String relativePath = toRelativePath(rootPath, filePath);
            response.setPath(relativePath);
            response.setContent(content);
            response.setSize((long) content.getBytes(StandardCharsets.UTF_8).length);
            response.setRevision(resolveFileRevision(filePath));
            projectFilesystemWatchService.markSelfWrite(projectId, rootPath, relativePath, request.getClientId());
            return response;
        } catch (IOException ex) {
            throw new RuntimeException("写入文件失败，请检查权限后重试。");
        } finally {
            if (tempPath != null) {
                try {
                    Files.deleteIfExists(tempPath);
                } catch (IOException ignored) {
                    // 临时文件清理失败不影响主流程。
                }
            }
        }
    }

    public ProjectFsEntryResponse createEntry(String projectId, ProjectFsCreateEntryRequest request) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path parentPath = resolvePathInsideProject(rootPath, request.getParentPath());
        if (!Files.exists(parentPath) || !Files.isDirectory(parentPath)) {
            throw new RuntimeException("父目录不存在。");
        }

        String name = normalizeEntryName(request.getName());
        Path targetPath = parentPath.resolve(name).normalize();
        if (!targetPath.startsWith(rootPath)) {
            throw new RuntimeException(INVALID_RELATIVE_PATH_MESSAGE);
        }
        if (Files.exists(targetPath)) {
            throw new RuntimeException("此位置已存在同名文件或目录。");
        }

        String kind = request.getKind().trim();
        try {
            if ("directory".equals(kind)) {
                Files.createDirectory(targetPath);
            } else if ("file".equals(kind)) {
                Files.createFile(targetPath);
            } else {
                throw new RuntimeException("仅支持创建 file 或 directory。");
            }
        } catch (IOException ex) {
            throw new RuntimeException("创建失败，请检查权限后重试。");
        }

        return toEntry(rootPath, targetPath);
    }

    public void deleteEntry(String projectId, String rawRelativePath, boolean recursive) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path targetPath = resolvePathInsideProject(rootPath, rawRelativePath);
        if (!Files.exists(targetPath)) {
            throw new RuntimeException("目标不存在。");
        }
        if (targetPath.equals(rootPath)) {
            throw new RuntimeException("不支持删除项目根目录。");
        }

        try {
            if (Files.isDirectory(targetPath) && recursive) {
                try (var stream = Files.walk(targetPath)) {
                    stream.sorted(Comparator.reverseOrder())
                            .forEach(path -> {
                                try {
                                    Files.deleteIfExists(path);
                                } catch (IOException ex) {
                                    throw new RuntimeException("删除失败，请检查权限后重试。");
                                }
                            });
                }
            } else {
                Files.delete(targetPath);
            }
        } catch (RuntimeException ex) {
            throw ex;
        } catch (IOException ex) {
            throw new RuntimeException("删除失败，请检查权限后重试。");
        }
    }

    public ProjectFsEntryResponse moveEntry(String projectId, ProjectFsMoveEntryRequest request) {
        Path rootPath = resolveProjectRootPath(projectId);
        Path sourcePath = resolvePathInsideProject(rootPath, request.getSourcePath());
        if (!Files.exists(sourcePath)) {
            throw new RuntimeException("源文件或目录不存在。");
        }
        if (sourcePath.equals(rootPath)) {
            throw new RuntimeException("不支持移动项目根目录。");
        }

        Path targetDirectoryPath = resolvePathInsideProject(rootPath, request.getTargetDirectoryPath());
        if (!Files.exists(targetDirectoryPath) || !Files.isDirectory(targetDirectoryPath)) {
            throw new RuntimeException("目标目录不存在。");
        }

        String sourceName = sourcePath.getFileName() == null ? "" : sourcePath.getFileName().toString();
        String targetName = request.getTargetName() == null || request.getTargetName().trim().isEmpty()
                ? sourceName
                : normalizeEntryName(request.getTargetName());
        if (targetName.isEmpty()) {
            throw new RuntimeException("目标名称不能为空。");
        }

        Path targetPath = targetDirectoryPath.resolve(targetName).normalize();
        if (!targetPath.startsWith(rootPath)) {
            throw new RuntimeException(INVALID_RELATIVE_PATH_MESSAGE);
        }
        if (!sourcePath.equals(targetPath) && Files.exists(targetPath)) {
            throw new RuntimeException("目标路径已存在同名文件或目录。");
        }
        if (Files.isDirectory(sourcePath) && targetPath.startsWith(sourcePath) && !targetPath.equals(sourcePath)) {
            throw new RuntimeException("不能将目录移动到自身或其子目录中。");
        }

        try {
            if (!sourcePath.equals(targetPath)) {
                Files.move(sourcePath, targetPath);
            }
            return toEntry(rootPath, targetPath);
        } catch (IOException ex) {
            throw new RuntimeException("移动失败，请检查权限后重试。");
        }
    }

    private ProjectItem getProjectById(String projectId) {
        ProjectItem projectItem = projectItemMapper.selectById(projectId);
        if (projectItem == null) {
            throw new RuntimeException("项目不存在: " + projectId);
        }
        return projectItem;
    }

    public Path resolveProjectRootPathForWatch(String projectId) {
        return resolveProjectRootPath(projectId);
    }

    private Path resolveProjectRootPath(String projectId) {
        ProjectItem projectItem = getProjectById(projectId);
        String realDirPath = projectItem.getRealDirPath();
        if (realDirPath == null || realDirPath.trim().isEmpty()) {
            throw new RuntimeException("项目未关联真实目录，请先重新关联目录。");
        }

        Path rootPath;
        try {
            rootPath = Paths.get(realDirPath).toAbsolutePath().normalize();
        } catch (InvalidPathException ex) {
            throw new RuntimeException("项目目录路径无效，请重新关联目录。");
        }

        if (!Files.exists(rootPath) || !Files.isDirectory(rootPath)) {
            throw new RuntimeException("项目目录不存在，请重新关联目录。");
        }
        return rootPath;
    }

    private Path resolvePathInsideProject(Path rootPath, String rawRelativePath) {
        String normalized = normalizeRelativePath(rawRelativePath);
        Path targetPath;
        try {
            targetPath = normalized.isEmpty()
                    ? rootPath
                    : rootPath.resolve(normalized).normalize();
        } catch (InvalidPathException ex) {
            throw new RuntimeException(INVALID_RELATIVE_PATH_MESSAGE);
        }

        if (!targetPath.startsWith(rootPath)) {
            throw new RuntimeException(INVALID_RELATIVE_PATH_MESSAGE);
        }
        return targetPath;
    }

    private String normalizeRelativePath(String rawRelativePath) {
        if (rawRelativePath == null) {
            return "";
        }
        String normalized = rawRelativePath.trim().replace('\\', '/');
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/") && !normalized.isEmpty()) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private String normalizeEntryName(String rawName) {
        if (rawName == null) {
            throw new RuntimeException(INVALID_NAME_MESSAGE);
        }
        String name = rawName.trim();
        if (name.isEmpty() || name.contains("/") || name.contains("\\")) {
            throw new RuntimeException(INVALID_NAME_MESSAGE);
        }
        if (".".equals(name) || "..".equals(name)) {
            throw new RuntimeException(INVALID_NAME_MESSAGE);
        }
        return name;
    }

    private String toRelativePath(Path rootPath, Path path) {
        if (path.equals(rootPath)) {
            return "";
        }
        return rootPath.relativize(path).toString().replace('\\', '/');
    }

    private ProjectFsEntryResponse toEntry(Path rootPath, Path path) {
        ProjectFsEntryResponse entry = new ProjectFsEntryResponse();
        String name = path.getFileName() == null ? path.toString() : path.getFileName().toString();
        entry.setName(name);
        entry.setPath(toRelativePath(rootPath, path));
        entry.setKind(Files.isDirectory(path) ? "directory" : "file");
        entry.setHidden(name.startsWith("."));
        return entry;
    }

    /**
     * 通过 fileKey + mtime + size 生成文件版本号，避免只依赖 mtime 导致冲突漏检。
     */
    private String resolveFileRevision(Path filePath) {
        try {
            BasicFileAttributes attributes = Files.readAttributes(filePath, BasicFileAttributes.class);
            String fileKey = attributes.fileKey() == null ? "none" : attributes.fileKey().toString();
            return fileKey + ":" + attributes.lastModifiedTime().toMillis() + ":" + attributes.size();
        } catch (IOException ex) {
            throw new RuntimeException("读取文件版本失败，请稍后重试。");
        }
    }
}
