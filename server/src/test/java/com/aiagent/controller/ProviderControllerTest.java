package com.aiagent.controller;

import com.aiagent.dto.ProviderRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProviderControllerTest {

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

    @BeforeEach
    void setUp() {
        chatMessageMapper.selectList(null).forEach(m -> chatMessageMapper.deleteById(m.getId()));
        chatSessionMapper.selectList(null).forEach(s -> chatSessionMapper.deleteById(s.getId()));
        aiModelMapper.selectList(null).forEach(m -> aiModelMapper.deleteById(m.getId()));
        providerMapper.selectList(null).forEach(p -> providerMapper.deleteById(p.getId()));
    }

    @Test
    void testCreateProvider() throws Exception {
        ProviderRequest req = new ProviderRequest();
        req.setName("OpenRouter");
        req.setBaseUrl("https://openrouter.ai/api/v1");
        req.setApiKey("sk-test-123");

        mockMvc.perform(post("/api/providers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("OpenRouter"))
                .andExpect(jsonPath("$.data.apiKeySet").value(true))
                .andExpect(jsonPath("$.data.id").isNumber());
    }

    @Test
    void testCreateProviderValidation() throws Exception {
        ProviderRequest req = new ProviderRequest();
        // Missing required fields

        mockMvc.perform(post("/api/providers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void testListProviders() throws Exception {
        createProvider("Provider1");
        createProvider("Provider2");

        mockMvc.perform(get("/api/providers"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void testGetProvider() throws Exception {
        String body = createProvider("TestGet");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(get("/api/providers/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("TestGet"));
    }

    @Test
    void testUpdateProvider() throws Exception {
        String body = createProvider("Original");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        ProviderRequest updateReq = new ProviderRequest();
        updateReq.setName("Updated");
        updateReq.setBaseUrl("https://updated.com");
        updateReq.setEnabled(false);

        mockMvc.perform(put("/api/providers/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Updated"))
                .andExpect(jsonPath("$.data.enabled").value(false));
    }

    @Test
    void testToggleProvider() throws Exception {
        String body = createProvider("Toggle");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(patch("/api/providers/" + id + "/toggle")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":false}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        mockMvc.perform(get("/api/providers/" + id))
                .andExpect(jsonPath("$.data.enabled").value(false));
    }

    private String createProvider(String name) throws Exception {
        ProviderRequest req = new ProviderRequest();
        req.setName(name);
        req.setBaseUrl("https://api.test.com");
        req.setApiKey("test-key");

        return mockMvc.perform(post("/api/providers")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
