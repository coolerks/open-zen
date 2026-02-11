package com.aiagent.controller;

import com.aiagent.dto.AppCenterItemCreateRequest;
import com.aiagent.dto.AppCenterItemUpdateRequest;
import com.aiagent.mapper.AppCenterItemMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
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
class AppCenterControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private AppCenterItemMapper appCenterItemMapper;

    @BeforeEach
    void setUp() {
        appCenterItemMapper.delete(null);
    }

    @Test
    void testCreateAndListAndDuplicate() throws Exception {
        AppCenterItemCreateRequest request = new AppCenterItemCreateRequest();
        request.setName("Open Zen Demo");
        request.setSourceKey("msg-200-block-1");
        request.setSourceSessionId(88L);
        request.setSourceSessionTitle("架构讨论");
        request.setSourceMessageId(99L);
        request.setSourceModelId(11L);
        request.setSourceModelName("o3-mini");
        request.setLanguage("html");
        request.setCodeContent("<html><body>demo</body></html>");

        mockMvc.perform(post("/api/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Open Zen Demo"))
                .andExpect(jsonPath("$.data.sourceSessionId").value(88))
                .andExpect(jsonPath("$.data.sourceModelName").value("o3-mini"));

        mockMvc.perform(get("/api/apps"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(1));

        mockMvc.perform(post("/api/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("该代码块已添加到应用中心"));
    }

    @Test
    void testUpdateAndDelete() throws Exception {
        AppCenterItemCreateRequest request = new AppCenterItemCreateRequest();
        request.setName("待更新应用");
        request.setSourceKey("msg-201-block-2");
        request.setLanguage("html");
        request.setCodeContent("<html><body>before</body></html>");

        String response = mockMvc.perform(post("/api/apps")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();

        long id = objectMapper.readTree(response).path("data").path("id").asLong();

        AppCenterItemUpdateRequest updateRequest = new AppCenterItemUpdateRequest();
        updateRequest.setName("更新后应用");
        updateRequest.setIconType("emoji");
        updateRequest.setIconValue("🧩");

        mockMvc.perform(put("/api/apps/" + id)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateRequest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("更新后应用"))
                .andExpect(jsonPath("$.data.iconType").value("emoji"));

        mockMvc.perform(delete("/api/apps/" + id))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/apps"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }
}
