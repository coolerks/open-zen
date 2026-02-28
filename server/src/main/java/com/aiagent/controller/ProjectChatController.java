package com.aiagent.controller;

import com.aiagent.dto.*;
import com.aiagent.entity.ChatMessage;
import com.aiagent.entity.ChatSession;
import com.aiagent.service.ChatService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

/**
 * 项目聊天接口。
 * 与普通聊天接口隔离，确保项目专用工具不会泄露到普通聊天。
 */
@RestController
@RequestMapping("/api/projects/{projectId}/chat")
@RequiredArgsConstructor
public class ProjectChatController {

    private final ChatService chatService;

    @PostMapping("/sessions")
    public ApiResult<ChatSession> createSession(@PathVariable String projectId,
                                                @RequestBody(required = false) ChatSessionCreateRequest request) {
        String title = request != null ? request.getTitle() : null;
        Long agentId = request != null ? request.getAgentId() : null;
        Boolean temporary = request != null ? request.getTemporary() : null;
        return ApiResult.ok(chatService.createProjectSession(projectId, title, agentId, temporary));
    }

    @GetMapping("/sessions")
    public ApiResult<List<ChatSession>> listSessions(@PathVariable String projectId) {
        return ApiResult.ok(chatService.listProjectSessions(projectId));
    }

    @GetMapping("/tools")
    public ApiResult<List<ChatToolDefinitionResponse>> listTools() {
        return ApiResult.ok(chatService.listProjectToolDefinitions());
    }

    @GetMapping("/sessions/{id}")
    public ApiResult<ChatSession> getSession(@PathVariable String projectId,
                                             @PathVariable Long id) {
        return ApiResult.ok(chatService.getProjectSession(projectId, id));
    }

    @PatchMapping("/sessions/{id}")
    public ApiResult<Void> updateSession(@PathVariable String projectId,
                                         @PathVariable Long id,
                                         @RequestBody ChatSessionUpdateRequest request) {
        chatService.updateProjectSession(projectId, id, request);
        return ApiResult.ok();
    }

    @PostMapping("/sessions/{id}/auto-title")
    public ApiResult<ChatSession> autoGenerateSessionTitle(@PathVariable String projectId,
                                                           @PathVariable Long id,
                                                           @RequestBody(required = false) ChatSessionAutoTitleRequest request) {
        Long modelId = request != null ? request.getModelId() : null;
        String firstQuestion = request != null ? request.getFirstQuestion() : null;
        return ApiResult.ok(chatService.autoGenerateProjectSessionTitle(projectId, id, modelId, firstQuestion));
    }

    @DeleteMapping("/sessions/{id}")
    public ApiResult<Void> deleteSession(@PathVariable String projectId,
                                         @PathVariable Long id) {
        chatService.deleteProjectSession(projectId, id);
        return ApiResult.ok();
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public ApiResult<List<ChatMessage>> getMessages(@PathVariable String projectId,
                                                    @PathVariable Long sessionId) {
        return ApiResult.ok(chatService.getProjectMessages(projectId, sessionId));
    }

    @GetMapping("/sessions/{sessionId}/context")
    public ApiResult<ChatSessionContextStatsResponse> getSessionContextStats(@PathVariable String projectId,
                                                                              @PathVariable Long sessionId,
                                                                              @RequestParam(required = false) Long modelId) {
        return ApiResult.ok(chatService.getProjectSessionContextStats(projectId, sessionId, modelId));
    }

    @DeleteMapping("/sessions/{sessionId}/messages/{messageId}")
    public ApiResult<Void> deleteMessage(@PathVariable String projectId,
                                         @PathVariable Long sessionId,
                                         @PathVariable Long messageId) {
        chatService.getProjectSession(projectId, sessionId);
        chatService.deleteMessage(sessionId, messageId);
        return ApiResult.ok();
    }

    @PostMapping("/sessions/{sessionId}/tool-approval")
    public ApiResult<ChatMessage> approveToolCall(@PathVariable String projectId,
                                                  @PathVariable Long sessionId,
                                                  @Valid @RequestBody ChatToolApprovalRequest request) {
        return ApiResult.ok(chatService.resolveProjectToolApproval(
                projectId,
                sessionId,
                request.getAssistantMessageId(),
                Boolean.TRUE.equals(request.getApproved()),
                request.getMaxToolRounds()
        ));
    }

    @PostMapping(value = "/sessions/{sessionId}/tool-approval/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamApproveToolCall(@PathVariable String projectId,
                                            @PathVariable Long sessionId,
                                            @Valid @RequestBody ChatToolApprovalRequest request) {
        return chatService.streamProjectToolApproval(
                projectId,
                sessionId,
                request.getAssistantMessageId(),
                Boolean.TRUE.equals(request.getApproved()),
                request.getMaxToolRounds()
        );
    }

    @PostMapping("/send")
    public ApiResult<ChatMessage> send(@PathVariable String projectId,
                                       @Valid @RequestBody ChatSendRequest request) {
        return ApiResult.ok(chatService.sendProjectMessage(projectId, request));
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable String projectId,
                             @Valid @RequestBody ChatSendRequest request) {
        return chatService.streamProjectMessage(projectId, request);
    }
}
