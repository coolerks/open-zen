package com.aiagent.service;

import com.aiagent.dto.openrouter.ChatCompletionRequest;
import com.aiagent.dto.openrouter.ChatCompletionResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class OpenRouterClientTest {

    @Autowired
    private OpenRouterClient openRouterClient;

    @Autowired
    private ObjectMapper objectMapper;

    private MockWebServer mockServer;

    @BeforeEach
    void setUp() throws IOException {
        mockServer = new MockWebServer();
        mockServer.start();
    }

    @AfterEach
    void tearDown() throws IOException {
        mockServer.shutdown();
    }

    @Test
    void testChatCompletion() throws Exception {
        // Prepare mock response
        String mockResponseBody = """
                {
                    "id": "chatcmpl-123",
                    "object": "chat.completion",
                    "created": 1700000000,
                    "model": "qwen/qwen3-coder:free",
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "你好！我是AI助手。"
                        },
                        "finish_reason": "stop"
                    }],
                    "usage": {
                        "prompt_tokens": 10,
                        "completion_tokens": 8,
                        "total_tokens": 18
                    }
                }
                """;

        mockServer.enqueue(new MockResponse()
                .setBody(mockResponseBody)
                .setHeader("Content-Type", "application/json"));

        // Build request
        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel("qwen/qwen3-coder:free");
        ChatCompletionRequest.Message msg = new ChatCompletionRequest.Message();
        msg.setRole("user");
        msg.setContent("你好");
        request.setMessages(List.of(msg));

        // Execute
        String baseUrl = mockServer.url("/api/v1").toString();
        ChatCompletionResponse response = openRouterClient.chatCompletion(baseUrl, "test-key", request);

        // Verify response
        assertNotNull(response);
        assertEquals("chatcmpl-123", response.getId());
        assertEquals(1, response.getChoices().size());
        assertEquals("assistant", response.getChoices().get(0).getMessage().getRole());
        assertEquals("你好！我是AI助手。", response.getChoices().get(0).getMessage().getContent());
        assertEquals("stop", response.getChoices().get(0).getFinishReason());
        assertEquals(18, response.getUsage().getTotalTokens());

        // Verify request
        RecordedRequest recorded = mockServer.takeRequest();
        assertEquals("/api/v1/chat/completions", recorded.getPath());
        assertEquals("Bearer test-key", recorded.getHeader("Authorization"));
    }

    @Test
    void testChatCompletionWithToolCalls() throws Exception {
        String mockResponseBody = """
                {
                    "id": "chatcmpl-456",
                    "choices": [{
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": null,
                            "tool_calls": [{
                                "id": "call_abc123",
                                "type": "function",
                                "function": {
                                    "name": "getServerTime",
                                    "arguments": "{\\"timezone\\":\\"Asia/Shanghai\\"}"
                                }
                            }]
                        },
                        "finish_reason": "tool_calls"
                    }]
                }
                """;

        mockServer.enqueue(new MockResponse()
                .setBody(mockResponseBody)
                .setHeader("Content-Type", "application/json"));

        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel("test");
        ChatCompletionRequest.Message msg = new ChatCompletionRequest.Message();
        msg.setRole("user");
        msg.setContent("现在几点了？");
        request.setMessages(List.of(msg));

        String baseUrl = mockServer.url("/api/v1").toString();
        ChatCompletionResponse response = openRouterClient.chatCompletion(baseUrl, "key", request);

        assertNotNull(response.getChoices().get(0).getMessage().getToolCalls());
        assertEquals(1, response.getChoices().get(0).getMessage().getToolCalls().size());
        assertEquals("getServerTime",
                response.getChoices().get(0).getMessage().getToolCalls().get(0).getFunction().getName());
        assertEquals("tool_calls", response.getChoices().get(0).getFinishReason());
    }

    @Test
    void testChatCompletionHttpError() {
        mockServer.enqueue(new MockResponse()
                .setResponseCode(401)
                .setBody("{\"error\":{\"message\":\"Invalid API key\"}}"));

        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel("test");
        ChatCompletionRequest.Message msg = new ChatCompletionRequest.Message();
        msg.setRole("user");
        msg.setContent("test");
        request.setMessages(List.of(msg));

        String baseUrl = mockServer.url("/api/v1").toString();
        assertThrows(RuntimeException.class, () ->
                openRouterClient.chatCompletion(baseUrl, "bad-key", request));
    }

    @Test
    void testUrlNormalization() throws Exception {
        mockServer.enqueue(new MockResponse()
                .setBody("{\"id\":\"1\",\"choices\":[{\"index\":0,\"message\":{\"role\":\"assistant\",\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}")
                .setHeader("Content-Type", "application/json"));

        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel("test");
        ChatCompletionRequest.Message msg = new ChatCompletionRequest.Message();
        msg.setRole("user");
        msg.setContent("test");
        request.setMessages(List.of(msg));

        // URL with trailing slash
        String baseUrl = mockServer.url("/api/v1/").toString();
        ChatCompletionResponse response = openRouterClient.chatCompletion(baseUrl, "key", request);
        assertNotNull(response);

        RecordedRequest recorded = mockServer.takeRequest();
        assertEquals("/api/v1/chat/completions", recorded.getPath());
    }

    @Test
    void testStreamChatCompletion() throws Exception {
        String sseBody = """
                data: {"id":"chatcmpl-stream","model":"qwen/qwen3-coder:free","choices":[{"index":0,"delta":{"role":"assistant","content":"你好"},"finish_reason":null}]}

                data: {"id":"chatcmpl-stream","model":"qwen/qwen3-coder:free","choices":[{"index":0,"delta":{"content":"，世界"},"finish_reason":"stop"}],"usage":{"total_tokens":21}}

                data: [DONE]

                """;

        mockServer.enqueue(new MockResponse()
                .setBody(sseBody)
                .setHeader("Content-Type", "text/event-stream"));

        ChatCompletionRequest request = new ChatCompletionRequest();
        request.setModel("qwen/qwen3-coder:free");
        ChatCompletionRequest.Message message = new ChatCompletionRequest.Message();
        message.setRole("user");
        message.setContent("你好");
        request.setMessages(List.of(message));

        List<String> deltas = new ArrayList<>();
        List<Integer> tokenUsages = new ArrayList<>();
        String baseUrl = mockServer.url("/api/v1").toString();
        openRouterClient.streamChatCompletion(baseUrl, "stream-key", request,
                chunk -> {
                    if (chunk.getChoices() != null && !chunk.getChoices().isEmpty()) {
                        String delta = chunk.getChoices().get(0).getDelta().getContent();
                        if (delta != null) {
                            deltas.add(delta);
                        }
                    }
                    if (chunk.getUsage() != null && chunk.getUsage().getTotalTokens() != null) {
                        tokenUsages.add(chunk.getUsage().getTotalTokens());
                    }
                });

        assertEquals(List.of("你好", "，世界"), deltas);
        assertEquals(List.of(21), tokenUsages);

        RecordedRequest recorded = mockServer.takeRequest();
        assertEquals("/api/v1/chat/completions", recorded.getPath());
        assertEquals("Bearer stream-key", recorded.getHeader("Authorization"));
    }
}
