package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.DirectoryBrowseResponse;
import com.aiagent.service.DirectoryBrowseService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/filesystem")
@RequiredArgsConstructor
public class DirectoryBrowseController {

    private final DirectoryBrowseService directoryBrowseService;

    @GetMapping("/directories")
    public ApiResult<DirectoryBrowseResponse> listDirectories(@RequestParam(required = false) String path) {
        return ApiResult.ok(directoryBrowseService.browseDirectories(path));
    }
}
