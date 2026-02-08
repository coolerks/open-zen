package com.aiagent.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class ProviderRequest {
    @NotBlank(message = "供应商名称不能为空")
    private String name;

    @NotBlank(message = "Base URL 不能为空")
    private String baseUrl;

    private String apiKey;  // nullable on update (means "keep existing")

    private Boolean enabled = true;
}
