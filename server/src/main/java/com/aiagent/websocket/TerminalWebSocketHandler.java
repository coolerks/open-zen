package com.aiagent.websocket;

import com.aiagent.service.TerminalService;
import com.aiagent.service.TerminalService.TerminalSession;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Component
public class TerminalWebSocketHandler extends TextWebSocketHandler {

    private final TerminalService terminalService;
    private final ObjectMapper objectMapper;
    private final ExecutorService executorService;
    private final Map<String, WebSocketSession> sessionMap = new ConcurrentHashMap<>();

    public TerminalWebSocketHandler(TerminalService terminalService, ObjectMapper objectMapper) {
        this.terminalService = terminalService;
        this.objectMapper = objectMapper;
        this.executorService = Executors.newCachedThreadPool();
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        String terminalId = extractTerminalId(session);
        String cwd = extractCwd(session);

        if (terminalId == null) {
            log.error("No terminal ID found in WebSocket path");
            session.close(CloseStatus.BAD_DATA);
            return;
        }

        if (cwd == null || cwd.isEmpty()) {
            cwd = System.getProperty("user.home");
        }

        log.info("WebSocket connection established for terminal: {}", terminalId);
        sessionMap.put(terminalId, session);

        try {
            // Create terminal session
            TerminalSession terminalSession = terminalService.createSession(terminalId, cwd);

            // Start reading from terminal output and sending to WebSocket
            executorService.submit(() -> readTerminalOutput(terminalId, terminalSession, session));

        } catch (Exception e) {
            log.error("Failed to create terminal session: {}", terminalId, e);
            session.sendMessage(new TextMessage("Failed to create terminal: " + e.getMessage()));
            session.close(CloseStatus.SERVER_ERROR);
        }
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String terminalId = extractTerminalId(session);
        if (terminalId == null) {
            return;
        }

        TerminalSession terminalSession = terminalService.getSession(terminalId);
        if (terminalSession == null || terminalSession.isClosed()) {
            log.warn("Terminal session not found or closed: {}", terminalId);
            return;
        }

        try {
            // Parse message JSON
            JsonNode jsonNode = objectMapper.readTree(message.getPayload());
            String type = jsonNode.get("type").asText();

            if ("input".equals(type)) {
                // User input - send to terminal
                String data = jsonNode.get("data").asText();
                OutputStream outputStream = terminalSession.getOutputStream();
                outputStream.write(data.getBytes(StandardCharsets.UTF_8));
                outputStream.flush();
            } else if ("resize".equals(type)) {
                // Terminal resize
                int cols = jsonNode.get("cols").asInt();
                int rows = jsonNode.get("rows").asInt();
                terminalSession.resize(cols, rows);
                log.debug("Terminal {} resized to {}x{}", terminalId, cols, rows);
            }
        } catch (Exception e) {
            log.error("Error handling message for terminal: {}", terminalId, e);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        String terminalId = extractTerminalId(session);
        if (terminalId == null) {
            return;
        }

        log.info("WebSocket connection closed for terminal: {} with status: {}", terminalId, status);
        sessionMap.remove(terminalId);

        // Close and cleanup terminal session
        terminalService.closeSession(terminalId);
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        String terminalId = extractTerminalId(session);
        log.error("WebSocket transport error for terminal: {}", terminalId, exception);

        if (terminalId != null) {
            terminalService.closeSession(terminalId);
            sessionMap.remove(terminalId);
        }
    }

    private void readTerminalOutput(String terminalId, TerminalSession terminalSession, WebSocketSession webSocketSession) {
        try {
            InputStream inputStream = terminalSession.getInputStream();
            byte[] buffer = new byte[8192];
            int bytesRead;

            while (!terminalSession.isClosed() && webSocketSession.isOpen()) {
                bytesRead = inputStream.read(buffer);
                if (bytesRead == -1) {
                    // End of stream
                    break;
                }

                if (bytesRead > 0) {
                    String output = new String(buffer, 0, bytesRead, StandardCharsets.UTF_8);
                    webSocketSession.sendMessage(new TextMessage(output));
                }
            }

            log.info("Terminal output reader finished for: {}", terminalId);
        } catch (Exception e) {
            if (!terminalSession.isClosed() && webSocketSession.isOpen()) {
                log.error("Error reading terminal output: {}", terminalId, e);
            }
        } finally {
            // Ensure cleanup
            try {
                if (webSocketSession.isOpen()) {
                    webSocketSession.close(CloseStatus.NORMAL);
                }
            } catch (Exception e) {
                log.error("Error closing WebSocket session: {}", terminalId, e);
            }
            terminalService.closeSession(terminalId);
            sessionMap.remove(terminalId);
        }
    }

    private String extractTerminalId(WebSocketSession session) {
        try {
            URI uri = session.getUri();
            if (uri != null) {
                String path = uri.getPath();
                // Path format: /api/terminal/{terminalId}
                String[] parts = path.split("/");
                if (parts.length >= 4) {
                    return parts[3];
                }
            }
        } catch (Exception e) {
            log.error("Failed to extract terminal ID", e);
        }
        return null;
    }

    private String extractCwd(WebSocketSession session) {
        try {
            URI uri = session.getUri();
            if (uri != null) {
                String query = uri.getQuery();
                if (query != null && query.contains("cwd=")) {
                    String[] params = query.split("&");
                    for (String param : params) {
                        if (param.startsWith("cwd=")) {
                            return java.net.URLDecoder.decode(param.substring(4), StandardCharsets.UTF_8);
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to extract cwd", e);
        }
        return null;
    }
}
