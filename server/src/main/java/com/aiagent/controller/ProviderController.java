package com.aiagent.controller;

import com.aiagent.dto.ApiResult;
import com.aiagent.dto.ProviderRequest;
import com.aiagent.dto.ProviderResponse;
import com.aiagent.service.ProviderService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/providers")
@RequiredArgsConstructor
public class ProviderController {

    private final ProviderService providerService;

    @GetMapping
    public ApiResult<List<ProviderResponse>> list() {
        return ApiResult.ok(providerService.listAll());
    }

    @GetMapping("/{id}")
    public ApiResult<ProviderResponse> get(@PathVariable Long id) {
        return ApiResult.ok(providerService.getById(id));
    }

    @PostMapping
    public ApiResult<ProviderResponse> create(@Valid @RequestBody ProviderRequest request) {
        return ApiResult.ok(providerService.create(request));
    }

    @PutMapping("/{id}")
    public ApiResult<ProviderResponse> update(@PathVariable Long id,
                                               @Valid @RequestBody ProviderRequest request) {
        return ApiResult.ok(providerService.update(id, request));
    }

    @PatchMapping("/{id}/toggle")
    public ApiResult<Void> toggle(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        providerService.toggleEnabled(id, body.getOrDefault("enabled", true));
        return ApiResult.ok();
    }

    @DeleteMapping("/{id}")
    public ApiResult<Void> delete(@PathVariable Long id) {
        providerService.delete(id);
        return ApiResult.ok();
    }
}
