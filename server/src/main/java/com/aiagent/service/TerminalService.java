package com.aiagent.service;

import com.pty4j.PtyProcess;
import com.pty4j.PtyProcessBuilder;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Service
public class TerminalService {

    private final Map<String, TerminalSession> sessions = new ConcurrentHashMap<>();

    public static class TerminalSession {
        private final PtyProcess process;
        private final InputStream inputStream;
        private final OutputStream outputStream;
        private volatile boolean closed = false;

        public TerminalSession(PtyProcess process) {
            this.process = process;
            this.inputStream = process.getInputStream();
            this.outputStream = process.getOutputStream();
        }

        public InputStream getInputStream() {
            return inputStream;
        }

        public OutputStream getOutputStream() {
            return outputStream;
        }

        public void resize(int cols, int rows) {
            if (!closed && process.isAlive()) {
                try {
                    process.getWinSize().setColumns(cols);
                    process.getWinSize().setRows(rows);
                } catch (Exception e) {
                    log.error("Failed to resize terminal", e);
                }
            }
        }

        public void close() {
            if (!closed) {
                closed = true;
                try {
                    process.destroy();
                } catch (Exception e) {
                    log.error("Error closing terminal process", e);
                }
                try {
                    inputStream.close();
                } catch (IOException e) {
                    // Ignore
                }
                try {
                    outputStream.close();
                } catch (IOException e) {
                    // Ignore
                }
            }
        }

        public boolean isClosed() {
            return closed || !process.isAlive();
        }
    }

    public TerminalSession createSession(String terminalId, String cwd) throws IOException {
        // Determine shell based on OS
        String[] command = getShellCommand();

        // Set up environment
        Map<String, String> environment = new HashMap<>(System.getenv());
        environment.put("TERM", "xterm-256color");
        environment.put("COLORTERM", "truecolor");

        // Create PTY process
        PtyProcessBuilder builder = new PtyProcessBuilder(command)
                .setDirectory(cwd)
                .setEnvironment(environment)
                .setInitialColumns(80)
                .setInitialRows(24)
                .setConsole(false);

        PtyProcess process = builder.start();
        TerminalSession session = new TerminalSession(process);
        sessions.put(terminalId, session);

        log.info("Created terminal session: {} in directory: {}", terminalId, cwd);
        return session;
    }

    public TerminalSession getSession(String terminalId) {
        return sessions.get(terminalId);
    }

    public void closeSession(String terminalId) {
        TerminalSession session = sessions.remove(terminalId);
        if (session != null) {
            session.close();
            log.info("Closed terminal session: {}", terminalId);
        }
    }

    public void closeAllSessions() {
        sessions.forEach((id, session) -> {
            session.close();
            log.info("Closed terminal session during shutdown: {}", id);
        });
        sessions.clear();
    }

    private String[] getShellCommand() {
        String os = System.getProperty("os.name").toLowerCase();

        if (os.contains("win")) {
            // Windows
            String powershell = "powershell.exe";
            String cmd = "cmd.exe";

            // Try PowerShell first, fallback to cmd
            try {
                new ProcessBuilder(powershell, "-Command", "exit").start().waitFor();
                return new String[]{powershell, "-NoLogo"};
            } catch (Exception e) {
                return new String[]{cmd};
            }
        } else {
            // Unix-like (Linux, macOS)
            String shell = System.getenv("SHELL");
            if (shell == null || shell.isEmpty()) {
                shell = "/bin/sh";
            }
            return new String[]{shell, "-l"};
        }
    }
}
