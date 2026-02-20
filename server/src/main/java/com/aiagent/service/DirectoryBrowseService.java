package com.aiagent.service;

import com.aiagent.dto.DirectoryBrowseResponse;
import com.aiagent.dto.DirectoryEntryResponse;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Comparator;
import java.util.List;

@Service
public class DirectoryBrowseService {

    private static final String PATH_NOT_FOUND_MESSAGE = "请输入已存在的路径。";
    private static final String PATH_NOT_DIRECTORY_MESSAGE = "该路径不是目录，请输入文件夹路径。";
    private static final String PATH_NOT_ABSOLUTE_MESSAGE = "请输入绝对路径。";
    private static final String PATH_INVALID_MESSAGE = "路径格式不正确，请重新输入。";
    private static final String PATH_READ_FAILED_MESSAGE = "读取目录失败，请检查权限后重试。";

    public DirectoryBrowseResponse browseDirectories(String rawPath) {
        Path normalizedPath = normalizeDirectoryPath(rawPath);
        List<DirectoryEntryResponse> directories = loadCurrentLevelDirectories(normalizedPath);
        String parentPath = normalizedPath.getParent() == null ? null : normalizedPath.getParent().toAbsolutePath().normalize().toString();
        return new DirectoryBrowseResponse(
                normalizedPath.toString(),
                parentPath,
                directories
        );
    }

    private Path normalizeDirectoryPath(String rawPath) {
        String sourcePath = rawPath == null || rawPath.trim().isEmpty() ? "~/" : rawPath.trim();
        String expandedPath = expandUserHome(sourcePath);
        Path path;
        try {
            path = Paths.get(expandedPath).toAbsolutePath().normalize();
        } catch (InvalidPathException ex) {
            throw new RuntimeException(PATH_INVALID_MESSAGE);
        }

        if (!path.isAbsolute()) {
            throw new RuntimeException(PATH_NOT_ABSOLUTE_MESSAGE);
        }
        if (!Files.exists(path)) {
            throw new RuntimeException(PATH_NOT_FOUND_MESSAGE);
        }
        if (!Files.isDirectory(path)) {
            throw new RuntimeException(PATH_NOT_DIRECTORY_MESSAGE);
        }
        return path;
    }

    private String expandUserHome(String rawPath) {
        if (rawPath == null || rawPath.isBlank()) {
            return System.getProperty("user.home");
        }

        String homeDir = System.getProperty("user.home");
        if ("~".equals(rawPath)) {
            return homeDir;
        }
        if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
            return homeDir + rawPath.substring(1);
        }
        return rawPath;
    }

    private List<DirectoryEntryResponse> loadCurrentLevelDirectories(Path directoryPath) {
        try (var stream = Files.list(directoryPath)) {
            return stream
                    .filter(Files::isDirectory)
                    .sorted(Comparator.comparing(path -> path.getFileName().toString(), String.CASE_INSENSITIVE_ORDER))
                    .map(path -> new DirectoryEntryResponse(
                            path.getFileName().toString(),
                            path.toAbsolutePath().normalize().toString(),
                            path.getFileName().toString().startsWith(".")
                    ))
                    .toList();
        } catch (IOException ex) {
            throw new RuntimeException(PATH_READ_FAILED_MESSAGE);
        }
    }
}
