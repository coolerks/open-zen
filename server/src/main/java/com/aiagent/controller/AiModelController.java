package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.ModelDiscoveryItemResponse;
import com.aiagent.dto.ModelRequest;
import com.aiagent.dto.ModelResponse;
import com.aiagent.service.AiModelService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/models")
@RequiredArgsConstructor
public class AiModelController {

    private final AiModelService aiModelService;

    @GetMapping
    public ApiResult<List<ModelResponse>> list() {
        return ApiResult.ok(aiModelService.listAll());
    }

    @GetMapping("/enabled")
    public ApiResult<List<ModelResponse>> listEnabled() {
        return ApiResult.ok(aiModelService.listEnabled());
    }

    @GetMapping("/discover")
    public ApiResult<List<ModelDiscoveryItemResponse>> discover(@RequestParam Long providerId) {
        return ApiResult.ok(aiModelService.discoverModels(providerId));
    }

    @GetMapping("/{id}")
    public ApiResult<ModelResponse> get(@PathVariable Long id) {
        return ApiResult.ok(aiModelService.getById(id));
    }

    @PostMapping
    public ApiResult<ModelResponse> create(@Valid @RequestBody ModelRequest request) {
        return ApiResult.ok(aiModelService.create(request));
    }

    @PutMapping("/{id}")
    public ApiResult<ModelResponse> update(@PathVariable Long id,
                                            @Valid @RequestBody ModelRequest request) {
        return ApiResult.ok(aiModelService.update(id, request));
    }

    @PatchMapping("/{id}/toggle")
    public ApiResult<Void> toggle(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        aiModelService.toggleEnabled(id, body.getOrDefault("enabled", true));
        return ApiResult.ok();
    }

    @PatchMapping("/{id}/default")
    public ApiResult<Void> setDefault(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        aiModelService.setDefault(id, body.getOrDefault("isDefault", true));
        return ApiResult.ok();
    }
}
