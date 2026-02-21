package com.aiagent.service;

import com.aiagent.dto.ProjectCreateRequest;
import com.aiagent.dto.ProjectDirectoryUpdateRequest;
import com.aiagent.dto.ProjectItemResponse;
import com.aiagent.entity.ProjectItem;
import com.aiagent.mapper.ProjectItemMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProjectService {

    private static final String PATH_NOT_FOUND_MESSAGE = "请输入已存在的真实目录路径。";
    private static final String PATH_NOT_DIRECTORY_MESSAGE = "该路径不是目录，请输入文件夹路径。";
    private static final String PATH_INVALID_MESSAGE = "路径格式不正确，请重新输入。";

    private final ProjectItemMapper projectItemMapper;

    public List<ProjectItemResponse> listAll() {
        return projectItemMapper.selectList(
                        new LambdaQueryWrapper<ProjectItem>()
                                .orderByDesc(ProjectItem::getUpdatedAt)
                                .orderByDesc(ProjectItem::getCreatedAt)
                ).stream()
                .map(this::toResponse)
                .toList();
    }

    public ProjectItemResponse getById(String id) {
        return toResponse(getEntityById(id));
    }

    public ProjectItemResponse create(ProjectCreateRequest request) {
        Path normalizedPath = normalizeDirectoryPath(request.getRealDirPath());
        ProjectItem item = new ProjectItem();
        item.setId(UUID.randomUUID().toString());
        item.setName(normalizeProjectName(request.getName()));
        item.setDescription(normalizeNullableText(request.getDescription()));
        item.setRootDirName(resolveRootDirName(request.getRootDirName(), normalizedPath));
        item.setRealDirPath(normalizedPath.toString());
        projectItemMapper.insert(item);
        return toResponse(item);
    }

    public ProjectItemResponse updateDirectory(String projectId, ProjectDirectoryUpdateRequest request) {
        ProjectItem item = getEntityById(projectId);
        Path normalizedPath = normalizeDirectoryPath(request.getRealDirPath());
        item.setRootDirName(resolveRootDirName(request.getRootDirName(), normalizedPath));
        item.setRealDirPath(normalizedPath.toString());
        projectItemMapper.updateById(item);
        return toResponse(item);
    }

    public void delete(String projectId) {
        ProjectItem item = getEntityById(projectId);
        projectItemMapper.deleteById(item.getId());
    }

    private ProjectItem getEntityById(String id) {
        ProjectItem item = projectItemMapper.selectById(id);
        if (item == null) {
            throw new RuntimeException("项目不存在: " + id);
        }
        return item;
    }

    private Path normalizeDirectoryPath(String rawPath) {
        String sourcePath = normalizeNullableText(rawPath);
        if (sourcePath == null) {
            throw new RuntimeException("真实目录不能为空");
        }
        String expandedPath = expandUserHome(sourcePath);
        Path path;
        try {
            path = Paths.get(expandedPath).toAbsolutePath().normalize();
        } catch (InvalidPathException ex) {
            throw new RuntimeException(PATH_INVALID_MESSAGE);
        }

        if (!java.nio.file.Files.exists(path)) {
            throw new RuntimeException(PATH_NOT_FOUND_MESSAGE);
        }
        if (!java.nio.file.Files.isDirectory(path)) {
            throw new RuntimeException(PATH_NOT_DIRECTORY_MESSAGE);
        }
        return path;
    }

    private String resolveRootDirName(String rootDirName, Path normalizedPath) {
        String manualValue = normalizeNullableText(rootDirName);
        if (manualValue != null) {
            return manualValue;
        }
        Path fileName = normalizedPath.getFileName();
        if (fileName == null) {
            return normalizedPath.toString();
        }
        return fileName.toString();
    }

    private String normalizeProjectName(String rawName) {
        String normalized = normalizeNullableText(rawName);
        if (normalized == null) {
            throw new RuntimeException("项目名称不能为空");
        }
        return normalized;
    }

    private String normalizeNullableText(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private String expandUserHome(String rawPath) {
        String homeDir = System.getProperty("user.home");
        if ("~".equals(rawPath)) {
            return homeDir;
        }
        if (rawPath.startsWith("~/") || rawPath.startsWith("~\\")) {
            return homeDir + rawPath.substring(1);
        }
        return rawPath;
    }

    private ProjectItemResponse toResponse(ProjectItem item) {
        ProjectItemResponse response = new ProjectItemResponse();
        response.setId(item.getId());
        response.setName(item.getName());
        response.setDescription(item.getDescription());
        response.setRootDirName(item.getRootDirName());
        response.setRealDirPath(item.getRealDirPath());
        response.setCreatedAt(item.getCreatedAt());
        response.setUpdatedAt(item.getUpdatedAt());
        return response;
    }
}
