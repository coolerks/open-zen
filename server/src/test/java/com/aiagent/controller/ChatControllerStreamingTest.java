package com.aiagent.controller;

import com.aiagent.service.ChatService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ChatControllerStreamingTest {

    @Autowired
    private MockMvc mockMvc;

    @MockBean
    private ChatService chatService;

    @Test
    void testStreamApproveToolCall_shouldDelegateToStreamingService() throws Exception {
        SseEmitter emitter = new SseEmitter();
        emitter.complete();
        when(chatService.streamToolApproval(12L, 34L, true, 9)).thenReturn(emitter);

        mockMvc.perform(post("/api/chat/sessions/12/tool-approval/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "assistantMessageId": 34,
                                  "approved": true,
                                  "maxToolRounds": 9
                                }
                                """))
                .andExpect(request().asyncStarted());

        verify(chatService).streamToolApproval(12L, 34L, true, 9);
    }
}
