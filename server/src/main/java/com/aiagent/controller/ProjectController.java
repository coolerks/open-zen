package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.ProjectCreateRequest;
import com.aiagent.dto.ProjectDirectoryUpdateRequest;
import com.aiagent.dto.ProjectItemResponse;
import com.aiagent.service.ProjectService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
@RequiredArgsConstructor
public class ProjectController {

    private final ProjectService projectService;

    @GetMapping
    public ApiResult<List<ProjectItemResponse>> listAll() {
        return ApiResult.ok(projectService.listAll());
    }

    @GetMapping("/{id}")
    public ApiResult<ProjectItemResponse> getById(@PathVariable String id) {
        return ApiResult.ok(projectService.getById(id));
    }

    @PostMapping
    public ApiResult<ProjectItemResponse> create(@Valid @RequestBody ProjectCreateRequest request) {
        return ApiResult.ok(projectService.create(request));
    }

    @PatchMapping("/{id}/directory")
    public ApiResult<ProjectItemResponse> updateDirectory(@PathVariable String id,
                                                          @Valid @RequestBody ProjectDirectoryUpdateRequest request) {
        return ApiResult.ok(projectService.updateDirectory(id, request));
    }

    @DeleteMapping("/{id}")
    public ApiResult<Void> delete(@PathVariable String id) {
        projectService.delete(id);
        return ApiResult.ok();
    }
}
