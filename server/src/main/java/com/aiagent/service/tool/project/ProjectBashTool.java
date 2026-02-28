package com.aiagent.service.tool.project;

import com.aiagent.service.tool.ToolDefinition;
import com.aiagent.service.tool.ToolExecutionContext;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 项目内命令执行工具。
 * 说明：
 * 1) 命令工作目录固定为当前项目根目录；
 * 2) 输出大小、执行超时均有硬限制，避免阻塞对话链路。
 */
@Component
@RequiredArgsConstructor
public class ProjectBashTool implements ToolDefinition {

    private static final int DEFAULT_TIMEOUT_SECONDS = 30;
    private static final int MAX_TIMEOUT_SECONDS = 180;
    private static final int DEFAULT_MAX_OUTPUT_KB = 256;
    private static final int MAX_MAX_OUTPUT_KB = 2048;

    private final ProjectToolSupport support;

    @Override
    public String getName() {
        return "bash";
    }

    @Override
    public String getDescription() {
        return "在项目目录中执行 shell 命令，返回退出码与输出结果。";
    }

    @Override
    public Map<String, Object> getParametersSchema() {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");

        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("command", Map.of(
                "type", "string",
                "description", "要执行的 shell 命令，例如 npm run build 或 git status"
        ));
        properties.put("timeoutSec", Map.of(
                "type", "integer",
                "description", "超时时间（秒），默认 30，最大 180"
        ));
        properties.put("maxOutputKb", Map.of(
                "type", "integer",
                "description", "最大输出大小（KB），默认 256，最大 2048"
        ));

        schema.put("properties", properties);
        schema.put("required", List.of("command"));
        schema.put("additionalProperties", false);
        return schema;
    }

    @Override
    public String execute(Map<String, Object> arguments) {
        return "错误: bash 仅支持在项目聊天中调用。";
    }

    @Override
    public String execute(Map<String, Object> arguments, ToolExecutionContext context) {
        Path rootPath = support.resolveProjectRoot(context);
        String command = support.getString(arguments, "command", null);
        if (command == null || command.isBlank()) {
            return "参数 command 不能为空。";
        }

        int timeoutSec = support.clamp(
                support.getInt(arguments, "timeoutSec", DEFAULT_TIMEOUT_SECONDS),
                1,
                MAX_TIMEOUT_SECONDS
        );
        int maxOutputKb = support.clamp(
                support.getInt(arguments, "maxOutputKb", DEFAULT_MAX_OUTPUT_KB),
                16,
                MAX_MAX_OUTPUT_KB
        );
        int maxOutputBytes = maxOutputKb * 1024;

        Process process;
        try {
            ProcessBuilder builder = new ProcessBuilder("bash", "-lc", command);
            builder.directory(rootPath.toFile());
            // 合并 stdout/stderr，避免双流读取造成阻塞。
            builder.redirectErrorStream(true);
            process = builder.start();
        } catch (Exception ex) {
            return "命令启动失败: " + ex.getMessage();
        }

        ByteArrayOutputStream outputBuffer = new ByteArrayOutputStream();
        AtomicBoolean truncated = new AtomicBoolean(false);

        Thread outputReader = Thread.startVirtualThread(() -> {
            try (InputStream inputStream = process.getInputStream()) {
                byte[] chunk = new byte[4096];
                int readBytes;
                while ((readBytes = inputStream.read(chunk)) != -1) {
                    int remaining = maxOutputBytes - outputBuffer.size();
                    if (remaining > 0) {
                        int writeSize = Math.min(remaining, readBytes);
                        outputBuffer.write(chunk, 0, writeSize);
                    }
                    if (readBytes > remaining) {
                        truncated.set(true);
                    }
                }
            } catch (Exception ignored) {
                // 输出读取失败不影响进程退出码获取。
            }
        });

        boolean finished;
        try {
            finished = process.waitFor(timeoutSec, TimeUnit.SECONDS);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            process.destroyForcibly();
            return "命令执行被中断。";
        }

        if (!finished) {
            process.destroyForcibly();
        }

        try {
            outputReader.join(1000L);
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }

        String output = outputBuffer.toString(StandardCharsets.UTF_8);
        if (output.isBlank()) {
            output = "(无输出)";
        }

        StringBuilder result = new StringBuilder();
        result.append("命令: ").append(command).append('\n');
        result.append("工作目录: ").append(rootPath).append('\n');
        if (!finished) {
            result.append("状态: 超时（").append(timeoutSec).append(" 秒）\n");
        } else {
            result.append("退出码: ").append(process.exitValue()).append('\n');
        }
        if (truncated.get()) {
            result.append("提示: 输出超过 ").append(maxOutputKb).append("KB，已截断。\n");
        }
        result.append('\n').append(output);
        return result.toString().trim();
    }

    @Override
    public boolean projectOnly() {
        return true;
    }
}
