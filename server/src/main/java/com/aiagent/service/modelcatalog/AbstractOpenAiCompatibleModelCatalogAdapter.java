package com.aiagent.service.modelcatalog;

import com.aiagent.entity.Provider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * OpenAI 兼容模型目录接口抽象父类：
 * 默认请求 GET {baseUrl}/models，并对 data[] 做统一遍历。
 */
@RequiredArgsConstructor
@Slf4j
public abstract class AbstractOpenAiCompatibleModelCatalogAdapter implements ModelCatalogAdapter {

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    /**
     * 兼容供应商返回的上下文长度文本格式：
     * - 纯数字：200000
     * - 小数：200000.0
     * - 科学计数法：2e5
     * - 单位后缀：200k / 1.5m / 2b
     */
    private static final Pattern TOKEN_NUMBER_PATTERN = Pattern.compile(
            "^([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?)\\s*([kmbKMB])?$");

    @Override
    public List<DiscoveredModelInfo> discover(Provider provider, String apiKey) {
        String url = normalizeUrl(provider.getBaseUrl()) + modelsPath();
        Request.Builder requestBuilder = new Request.Builder()
                .url(url)
                .get()
                .addHeader("Accept", "application/json");

        if (apiKey != null && !apiKey.isBlank()) {
            requestBuilder.addHeader("Authorization", "Bearer " + apiKey.trim());
        }

        try (Response response = httpClient.newCall(requestBuilder.build()).execute()) {
            if (!response.isSuccessful()) {
                String errorBody = response.body() != null ? response.body().string() : "";
                throw new RuntimeException("拉取模型列表失败（HTTP " + response.code() + "）: " + errorBody);
            }
            String body = response.body() != null ? response.body().string() : "";
            JsonNode root = objectMapper.readTree(body);
            JsonNode dataNode = root.path("data");
            if (!dataNode.isArray()) {
                throw new RuntimeException("模型列表格式不兼容：缺少 data 数组");
            }

            List<DiscoveredModelInfo> discovered = new ArrayList<>();
            for (JsonNode modelNode : dataNode) {
                DiscoveredModelInfo modelInfo = mapModelNode(modelNode, provider);
                if (modelInfo == null || isBlank(modelInfo.getModelKey())) {
                    continue;
                }
                normalize(modelInfo);
                discovered.add(modelInfo);
            }
            return distinctByKey(discovered);
        } catch (IOException e) {
            log.warn("拉取模型列表异常", e);
            throw new RuntimeException("拉取模型列表失败: " + e.getMessage(), e);
        }
    }

    /**
     * 子类可覆盖模型列表路径，默认 /models。
     */
    protected String modelsPath() {
        return "/models";
    }

    /**
     * 子类需要按各供应商结构提取字段。
     */
    protected abstract DiscoveredModelInfo mapModelNode(JsonNode modelNode, Provider provider);

    protected String text(JsonNode node, String fieldName) {
        JsonNode target = node.path(fieldName);
        if (target.isMissingNode() || target.isNull()) {
            return null;
        }
        String value = target.asText();
        return isBlank(value) ? null : value.trim();
    }

    protected Long longValue(JsonNode node, String fieldName) {
        JsonNode target = node.path(fieldName);
        if (target.isMissingNode() || target.isNull()) {
            return null;
        }
        if (target.isIntegralNumber()) {
            return target.asLong();
        }
        if (target.isTextual()) {
            String raw = target.asText().trim();
            if (raw.isEmpty()) {
                return null;
            }
            return parseTokenLikeLong(raw);
        }
        return null;
    }

    protected BigDecimal decimalValue(JsonNode node, String fieldName) {
        JsonNode target = node.path(fieldName);
        if (target.isMissingNode() || target.isNull()) {
            return null;
        }
        try {
            if (target.isNumber()) {
                return target.decimalValue();
            }
            if (target.isTextual()) {
                String raw = target.asText().trim();
                if (raw.isEmpty()) {
                    return null;
                }
                return new BigDecimal(raw);
            }
        } catch (NumberFormatException ignored) {
            return null;
        }
        return null;
    }

    protected boolean arrayContainsText(JsonNode arrayNode, String expected) {
        if (!arrayNode.isArray()) {
            return false;
        }
        for (JsonNode item : arrayNode) {
            if (expected.equalsIgnoreCase(item.asText(""))) {
                return true;
            }
        }
        return false;
    }

    protected boolean arrayContainsTextPart(JsonNode arrayNode, String part) {
        if (!arrayNode.isArray()) {
            return false;
        }
        String lowerPart = part.toLowerCase();
        for (JsonNode item : arrayNode) {
            String text = item.asText("");
            if (text.toLowerCase().contains(lowerPart)) {
                return true;
            }
        }
        return false;
    }

    protected String normalizeUrl(String baseUrl) {
        if (baseUrl == null) {
            return "";
        }
        return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    private Long parseTokenLikeLong(String raw) {
        String normalized = raw.replace(",", "").replace("_", "").trim();
        if (normalized.isEmpty()) {
            return null;
        }

        Matcher matcher = TOKEN_NUMBER_PATTERN.matcher(normalized);
        if (!matcher.matches()) {
            return null;
        }

        try {
            BigDecimal base = new BigDecimal(matcher.group(1));
            String suffix = matcher.group(2);
            BigDecimal multiplier = switch (suffix == null ? "" : suffix.toLowerCase(Locale.ROOT)) {
                case "k" -> BigDecimal.valueOf(1_000);
                case "m" -> BigDecimal.valueOf(1_000_000);
                case "b" -> BigDecimal.valueOf(1_000_000_000L);
                default -> BigDecimal.ONE;
            };
            BigDecimal result = base.multiply(multiplier).setScale(0, RoundingMode.HALF_UP);
            if (result.compareTo(BigDecimal.ZERO) < 0
                    || result.compareTo(BigDecimal.valueOf(Long.MAX_VALUE)) > 0) {
                return null;
            }
            return result.longValueExact();
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private void normalize(DiscoveredModelInfo modelInfo) {
        if (isBlank(modelInfo.getDisplayName())) {
            modelInfo.setDisplayName(modelInfo.getModelKey());
        }
        if (modelInfo.getSupportsTools() == null) {
            modelInfo.setSupportsTools(false);
        }
        if (modelInfo.getSupportsVision() == null) {
            modelInfo.setSupportsVision(false);
        }
        if (modelInfo.getSupportsReasoning() == null) {
            modelInfo.setSupportsReasoning(false);
        }
    }

    private List<DiscoveredModelInfo> distinctByKey(List<DiscoveredModelInfo> input) {
        Map<String, DiscoveredModelInfo> unique = new LinkedHashMap<>();
        for (DiscoveredModelInfo item : input) {
            unique.putIfAbsent(item.getModelKey(), item);
        }
        return new ArrayList<>(unique.values());
    }

    private boolean isBlank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
