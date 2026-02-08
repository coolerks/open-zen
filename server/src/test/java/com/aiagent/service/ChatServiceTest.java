package com.aiagent.service;

import com.aiagent.entity.ChatMessage;
import com.aiagent.entity.ChatSession;
import com.aiagent.mapper.ChatMessageMapper;
import com.aiagent.mapper.ChatSessionMapper;
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
}
