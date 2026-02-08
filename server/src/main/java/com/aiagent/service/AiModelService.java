package com.aiagent.service;

import com.aiagent.dto.ModelRequest;
import com.aiagent.dto.ModelDiscoveryItemResponse;
import com.aiagent.dto.ModelResponse;
import com.aiagent.entity.AiModel;
import com.aiagent.entity.Provider;
import com.aiagent.mapper.AiModelMapper;
import com.aiagent.mapper.ProviderMapper;
import com.aiagent.service.modelcatalog.DiscoveredModelInfo;
import com.aiagent.service.modelcatalog.ModelCatalogService;
import com.aiagent.util.EncryptionUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class AiModelService {

    private final AiModelMapper aiModelMapper;
    private final ProviderMapper providerMapper;
    private final EncryptionUtil encryptionUtil;
    private final ModelCatalogService modelCatalogService;

    public List<ModelResponse> listAll() {
        List<AiModel> models = aiModelMapper.selectList(
                new LambdaQueryWrapper<AiModel>()
                        .orderByDesc(AiModel::getIsDefault)
                        .orderByDesc(AiModel::getCreatedAt)
        );
        return models.stream().map(this::toResponse).toList();
    }

    public List<ModelResponse> listEnabled() {
        List<AiModel> models = aiModelMapper.selectList(
                new LambdaQueryWrapper<AiModel>()
                        .eq(AiModel::getEnabled, true)
                        .orderByDesc(AiModel::getIsDefault)
                        .orderByAsc(AiModel::getDisplayName)
        );
        return models.stream().map(this::toResponse).toList();
    }

    public ModelResponse getById(Long id) {
        AiModel model = aiModelMapper.selectById(id);
        if (model == null) {
            throw new RuntimeException("模型不存在: " + id);
        }
        return toResponse(model);
    }

    public AiModel getEntityById(Long id) {
        AiModel model = aiModelMapper.selectById(id);
        if (model == null) {
            throw new RuntimeException("模型不存在: " + id);
        }
        return model;
    }

    /**
     * 返回“优先模型”ID：优先默认启用模型，否则返回第一个启用模型。
     */
    public Long resolvePreferredEnabledModelId() {
        AiModel defaultEnabled = aiModelMapper.selectOne(
                new LambdaQueryWrapper<AiModel>()
                        .eq(AiModel::getEnabled, true)
                        .eq(AiModel::getIsDefault, true)
                        .last("LIMIT 1")
        );
        if (defaultEnabled != null) {
            return defaultEnabled.getId();
        }

        AiModel firstEnabled = aiModelMapper.selectOne(
                new LambdaQueryWrapper<AiModel>()
                        .eq(AiModel::getEnabled, true)
                        .orderByAsc(AiModel::getDisplayName)
                        .last("LIMIT 1")
        );
        return firstEnabled != null ? firstEnabled.getId() : null;
    }

    public ModelResponse create(ModelRequest request) {
        Provider provider = providerMapper.selectById(request.getProviderId());
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + request.getProviderId());
        }

        AiModel model = new AiModel();
        model.setProviderId(request.getProviderId());
        model.setModelKey(request.getModelKey());
        model.setDisplayName(request.getDisplayName());
        model.setIsDefault(Boolean.TRUE.equals(request.getIsDefault()));
        model.setSupportsTools(Boolean.TRUE.equals(request.getSupportsTools()));
        model.setSupportsVision(Boolean.TRUE.equals(request.getSupportsVision()));
        model.setSupportsReasoning(Boolean.TRUE.equals(request.getSupportsReasoning()));
        model.setContextWindowTokens(request.getContextWindowTokens());
        model.setMaxCompletionTokens(request.getMaxCompletionTokens());
        model.setInputPrice(request.getInputPrice());
        model.setOutputPrice(request.getOutputPrice());
        model.setCacheReadPrice(request.getCacheReadPrice());
        model.setCacheWritePrice(request.getCacheWritePrice());
        model.setDefaultParams(request.getDefaultParams());
        model.setEnabled(Boolean.TRUE.equals(request.getEnabled()));
        model.setCreatedAt(LocalDateTime.now());
        model.setUpdatedAt(LocalDateTime.now());

        if (Boolean.TRUE.equals(model.getIsDefault())) {
            model.setEnabled(true);
        }

        aiModelMapper.insert(model);

        if (Boolean.TRUE.equals(model.getIsDefault())) {
            clearDefaultFlagExcept(model.getId());
        }

        return toResponse(model);
    }

    public ModelResponse update(Long id, ModelRequest request) {
        AiModel model = aiModelMapper.selectById(id);
        if (model == null) {
            throw new RuntimeException("模型不存在: " + id);
        }

        Provider provider = providerMapper.selectById(request.getProviderId());
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + request.getProviderId());
        }

        model.setProviderId(request.getProviderId());
        model.setModelKey(request.getModelKey());
        model.setDisplayName(request.getDisplayName());
        model.setIsDefault(Boolean.TRUE.equals(request.getIsDefault()));
        model.setSupportsTools(Boolean.TRUE.equals(request.getSupportsTools()));
        model.setSupportsVision(Boolean.TRUE.equals(request.getSupportsVision()));
        model.setSupportsReasoning(Boolean.TRUE.equals(request.getSupportsReasoning()));
        model.setContextWindowTokens(request.getContextWindowTokens());
        model.setMaxCompletionTokens(request.getMaxCompletionTokens());
        model.setInputPrice(request.getInputPrice());
        model.setOutputPrice(request.getOutputPrice());
        model.setCacheReadPrice(request.getCacheReadPrice());
        model.setCacheWritePrice(request.getCacheWritePrice());
        model.setDefaultParams(request.getDefaultParams());
        model.setEnabled(Boolean.TRUE.equals(request.getEnabled()));

        if (Boolean.TRUE.equals(model.getIsDefault())) {
            model.setEnabled(true);
        }

        model.setUpdatedAt(LocalDateTime.now());
        aiModelMapper.updateById(model);

        if (Boolean.TRUE.equals(model.getIsDefault())) {
            clearDefaultFlagExcept(model.getId());
        }

        return toResponse(model);
    }

    public void toggleEnabled(Long id, boolean enabled) {
        AiModel model = aiModelMapper.selectById(id);
        if (model == null) {
            throw new RuntimeException("模型不存在: " + id);
        }

        model.setEnabled(enabled);
        // 禁用时自动取消默认模型标记，避免“默认但不可用”的脏状态。
        if (!enabled && Boolean.TRUE.equals(model.getIsDefault())) {
            model.setIsDefault(false);
        }
        model.setUpdatedAt(LocalDateTime.now());
        aiModelMapper.updateById(model);
    }

    public void setDefault(Long id, boolean isDefault) {
        AiModel model = aiModelMapper.selectById(id);
        if (model == null) {
            throw new RuntimeException("模型不存在: " + id);
        }

        if (isDefault) {
            clearDefaultFlagExcept(id);
            model.setIsDefault(true);
            model.setEnabled(true);
        } else {
            model.setIsDefault(false);
        }
        model.setUpdatedAt(LocalDateTime.now());
        aiModelMapper.updateById(model);
    }

    /**
     * 按供应商自动发现模型列表（支持 OpenAI 兼容接口与供应商特化解析）。
     */
    public List<ModelDiscoveryItemResponse> discoverModels(Long providerId) {
        Provider provider = providerMapper.selectById(providerId);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + providerId);
        }
        if (provider.getApiKey() == null || provider.getApiKey().isBlank()) {
            throw new RuntimeException("供应商 API Key 未配置，无法拉取模型列表");
        }

        String apiKey = encryptionUtil.decrypt(provider.getApiKey());
        List<DiscoveredModelInfo> discovered = modelCatalogService.discover(provider, apiKey);
        return discovered.stream().map(this::toDiscoveryResponse).toList();
    }

    private void clearDefaultFlagExcept(Long keepId) {
        List<AiModel> defaults = aiModelMapper.selectList(
                new LambdaQueryWrapper<AiModel>().eq(AiModel::getIsDefault, true)
        );

        for (AiModel candidate : defaults) {
            if (Objects.equals(candidate.getId(), keepId)) {
                continue;
            }
            candidate.setIsDefault(false);
            candidate.setUpdatedAt(LocalDateTime.now());
            aiModelMapper.updateById(candidate);
        }
    }

    private ModelResponse toResponse(AiModel model) {
        ModelResponse resp = new ModelResponse();
        resp.setId(model.getId());
        resp.setProviderId(model.getProviderId());
        resp.setModelKey(model.getModelKey());
        resp.setDisplayName(model.getDisplayName());
        resp.setIsDefault(Boolean.TRUE.equals(model.getIsDefault()));
        resp.setSupportsTools(model.getSupportsTools());
        resp.setSupportsVision(model.getSupportsVision());
        resp.setSupportsReasoning(model.getSupportsReasoning());
        resp.setContextWindowTokens(model.getContextWindowTokens());
        resp.setMaxCompletionTokens(model.getMaxCompletionTokens());
        resp.setInputPrice(model.getInputPrice());
        resp.setOutputPrice(model.getOutputPrice());
        resp.setCacheReadPrice(model.getCacheReadPrice());
        resp.setCacheWritePrice(model.getCacheWritePrice());
        resp.setDefaultParams(model.getDefaultParams());
        resp.setEnabled(model.getEnabled());
        resp.setCreatedAt(model.getCreatedAt());
        resp.setUpdatedAt(model.getUpdatedAt());

        Provider provider = providerMapper.selectById(model.getProviderId());
        if (provider != null) {
            resp.setProviderName(provider.getName());
        }
        return resp;
    }

    private ModelDiscoveryItemResponse toDiscoveryResponse(DiscoveredModelInfo discoveredModelInfo) {
        ModelDiscoveryItemResponse response = new ModelDiscoveryItemResponse();
        response.setModelKey(discoveredModelInfo.getModelKey());
        response.setDisplayName(discoveredModelInfo.getDisplayName());
        response.setSupportsTools(discoveredModelInfo.getSupportsTools());
        response.setSupportsVision(discoveredModelInfo.getSupportsVision());
        response.setSupportsReasoning(discoveredModelInfo.getSupportsReasoning());
        response.setContextWindowTokens(discoveredModelInfo.getContextWindowTokens());
        response.setMaxCompletionTokens(discoveredModelInfo.getMaxCompletionTokens());
        response.setInputPrice(discoveredModelInfo.getInputPrice());
        response.setOutputPrice(discoveredModelInfo.getOutputPrice());
        response.setCacheReadPrice(discoveredModelInfo.getCacheReadPrice());
        response.setCacheWritePrice(discoveredModelInfo.getCacheWritePrice());
        return response;
    }
}
