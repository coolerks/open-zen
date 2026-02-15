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

@RestController
@RequestMapping("/api/chat")
@RequiredArgsConstructor
public class ChatController {

    private final ChatService chatService;

    @PostMapping("/sessions")
    public ApiResult<ChatSession> createSession(@RequestBody(required = false) ChatSessionCreateRequest request) {
        String title = request != null ? request.getTitle() : null;
        Long agentId = request != null ? request.getAgentId() : null;
        return ApiResult.ok(chatService.createSession(title, agentId));
    }

    @GetMapping("/sessions")
    public ApiResult<List<ChatSession>> listSessions() {
        return ApiResult.ok(chatService.listSessions());
    }

    @GetMapping("/sessions/search")
    public ApiResult<List<ChatSessionSearchResultResponse>> searchSessions(@RequestParam String keyword,
                                                                           @RequestParam(required = false) Integer limit) {
        return ApiResult.ok(chatService.searchSessions(keyword, limit));
    }

    @GetMapping("/sessions/{id}")
    public ApiResult<ChatSession> getSession(@PathVariable Long id) {
        return ApiResult.ok(chatService.getSession(id));
    }

    @DeleteMapping("/sessions/{id}")
    public ApiResult<Void> deleteSession(@PathVariable Long id) {
        chatService.deleteSession(id);
        return ApiResult.ok();
    }

    @PostMapping("/sessions/{id}/copy")
    public ApiResult<ChatSession> copySession(@PathVariable Long id,
                                              @RequestBody(required = false) ChatSessionCopyRequest request) {
        String title = request != null ? request.getTitle() : null;
        return ApiResult.ok(chatService.copySession(id, title));
    }

    @PostMapping("/sessions/{id}/branch")
    public ApiResult<ChatSession> branchSession(@PathVariable Long id,
                                                @Valid @RequestBody ChatSessionBranchRequest request) {
        return ApiResult.ok(chatService.branchSession(id, request.getMessageId(), request.getTitle()));
    }

    @PatchMapping("/sessions/{id}")
    public ApiResult<Void> updateSession(@PathVariable Long id,
                                         @RequestBody ChatSessionUpdateRequest request) {
        chatService.updateSession(id, request);
        return ApiResult.ok();
    }

    @GetMapping("/sessions/{sessionId}/messages")
    public ApiResult<List<ChatMessage>> getMessages(@PathVariable Long sessionId) {
        return ApiResult.ok(chatService.getMessages(sessionId));
    }

    @GetMapping("/sessions/{sessionId}/context")
    public ApiResult<ChatSessionContextStatsResponse> getSessionContextStats(@PathVariable Long sessionId,
                                                                              @RequestParam(required = false) Long modelId) {
        return ApiResult.ok(chatService.getSessionContextStats(sessionId, modelId));
    }

    @DeleteMapping("/sessions/{sessionId}/messages/{messageId}")
    public ApiResult<Void> deleteMessage(@PathVariable Long sessionId,
                                         @PathVariable Long messageId) {
        chatService.deleteMessage(sessionId, messageId);
        return ApiResult.ok();
    }

    @PostMapping("/send")
    public ApiResult<ChatMessage> send(@Valid @RequestBody ChatSendRequest request) {
        return ApiResult.ok(chatService.sendMessage(request));
    }

    @PostMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@Valid @RequestBody ChatSendRequest request) {
        return chatService.streamMessage(request);
    }
}
