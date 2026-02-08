package com.aiagent.service;

import com.aiagent.dto.AgentRequest;
import com.aiagent.dto.AgentResponse;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.aiagent.mapper.CustomAgentMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class CustomAgentServiceTest {

    @Autowired
    private CustomAgentService customAgentService;

    @Autowired
    private CustomAgentMapper customAgentMapper;

    @Autowired
    private ChatSessionMapper chatSessionMapper;

    @Autowired
    private ChatMessageMapper chatMessageMapper;

    @BeforeEach
    void setUp() {
        // 先清理消息和会话，避免会话引用智能体导致外键删除失败
        chatMessageMapper.selectList(null).forEach(message -> chatMessageMapper.deleteById(message.getId()));
        chatSessionMapper.selectList(null).forEach(session -> chatSessionMapper.deleteById(session.getId()));
        customAgentMapper.selectList(null).forEach(agent -> customAgentMapper.deleteById(agent.getId()));
    }

    @Test
    void testCreateAndGet() {
        AgentRequest request = new AgentRequest();
        request.setName("代码助手");
        request.setDescription("用于代码讲解");
        request.setSystemPrompt("你是代码专家。");
        request.setEnabled(true);

        AgentResponse created = customAgentService.create(request);
        assertNotNull(created.getId());

        AgentResponse fetched = customAgentService.getById(created.getId());
        assertEquals("代码助手", fetched.getName());
        assertEquals("你是代码专家。", fetched.getSystemPrompt());
    }

    @Test
    void testUpdateAndToggle() {
        AgentRequest create = new AgentRequest();
        create.setName("默认助手");
        create.setSystemPrompt("默认提示词");
        create.setEnabled(true);

        AgentResponse created = customAgentService.create(create);

        AgentRequest update = new AgentRequest();
        update.setName("新助手");
        update.setDescription("新描述");
        update.setSystemPrompt("新提示词");
        update.setEnabled(true);

        AgentResponse updated = customAgentService.update(created.getId(), update);
        assertEquals("新助手", updated.getName());

        customAgentService.toggleEnabled(created.getId(), false);
        AgentResponse toggled = customAgentService.getById(created.getId());
        assertFalse(toggled.getEnabled());
    }

    @Test
    void testListEnabled() {
        AgentRequest enabledAgent = new AgentRequest();
        enabledAgent.setName("启用智能体");
        enabledAgent.setSystemPrompt("test");
        enabledAgent.setEnabled(true);
        customAgentService.create(enabledAgent);

        AgentRequest disabledAgent = new AgentRequest();
        disabledAgent.setName("禁用智能体");
        disabledAgent.setSystemPrompt("test");
        disabledAgent.setEnabled(false);
        customAgentService.create(disabledAgent);

        List<AgentResponse> list = customAgentService.listEnabled();
        assertEquals(2, list.size());
        assertEquals("默认", list.get(0).getName());
        assertTrue(list.stream().anyMatch(item -> "启用智能体".equals(item.getName())));
    }

    @Test
    void testDefaultAgentCannotDeleteOrDisable() {
        AgentResponse defaultAgent = customAgentService.listAll().stream()
                .filter(AgentResponse::getIsDefault)
                .findFirst()
                .orElseThrow();

        RuntimeException disableException = assertThrows(
                RuntimeException.class,
                () -> customAgentService.toggleEnabled(defaultAgent.getId(), false)
        );
        assertEquals("默认智能体不允许禁用", disableException.getMessage());

        RuntimeException deleteException = assertThrows(
                RuntimeException.class,
                () -> customAgentService.delete(defaultAgent.getId())
        );
        assertEquals("默认智能体不允许删除", deleteException.getMessage());
    }

    @Test
    void testReservedDefaultNameNotAllowedForCustomAgent() {
        AgentRequest request = new AgentRequest();
        request.setName("默认");
        request.setSystemPrompt("test");
        request.setEnabled(true);

        RuntimeException exception = assertThrows(
                RuntimeException.class,
                () -> customAgentService.create(request)
        );
        assertEquals("名称“默认”为系统保留名称，请使用其他名称", exception.getMessage());
    }
}
