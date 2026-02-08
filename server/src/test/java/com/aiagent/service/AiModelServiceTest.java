package com.aiagent.service;

import com.aiagent.dto.ModelRequest;
import com.aiagent.dto.ModelDiscoveryItemResponse;
import com.aiagent.dto.ModelResponse;
import com.aiagent.dto.ProviderRequest;
import com.aiagent.dto.ProviderResponse;
import com.aiagent.mapper.AiModelMapper;
import com.aiagent.mapper.ProviderMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class AiModelServiceTest {

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private ProviderService providerService;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private ProviderMapper providerMapper;

    private Long testProviderId;

    @BeforeEach
    void setUp() {
        // Clean up
        aiModelMapper.selectList(null).forEach(m -> aiModelMapper.deleteById(m.getId()));
        providerMapper.selectList(null).forEach(p -> providerMapper.deleteById(p.getId()));

        // Create a test provider
        ProviderRequest pReq = new ProviderRequest();
        pReq.setName("TestOpenRouter");
        pReq.setBaseUrl("https://openrouter.ai/api/v1");
        pReq.setApiKey("test-key");
        pReq.setEnabled(true);
        ProviderResponse provider = providerService.create(pReq);
        testProviderId = provider.getId();
    }

    @Test
    void testCreateModel() {
        ModelRequest req = createModelRequest("qwen/qwen3-coder:free", "Qwen3 Coder (Free)");
        ModelResponse resp = aiModelService.create(req);

        assertNotNull(resp.getId());
        assertEquals("qwen/qwen3-coder:free", resp.getModelKey());
        assertEquals("Qwen3 Coder (Free)", resp.getDisplayName());
        assertEquals(testProviderId, resp.getProviderId());
        assertTrue(resp.getEnabled());
    }

    @Test
    void testCreateModelWithCapabilities() {
        ModelRequest req = createModelRequest("openai/gpt-4", "GPT-4");
        req.setSupportsTools(true);
        req.setSupportsVision(true);
        req.setSupportsReasoning(true);
        req.setDefaultParams("{\"temperature\":0.7,\"max_tokens\":4096}");

        ModelResponse resp = aiModelService.create(req);

        assertTrue(resp.getSupportsTools());
        assertTrue(resp.getSupportsVision());
        assertTrue(resp.getSupportsReasoning());
        assertEquals("{\"temperature\":0.7,\"max_tokens\":4096}", resp.getDefaultParams());
    }

    @Test
    void testCreateModelWithInvalidProvider() {
        ModelRequest req = new ModelRequest();
        req.setProviderId(99999L);
        req.setModelKey("test");
        req.setDisplayName("Test");

        assertThrows(RuntimeException.class, () -> aiModelService.create(req));
    }

    @Test
    void testListAll() {
        createTestModel("model1", "Model 1");
        createTestModel("model2", "Model 2");

        List<ModelResponse> all = aiModelService.listAll();
        assertEquals(2, all.size());
    }

    @Test
    void testListEnabled() {
        ModelResponse m1 = createTestModel("model1", "Model 1");
        createTestModel("model2", "Model 2");

        aiModelService.toggleEnabled(m1.getId(), false);

        List<ModelResponse> enabled = aiModelService.listEnabled();
        assertEquals(1, enabled.size());
        assertEquals("Model 2", enabled.get(0).getDisplayName());
    }

    @Test
    void testGetById() {
        ModelResponse created = createTestModel("test-model", "Test Model");
        ModelResponse fetched = aiModelService.getById(created.getId());
        assertEquals("Test Model", fetched.getDisplayName());
        assertEquals("TestOpenRouter", fetched.getProviderName());
    }

    @Test
    void testGetByIdNotFound() {
        assertThrows(RuntimeException.class, () -> aiModelService.getById(99999L));
    }

    @Test
    void testUpdateModel() {
        ModelResponse created = createTestModel("original", "Original");

        ModelRequest updateReq = createModelRequest("updated-key", "Updated Name");
        updateReq.setSupportsTools(true);

        ModelResponse updated = aiModelService.update(created.getId(), updateReq);
        assertEquals("updated-key", updated.getModelKey());
        assertEquals("Updated Name", updated.getDisplayName());
        assertTrue(updated.getSupportsTools());
    }

    @Test
    void testToggleEnabled() {
        ModelResponse created = createTestModel("toggle", "Toggle");
        assertTrue(created.getEnabled());

        aiModelService.toggleEnabled(created.getId(), false);
        ModelResponse updated = aiModelService.getById(created.getId());
        assertFalse(updated.getEnabled());
        assertFalse(updated.getIsDefault());
    }

    @Test
    void testDefaultModelPriority() {
        ModelResponse first = createTestModel("model-first", "A First");
        ModelResponse second = createTestModel("model-second", "B Second");

        aiModelService.setDefault(second.getId(), true);

        Long preferredModelId = aiModelService.resolvePreferredEnabledModelId();
        assertEquals(second.getId(), preferredModelId);

        aiModelService.toggleEnabled(second.getId(), false);
        Long fallbackModelId = aiModelService.resolvePreferredEnabledModelId();
        assertEquals(first.getId(), fallbackModelId);
    }

    @Test
    void testDiscoverModelsWithOpenRouterAdapter() throws Exception {
        String responseBody = """
                {
                  "data": [
                    {
                      "id": "anthropic/claude-opus-4.6",
                      "name": "Anthropic: Claude Opus 4.6",
                      "context_length": 1000000,
                      "architecture": {
                        "modality": "text+image->text",
                        "input_modalities": ["text", "image"],
                        "output_modalities": ["text"]
                      },
                      "pricing": {
                        "prompt": "0.000005",
                        "completion": "0.000025",
                        "input_cache_read": "0.0000005",
                        "input_cache_write": "0.00000625"
                      },
                      "top_provider": {
                        "max_completion_tokens": 128000
                      },
                      "supported_parameters": [
                        "tools",
                        "tool_choice",
                        "reasoning",
                        "max_tokens"
                      ]
                    }
                  ]
                }
                """;

        HttpServer server = startModelServer(responseBody);
        try {
            ProviderRequest request = new ProviderRequest();
            request.setName("OpenRouter Local");
            request.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            request.setApiKey("local-test-key");
            request.setEnabled(true);
            ProviderResponse provider = providerService.create(request);

            List<ModelDiscoveryItemResponse> discovered = aiModelService.discoverModels(provider.getId());
            assertEquals(1, discovered.size());

            ModelDiscoveryItemResponse item = discovered.get(0);
            assertEquals("anthropic/claude-opus-4.6", item.getModelKey());
            assertEquals("Anthropic: Claude Opus 4.6", item.getDisplayName());
            assertTrue(item.getSupportsTools());
            assertTrue(item.getSupportsVision());
            assertTrue(item.getSupportsReasoning());
            assertEquals(1_000_000L, item.getContextWindowTokens());
            assertEquals(128_000L, item.getMaxCompletionTokens());
            assertEquals("0.000005", item.getInputPrice().toPlainString());
            assertEquals("0.000025", item.getOutputPrice().toPlainString());
            assertEquals("0.0000005", item.getCacheReadPrice().toPlainString());
            assertEquals("0.00000625", item.getCacheWritePrice().toPlainString());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void testDiscoverModelsWithOpenAiCompatibleAdapterFallback() throws Exception {
        String responseBody = """
                {
                  "data": [
                    { "id": "gpt-4.1-mini", "name": "GPT-4.1 Mini" },
                    { "id": "gpt-4.1-mini", "name": "GPT-4.1 Mini Duplicate" }
                  ]
                }
                """;

        HttpServer server = startModelServer(responseBody);
        try {
            ProviderRequest request = new ProviderRequest();
            request.setName("Generic Compatible");
            request.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            request.setApiKey("local-test-key");
            request.setEnabled(true);
            ProviderResponse provider = providerService.create(request);

            List<ModelDiscoveryItemResponse> discovered = aiModelService.discoverModels(provider.getId());
            assertEquals(1, discovered.size());

            ModelDiscoveryItemResponse item = discovered.get(0);
            assertEquals("gpt-4.1-mini", item.getModelKey());
            assertEquals("GPT-4.1 Mini", item.getDisplayName());
            assertFalse(item.getSupportsTools());
            assertFalse(item.getSupportsVision());
            assertFalse(item.getSupportsReasoning());
            assertNull(item.getContextWindowTokens());
            assertNull(item.getMaxCompletionTokens());
            assertNull(item.getInputPrice());
            assertNull(item.getOutputPrice());
            assertNull(item.getCacheReadPrice());
            assertNull(item.getCacheWritePrice());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void testDiscoverModelsParsesContextLengthWithKUnit() throws Exception {
        String responseBody = """
                {
                  "data": [
                    {
                      "id": "openai/o3-mini",
                      "name": "OpenAI: o3-mini",
                      "context_length": "200k",
                      "top_provider": {
                        "context_length": 2000,
                        "max_completion_tokens": 100000
                      },
                      "supported_parameters": ["reasoning", "tools"]
                    }
                  ]
                }
                """;

        HttpServer server = startModelServer(responseBody);
        try {
            ProviderRequest request = new ProviderRequest();
            request.setName("OpenRouter Local");
            request.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            request.setApiKey("local-test-key");
            request.setEnabled(true);
            ProviderResponse provider = providerService.create(request);

            List<ModelDiscoveryItemResponse> discovered = aiModelService.discoverModels(provider.getId());
            assertEquals(1, discovered.size());

            ModelDiscoveryItemResponse item = discovered.get(0);
            assertEquals("openai/o3-mini", item.getModelKey());
            assertEquals(200_000L, item.getContextWindowTokens());
            assertEquals(100_000L, item.getMaxCompletionTokens());
        } finally {
            server.stop(0);
        }
    }

    private ModelRequest createModelRequest(String key, String name) {
        ModelRequest req = new ModelRequest();
        req.setProviderId(testProviderId);
        req.setModelKey(key);
        req.setDisplayName(name);
        req.setIsDefault(false);
        req.setSupportsTools(false);
        req.setSupportsVision(false);
        req.setEnabled(true);
        return req;
    }

    private ModelResponse createTestModel(String key, String name) {
        return aiModelService.create(createModelRequest(key, name));
    }

    /**
     * 启动本地 mock /models 服务，模拟供应商模型目录接口返回。
     */
    private HttpServer startModelServer(String responseBody) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/models", exchange -> writeJson(exchange, responseBody));
        server.start();
        return server;
    }

    private void writeJson(HttpExchange exchange, String responseBody) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(405, -1);
            exchange.close();
            return;
        }

        byte[] bytes = responseBody.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(200, bytes.length);
        try (OutputStream outputStream = exchange.getResponseBody()) {
            outputStream.write(bytes);
        }
    }
}
