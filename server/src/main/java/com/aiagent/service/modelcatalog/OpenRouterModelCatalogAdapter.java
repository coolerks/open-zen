package com.aiagent.service.modelcatalog;

import com.aiagent.entity.Provider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.OkHttpClient;
import org.springframework.stereotype.Component;

/**
 * OpenRouter 特化适配器：解析 context/pricing/supported_parameters 等扩展字段。
 */
@Component
public class OpenRouterModelCatalogAdapter extends AbstractOpenAiCompatibleModelCatalogAdapter {

    public OpenRouterModelCatalogAdapter(OkHttpClient httpClient, ObjectMapper objectMapper) {
        super(httpClient, objectMapper);
    }

    @Override
    public String adapterName() {
        return "openrouter";
    }

    @Override
    public int priority() {
        return 100;
    }

    @Override
    public boolean supports(Provider provider) {
        String name = provider.getName() != null ? provider.getName().toLowerCase() : "";
        String baseUrl = provider.getBaseUrl() != null ? provider.getBaseUrl().toLowerCase() : "";
        return name.contains("openrouter") || baseUrl.contains("openrouter.ai");
    }

    @Override
    protected DiscoveredModelInfo mapModelNode(JsonNode modelNode, Provider provider) {
        String modelKey = text(modelNode, "id");
        if (modelKey == null) {
            return null;
        }

        JsonNode supportedParameters = modelNode.path("supported_parameters");
        JsonNode architecture = modelNode.path("architecture");
        JsonNode pricing = modelNode.path("pricing");
        JsonNode topProvider = modelNode.path("top_provider");

        boolean supportsTools = arrayContainsText(supportedParameters, "tools")
                || arrayContainsText(supportedParameters, "tool_choice");
        boolean supportsReasoning = arrayContainsTextPart(supportedParameters, "reasoning");

        boolean supportsVision = arrayContainsText(architecture.path("input_modalities"), "image")
                || arrayContainsText(architecture.path("output_modalities"), "image");
        String modality = text(architecture, "modality");
        if (!supportsVision && modality != null) {
            supportsVision = modality.toLowerCase().contains("image");
        }

        Long contextWindow = longValue(modelNode, "context_length");
        if (contextWindow == null) {
            contextWindow = longValue(topProvider, "context_length");
        }

        Long maxCompletion = longValue(topProvider, "max_completion_tokens");
        if (maxCompletion == null) {
            maxCompletion = longValue(modelNode, "max_completion_tokens");
        }

        DiscoveredModelInfo info = new DiscoveredModelInfo();
        info.setModelKey(modelKey);
        info.setDisplayName(text(modelNode, "name"));
        info.setSupportsTools(supportsTools);
        info.setSupportsVision(supportsVision);
        info.setSupportsReasoning(supportsReasoning);
        info.setContextWindowTokens(contextWindow);
        info.setMaxCompletionTokens(maxCompletion);
        info.setInputPrice(decimalValue(pricing, "prompt"));
        info.setOutputPrice(decimalValue(pricing, "completion"));
        info.setCacheReadPrice(decimalValue(pricing, "input_cache_read"));
        info.setCacheWritePrice(decimalValue(pricing, "input_cache_write"));
        return info;
    }
}
