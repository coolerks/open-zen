package com.aiagent.service;

import com.aiagent.dto.openrouter.ChatCompletionRequest;
import com.aiagent.entity.ChatMessage;
import com.aiagent.entity.ChatSession;
import com.aiagent.entity.CustomAgent;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDateTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class ChatServiceTest {

    @Autowired
    private ChatService chatService;

    @Autowired
    private ChatSessionMapper sessionMapper;

    @Autowired
    private ChatMessageMapper messageMapper;

    @Autowired
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        messageMapper.selectList(null).forEach(m -> messageMapper.deleteById(m.getId()));
        sessionMapper.selectList(null).forEach(s -> sessionMapper.deleteById(s.getId()));
    }

    @Test
    void testCreateSession() {
        ChatSession session = chatService.createSession("测试会话");
        assertNotNull(session.getId());
        assertEquals("测试会话", session.getTitle());
    }

    @Test
    void testCreateSessionWithDefaultTitle() {
        ChatSession session = chatService.createSession(null);
        assertEquals("新会话", session.getTitle());
    }

    @Test
    void testListSessions() {
        chatService.createSession("会话1");
        chatService.createSession("会话2");

        List<ChatSession> sessions = chatService.listSessions();
        assertEquals(2, sessions.size());
    }

    @Test
    void testGetSession() {
        ChatSession created = chatService.createSession("获取测试");
        ChatSession fetched = chatService.getSession(created.getId());
        assertEquals("获取测试", fetched.getTitle());
    }

    @Test
    void testGetSessionNotFound() {
        assertThrows(RuntimeException.class, () -> chatService.getSession(99999L));
    }

    @Test
    void testUpdateSessionTitle() {
        ChatSession session = chatService.createSession("原标题");
        chatService.updateSessionTitle(session.getId(), "新标题");

        ChatSession updated = chatService.getSession(session.getId());
        assertEquals("新标题", updated.getTitle());
    }

    @Test
    void testDeleteSession() {
        ChatSession session = chatService.createSession("删除测试");
        Long id = session.getId();

        chatService.deleteSession(id);
        assertThrows(RuntimeException.class, () -> chatService.getSession(id));
    }

    @Test
    void testGetMessagesEmpty() {
        ChatSession session = chatService.createSession("空消息");
        List<ChatMessage> messages = chatService.getMessages(session.getId());
        assertTrue(messages.isEmpty());
    }

    @Test
    void testCopySession() {
        ChatSession source = chatService.createSession("源会话");
        ChatMessage message = new ChatMessage();
        message.setSessionId(source.getId());
        message.setRole("user");
        message.setContent("hello");
        message.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(message);

        ChatSession copied = chatService.copySession(source.getId(), "源会话副本");
        assertNotNull(copied.getId());
        assertEquals("源会话副本", copied.getTitle());
        assertEquals(source.getId(), copied.getParentSessionId());
        assertEquals(1, chatService.getMessages(copied.getId()).size());
    }

    @Test
    void testCopySessionShouldKeepAgentSnapshot() {
        ChatSession source = chatService.createSession("快照源会话");
        ChatMessage message = new ChatMessage();
        message.setSessionId(source.getId());
        message.setRole("assistant");
        message.setContent("你好");
        message.setAgentId(123L);
        message.setAgentName("数学老师");
        message.setAgentAvatarType("emoji");
        message.setAgentAvatarValue("math-emoji");
        message.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(message);

        ChatSession copied = chatService.copySession(source.getId(), "快照副本");
        List<ChatMessage> copiedMessages = chatService.getMessages(copied.getId());
        assertEquals(1, copiedMessages.size());

        ChatMessage copiedMessage = copiedMessages.get(0);
        assertEquals(123L, copiedMessage.getAgentId());
        assertEquals("数学老师", copiedMessage.getAgentName());
        assertEquals("emoji", copiedMessage.getAgentAvatarType());
        assertEquals("math-emoji", copiedMessage.getAgentAvatarValue());
    }

    @Test
    void testBranchSessionAndDeleteMessage() {
        ChatSession source = chatService.createSession("分支源会话");
        ChatMessage message = new ChatMessage();
        message.setSessionId(source.getId());
        message.setRole("user");
        message.setContent("hello");
        message.setCreatedAt(LocalDateTime.now());
        messageMapper.insert(message);

        ChatSession branched = chatService.branchSession(source.getId(), message.getId(), "分支");
        assertEquals(source.getId(), branched.getParentSessionId());
        assertEquals(message.getId(), branched.getParentMessageId());

        chatService.deleteMessage(source.getId(), message.getId());
        assertTrue(chatService.getMessages(source.getId()).isEmpty());
    }

    @Test
    void testBuildSystemPrompt_projectChatShouldAppendProjectInstructions() {
        CustomAgent agent = new CustomAgent();
        agent.setEnabled(true);
        agent.setSystemPrompt("你是一个代码助手");

        String prompt = chatService.buildSystemPrompt(agent, true);

        assertNotNull(prompt);
        assertTrue(prompt.contains("你是一个代码助手"));
        assertTrue(prompt.contains("项目聊天模式"));
        assertTrue(prompt.contains("继续调用项目工具"));
    }

    @Test
    void testShouldContinueProjectToolLoop_returnsTrueForProjectPlanningText() {
        boolean shouldContinue = chatService.shouldContinueProjectToolLoop(
                true,
                true,
                "现在让我读取代码文件并继续统计不同文件类型的代码行数。",
                true,
                0,
                1,
                100
        );

        assertTrue(shouldContinue);
    }

    @Test
    void testShouldContinueProjectToolLoop_returnsFalseForNormalAnswer() {
        boolean shouldContinue = chatService.shouldContinueProjectToolLoop(
                true,
                true,
                "统计完成：前端 1200 行，后端 980 行。",
                true,
                0,
                1,
                100
        );

        assertFalse(shouldContinue);
    }

    @Test
    void testShouldRecoverProjectPseudoToolOutput_returnsTrueForLiteralToolCallText() {
        boolean shouldRecover = chatService.shouldRecoverProjectPseudoToolOutput(
                true,
                true,
                "<tool_call> 匹配模式: **/*.vue 起始目录: . 命中数量: 2\nfile web/src/App.vue </tool_call>",
                2,
                100
        );

        assertTrue(shouldRecover);
    }

    @Test
    void testShouldRecoverProjectPseudoToolOutput_returnsFalseForNormalAssistantAnswer() {
        boolean shouldRecover = chatService.shouldRecoverProjectPseudoToolOutput(
                true,
                true,
                "统计完成：前端 Vue 代码 1280 行，后端 Java 代码 2310 行。",
                2,
                100
        );

        assertFalse(shouldRecover);
    }

    @Test
    void testDeserializeHistoricalToolCalls_shouldIgnoreResponseOnlyFields() throws Exception {
        String storedToolCalls = """
                [
                  {
                    "index": 0,
                    "id": "call_123",
                    "type": "function",
                    "function": {
                      "name": "list",
                      "arguments": "{\\"path\\":\\".\\"}"
                    }
                  }
                ]
                """;

        List<ChatCompletionRequest.ToolCall> toolCalls = objectMapper.readValue(
                storedToolCalls,
                new TypeReference<List<ChatCompletionRequest.ToolCall>>() {
                }
        );

        assertEquals(1, toolCalls.size());
        assertEquals("call_123", toolCalls.getFirst().getId());
        assertEquals("list", toolCalls.getFirst().getFunction().getName());
        assertEquals("{\"path\":\".\"}", toolCalls.getFirst().getFunction().getArguments());
    }
}
