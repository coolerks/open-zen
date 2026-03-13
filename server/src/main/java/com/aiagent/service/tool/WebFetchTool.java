package com.aiagent.service.tool;

import com.aiagent.service.tool.annotation.AiTool;
import com.aiagent.service.tool.annotation.AiToolMethod;
import com.aiagent.service.tool.annotation.AiToolParam;
import com.aiagent.service.tool.annotation.AiToolResult;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.springframework.stereotype.Component;
import org.springframework.web.util.HtmlUtils;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 通用网页抓取工具。
 * 允许模型读取公开 URL 的文本内容，适用于普通聊天与项目聊天。
 */
@Component
@RequiredArgsConstructor
@AiTool(value = "web", description = "网页抓取工具")
public class WebFetchTool {

    private static final int MAX_RESPONSE_BYTES = 256 * 1024;
    private static final int MAX_RETURN_CHARS = 12_000;
    private static final Pattern SCRIPT_PATTERN = Pattern.compile("(?is)<script\\b[^>]*>.*?</script>");
    private static final Pattern STYLE_PATTERN = Pattern.compile("(?is)<style\\b[^>]*>.*?</style>");
    private static final Pattern NOSCRIPT_PATTERN = Pattern.compile("(?is)<noscript\\b[^>]*>.*?</noscript>");
    private static final Pattern BLOCK_TAG_PATTERN = Pattern.compile(
            "(?is)</?(?:p|div|section|article|main|header|footer|aside|nav|li|ul|ol|table|thead|tbody|tr|td|th|h[1-6]|blockquote|pre|br)[^>]*>"
    );
    private static final Pattern TAG_PATTERN = Pattern.compile("(?is)<[^>]+>");
    private static final Pattern TITLE_PATTERN = Pattern.compile("(?is)<title\\b[^>]*>(.*?)</title>");

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    @AiToolMethod(
            name = "webfetch",
            description = "根据 URL 抓取网页或文本接口内容，返回标题、状态与提取后的正文文本。"
    )
    @AiToolResult(description = "返回抓取结果摘要，包含请求 URL、最终 URL、HTTP 状态、正文文本与截断提示。")
    public String webfetch(
            @AiToolParam(
                    name = "url",
                    description = "要抓取的完整 URL，必须以 http:// 或 https:// 开头。",
                    required = true
            ) String url
    ) {
        URI targetUri;
        try {
            targetUri = normalizeUri(url);
        } catch (RuntimeException ex) {
            return ex.getMessage();
        }

        Request request = new Request.Builder()
                .url(targetUri.toString())
                .addHeader("User-Agent", "OpenZen-WebFetch/1.0")
                .addHeader("Accept", "text/html,application/json,text/plain,application/xml;q=0.9,*/*;q=0.8")
                .get()
                .build();

        try (Response response = httpClient.newCall(request).execute()) {
            ResponseBody body = response.body();
            okhttp3.MediaType contentType = body != null ? body.contentType() : null;

            StringBuilder result = new StringBuilder();
            result.append("请求 URL: ").append(targetUri).append('\n');
            result.append("最终 URL: ").append(response.request().url()).append('\n');
            result.append("HTTP 状态: ").append(response.code());
            if (response.message() != null && !response.message().isBlank()) {
                result.append(' ').append(response.message().trim());
            }
            result.append('\n');
            result.append("Content-Type: ").append(contentType != null ? contentType : "unknown");

            if (body == null) {
                result.append("\n\n响应体为空。");
                return result.toString().trim();
            }

            BodyReadResult bodyReadResult = readBody(body, contentType);
            String rawBody = bodyReadResult.text();
            boolean truncated = bodyReadResult.truncated();

            if (!response.isSuccessful()) {
                String errorText = extractBodyText(rawBody, contentType);
                if (errorText != null && !errorText.isBlank()) {
                    result.append("\n\n错误响应:\n").append(clampText(errorText, MAX_RETURN_CHARS));
                }
                if (truncated) {
                    result.append("\n\n提示: 响应体超过 ").append(MAX_RESPONSE_BYTES / 1024).append("KB，已截断。");
                }
                return result.toString().trim();
            }

            if (!isTextLike(contentType)) {
                result.append("\n\n该 URL 返回的是非文本内容，当前工具仅提取文本正文。");
                return result.toString().trim();
            }

            String extractedText = extractBodyText(rawBody, contentType);
            if (isHtmlContent(contentType)) {
                String title = extractHtmlTitle(rawBody);
                if (title != null) {
                    result.append('\n').append("标题: ").append(title);
                }
            }
            if (truncated) {
                result.append('\n').append("提示: 响应体超过 ").append(MAX_RESPONSE_BYTES / 1024).append("KB，已截断后提取。");
            }

            if (extractedText == null || extractedText.isBlank()) {
                result.append("\n\n未提取到可用文本内容。");
                return result.toString().trim();
            }

            result.append("\n\n正文:\n").append(clampText(extractedText, MAX_RETURN_CHARS));
            return result.toString().trim();
        } catch (IOException ex) {
            return "抓取失败: " + ex.getMessage();
        }
    }

    private URI normalizeUri(String url) {
        String normalized = url == null ? "" : url.trim();
        if (normalized.isEmpty()) {
            throw new RuntimeException("参数 url 不能为空。");
        }

        URI uri;
        try {
            uri = URI.create(normalized);
        } catch (Exception ex) {
            throw new RuntimeException("URL 格式不正确。");
        }

        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new RuntimeException("仅支持 http 或 https URL。");
        }
        if (uri.getHost() == null || uri.getHost().isBlank()) {
            throw new RuntimeException("URL 必须包含主机名。");
        }
        if (uri.getUserInfo() != null && !uri.getUserInfo().isBlank()) {
            throw new RuntimeException("URL 不支持包含用户名或密码。");
        }
        return uri.normalize();
    }

    private BodyReadResult readBody(ResponseBody body, okhttp3.MediaType contentType) throws IOException {
        Charset charset = contentType != null ? contentType.charset(StandardCharsets.UTF_8) : StandardCharsets.UTF_8;
        try (InputStream inputStream = body.byteStream();
             ByteArrayOutputStream outputStream = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            boolean truncated = false;
            int readBytes;
            while ((readBytes = inputStream.read(buffer)) != -1) {
                int remaining = MAX_RESPONSE_BYTES - outputStream.size();
                if (remaining <= 0) {
                    truncated = true;
                    break;
                }
                int writeBytes = Math.min(remaining, readBytes);
                outputStream.write(buffer, 0, writeBytes);
                if (writeBytes < readBytes) {
                    truncated = true;
                    break;
                }
            }
            return new BodyReadResult(outputStream.toString(charset), truncated);
        }
    }

    private boolean isTextLike(okhttp3.MediaType contentType) {
        if (contentType == null) {
            return true;
        }
        String type = contentType.type();
        String subtype = contentType.subtype();
        if (type == null || subtype == null) {
            return true;
        }
        if ("text".equalsIgnoreCase(type)) {
            return true;
        }

        String normalizedSubtype = subtype.toLowerCase(Locale.ROOT);
        return normalizedSubtype.contains("json")
                || normalizedSubtype.contains("xml")
                || normalizedSubtype.contains("html")
                || normalizedSubtype.contains("xhtml")
                || normalizedSubtype.contains("javascript");
    }

    private boolean isHtmlContent(okhttp3.MediaType contentType) {
        if (contentType == null || contentType.subtype() == null) {
            return false;
        }
        String subtype = contentType.subtype().toLowerCase(Locale.ROOT);
        return subtype.contains("html") || subtype.contains("xhtml");
    }

    private boolean isJsonContent(okhttp3.MediaType contentType) {
        if (contentType == null || contentType.subtype() == null) {
            return false;
        }
        return contentType.subtype().toLowerCase(Locale.ROOT).contains("json");
    }

    private String extractBodyText(String rawBody, okhttp3.MediaType contentType) {
        if (rawBody == null || rawBody.isBlank()) {
            return null;
        }
        if (isHtmlContent(contentType)) {
            return normalizeHtmlText(rawBody);
        }
        if (isJsonContent(contentType)) {
            return normalizeJsonText(rawBody);
        }
        return normalizePlainText(rawBody);
    }

    private String normalizeJsonText(String rawBody) {
        try {
            Object parsed = objectMapper.readValue(rawBody, Object.class);
            return objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(parsed);
        } catch (Exception ignored) {
            return normalizePlainText(rawBody);
        }
    }

    private String normalizeHtmlText(String html) {
        String normalized = html.replace("\r\n", "\n").replace('\r', '\n');
        normalized = SCRIPT_PATTERN.matcher(normalized).replaceAll(" ");
        normalized = STYLE_PATTERN.matcher(normalized).replaceAll(" ");
        normalized = NOSCRIPT_PATTERN.matcher(normalized).replaceAll(" ");
        normalized = BLOCK_TAG_PATTERN.matcher(normalized).replaceAll("\n");
        normalized = TAG_PATTERN.matcher(normalized).replaceAll(" ");
        normalized = HtmlUtils.htmlUnescape(normalized).replace('\u00A0', ' ');

        StringBuilder builder = new StringBuilder();
        for (String line : normalized.split("\n")) {
            String cleanedLine = line.replaceAll("[\\t\\x0B\\f ]+", " ").trim();
            if (cleanedLine.isEmpty()) {
                continue;
            }
            if (!builder.isEmpty()) {
                builder.append('\n');
            }
            builder.append(cleanedLine);
        }
        return builder.toString().trim();
    }

    private String normalizePlainText(String rawBody) {
        String normalized = rawBody
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                .replace("\u0000", "")
                .trim();
        normalized = normalized.replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]+", " ");
        normalized = normalized.replaceAll("\\n{3,}", "\n\n");
        return normalized.trim();
    }

    private String extractHtmlTitle(String html) {
        if (html == null || html.isBlank()) {
            return null;
        }
        java.util.regex.Matcher matcher = TITLE_PATTERN.matcher(html);
        if (!matcher.find()) {
            return null;
        }
        String title = HtmlUtils.htmlUnescape(matcher.group(1)).replaceAll("\\s+", " ").trim();
        return title.isEmpty() ? null : title;
    }

    private String clampText(String value, int maxChars) {
        if (value == null) {
            return "";
        }
        if (value.length() <= maxChars) {
            return value;
        }
        return value.substring(0, maxChars) + "\n...(已截断)";
    }

    private record BodyReadResult(String text, boolean truncated) {
    }
}
