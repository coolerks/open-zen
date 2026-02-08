package com.aiagent.controller;

import com.aiagent.dto.ModelRequest;
import com.aiagent.dto.ProviderRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import com.aiagent.mapper.AiModelMapper;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.aiagent.mapper.ProviderMapper;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AiModelControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ProviderMapper providerMapper;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private ChatMessageMapper chatMessageMapper;

    @Autowired
    private ChatSessionMapper chatSessionMapper;

    private Long testProviderId;

    @BeforeEach
    void setUp() throws Exception {
        chatMessageMapper.selectList(null).forEach(m -> chatMessageMapper.deleteById(m.getId()));
        chatSessionMapper.selectList(null).forEach(s -> chatSessionMapper.deleteById(s.getId()));
        aiModelMapper.selectList(null).forEach(m -> aiModelMapper.deleteById(m.getId()));
        providerMapper.selectList(null).forEach(p -> providerMapper.deleteById(p.getId()));

        // Create a test provider
        ProviderRequest pReq = new ProviderRequest();
        pReq.setName("TestProvider");
        pReq.setBaseUrl("https://api.test.com");
        pReq.setApiKey("test-key");

        String response = mockMvc.perform(post("/api/providers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(pReq)))
                .andReturn().getResponse().getContentAsString();
        testProviderId = objectMapper.readTree(response).path("data").path("id").asLong();
    }

    @Test
    void testCreateModel() throws Exception {
        ModelRequest req = new ModelRequest();
        req.setProviderId(testProviderId);
        req.setModelKey("qwen/qwen3-coder:free");
        req.setDisplayName("Qwen3 Coder");
        req.setSupportsTools(true);

        mockMvc.perform(post("/api/models")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.modelKey").value("qwen/qwen3-coder:free"))
                .andExpect(jsonPath("$.data.displayName").value("Qwen3 Coder"))
                .andExpect(jsonPath("$.data.supportsTools").value(true));
    }

    @Test
    void testCreateModelValidation() throws Exception {
        ModelRequest req = new ModelRequest();
        // Missing required fields

        mockMvc.perform(post("/api/models")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testListModels() throws Exception {
        createModel("model1", "Model 1");
        createModel("model2", "Model 2");

        mockMvc.perform(get("/api/models"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void testListEnabledModels() throws Exception {
        String body1 = createModel("model1", "Model 1");
        createModel("model2", "Model 2");
        Long id1 = objectMapper.readTree(body1).path("data").path("id").asLong();

        // Disable first model
        mockMvc.perform(patch("/api/models/" + id1 + "/toggle")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"enabled\":false}"));

        mockMvc.perform(get("/api/models/enabled"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1));
    }

    @Test
    void testUpdateModel() throws Exception {
        String body = createModel("original", "Original");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        ModelRequest updateReq = new ModelRequest();
        updateReq.setProviderId(testProviderId);
        updateReq.setModelKey("updated-key");
        updateReq.setDisplayName("Updated");
        updateReq.setSupportsTools(true);
        updateReq.setSupportsVision(true);
        updateReq.setSupportsReasoning(true);

        mockMvc.perform(put("/api/models/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.modelKey").value("updated-key"))
                .andExpect(jsonPath("$.data.supportsTools").value(true))
                .andExpect(jsonPath("$.data.supportsVision").value(true))
                .andExpect(jsonPath("$.data.supportsReasoning").value(true));
    }

    @Test
    void testSetDefaultModel() throws Exception {
        String body1 = createModel("model1", "Model 1");
        String body2 = createModel("model2", "Model 2");

        Long id1 = objectMapper.readTree(body1).path("data").path("id").asLong();
        Long id2 = objectMapper.readTree(body2).path("data").path("id").asLong();

        mockMvc.perform(patch("/api/models/" + id2 + "/default")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isDefault\":true}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/models/" + id2))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.isDefault").value(true));

        mockMvc.perform(get("/api/models/" + id1))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.isDefault").value(false));
    }

    @Test
    void testDiscoverModelsEndpoint() throws Exception {
        String responseBody = """
                {
                  "data": [
                    {
                      "id": "qwen/qwen3-coder",
                      "name": "Qwen3 Coder"
                    }
                  ]
                }
                """;

        HttpServer server = startModelServer(responseBody);
        try {
            ProviderRequest request = new ProviderRequest();
            request.setName("Compatible Provider");
            request.setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            request.setApiKey("test-key");
            request.setEnabled(true);

            String providerResponse = mockMvc.perform(post("/api/providers")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(objectMapper.writeValueAsString(request)))
                    .andExpect(status().isOk())
                    .andReturn().getResponse().getContentAsString();

            Long providerId = objectMapper.readTree(providerResponse).path("data").path("id").asLong();

            mockMvc.perform(get("/api/models/discover").param("providerId", String.valueOf(providerId)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.length()").value(1))
                    .andExpect(jsonPath("$.data[0].modelKey").value("qwen/qwen3-coder"))
                    .andExpect(jsonPath("$.data[0].displayName").value("Qwen3 Coder"));
        } finally {
            server.stop(0);
        }
    }

    private String createModel(String key, String name) throws Exception {
        ModelRequest req = new ModelRequest();
        req.setProviderId(testProviderId);
        req.setModelKey(key);
        req.setDisplayName(name);

        return mockMvc.perform(post("/api/models")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }

    /**
     * 启动本地 mock /models 服务，便于接口测试稳定复现。
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
