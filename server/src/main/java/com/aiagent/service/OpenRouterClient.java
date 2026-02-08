package com.aiagent.service;

import com.aiagent.dto.openrouter.ChatCompletionRequest;
import com.aiagent.dto.openrouter.ChatCompletionResponse;
import com.aiagent.dto.openrouter.ChatCompletionStreamChunk;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import okhttp3.*;
import okio.BufferedSource;
import org.springframework.stereotype.Component;

import java.io.IOException;

/**
 * 调用 OpenRouter（或兼容 OpenAI 协议）Chat Completions 的 HTTP 客户端。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class OpenRouterClient {

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    private static final MediaType JSON_MEDIA = MediaType.parse("application/json; charset=utf-8");

    public ChatCompletionResponse chatCompletion(String baseUrl,
                                                 String apiKey,
                                                 ChatCompletionRequest request) {
        String url = normalizeUrl(baseUrl) + "/chat/completions";

        try {
            String requestBody = objectMapper.writeValueAsString(request);
            log.debug("OpenRouter request to {}: {}", url, requestBody);

            Request httpRequest = new Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer " + apiKey)
                    .addHeader("Content-Type", "application/json")
                    .post(RequestBody.create(requestBody, JSON_MEDIA))
                    .build();

            try (Response response = httpClient.newCall(httpRequest).execute()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                log.debug("OpenRouter response ({}): {}", response.code(), responseBody);

                if (!response.isSuccessful()) {
                    throw new RuntimeException(
                            String.format("OpenRouter API 调用失败 (HTTP %d): %s", response.code(), responseBody));
                }

                return objectMapper.readValue(responseBody, ChatCompletionResponse.class);
            }
        } catch (IOException e) {
            throw new RuntimeException("OpenRouter API 调用异常: " + e.getMessage(), e);
        }
    }

    /**
     * 流式调用聊天接口，按 SSE 的 data 行回调每个增量块。
     */
    public void streamChatCompletion(String baseUrl,
                                     String apiKey,
                                     ChatCompletionRequest request,
                                     StreamChunkHandler handler) {
        String url = normalizeUrl(baseUrl) + "/chat/completions";
        request.setStream(true);

        try {
            String requestBody = objectMapper.writeValueAsString(request);
            log.debug("OpenRouter stream request to {}: {}", url, requestBody);

            Request httpRequest = new Request.Builder()
                    .url(url)
                    .addHeader("Authorization", "Bearer " + apiKey)
                    .addHeader("Content-Type", "application/json")
                    .addHeader("Accept", "text/event-stream")
                    .post(RequestBody.create(requestBody, JSON_MEDIA))
                    .build();

            try (Response response = httpClient.newCall(httpRequest).execute()) {
                if (!response.isSuccessful()) {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    throw new RuntimeException(
                            String.format("OpenRouter 流式调用失败 (HTTP %d): %s", response.code(), responseBody));
                }

                if (response.body() == null) {
                    throw new RuntimeException("OpenRouter 流式调用返回空响应体");
                }

                BufferedSource source = response.body().source();
                while (!source.exhausted()) {
                    String line = source.readUtf8Line();
                    if (line == null || line.isBlank()) {
                        continue;
                    }
                    if (!line.startsWith("data:")) {
                        continue;
                    }

                    String data = line.substring(5).trim();
                    if (data.isEmpty()) {
                        continue;
                    }
                    if ("[DONE]".equals(data)) {
                        handler.onDone();
                        break;
                    }

                    ChatCompletionStreamChunk chunk = objectMapper.readValue(data, ChatCompletionStreamChunk.class);
                    handler.onChunk(chunk);
                }
            }
        } catch (IOException e) {
            throw new RuntimeException("OpenRouter 流式调用异常: " + e.getMessage(), e);
        } catch (Exception e) {
            throw new RuntimeException("OpenRouter 流式处理失败: " + e.getMessage(), e);
        }
    }

    private String normalizeUrl(String baseUrl) {
        return baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
    }

    public interface StreamChunkHandler {
        void onChunk(ChatCompletionStreamChunk chunk) throws Exception;

        default void onDone() throws Exception {
        }
    }
}
