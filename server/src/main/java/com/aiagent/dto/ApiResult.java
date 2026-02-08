package com.aiagent.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class ApiResult<T> {
    private boolean success;
    private String message;
    private T data;

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>(true, "ok", data);
    }

    public static <T> ApiResult<T> ok() {
        return new ApiResult<>(true, "ok", null);
    }

    public static <T> ApiResult<T> error(String message) {
        return new ApiResult<>(false, message, null);
    }
}
