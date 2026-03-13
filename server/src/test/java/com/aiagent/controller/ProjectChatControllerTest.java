package com.aiagent.controller;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ProjectChatControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void testListTools_shouldIncludeWebfetchForProjectChat() throws Exception {
        String body = mockMvc.perform(get("/api/projects/demo-project/chat/tools"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        assertTrue(body.contains("\"name\":\"webfetch\""));
        assertTrue(body.contains("\"name\":\"read\""));
    }
}
