package com.aiagent.service;

import com.aiagent.dto.AppCenterItemCreateRequest;
import com.aiagent.dto.AppCenterItemResponse;
import com.aiagent.dto.AppCenterItemUpdateRequest;
import com.aiagent.mapper.AppCenterItemMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("test")
class AppCenterServiceTest {

    @Autowired
    private AppCenterService appCenterService;

    @Autowired
    private AppCenterItemMapper appCenterItemMapper;

    @BeforeEach
    void setUp() {
        appCenterItemMapper.delete(null);
    }

    @Test
    void testCreateAndList() {
        AppCenterItemCreateRequest request = new AppCenterItemCreateRequest();
        request.setName("可视化看板");
        request.setIconType("emoji");
        request.setIconValue("📊");
        request.setSourceKey("msg-100-block-1");
        request.setSourceSessionId(12L);
        request.setSourceSessionTitle("测试会话");
        request.setSourceMessageId(34L);
        request.setSourceModelId(56L);
        request.setSourceModelName("deepseek-r1");
        request.setLanguage("html");
        request.setCodeContent("<html><body>dashboard</body></html>");

        AppCenterItemResponse created = appCenterService.create(request);
        assertNotNull(created.getId());
        assertEquals("可视化看板", created.getName());

        List<AppCenterItemResponse> list = appCenterService.listAll();
        assertEquals(1, list.size());
        assertEquals(created.getId(), list.get(0).getId());
        assertEquals("📊", list.get(0).getIconValue());
        assertEquals(12L, list.get(0).getSourceSessionId());
        assertEquals("测试会话", list.get(0).getSourceSessionTitle());
        assertEquals(34L, list.get(0).getSourceMessageId());
        assertEquals(56L, list.get(0).getSourceModelId());
        assertEquals("deepseek-r1", list.get(0).getSourceModelName());
    }

    @Test
    void testDuplicateSourceKeyNotAllowed() {
        AppCenterItemCreateRequest request = new AppCenterItemCreateRequest();
        request.setName("页面一");
        request.setSourceKey("msg-101-block-1");
        request.setLanguage("html");
        request.setCodeContent("<html>first</html>");

        appCenterService.create(request);

        AppCenterItemCreateRequest duplicateRequest = new AppCenterItemCreateRequest();
        duplicateRequest.setName("页面二");
        duplicateRequest.setSourceKey("msg-101-block-1");
        duplicateRequest.setLanguage("html");
        duplicateRequest.setCodeContent("<html>second</html>");

        RuntimeException exception = assertThrows(RuntimeException.class, () -> appCenterService.create(duplicateRequest));
        assertEquals("该代码块已添加到应用中心", exception.getMessage());
    }

    @Test
    void testUpdateAndDelete() {
        AppCenterItemCreateRequest request = new AppCenterItemCreateRequest();
        request.setName("初始应用");
        request.setSourceKey("msg-102-block-2");
        request.setLanguage("html");
        request.setCodeContent("<html>init</html>");

        AppCenterItemResponse created = appCenterService.create(request);

        AppCenterItemUpdateRequest updateRequest = new AppCenterItemUpdateRequest();
        updateRequest.setName("更新应用");
        updateRequest.setIconType("emoji");
        updateRequest.setIconValue("🚀");

        AppCenterItemResponse updated = appCenterService.update(created.getId(), updateRequest);
        assertEquals("更新应用", updated.getName());
        assertEquals("emoji", updated.getIconType());
        assertEquals("🚀", updated.getIconValue());

        appCenterService.delete(created.getId());
        assertTrue(appCenterService.listAll().isEmpty());
    }
}
