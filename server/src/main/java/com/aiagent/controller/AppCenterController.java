package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.AppCenterItemCreateRequest;
import com.aiagent.dto.AppCenterItemResponse;
import com.aiagent.dto.AppCenterItemUpdateRequest;
import com.aiagent.service.AppCenterService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/apps")
@RequiredArgsConstructor
public class AppCenterController {

    private final AppCenterService appCenterService;

    @GetMapping
    public ApiResult<List<AppCenterItemResponse>> listAll() {
        return ApiResult.ok(appCenterService.listAll());
    }

    @GetMapping("/{id}")
    public ApiResult<AppCenterItemResponse> getById(@PathVariable Long id) {
        return ApiResult.ok(appCenterService.getById(id));
    }

    @PostMapping
    public ApiResult<AppCenterItemResponse> create(@Valid @RequestBody AppCenterItemCreateRequest request) {
        return ApiResult.ok(appCenterService.create(request));
    }

    @PutMapping("/{id}")
    public ApiResult<AppCenterItemResponse> update(@PathVariable Long id,
                                                    @Valid @RequestBody AppCenterItemUpdateRequest request) {
        return ApiResult.ok(appCenterService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public ApiResult<Void> delete(@PathVariable Long id) {
        appCenterService.delete(id);
        return ApiResult.ok();
    }
}
