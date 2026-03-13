package com.aiagent.service;

import com.aiagent.service.tool.WebFetchTool;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.io.IOException;

import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@ActiveProfiles("test")
class WebFetchToolTest {

    @Autowired
    private WebFetchTool webFetchTool;

    private MockWebServer mockWebServer;

    @BeforeEach
    void setUp() throws IOException {
        mockWebServer = new MockWebServer();
        mockWebServer.start();
    }

    @AfterEach
    void tearDown() throws IOException {
        mockWebServer.shutdown();
    }

    @Test
    void testWebfetch_returnsHtmlTitleAndText() {
        mockWebServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "text/html; charset=utf-8")
                .setBody("""
                        <html>
                          <head>
                            <title>Open Zen 文档</title>
                          </head>
                          <body>
                            <main>
                              <h1>欢迎使用 Open Zen</h1>
                              <p>这是一个用于测试 webfetch 的页面。</p>
                            </main>
                          </body>
                        </html>
                        """));

        String result = webFetchTool.webfetch(mockWebServer.url("/docs").toString());

        assertTrue(result.contains("HTTP 状态: 200"));
        assertTrue(result.contains("标题: Open Zen 文档"));
        assertTrue(result.contains("欢迎使用 Open Zen"));
        assertTrue(result.contains("这是一个用于测试 webfetch 的页面。"));
    }

    @Test
    void testWebfetch_returnsPrettyJsonBody() {
        mockWebServer.enqueue(new MockResponse()
                .setHeader("Content-Type", "application/json")
                .setBody("""
                        {"name":"Open Zen","enabled":true,"tags":["chat","project"]}
                        """));

        String result = webFetchTool.webfetch(mockWebServer.url("/api/tool").toString());

        assertTrue(result.contains("HTTP 状态: 200"));
        assertTrue(result.contains("\"name\""));
        assertTrue(result.contains("Open Zen"));
        assertTrue(result.contains("\"enabled\""));
    }

    @Test
    void testWebfetch_rejectsUnsupportedScheme() {
        String result = webFetchTool.webfetch("file:///etc/hosts");

        assertTrue(result.contains("仅支持 http 或 https URL"));
    }
}
