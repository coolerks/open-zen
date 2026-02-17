package com.aiagent.service.tool;

import com.aiagent.entity.ChatMessage;
import com.aiagent.entity.ChatSession;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 跨会话记忆检索工具。
 * 仅在“记忆开关开启”时暴露给模型，并允许免授权自动调用。
 */
@Component
@RequiredArgsConstructor
public class ConversationMemorySearchTool implements ToolDefinition {

    private static final int DEFAULT_LIMIT = 4;
    private static final int MAX_LIMIT = 8;
    private static final int MAX_SCAN_LIMIT = 120;
    private static final int SNIPPET_MAX_CHARS = 120;
    private static final int RESULT_MAX_CHARS = 1600;
    private static final int SESSION_TITLE_MAX_CHARS = 24;

    private final ChatMessageMapper chatMessageMapper;
    private final ChatSessionMapper chatSessionMapper;

    @Override
    public String getName() {
        return "searchConversationMemory";
    }

    @Override
    public String getDescription() {
        return "在全部历史会话中按关键词检索聊天记忆，返回精简后的命中摘要。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();

        Map<String, Object> query = new LinkedHashMap<>();
        query.put("type", "string");
        query.put("description", "检索关键词，建议使用 2 到 30 个字符");
        properties.put("query", query);

        Map<String, Object> limit = new LinkedHashMap<>();
        limit.put("type", "integer");
        limit.put("description", "返回条数，范围 1 到 8，默认 4");
        properties.put("limit", limit);

        schema.put("properties", properties);
        schema.put("required", List.of("query"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        // 兼容旧调用路径：即使无上下文，也允许做跨会话检索。
        return execute(arguments, null);
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        String query = extractString(arguments, "query");
        if (query == null || query.isBlank()) {
            return "请提供检索关键词 query。";
        }

        int resolvedLimit = clamp(extractInteger(arguments, "limit", DEFAULT_LIMIT), 1, MAX_LIMIT);
        int scanLimit = Math.min(MAX_SCAN_LIMIT, Math.max(resolvedLimit * 12, resolvedLimit));

        List<ChatMessage> candidates = chatMessageMapper.selectList(
                new LambdaQueryWrapper<ChatMessage>()
                        .in(ChatMessage::getRole, List.of("user", "assistant", "tool"))
                        .isNotNull(ChatMessage::getContent)
                        .like(ChatMessage::getContent, query)
                        .orderByDesc(ChatMessage::getCreatedAt)
                        .orderByDesc(ChatMessage::getId)
                        .last("LIMIT " + scanLimit)
        );

        if (candidates.isEmpty()) {
            return "未检索到与“" + query.trim() + "”相关的跨会话记忆。";
        }

        Set<Long> sessionIdSet = candidates.stream()
                .map(ChatMessage::getSessionId)
                .filter(id -> id != null && id > 0)
                .collect(Collectors.toSet());
        Map<Long, String> sessionTitleMap = loadSessionTitleMap(sessionIdSet);

        Long currentSessionId = context != null ? context.sessionId() : null;
        StringBuilder result = new StringBuilder();
        result.append("跨会话记忆命中（最近 ").append(Math.min(candidates.size(), resolvedLimit)).append(" 条）：\n");

        int appended = 0;
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
        for (ChatMessage item : candidates) {
            if (appended >= resolvedLimit) {
                break;
            }
            String snippet = buildSnippet(item.getContent(), query);
            if (snippet == null) {
                continue;
            }
            appended += 1;
            String roleLabel = switch (item.getRole()) {
                case "user" -> "用户";
                case "assistant" -> "助手";
                case "tool" -> "工具";
                default -> item.getRole();
            };
            String createdAt = item.getCreatedAt() != null ? item.getCreatedAt().format(formatter) : "未知时间";
            Long sessionId = item.getSessionId();
            String sessionTitle = formatSessionTitle(sessionId, sessionTitleMap.get(sessionId), currentSessionId);
            result.append(appended)
                    .append(". [")
                    .append(sessionTitle)
                    .append("]")
                    .append("[")
                    .append(roleLabel)
                    .append("]")
                    .append("[msg#")
                    .append(item.getId())
                    .append("]")
                    .append("[")
                    .append(createdAt)
                    .append("] ")
                    .append(snippet)
                    .append('\n');

            if (result.length() >= RESULT_MAX_CHARS) {
                result.append("...(已截断)");
                break;
            }
        }

        if (appended == 0) {
            return "未检索到可用的历史摘要。";
        }

        return result.toString().trim();
    }

    @Override
    public boolean isMemoryTool() {
        return true;
    }

    @Override
    public boolean bypassUserApproval() {
        return true;
    }

    private String extractString(Map<String, Object> arguments, String key) {
        if (arguments == null || key == null) {
            return null;
        }
        Object raw = arguments.get(key);
        if (raw == null) {
            return null;
        }
        String value = String.valueOf(raw).trim();
        return value.isEmpty() ? null : value;
    }

    private int extractInteger(Map<String, Object> arguments, String key, int defaultValue) {
        if (arguments == null || key == null) {
            return defaultValue;
        }
        Object raw = arguments.get(key);
        if (raw == null) {
            return defaultValue;
        }
        if (raw instanceof Number number) {
            return number.intValue();
        }
        try {
            return Integer.parseInt(String.valueOf(raw).trim());
        } catch (Exception ignored) {
            return defaultValue;
        }
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private String buildSnippet(String rawContent, String keyword) {
        if (rawContent == null) {
            return null;
        }
        String normalized = rawContent
                .replace('\r', ' ')
                .replace('\n', ' ')
                .replace('\t', ' ')
                .replaceAll("\\s+", " ")
                .trim();
        if (normalized.isBlank()) {
            return null;
        }

        String lowerContent = normalized.toLowerCase(Locale.ROOT);
        String lowerKeyword = keyword == null ? "" : keyword.toLowerCase(Locale.ROOT);
        int hitIndex = lowerKeyword.isBlank() ? -1 : lowerContent.indexOf(lowerKeyword);
        if (hitIndex < 0) {
            return clampText(normalized, SNIPPET_MAX_CHARS);
        }

        int prefixLength = 24;
        int suffixLength = SNIPPET_MAX_CHARS - lowerKeyword.length() - prefixLength;
        if (suffixLength < 20) {
            suffixLength = 20;
        }
        int start = Math.max(0, hitIndex - prefixLength);
        int end = Math.min(normalized.length(), hitIndex + lowerKeyword.length() + suffixLength);
        String snippet = normalized.substring(start, end);
        if (start > 0) {
            snippet = "..." + snippet;
        }
        if (end < normalized.length()) {
            snippet = snippet + "...";
        }
        return snippet;
    }

    private String clampText(String value, int maxLength) {
        if (value.length() <= maxLength) {
            return value;
        }
        return value.substring(0, maxLength) + "...";
    }

    private Map<Long, String> loadSessionTitleMap(Set<Long> sessionIdSet) {
        if (sessionIdSet == null || sessionIdSet.isEmpty()) {
            return Map.of();
        }
        List<ChatSession> sessions = chatSessionMapper.selectList(
                new LambdaQueryWrapper<ChatSession>()
                        .in(ChatSession::getId, sessionIdSet)
        );
        if (sessions == null || sessions.isEmpty()) {
            return Map.of();
        }
        return sessions.stream()
                .filter(session -> session.getId() != null)
                .collect(Collectors.toMap(
                        ChatSession::getId,
                        session -> session.getTitle() == null ? "" : session.getTitle(),
                        (a, b) -> a
                ));
    }

    private String formatSessionTitle(Long sessionId, String rawTitle, Long currentSessionId) {
        String normalizedTitle = rawTitle == null ? "" : rawTitle.trim();
        if (normalizedTitle.isBlank()) {
            normalizedTitle = "新会话";
        }
        normalizedTitle = clampText(normalizedTitle, SESSION_TITLE_MAX_CHARS);
        String sessionPrefix = sessionId != null ? "会话#" + sessionId : "会话";
        String base = sessionPrefix + ":" + normalizedTitle;
        if (currentSessionId != null && currentSessionId.equals(sessionId)) {
            return base + "（当前）";
        }
        return base;
    }
}
