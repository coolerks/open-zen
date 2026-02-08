package com.aiagent.controller;

import com.aiagent.dto.AgentRequest;
import com.aiagent.dto.AgentResponse;
import com.aiagent.dto.ApiResult;
import com.aiagent.service.CustomAgentService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/agents")
@RequiredArgsConstructor
public class CustomAgentController {

    private final CustomAgentService customAgentService;

    @GetMapping
    public ApiResult<List<AgentResponse>> listAll() {
        return ApiResult.ok(customAgentService.listAll());
    }

    @GetMapping("/enabled")
    public ApiResult<List<AgentResponse>> listEnabled() {
        return ApiResult.ok(customAgentService.listEnabled());
    }

    @GetMapping("/{id}")
    public ApiResult<AgentResponse> getById(@PathVariable Long id) {
        return ApiResult.ok(customAgentService.getById(id));
    }

    @PostMapping
    public ApiResult<AgentResponse> create(@Valid @RequestBody AgentRequest request) {
        return ApiResult.ok(customAgentService.create(request));
    }

    @PutMapping("/{id}")
    public ApiResult<AgentResponse> update(@PathVariable Long id,
                                           @Valid @RequestBody AgentRequest request) {
        return ApiResult.ok(customAgentService.update(id, request));
    }

    @PatchMapping("/{id}/toggle")
    public ApiResult<Void> toggle(@PathVariable Long id,
                                  @RequestBody Map<String, Boolean> body) {
        customAgentService.toggleEnabled(id, body.getOrDefault("enabled", true));
        return ApiResult.ok();
    }

    @DeleteMapping("/{id}")
    public ApiResult<Void> delete(@PathVariable Long id) {
        customAgentService.delete(id);
        return ApiResult.ok();
    }
}
