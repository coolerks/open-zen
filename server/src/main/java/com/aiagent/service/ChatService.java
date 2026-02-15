package com.aiagent.service;

import com.aiagent.dto.ChatSendRequest;
import com.aiagent.dto.ChatSessionSearchResultResponse;
import com.aiagent.dto.ChatSessionContextStatsResponse;
import com.aiagent.dto.ChatSessionUpdateRequest;
import com.aiagent.dto.openrouter.ChatCompletionRequest;
import com.aiagent.dto.openrouter.ChatCompletionResponse;
import com.aiagent.dto.openrouter.ChatCompletionStreamChunk;
import com.aiagent.entity.AiModel;
import com.aiagent.entity.ChatMessage;
import com.aiagent.entity.ChatSession;
import com.aiagent.entity.CustomAgent;
import com.aiagent.entity.Provider;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolRegistry;
import com.aiagent.util.EncryptionUtil;
import com.aiagent.util.TokenEstimator;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

@Service
@RequiredArgsConstructor
@Slf4j
public class ChatService {

    private static final int MAX_TOOL_ROUNDS = 5;
    private static final int TITLE_MAX_LENGTH = 20;
    private static final String DEFAULT_ASSISTANT_NAME = "AI";
    private static final long DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000L;
    private static final int DEFAULT_RESERVED_OUTPUT_TOKENS = 4096;
    private static final int MIN_PROMPT_BUDGET_TOKENS = 1024;
    private static final int ESTIMATED_IMAGE_TOKENS = 600;

    private final ChatSessionMapper sessionMapper;
    private final ChatMessageMapper messageMapper;
    private final AiModelService aiModelService;
    private final ProviderService providerService;
    private final CustomAgentService customAgentService;
    private final OpenRouterClient openRouterClient;
    private final ToolRegistry toolRegistry;
    private final EncryptionUtil encryptionUtil;
    private final ObjectMapper objectMapper;

    public ChatSession createSession(String title) {
        return createSession(title, null);
    }

    public ChatSession createSession(String title, Long agentId) {
        return createSessionInternal(title, agentId, null, null, null);
    }

    public List<ChatSession> listSessions() {
        return sessionMapper.selectList(
                new LambdaQueryWrapper<ChatSession>().orderByDesc(ChatSession::getUpdatedAt));
    }

    /**
     * 搜索会话标题与聊天内容，返回去重后的会话结果。
     */
    public List<ChatSessionSearchResultResponse> searchSessions(String keyword, Integer limit) {
        String normalizedKeyword = keyword == null ? "" : keyword.trim();
        if (normalizedKeyword.isEmpty()) {
            return List.of();
        }

        int resolvedLimit = limit == null ? 80 : Math.max(1, Math.min(200, limit));
        int messageScanLimit = Math.max(60, resolvedLimit * 20);

        Map<Long, ChatSessionSearchResultResponse> resultMap = new LinkedHashMap<>();

        List<ChatSession> titleMatchedSessions = sessionMapper.selectList(
                new LambdaQueryWrapper<ChatSession>()
                        .like(ChatSession::getTitle, normalizedKeyword)
                        .orderByDesc(ChatSession::getUpdatedAt)
                        .orderByDesc(ChatSession::getId)
                        .last("LIMIT " + resolvedLimit)
        );
        for (ChatSession session : titleMatchedSessions) {
            ChatSessionSearchResultResponse item = new ChatSessionSearchResultResponse();
            item.setSessionId(session.getId());
            item.setTitle(session.getTitle());
            item.setSnippet(null);
            item.setMatchedMessageId(null);
            item.setMatchedBy("title");
            item.setMatchedAt(session.getUpdatedAt() != null ? session.getUpdatedAt() : session.getCreatedAt());
            resultMap.put(session.getId(), item);
        }

        List<ChatMessage> matchedMessages = messageMapper.selectList(
                new LambdaQueryWrapper<ChatMessage>()
                        .in(ChatMessage::getRole, List.of("user", "assistant", "tool"))
                        .isNotNull(ChatMessage::getContent)
                        .like(ChatMessage::getContent, normalizedKeyword)
                        .orderByDesc(ChatMessage::getCreatedAt)
                        .orderByDesc(ChatMessage::getId)
                        .last("LIMIT " + messageScanLimit)
        );

        if (matchedMessages.isEmpty()) {
            return resultMap.values().stream()
                    .sorted(Comparator.comparing(
                            (ChatSessionSearchResultResponse item) -> item.getMatchedAt() != null ? item.getMatchedAt() : LocalDateTime.MIN
                    ).reversed())
                    .limit(resolvedLimit)
                    .toList();
        }

        Set<Long> messageSessionIds = matchedMessages.stream()
                .map(ChatMessage::getSessionId)
                .filter(Objects::nonNull)
                .collect(java.util.stream.Collectors.toSet());
        if (messageSessionIds.isEmpty()) {
            return resultMap.values().stream()
                    .sorted(Comparator.comparing(
                            (ChatSessionSearchResultResponse item) -> item.getMatchedAt() != null ? item.getMatchedAt() : LocalDateTime.MIN
                    ).reversed())
                    .limit(resolvedLimit)
                    .toList();
        }

        Map<Long, ChatSession> sessionMap = sessionMapper.selectBatchIds(messageSessionIds).stream()
                .collect(java.util.stream.Collectors.toMap(ChatSession::getId, session -> session));

        for (ChatMessage message : matchedMessages) {
            Long sessionId = message.getSessionId();
            if (sessionId == null) {
                continue;
            }
            ChatSession session = sessionMap.get(sessionId);
            if (session == null) {
                continue;
            }

            String snippet = buildSearchSnippet(message.getContent(), normalizedKeyword);
            ChatSessionSearchResultResponse existing = resultMap.get(sessionId);
            if (existing == null) {
                ChatSessionSearchResultResponse item = new ChatSessionSearchResultResponse();
                item.setSessionId(sessionId);
                item.setTitle(session.getTitle());
                item.setSnippet(snippet);
                item.setMatchedMessageId(message.getId());
                item.setMatchedBy("message");
                item.setMatchedAt(message.getCreatedAt() != null ? message.getCreatedAt() : session.getUpdatedAt());
                resultMap.put(sessionId, item);
                continue;
            }

            // 标题和正文同时命中时，合并结果并优先展示正文摘要。
            if (existing.getSnippet() == null || existing.getSnippet().isBlank()) {
                existing.setSnippet(snippet);
            }
            if ("title".equals(existing.getMatchedBy())) {
                existing.setMatchedBy("both");
            }
            if (existing.getMatchedMessageId() == null) {
                existing.setMatchedMessageId(message.getId());
            }
            LocalDateTime messageMatchedAt = message.getCreatedAt();
            if (messageMatchedAt != null && (existing.getMatchedAt() == null || messageMatchedAt.isAfter(existing.getMatchedAt()))) {
                existing.setMatchedAt(messageMatchedAt);
                existing.setMatchedMessageId(message.getId());
            }
        }

        return resultMap.values().stream()
                .sorted(Comparator.comparing(
                        (ChatSessionSearchResultResponse item) -> item.getMatchedAt() != null ? item.getMatchedAt() : LocalDateTime.MIN
                ).reversed())
                .limit(resolvedLimit)
                .toList();
    }

    public ChatSession getSession(Long id) {
        ChatSession session = sessionMapper.selectById(id);
        if (session == null) {
            throw new RuntimeException("会话不存在: " + id);
        }

        // 兼容历史数据：如果会话未记录模型，回填最后一条消息使用的模型。
        if (session.getModelId() == null) {
            ChatMessage lastModelMessage = messageMapper.selectOne(
                    new LambdaQueryWrapper<ChatMessage>()
                            .eq(ChatMessage::getSessionId, id)
                            .isNotNull(ChatMessage::getModelId)
                            .orderByDesc(ChatMessage::getId)
                            .last("LIMIT 1")
            );
            if (lastModelMessage != null) {
                session.setModelId(lastModelMessage.getModelId());
                session.setUpdatedAt(LocalDateTime.now());
                sessionMapper.updateById(session);
            }
        }
        return session;
    }

    public void deleteSession(Long id) {
        messageMapper.delete(new LambdaQueryWrapper<ChatMessage>().eq(ChatMessage::getSessionId, id));
        sessionMapper.deleteById(id);
    }

    public ChatSession copySession(Long sourceSessionId, String title) {
        ChatSession sourceSession = getSession(sourceSessionId);
        String newTitle = normalizeTitle(title, sourceSession.getTitle() + "（副本）");

        ChatSession copiedSession = createSessionInternal(
                newTitle,
                sourceSession.getAgentId(),
                sourceSession.getModelId(),
                sourceSession.getId(),
                null
        );
        copyMessages(sourceSession.getId(), copiedSession.getId(), null);
        return getSession(copiedSession.getId());
    }

    public ChatSession branchSession(Long sourceSessionId, Long messageId, String title) {
        ChatSession sourceSession = getSession(sourceSessionId);
        ChatMessage branchMessage = messageMapper.selectOne(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getSessionId, sourceSessionId)
                        .eq(ChatMessage::getId, messageId)
                        .last("LIMIT 1")
        );
        if (branchMessage == null) {
            throw new RuntimeException("分支消息不存在或不属于该会话");
        }

        String newTitle = normalizeTitle(title, sourceSession.getTitle() + "（分支）");
        Long branchModelId = branchMessage.getModelId() != null
                ? branchMessage.getModelId()
                : sourceSession.getModelId();

        ChatSession branchSession = createSessionInternal(
                newTitle,
                sourceSession.getAgentId(),
                branchModelId,
                sourceSession.getId(),
                messageId
        );
        copyMessages(sourceSession.getId(), branchSession.getId(), messageId);
        return getSession(branchSession.getId());
    }

    public void updateSession(Long id, ChatSessionUpdateRequest request) {
        ChatSession session = getSession(id);

        if (request.getTitle() != null) {
            session.setTitle(normalizeTitle(request.getTitle(), "新会话"));
        }
        if (request.getModelId() != null) {
            aiModelService.getEntityById(request.getModelId());
            session.setModelId(request.getModelId());
        }
        if (request.getAgentId() != null) {
            if (request.getAgentId() <= 0) {
                session.setAgentId(customAgentService.getDefaultAgentEntity().getId());
            } else {
                CustomAgent agent = customAgentService.getEntityById(request.getAgentId());
                if (!Boolean.TRUE.equals(agent.getEnabled())) {
                    throw new RuntimeException("智能体未启用: " + agent.getName());
                }
                session.setAgentId(agent.getId());
            }
        }

        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(session);
    }

    public void updateSessionTitle(Long id, String title) {
        ChatSessionUpdateRequest request = new ChatSessionUpdateRequest();
        request.setTitle(title);
        updateSession(id, request);
    }

    public List<ChatMessage> getMessages(Long sessionId) {
        getSession(sessionId);
        return messageMapper.selectList(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getSessionId, sessionId)
                        .orderByAsc(ChatMessage::getCreatedAt)
                        .orderByAsc(ChatMessage::getId)
        );
    }

    /**
     * 获取会话上下文使用与会话成本统计信息。
     */
    public ChatSessionContextStatsResponse getSessionContextStats(Long sessionId, Long modelId) {
        ChatSession session = getSession(sessionId);
        Long resolvedModelId = modelId != null
                ? modelId
                : (session.getModelId() != null ? session.getModelId() : aiModelService.resolvePreferredEnabledModelId());

        AiModel currentModel = resolvedModelId != null ? aiModelService.getEntityById(resolvedModelId) : null;
        List<ChatMessage> messages = getMessages(sessionId);

        int contextUsedTokens = estimateContextTokens(messages);
        long contextWindowTokens = resolveContextWindowTokens(currentModel);
        double contextUsageRatio = contextWindowTokens > 0
                ? Math.min(1.0d, contextUsedTokens / (double) contextWindowTokens)
                : 0d;

        long sessionPromptTokens = 0L;
        long sessionCompletionTokens = 0L;
        long sessionCacheReadTokens = 0L;
        long sessionCacheWriteTokens = 0L;
        BigDecimal sessionCostUsd = BigDecimal.ZERO;

        Map<Long, AiModel> modelCache = new HashMap<>();
        if (currentModel != null) {
            modelCache.put(currentModel.getId(), currentModel);
        }

        for (ChatMessage message : messages) {
            if (!"assistant".equals(message.getRole())) {
                continue;
            }
            int promptTokens = nonNullInt(message.getPromptTokens());
            int completionTokens = nonNullInt(message.getCompletionTokens());
            int cacheReadTokens = nonNullInt(message.getCacheReadTokens());
            int cacheWriteTokens = nonNullInt(message.getCacheWriteTokens());

            sessionPromptTokens += promptTokens;
            sessionCompletionTokens += completionTokens;
            sessionCacheReadTokens += cacheReadTokens;
            sessionCacheWriteTokens += cacheWriteTokens;

            BigDecimal cost = message.getCostUsd();
            if (cost == null) {
                AiModel messageModel = null;
                if (message.getModelId() != null) {
                    messageModel = modelCache.computeIfAbsent(message.getModelId(), id -> {
                        try {
                            return aiModelService.getEntityById(id);
                        } catch (RuntimeException ignored) {
                            return null;
                        }
                    });
                }
                cost = estimateUsageCost(
                        promptTokens,
                        completionTokens,
                        cacheReadTokens,
                        cacheWriteTokens,
                        messageModel
                );
            }
            sessionCostUsd = sessionCostUsd.add(cost);
        }

        ChatSessionContextStatsResponse response = new ChatSessionContextStatsResponse();
        response.setSessionId(sessionId);
        response.setModelId(currentModel != null ? currentModel.getId() : null);
        response.setModelName(currentModel != null ? currentModel.getDisplayName() : null);
        response.setContextUsedTokens(contextUsedTokens);
        response.setContextWindowTokens(contextWindowTokens);
        response.setContextUsageRatio(contextUsageRatio);
        response.setInputPrice(currentModel != null ? currentModel.getInputPrice() : null);
        response.setOutputPrice(currentModel != null ? currentModel.getOutputPrice() : null);
        response.setCacheReadPrice(currentModel != null ? currentModel.getCacheReadPrice() : null);
        response.setCacheWritePrice(currentModel != null ? currentModel.getCacheWritePrice() : null);
        response.setSessionPromptTokens(sessionPromptTokens);
        response.setSessionCompletionTokens(sessionCompletionTokens);
        response.setSessionCacheReadTokens(sessionCacheReadTokens);
        response.setSessionCacheWriteTokens(sessionCacheWriteTokens);
        response.setSessionCostUsd(sessionCostUsd.setScale(8, RoundingMode.HALF_UP));
        return response;
    }

    public void deleteMessage(Long sessionId, Long messageId) {
        ChatMessage message = messageMapper.selectOne(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getId, messageId)
                        .eq(ChatMessage::getSessionId, sessionId)
                        .last("LIMIT 1")
        );
        if (message == null) {
            throw new RuntimeException("消息不存在或不属于该会话");
        }

        messageMapper.deleteById(messageId);

        ChatSession session = getSession(sessionId);
        ChatMessage lastModelMessage = messageMapper.selectOne(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getSessionId, sessionId)
                        .isNotNull(ChatMessage::getModelId)
                        .orderByDesc(ChatMessage::getId)
                        .last("LIMIT 1")
        );
        session.setModelId(lastModelMessage != null ? lastModelMessage.getModelId() : null);
        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(session);
    }

    /**
     * 非流式发送，保留工具调用闭环能力。
     */
    public ChatMessage sendMessage(ChatSendRequest request) {
        SendContext context = prepareSendContext(request, true);
        List<ChatMessage> history = context.history();

        ChatCompletionResponse lastResponse = null;
        for (int round = 0; round < MAX_TOOL_ROUNDS; round++) {
            ChatCompletionRequest completionRequest = buildRequest(
                    context.model().getModelKey(),
                    history,
                    context.defaultParams(),
                    context.tools(),
                    context.systemPrompt()
            );
            completionRequest.setStream(false);

            long requestStartAt = System.currentTimeMillis();
            lastResponse = openRouterClient.chatCompletion(
                    context.provider().getBaseUrl(),
                    context.apiKey(),
                    completionRequest
            );
            long requestDurationMs = Math.max(0, System.currentTimeMillis() - requestStartAt);

            if (lastResponse.getChoices() == null || lastResponse.getChoices().isEmpty()) {
                throw new RuntimeException("OpenRouter 返回空响应");
            }

            ChatCompletionResponse.Choice choice = lastResponse.getChoices().get(0);
            ChatCompletionResponse.Message responseMessage = choice.getMessage();
            String reasoningText = extractReasoning(responseMessage);
            boolean hasToolCalls = responseMessage != null
                    && responseMessage.getToolCalls() != null
                    && !responseMessage.getToolCalls().isEmpty();

            if (hasToolCalls && Boolean.TRUE.equals(context.model().getSupportsTools())) {
                ChatMessage assistantToolMessage = new ChatMessage();
                assistantToolMessage.setSessionId(request.getSessionId());
                assistantToolMessage.setRole("assistant");
                assistantToolMessage.setContent(normalizeContent(responseMessage.getContent()));
                assistantToolMessage.setReasoningContent(reasoningText);
                assistantToolMessage.setReasoningDurationMs(resolveReasoningDurationMs(reasoningText, requestDurationMs));
                assistantToolMessage.setModelId(context.model().getId());
                assistantToolMessage.setModelName(context.model().getDisplayName());
                applyAgentSnapshot(assistantToolMessage, context.agent());
                applyUsageSnapshot(assistantToolMessage, lastResponse.getUsage(), context.model());
                assistantToolMessage.setCreatedAt(LocalDateTime.now());
                try {
                    assistantToolMessage.setToolCalls(
                            objectMapper.writeValueAsString(responseMessage.getToolCalls()));
                } catch (JsonProcessingException e) {
                    log.warn("工具调用序列化失败", e);
                }
                messageMapper.insert(assistantToolMessage);

                for (ChatCompletionResponse.ToolCall toolCall : responseMessage.getToolCalls()) {
                    String toolResult = executeToolCall(toolCall);

                    ChatMessage toolMessage = new ChatMessage();
                    toolMessage.setSessionId(request.getSessionId());
                    toolMessage.setRole("tool");
                    toolMessage.setContent(toolResult);
                    toolMessage.setToolCallId(toolCall.getId());
                    toolMessage.setModelId(context.model().getId());
                    toolMessage.setModelName(context.model().getDisplayName());
                    applyAgentSnapshot(toolMessage, context.agent());
                    toolMessage.setCreatedAt(LocalDateTime.now());
                    messageMapper.insert(toolMessage);
                }

                CompressionResult compressionResult = compressHistoryIfNeeded(
                        getMessages(request.getSessionId()),
                        context.model(),
                        context.defaultParams()
                );
                history = compressionResult.history();
                continue;
            }

            ChatMessage assistantMessage = new ChatMessage();
            assistantMessage.setSessionId(request.getSessionId());
            assistantMessage.setRole("assistant");
            assistantMessage.setContent(normalizeContent(responseMessage != null ? responseMessage.getContent() : null));
            assistantMessage.setReasoningContent(reasoningText);
            assistantMessage.setReasoningDurationMs(resolveReasoningDurationMs(reasoningText, requestDurationMs));
            assistantMessage.setModelId(context.model().getId());
            assistantMessage.setModelName(context.model().getDisplayName());
            applyAgentSnapshot(assistantMessage, context.agent());
            applyUsageSnapshot(assistantMessage, lastResponse.getUsage(), context.model());
            assistantMessage.setCreatedAt(LocalDateTime.now());
            messageMapper.insert(assistantMessage);

            touchSession(context.session(), context.model().getId());
            return assistantMessage;
        }

        ChatMessage fallbackMessage = new ChatMessage();
        fallbackMessage.setSessionId(request.getSessionId());
        fallbackMessage.setRole("assistant");
        fallbackMessage.setContent("工具调用轮次超限，已停止处理。");
        fallbackMessage.setModelId(context.model().getId());
        fallbackMessage.setModelName(context.model().getDisplayName());
        applyAgentSnapshot(fallbackMessage, context.agent());
        fallbackMessage.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(fallbackMessage);

        touchSession(context.session(), context.model().getId());
        return fallbackMessage;
    }

    /**
     * SSE 流式发送，返回增量消息与推理片段。
     */
    public SseEmitter streamMessage(ChatSendRequest request) {
        SseEmitter emitter = new SseEmitter(0L);

        Thread.startVirtualThread(() -> {
            try {
                SendContext context = prepareSendContext(request, false);

                ChatCompletionRequest completionRequest = buildRequest(
                        context.model().getModelKey(),
                        context.history(),
                        context.defaultParams(),
                        null,
                        context.systemPrompt()
                );
                completionRequest.setStream(true);

                StringBuilder contentBuilder = new StringBuilder();
                StringBuilder reasoningBuilder = new StringBuilder();
                ChatCompletionResponse.Usage[] usageHolder = new ChatCompletionResponse.Usage[] {null};
                long streamStartAt = System.currentTimeMillis();
                long[] reasoningStartAt = new long[] {0L};
                long[] reasoningLastAt = new long[] {0L};
                long[] firstContentAt = new long[] {0L};

                sendEvent(emitter, "start", Map.of(
                        "sessionId", request.getSessionId(),
                        "modelId", context.model().getId(),
                        "modelName", context.model().getDisplayName(),
                        "contextUsedTokens", context.compressionResult().usedTokens(),
                        "contextWindowTokens", context.compressionResult().contextWindowTokens(),
                        "compressedMessageCount", context.compressionResult().droppedMessages()
                ));

                openRouterClient.streamChatCompletion(
                        context.provider().getBaseUrl(),
                        context.apiKey(),
                        completionRequest,
                        new OpenRouterClient.StreamChunkHandler() {
                            @Override
                            public void onChunk(ChatCompletionStreamChunk chunk) throws Exception {
                                if (chunk.getUsage() != null) {
                                    usageHolder[0] = chunk.getUsage();
                                }
                                if (chunk.getChoices() == null || chunk.getChoices().isEmpty()) {
                                    return;
                                }

                                ChatCompletionStreamChunk.Choice choice = chunk.getChoices().get(0);
                                ChatCompletionStreamChunk.Delta delta = choice.getDelta();
                                if (delta == null) {
                                    return;
                                }

                                if (delta.getContent() != null && !delta.getContent().isEmpty()) {
                                    if (firstContentAt[0] == 0L) {
                                        firstContentAt[0] = System.currentTimeMillis();
                                    }
                                    contentBuilder.append(delta.getContent());
                                    sendEvent(emitter, "delta", Map.of("content", delta.getContent()));
                                }

                                if (delta.getReasoning() != null && !delta.getReasoning().isEmpty()) {
                                    long now = System.currentTimeMillis();
                                    if (reasoningStartAt[0] == 0L) {
                                        reasoningStartAt[0] = now;
                                    }
                                    reasoningLastAt[0] = now;
                                    reasoningBuilder.append(delta.getReasoning());
                                    sendEvent(emitter, "reasoning", Map.of("reasoning", delta.getReasoning()));
                                }
                            }
                        }
                );

                ChatMessage assistantMessage = new ChatMessage();
                assistantMessage.setSessionId(request.getSessionId());
                assistantMessage.setRole("assistant");
                assistantMessage.setContent(normalizeContent(contentBuilder.toString()));
                String reasoningText = normalizeContent(reasoningBuilder.toString());
                assistantMessage.setReasoningContent(reasoningText);
                assistantMessage.setReasoningDurationMs(resolveStreamReasoningDurationMs(
                        reasoningText,
                        reasoningStartAt[0],
                        reasoningLastAt[0],
                        firstContentAt[0],
                        streamStartAt
                ));
                assistantMessage.setModelId(context.model().getId());
                assistantMessage.setModelName(context.model().getDisplayName());
                applyAgentSnapshot(assistantMessage, context.agent());
                applyUsageSnapshot(assistantMessage, usageHolder[0], context.model());
                assistantMessage.setCreatedAt(LocalDateTime.now());
                messageMapper.insert(assistantMessage);

                touchSession(context.session(), context.model().getId());
                ChatSessionContextStatsResponse contextStats = getSessionContextStats(request.getSessionId(), context.model().getId());

                Map<String, Object> donePayload = new HashMap<>();
                donePayload.put("messageId", assistantMessage.getId());
                donePayload.put("sessionId", request.getSessionId());
                donePayload.put("modelId", context.model().getId());
                donePayload.put("modelName", context.model().getDisplayName());
                donePayload.put("tokenUsage", assistantMessage.getTokenUsage());
                donePayload.put("promptTokens", assistantMessage.getPromptTokens());
                donePayload.put("completionTokens", assistantMessage.getCompletionTokens());
                donePayload.put("cacheReadTokens", assistantMessage.getCacheReadTokens());
                donePayload.put("cacheWriteTokens", assistantMessage.getCacheWriteTokens());
                donePayload.put("costUsd", assistantMessage.getCostUsd());
                donePayload.put("sessionCostUsd", contextStats.getSessionCostUsd());
                donePayload.put("title", getSession(request.getSessionId()).getTitle());
                sendEvent(emitter, "done", donePayload);

                emitter.complete();
            } catch (Exception e) {
                log.error("流式发送失败", e);
                try {
                    sendEvent(emitter, "error", Map.of("message", e.getMessage()));
                } catch (IOException ignored) {
                }
                emitter.completeWithError(e);
            }
        });

        return emitter;
    }

    private SendContext prepareSendContext(ChatSendRequest request, boolean includeTools) {
        AiModel model = aiModelService.getEntityById(request.getModelId());
        if (!Boolean.TRUE.equals(model.getEnabled())) {
            throw new RuntimeException("模型未启用: " + model.getDisplayName());
        }

        Provider provider = providerService.getEntityById(model.getProviderId());
        if (!Boolean.TRUE.equals(provider.getEnabled())) {
            throw new RuntimeException("供应商未启用: " + provider.getName());
        }

        List<String> images = sanitizeImages(request.getImages());
        if (!images.isEmpty() && !Boolean.TRUE.equals(model.getSupportsVision())) {
            throw new RuntimeException("当前模型不支持图片输入");
        }

        ChatSession session = getSession(request.getSessionId());
        session.setModelId(model.getId());
        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(session);

        CustomAgent agent = resolveSessionAgent(session.getAgentId());

        ChatMessage userMessage = new ChatMessage();
        userMessage.setSessionId(request.getSessionId());
        userMessage.setRole("user");
        userMessage.setContent(normalizeContent(request.getContent()));
        userMessage.setImageUrls(serializeImages(images));
        userMessage.setModelId(model.getId());
        userMessage.setModelName(model.getDisplayName());
        applyAgentSnapshot(userMessage, agent);
        userMessage.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(userMessage);

        applyAutoTitleIfNeeded(session, userMessage.getContent(), images);

        Map<String, Object> defaultParams = parseDefaultParams(model.getDefaultParams());
        if (!defaultParams.containsKey("max_tokens")
                && model.getMaxCompletionTokens() != null
                && model.getMaxCompletionTokens() > 0) {
            defaultParams.put("max_tokens", model.getMaxCompletionTokens());
        }
        List<ChatMessage> history = getMessages(request.getSessionId());
        CompressionResult compressionResult = compressHistoryIfNeeded(history, model, defaultParams);
        history = compressionResult.history();

        List<ChatCompletionRequest.Tool> tools = null;
        if (includeTools
                && Boolean.TRUE.equals(model.getSupportsTools())
                && !toolRegistry.getAllTools().isEmpty()) {
            tools = toolRegistry.getAllTools().stream().map(ToolDefinition::toRequestTool).toList();
        }

        String apiKey = encryptionUtil.decrypt(provider.getApiKey());
        String systemPrompt = loadSystemPrompt(agent);
        return new SendContext(
                session,
                model,
                provider,
                agent,
                apiKey,
                defaultParams,
                tools,
                systemPrompt,
                history,
                compressionResult
        );
    }

    private ChatSession createSessionInternal(String title,
                                              Long agentId,
                                              Long modelId,
                                              Long parentSessionId,
                                              Long parentMessageId) {
        Long finalAgentId;
        if (agentId == null) {
            finalAgentId = customAgentService.getDefaultAgentEntity().getId();
        } else {
            CustomAgent agent = customAgentService.getEntityById(agentId);
            if (!Boolean.TRUE.equals(agent.getEnabled())) {
                throw new RuntimeException("智能体未启用: " + agent.getName());
            }
            finalAgentId = agent.getId();
        }

        Long finalModelId = modelId != null ? modelId : aiModelService.resolvePreferredEnabledModelId();

        ChatSession session = new ChatSession();
        session.setTitle(normalizeTitle(title, "新会话"));
        session.setModelId(finalModelId);
        session.setAgentId(finalAgentId);
        session.setParentSessionId(parentSessionId);
        session.setParentMessageId(parentMessageId);
        session.setCreatedAt(LocalDateTime.now());
        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.insert(session);
        return session;
    }

    private void copyMessages(Long sourceSessionId, Long targetSessionId, Long maxMessageId) {
        LambdaQueryWrapper<ChatMessage> wrapper = new LambdaQueryWrapper<ChatMessage>()
                .eq(ChatMessage::getSessionId, sourceSessionId)
                .orderByAsc(ChatMessage::getCreatedAt)
                .orderByAsc(ChatMessage::getId);
        if (maxMessageId != null) {
            wrapper.le(ChatMessage::getId, maxMessageId);
        }

        List<ChatMessage> sourceMessages = messageMapper.selectList(wrapper);
        for (ChatMessage sourceMessage : sourceMessages) {
            ChatMessage copiedMessage = new ChatMessage();
            copiedMessage.setSessionId(targetSessionId);
            copiedMessage.setRole(sourceMessage.getRole());
            copiedMessage.setContent(sourceMessage.getContent());
            copiedMessage.setToolCalls(sourceMessage.getToolCalls());
            copiedMessage.setToolCallId(sourceMessage.getToolCallId());
            copiedMessage.setTokenUsage(sourceMessage.getTokenUsage());
            copiedMessage.setPromptTokens(sourceMessage.getPromptTokens());
            copiedMessage.setCompletionTokens(sourceMessage.getCompletionTokens());
            copiedMessage.setCacheReadTokens(sourceMessage.getCacheReadTokens());
            copiedMessage.setCacheWriteTokens(sourceMessage.getCacheWriteTokens());
            copiedMessage.setCostUsd(sourceMessage.getCostUsd());
            copiedMessage.setModelId(sourceMessage.getModelId());
            copiedMessage.setModelName(sourceMessage.getModelName());
            copiedMessage.setAgentId(sourceMessage.getAgentId());
            copiedMessage.setAgentName(sourceMessage.getAgentName());
            copiedMessage.setAgentAvatarType(sourceMessage.getAgentAvatarType());
            copiedMessage.setAgentAvatarValue(sourceMessage.getAgentAvatarValue());
            copiedMessage.setReasoningContent(sourceMessage.getReasoningContent());
            copiedMessage.setReasoningDurationMs(sourceMessage.getReasoningDurationMs());
            copiedMessage.setImageUrls(sourceMessage.getImageUrls());
            copiedMessage.setCreatedAt(LocalDateTime.now());
            messageMapper.insert(copiedMessage);
        }
    }

    private ChatCompletionRequest buildRequest(String modelKey,
                                               List<ChatMessage> history,
                                               Map<String, Object> defaultParams,
                                               List<ChatCompletionRequest.Tool> tools,
                                               String systemPrompt) {
        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel(modelKey);

        if (defaultParams.containsKey("temperature")) {
            request.setTemperature(((Number) defaultParams.get("temperature")).doubleValue());
        }
        if (defaultParams.containsKey("top_p")) {
            request.setTopP(((Number) defaultParams.get("top_p")).doubleValue());
        }
        if (defaultParams.containsKey("max_tokens")) {
            request.setMaxTokens(((Number) defaultParams.get("max_tokens")).intValue());
        }

        List<ChatCompletionRequest.Message> messages = new ArrayList<>();
        if (systemPrompt != null && !systemPrompt.isBlank()) {
            ChatCompletionRequest.Message systemMessage = new ChatCompletionRequest.Message();
            systemMessage.setRole("system");
            systemMessage.setContent(systemPrompt);
            messages.add(systemMessage);
        }

        for (ChatMessage historyMessage : history) {
            ChatCompletionRequest.Message message = new ChatCompletionRequest.Message();
            message.setRole(historyMessage.getRole());

            if ("user".equals(historyMessage.getRole())
                    && historyMessage.getImageUrls() != null
                    && !historyMessage.getImageUrls().isBlank()) {
                List<String> images = parseImages(historyMessage.getImageUrls());
                if (!images.isEmpty()) {
                    message.setContent(buildVisionContent(historyMessage.getContent(), images));
                } else {
                    message.setContent(historyMessage.getContent());
                }
            } else {
                message.setContent(historyMessage.getContent());
            }

            if ("assistant".equals(historyMessage.getRole())
                    && historyMessage.getToolCalls() != null
                    && !historyMessage.getToolCalls().isBlank()) {
                try {
                    List<ChatCompletionRequest.ToolCall> toolCalls = objectMapper.readValue(
                            historyMessage.getToolCalls(),
                            new TypeReference<List<ChatCompletionRequest.ToolCall>>() {
                            }
                    );
                    message.setToolCalls(toolCalls);
                } catch (JsonProcessingException e) {
                    log.warn("历史工具调用反序列化失败", e);
                }
            }

            if ("tool".equals(historyMessage.getRole())) {
                message.setToolCallId(historyMessage.getToolCallId());
            }

            messages.add(message);
        }

        request.setMessages(messages);

        if (tools != null && !tools.isEmpty()) {
            request.setTools(tools);
            request.setToolChoice("auto");
        }

        return request;
    }

    private List<Map<String, Object>> buildVisionContent(String text, List<String> images) {
        List<Map<String, Object>> content = new ArrayList<>();
        if (text != null && !text.isBlank()) {
            content.add(Map.of("type", "text", "text", text));
        }

        for (String image : images) {
            content.add(Map.of(
                    "type", "image_url",
                    "image_url", Map.of("url", image)
            ));
        }

        if (content.isEmpty()) {
            content.add(Map.of("type", "text", "text", "请分析图片"));
        }
        return content;
    }

    private void applyAutoTitleIfNeeded(ChatSession session, String content, List<String> images) {
        if (!isDefaultSessionTitle(session.getTitle())) {
            return;
        }

        Long userMessageCount = messageMapper.selectCount(
                new LambdaQueryWrapper<ChatMessage>()
                        .eq(ChatMessage::getSessionId, session.getId())
                        .eq(ChatMessage::getRole, "user")
        );
        if (userMessageCount == null || userMessageCount != 1) {
            return;
        }

        String autoTitle = generateAutoTitle(content, images);
        session.setTitle(autoTitle);
        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(session);
    }

    private String generateAutoTitle(String content, List<String> images) {
        String normalized = normalizeContent(content);
        if (normalized == null || normalized.isBlank()) {
            if (images != null && !images.isEmpty()) {
                return "图片对话";
            }
            return "新会话";
        }

        String plainText = normalized
                .replaceAll("[#*`>\\-]+", " ")
                .replaceAll("\\s+", " ")
                .trim();

        if (plainText.length() <= TITLE_MAX_LENGTH) {
            return plainText;
        }
        return plainText.substring(0, TITLE_MAX_LENGTH) + "...";
    }

    private String loadSystemPrompt(CustomAgent agent) {
        if (!Boolean.TRUE.equals(agent.getEnabled())) {
            return null;
        }
        return normalizeContent(agent.getSystemPrompt());
    }

    private CustomAgent resolveSessionAgent(Long agentId) {
        return agentId == null
                ? customAgentService.getDefaultAgentEntity()
                : customAgentService.getEntityById(agentId);
    }

    /**
     * 将消息关联的智能体信息写入快照字段，保证历史消息显示稳定。
     */
    private void applyAgentSnapshot(ChatMessage message, CustomAgent agent) {
        message.setAgentId(agent.getId());
        if (Boolean.TRUE.equals(agent.getIsDefault())) {
            message.setAgentName(DEFAULT_ASSISTANT_NAME);
            message.setAgentAvatarType(null);
            message.setAgentAvatarValue(null);
            return;
        }
        message.setAgentName(agent.getName());
        message.setAgentAvatarType(agent.getAvatarType());
        message.setAgentAvatarValue(agent.getAvatarValue());
    }

    /**
     * 将 usage 快照写入消息，兼容不同供应商的 usage 字段。
     */
    private void applyUsageSnapshot(ChatMessage message,
                                    ChatCompletionResponse.Usage usage,
                                    AiModel model) {
        if (usage == null) {
            return;
        }

        message.setTokenUsage(usage.getTotalTokens());
        message.setPromptTokens(usage.getPromptTokens());
        message.setCompletionTokens(usage.getCompletionTokens());
        if (usage.getPromptTokensDetails() != null) {
            message.setCacheReadTokens(usage.getPromptTokensDetails().getCacheReadTokens());
            message.setCacheWriteTokens(usage.getPromptTokensDetails().getCacheWriteTokens());
        }

        BigDecimal cost = usage.getCost();
        if (cost == null) {
            cost = estimateUsageCost(
                    nonNullInt(message.getPromptTokens()),
                    nonNullInt(message.getCompletionTokens()),
                    nonNullInt(message.getCacheReadTokens()),
                    nonNullInt(message.getCacheWriteTokens()),
                    model
            );
        }
        message.setCostUsd(cost);
    }

    private BigDecimal estimateUsageCost(int promptTokens,
                                         int completionTokens,
                                         int cacheReadTokens,
                                         int cacheWriteTokens,
                                         AiModel model) {
        if (model == null) {
            return BigDecimal.ZERO;
        }
        BigDecimal total = BigDecimal.ZERO;
        if (model.getInputPrice() != null && promptTokens > 0) {
            total = total.add(model.getInputPrice().multiply(BigDecimal.valueOf(promptTokens)));
        }
        if (model.getOutputPrice() != null && completionTokens > 0) {
            total = total.add(model.getOutputPrice().multiply(BigDecimal.valueOf(completionTokens)));
        }
        if (model.getCacheReadPrice() != null && cacheReadTokens > 0) {
            total = total.add(model.getCacheReadPrice().multiply(BigDecimal.valueOf(cacheReadTokens)));
        }
        if (model.getCacheWritePrice() != null && cacheWriteTokens > 0) {
            total = total.add(model.getCacheWritePrice().multiply(BigDecimal.valueOf(cacheWriteTokens)));
        }
        return total;
    }

    private CompressionResult compressHistoryIfNeeded(List<ChatMessage> history,
                                                      AiModel model,
                                                      Map<String, Object> defaultParams) {
        List<ChatMessage> compressed = new ArrayList<>(history);
        long contextWindowTokens = resolveContextWindowTokens(model);
        int usedTokens = estimateContextTokens(compressed);
        int droppedMessages = 0;

        int reservedOutputTokens = resolveReservedOutputTokens(model, defaultParams, contextWindowTokens);
        long promptBudget = Math.max(MIN_PROMPT_BUDGET_TOKENS, contextWindowTokens - reservedOutputTokens);

        // 保留最近消息，按最老优先裁剪，避免超出模型上下文窗口。
        while (usedTokens > promptBudget && compressed.size() > 1) {
            compressed.remove(0);
            droppedMessages += 1;
            usedTokens = estimateContextTokens(compressed);
        }

        return new CompressionResult(List.copyOf(compressed), droppedMessages, usedTokens, contextWindowTokens);
    }

    private long resolveContextWindowTokens(AiModel model) {
        if (model == null || model.getContextWindowTokens() == null || model.getContextWindowTokens() <= 0) {
            return DEFAULT_CONTEXT_WINDOW_TOKENS;
        }
        return model.getContextWindowTokens();
    }

    private int resolveReservedOutputTokens(AiModel model,
                                            Map<String, Object> defaultParams,
                                            long contextWindowTokens) {
        if (model != null && model.getMaxCompletionTokens() != null && model.getMaxCompletionTokens() > 0) {
            return (int) Math.min(model.getMaxCompletionTokens(), Integer.MAX_VALUE);
        }
        Object maxTokens = defaultParams.get("max_tokens");
        if (maxTokens instanceof Number number) {
            return Math.max(number.intValue(), MIN_PROMPT_BUDGET_TOKENS);
        }
        int byWindow = (int) Math.max(contextWindowTokens / 8, MIN_PROMPT_BUDGET_TOKENS);
        return Math.max(DEFAULT_RESERVED_OUTPUT_TOKENS, byWindow);
    }

    private int estimateContextTokens(List<ChatMessage> messages) {
        int total = 0;
        for (ChatMessage message : messages) {
            total += estimateMessageTokens(message);
        }
        return total;
    }

    private int estimateMessageTokens(ChatMessage message) {
        int total = 4; // role + 边界开销
        total += TokenEstimator.estimateTextTokens(message.getContent());
        total += TokenEstimator.estimateTextTokens(message.getReasoningContent());
        total += TokenEstimator.estimateTextTokens(message.getToolCalls());
        if (message.getImageUrls() != null && !message.getImageUrls().isBlank()) {
            int imageCount = parseImages(message.getImageUrls()).size();
            total += imageCount * ESTIMATED_IMAGE_TOKENS;
        }
        return total;
    }

    private int nonNullInt(Integer value) {
        return value != null ? value : 0;
    }

    /**
     * 若模型返回了推理内容，则记录本次调用的推理耗时。
     */
    private Long resolveReasoningDurationMs(String reasoningText, long durationMs) {
        if (reasoningText == null || reasoningText.isBlank()) {
            return null;
        }
        return Math.max(0L, durationMs);
    }

    /**
     * 流式推理耗时：
     * 1) 优先统计首个到最后一个 reasoning chunk 的时长；
     * 2) 若缺少结束点，则回退到正文首 chunk；
     * 3) 再回退到流结束时间，避免丢失数据。
     */
    private Long resolveStreamReasoningDurationMs(String reasoningText,
                                                  long reasoningStartAt,
                                                  long reasoningLastAt,
                                                  long firstContentAt,
                                                  long streamStartAt) {
        if (reasoningText == null || reasoningText.isBlank()) {
            return null;
        }

        long startAt = reasoningStartAt > 0L ? reasoningStartAt : streamStartAt;
        long endAt;
        if (reasoningLastAt > 0L) {
            endAt = reasoningLastAt;
        } else if (firstContentAt > 0L) {
            endAt = firstContentAt;
        } else {
            endAt = System.currentTimeMillis();
        }

        if (endAt < startAt) {
            endAt = startAt;
        }
        return Math.max(0L, endAt - startAt);
    }

    private void touchSession(ChatSession session, Long modelId) {
        session.setModelId(modelId);
        session.setUpdatedAt(LocalDateTime.now());
        sessionMapper.updateById(session);
    }

    private void sendEvent(SseEmitter emitter, String event, Object data) throws IOException {
        emitter.send(SseEmitter.event().name(event).data(data));
    }

    private String executeToolCall(ChatCompletionResponse.ToolCall toolCall) {
        if (toolCall == null || toolCall.getFunction() == null) {
            return "工具调用结构不完整";
        }

        String name = toolCall.getFunction().getName();
        String argsJson = toolCall.getFunction().getArguments();

        ToolDefinition tool = toolRegistry.getTool(name);
        if (tool == null) {
            return "错误: 未知工具 " + name;
        }

        try {
            Map<String, Object> args = (argsJson != null && !argsJson.isEmpty())
                    ? objectMapper.readValue(argsJson, new TypeReference<Map<String, Object>>() {
                    })
                    : Map.of();
            return tool.execute(args);
        } catch (Exception e) {
            log.error("工具执行失败: {}", name, e);
            return "工具执行失败: " + e.getMessage();
        }
    }

    private String extractReasoning(ChatCompletionResponse.Message message) {
        if (message == null) {
            return null;
        }
        String reasoning = normalizeContent(message.getReasoningContent());
        if (reasoning != null) {
            return reasoning;
        }
        return normalizeContent(message.getReasoning());
    }

    private String normalizeTitle(String title, String defaultTitle) {
        if (title == null || title.isBlank()) {
            return defaultTitle;
        }
        return title.trim();
    }

    /**
     * 根据命中位置裁剪一段上下文摘要，避免搜索结果行过长。
     */
    private String buildSearchSnippet(String rawContent, String keyword) {
        String normalizedContent = normalizeSearchContent(rawContent);
        if (normalizedContent == null) {
            return null;
        }
        if (keyword == null || keyword.isBlank()) {
            return clampText(normalizedContent, 120);
        }

        String lowerContent = normalizedContent.toLowerCase(Locale.ROOT);
        String lowerKeyword = keyword.toLowerCase(Locale.ROOT);
        int hitIndex = lowerContent.indexOf(lowerKeyword);
        if (hitIndex < 0) {
            return clampText(normalizedContent, 120);
        }

        int prefixLength = 28;
        int suffixLength = 84;
        int start = Math.max(0, hitIndex - prefixLength);
        int end = Math.min(normalizedContent.length(), hitIndex + keyword.length() + suffixLength);
        String snippet = normalizedContent.substring(start, end);
        if (start > 0) {
            snippet = "..." + snippet;
        }
        if (end < normalizedContent.length()) {
            snippet = snippet + "...";
        }
        return snippet;
    }

    private String normalizeSearchContent(String value) {
        if (value == null) {
            return null;
        }
        String normalized = value
                .replace('\r', ' ')
                .replace('\n', ' ')
                .replace('\t', ' ')
                .replaceAll("\\s+", " ")
                .trim();
        if (normalized.isBlank()) {
            return null;
        }
        return normalized;
    }

    private String clampText(String value, int maxLength) {
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }

    private boolean isDefaultSessionTitle(String title) {
        return title == null || title.isBlank() || "新会话".equals(title);
    }

    private String normalizeContent(String content) {
        if (content == null) {
            return null;
        }
        String normalized = content.trim();
        return normalized.isEmpty() ? null : normalized;
    }

    private String serializeImages(List<String> images) {
        if (images == null || images.isEmpty()) {
            return null;
        }
        try {
            return objectMapper.writeValueAsString(images);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("图片列表序列化失败", e);
        }
    }

    private List<String> parseImages(String imageJson) {
        if (imageJson == null || imageJson.isBlank()) {
            return List.of();
        }
        try {
            return objectMapper.readValue(imageJson, new TypeReference<List<String>>() {
            });
        } catch (JsonProcessingException e) {
            log.warn("图片列表反序列化失败", e);
            return List.of();
        }
    }

    private List<String> sanitizeImages(List<String> images) {
        if (images == null || images.isEmpty()) {
            return List.of();
        }
        return images.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(url -> !url.isBlank())
                .distinct()
                .toList();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseDefaultParams(String json) {
        if (json == null || json.isBlank()) {
            return new HashMap<>();
        }
        try {
            return new HashMap<>(objectMapper.readValue(json, Map.class));
        } catch (JsonProcessingException e) {
            log.warn("默认参数解析失败: {}", json, e);
            return new HashMap<>();
        }
    }

    private record SendContext(ChatSession session,
                               AiModel model,
                               Provider provider,
                               CustomAgent agent,
                               String apiKey,
                               Map<String, Object> defaultParams,
                               List<ChatCompletionRequest.Tool> tools,
                               String systemPrompt,
                               List<ChatMessage> history,
                               CompressionResult compressionResult) {
    }

    private record CompressionResult(List<ChatMessage> history,
                                     int droppedMessages,
                                     int usedTokens,
                                     long contextWindowTokens) {
    }
}
