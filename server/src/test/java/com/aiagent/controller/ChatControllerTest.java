package com.aiagent.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.aiagent.entity.ChatMessage;
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

import java.time.LocalDateTime;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private ChatSessionMapper chatSessionMapper;

    @Autowired
    private ChatMessageMapper chatMessageMapper;

    @Autowired
    private AiModelMapper aiModelMapper;

    @Autowired
    private ProviderMapper providerMapper;

    @BeforeEach
    void setUp() {
        chatMessageMapper.selectList(null).forEach(m -> chatMessageMapper.deleteById(m.getId()));
        chatSessionMapper.selectList(null).forEach(s -> chatSessionMapper.deleteById(s.getId()));
        aiModelMapper.selectList(null).forEach(m -> aiModelMapper.deleteById(m.getId()));
        providerMapper.selectList(null).forEach(p -> providerMapper.deleteById(p.getId()));
    }

    @Test
    void testCreateSession() throws Exception {
        mockMvc.perform(post("/api/chat/sessions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"测试会话\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("测试会话"))
                .andExpect(jsonPath("$.data.id").isNumber());
    }

    @Test
    void testCreateSessionDefaultTitle() throws Exception {
        mockMvc.perform(post("/api/chat/sessions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("新会话"));
    }

    @Test
    void testListSessions() throws Exception {
        createSession("会话1");
        createSession("会话2");

        mockMvc.perform(get("/api/chat/sessions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void testListTools_shouldIncludeWebfetchAndExcludeProjectOnlyTools() throws Exception {
        String body = mockMvc.perform(get("/api/chat/tools"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertTrue(body.contains("\"name\":\"webfetch\""));
        assertFalse(body.contains("\"name\":\"read\""));
    }

    @Test
    void testGetSession() throws Exception {
        String body = createSession("获取测试");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(get("/api/chat/sessions/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("获取测试"));
    }

    @Test
    void testDeleteSession() throws Exception {
        String body = createSession("删除测试");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(delete("/api/chat/sessions/" + id))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/chat/sessions/" + id))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testUpdateSessionTitle() throws Exception {
        String body = createSession("原标题");
        Long id = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(patch("/api/chat/sessions/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"新标题\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/chat/sessions/" + id))
                .andExpect(jsonPath("$.data.title").value("新标题"));
    }

    @Test
    void testGetMessages() throws Exception {
        String body = createSession("消息测试");
        Long sessionId = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(get("/api/chat/sessions/" + sessionId + "/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    void testGetSessionContextStats() throws Exception {
        String body = createSession("上下文统计测试");
        Long sessionId = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(get("/api/chat/sessions/" + sessionId + "/context"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.sessionId").value(sessionId))
                .andExpect(jsonPath("$.data.contextUsedTokens").isNumber())
                .andExpect(jsonPath("$.data.contextWindowTokens").isNumber())
                .andExpect(jsonPath("$.data.contextUsageRatio").isNumber());
    }

    @Test
    void testCopySession() throws Exception {
        String body = createSession("复制源会话");
        Long sessionId = objectMapper.readTree(body).path("data").path("id").asLong();

        mockMvc.perform(post("/api/chat/sessions/" + sessionId + "/copy")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"复制后的会话\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("复制后的会话"))
                .andExpect(jsonPath("$.data.parentSessionId").value(sessionId));
    }

    @Test
    void testBranchSessionAndDeleteMessage() throws Exception {
        String body = createSession("分支源会话");
        Long sessionId = objectMapper.readTree(body).path("data").path("id").asLong();

        ChatMessage message = new ChatMessage();
        message.setSessionId(sessionId);
        message.setRole("user");
        message.setContent("第一条消息");
        message.setCreatedAt(LocalDateTime.now());
        chatMessageMapper.insert(message);

        mockMvc.perform(post("/api/chat/sessions/" + sessionId + "/branch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"messageId\":" + message.getId() + ",\"title\":\"分支会话\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.title").value("分支会话"))
                .andExpect(jsonPath("$.data.parentSessionId").value(sessionId))
                .andExpect(jsonPath("$.data.parentMessageId").value(message.getId()));

        mockMvc.perform(delete("/api/chat/sessions/" + sessionId + "/messages/" + message.getId()))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/chat/sessions/" + sessionId + "/messages"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    private String createSession(String title) throws Exception {
        return mockMvc.perform(post("/api/chat/sessions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"" + title + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
    }
}
