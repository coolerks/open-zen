package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.ProjectFsCreateEntryRequest;
import com.aiagent.dto.ProjectFsDirectoryResponse;
import com.aiagent.dto.ProjectFsEntryResponse;
import com.aiagent.dto.ProjectFsFileResponse;
import com.aiagent.dto.ProjectFsFileMetaResponse;
import com.aiagent.dto.ProjectFsMoveEntryRequest;
import com.aiagent.dto.ProjectFsWatchInterestsRequest;
import com.aiagent.dto.ProjectFsWriteFileRequest;
import com.aiagent.service.ProjectFilesystemService;
import com.aiagent.service.ProjectFilesystemWatchService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/projects/{projectId}/filesystem")
@RequiredArgsConstructor
public class ProjectFilesystemController {

    private final ProjectFilesystemService projectFilesystemService;
    private final ProjectFilesystemWatchService projectFilesystemWatchService;

    @GetMapping("/entries")
    public ApiResult<ProjectFsDirectoryResponse> listEntries(@PathVariable String projectId,
                                                             @RequestParam(required = false) String path) {
        return ApiResult.ok(projectFilesystemService.listEntries(projectId, path));
    }

    @GetMapping("/file/meta")
    public ApiResult<ProjectFsFileMetaResponse> readFileMeta(@PathVariable String projectId,
                                                             @RequestParam String path) {
        return ApiResult.ok(projectFilesystemService.readFileMeta(projectId, path));
    }

    @GetMapping("/file")
    public ApiResult<ProjectFsFileResponse> readFile(@PathVariable String projectId,
                                                     @RequestParam String path,
                                                     @RequestParam(defaultValue = "false") boolean allowLargeFile) {
        return ApiResult.ok(projectFilesystemService.readFile(projectId, path, allowLargeFile));
    }

    @PutMapping("/file")
    public ApiResult<ProjectFsFileResponse> writeFile(@PathVariable String projectId,
                                                      @Valid @RequestBody ProjectFsWriteFileRequest request) {
        return ApiResult.ok(projectFilesystemService.writeFile(projectId, request));
    }

    @PostMapping("/entries")
    public ApiResult<ProjectFsEntryResponse> createEntry(@PathVariable String projectId,
                                                         @Valid @RequestBody ProjectFsCreateEntryRequest request) {
        return ApiResult.ok(projectFilesystemService.createEntry(projectId, request));
    }

    @DeleteMapping("/entries")
    public ApiResult<Void> deleteEntry(@PathVariable String projectId,
                                       @RequestParam String path,
                                       @RequestParam(defaultValue = "false") boolean recursive) {
        projectFilesystemService.deleteEntry(projectId, path, recursive);
        return ApiResult.ok();
    }

    @PostMapping("/entries/move")
    public ApiResult<ProjectFsEntryResponse> moveEntry(@PathVariable String projectId,
                                                       @Valid @RequestBody ProjectFsMoveEntryRequest request) {
        return ApiResult.ok(projectFilesystemService.moveEntry(projectId, request));
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String projectId,
                             @RequestParam String clientId) {
        return projectFilesystemWatchService.subscribe(
                projectId,
                projectFilesystemService.resolveProjectRootPathForWatch(projectId),
                clientId
        );
    }

    @PostMapping("/stream/interests")
    public ApiResult<Void> updateInterests(@PathVariable String projectId,
                                           @Valid @RequestBody ProjectFsWatchInterestsRequest request) {
        projectFilesystemWatchService.updateInterests(
                projectId,
                projectFilesystemService.resolveProjectRootPathForWatch(projectId),
                request.getClientId(),
                request.getOpenFiles(),
                request.getExpandedDirs()
        );
        return ApiResult.ok();
    }
}
