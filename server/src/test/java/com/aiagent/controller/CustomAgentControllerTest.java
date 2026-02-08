package com.aiagent.controller;

import com.aiagent.dto.AgentRequest;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.aiagent.mapper.CustomAgentMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CustomAgentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private CustomAgentMapper customAgentMapper;

    @Autowired
    private ChatSessionMapper chatSessionMapper;

    @Autowired
    private ChatMessageMapper chatMessageMapper;

    @BeforeEach
    void setUp() {
        // 先清理消息和会话，避免删除智能体时触发外键约束异常
        chatMessageMapper.selectList(null).forEach(message -> chatMessageMapper.deleteById(message.getId()));
        chatSessionMapper.selectList(null).forEach(session -> chatSessionMapper.deleteById(session.getId()));
        customAgentMapper.selectList(null).forEach(agent -> customAgentMapper.deleteById(agent.getId()));
    }

    @Test
    void testCreateAndList() throws Exception {
        AgentRequest request = new AgentRequest();
        request.setName("代码助手");
        request.setDescription("desc");
        request.setSystemPrompt("你是代码助手");
        request.setEnabled(true);

        mockMvc.perform(post("/api/agents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("代码助手"));

        mockMvc.perform(get("/api/agents"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));
    }

    @Test
    void testUpdateToggleDelete() throws Exception {
        Long id = createAgent("测试智能体");

        AgentRequest update = new AgentRequest();
        update.setName("更新后智能体");
        update.setDescription("new");
        update.setSystemPrompt("new prompt");
        update.setEnabled(true);

        mockMvc.perform(put("/api/agents/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(update)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("更新后智能体"));

        mockMvc.perform(patch("/api/agents/" + id + "/toggle")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enabled\":false}"))
                .andExpect(status().isOk());

        mockMvc.perform(delete("/api/agents/" + id))
                .andExpect(status().isOk());
    }

    @Test
    void testDefaultAgentCannotDelete() throws Exception {
        String listBody = mockMvc.perform(get("/api/agents"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        JsonNode dataNode = objectMapper.readTree(listBody).path("data");
        Long defaultAgentId = -1L;
        if (dataNode.isArray()) {
            for (JsonNode agentNode : dataNode) {
                if (agentNode.path("isDefault").asBoolean(false)) {
                    defaultAgentId = agentNode.path("id").asLong(-1L);
                    break;
                }
            }
        }

        if (defaultAgentId <= 0) {
            throw new IllegalStateException("默认智能体未初始化");
        }

        mockMvc.perform(delete("/api/agents/" + defaultAgentId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("默认智能体不允许删除"));
    }

    private Long createAgent(String name) throws Exception {
        AgentRequest request = new AgentRequest();
        request.setName(name);
        request.setSystemPrompt("prompt");
        request.setEnabled(true);

        String body = mockMvc.perform(post("/api/agents")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        return objectMapper.readTree(body).path("data").path("id").asLong();
    }
}
