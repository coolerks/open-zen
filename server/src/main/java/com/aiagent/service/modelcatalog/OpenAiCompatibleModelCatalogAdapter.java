package com.aiagent.service.modelcatalog;

import com.aiagent.entity.Provider;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.OkHttpClient;
import org.springframework.stereotype.Component;

/**
 * OpenAI 兼容适配器（默认兜底）。
 */
@Component
public class OpenAiCompatibleModelCatalogAdapter extends AbstractOpenAiCompatibleModelCatalogAdapter {

    public OpenAiCompatibleModelCatalogAdapter(OkHttpClient httpClient, ObjectMapper objectMapper) {
        super(httpClient, objectMapper);
    }

    @Override
    public String adapterName() {
        return "openai-compatible";
    }

    @Override
    public int priority() {
        return 10;
    }

    @Override
    public boolean supports(Provider provider) {
        return true;
    }

    @Override
    protected DiscoveredModelInfo mapModelNode(JsonNode modelNode, Provider provider) {
        String modelKey = text(modelNode, "id");
        if (modelKey == null) {
            return null;
        }

        JsonNode supportedParameters = modelNode.path("supported_parameters");
        JsonNode capabilities = modelNode.path("capabilities");
        JsonNode architecture = modelNode.path("architecture");
        JsonNode pricing = modelNode.path("pricing");

        boolean supportsTools = arrayContainsText(supportedParameters, "tools")
                || arrayContainsText(supportedParameters, "tool_choice")
                || capabilities.path("tools").asBoolean(false)
                || capabilities.path("tool_calling").asBoolean(false);

        boolean supportsReasoning = arrayContainsTextPart(supportedParameters, "reasoning")
                || capabilities.path("reasoning").asBoolean(false);

        boolean supportsVision = capabilities.path("vision").asBoolean(false)
                || arrayContainsText(architecture.path("input_modalities"), "image")
                || arrayContainsText(architecture.path("output_modalities"), "image")
                || arrayContainsText(modelNode.path("input_modalities"), "image")
                || arrayContainsText(modelNode.path("output_modalities"), "image");

        String modality = text(architecture, "modality");
        if (!supportsVision && modality != null) {
            supportsVision = modality.toLowerCase().contains("image");
        }

        String modalities = text(modelNode, "modalities");
        if (!supportsVision && modalities != null) {
            supportsVision = modalities.toLowerCase().contains("image");
        }

        Long contextWindowTokens = longValue(modelNode, "context_length");
        if (contextWindowTokens == null) {
            contextWindowTokens = longValue(modelNode, "context_window");
        }

        Long maxCompletionTokens = longValue(modelNode, "max_completion_tokens");
        if (maxCompletionTokens == null) {
            maxCompletionTokens = longValue(modelNode, "max_output_tokens");
        }

        if (pricing.isMissingNode() || pricing.isNull()) {
            pricing = modelNode;
        }

        var inputPrice = decimalValue(pricing, "prompt");
        if (inputPrice == null) {
            inputPrice = decimalValue(pricing, "input_price");
        }

        var outputPrice = decimalValue(pricing, "completion");
        if (outputPrice == null) {
            outputPrice = decimalValue(pricing, "output_price");
        }

        var cacheReadPrice = decimalValue(pricing, "input_cache_read");
        if (cacheReadPrice == null) {
            cacheReadPrice = decimalValue(pricing, "cache_read_price");
        }

        var cacheWritePrice = decimalValue(pricing, "input_cache_write");
        if (cacheWritePrice == null) {
            cacheWritePrice = decimalValue(pricing, "cache_write_price");
        }

        DiscoveredModelInfo info = new DiscoveredModelInfo();
        info.setModelKey(modelKey);
        info.setDisplayName(text(modelNode, "name"));
        info.setSupportsTools(supportsTools);
        info.setSupportsVision(supportsVision);
        info.setSupportsReasoning(supportsReasoning);
        info.setContextWindowTokens(contextWindowTokens);
        info.setMaxCompletionTokens(maxCompletionTokens);
        info.setInputPrice(inputPrice);
        info.setOutputPrice(outputPrice);
        info.setCacheReadPrice(cacheReadPrice);
        info.setCacheWritePrice(cacheWritePrice);
        return info;
    }
}
