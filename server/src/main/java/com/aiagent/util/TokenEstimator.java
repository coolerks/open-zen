package com.aiagent.util;

import java.nio.charset.StandardCharsets;

/**
 * 轻量 token 估算器：
 * 仅用于上下文容量预估，不用于计费结算。
 */
public final class TokenEstimator {

    private TokenEstimator() {
    }

    /**
     * 使用 UTF-8 字节长度粗略估算 token 数。
     */
    public static int estimateTextTokens(String text) {
        if (text == null || text.isBlank()) {
            return 0;
        }
        int utf8Bytes = text.getBytes(StandardCharsets.UTF_8).length;
        int estimated = (int) Math.ceil(utf8Bytes / 3.5d);
        return Math.max(estimated, 1);
    }
}
