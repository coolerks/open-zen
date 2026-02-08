package com.aiagent.service;

import com.aiagent.dto.ProviderRequest;
import com.aiagent.dto.ProviderResponse;
import com.aiagent.entity.Provider;
import com.aiagent.mapper.ProviderMapper;
import com.aiagent.util.EncryptionUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
@RequiredArgsConstructor
public class ProviderService {

    private final ProviderMapper providerMapper;
    private final EncryptionUtil encryptionUtil;

    public List<ProviderResponse> listAll() {
        List<Provider> providers = providerMapper.selectList(
                new LambdaQueryWrapper<Provider>().orderByDesc(Provider::getCreatedAt)
        );
        return providers.stream().map(this::toResponse).toList();
    }

    public ProviderResponse getById(Long id) {
        Provider provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + id);
        }
        return toResponse(provider);
    }

    public Provider getEntityById(Long id) {
        Provider provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + id);
        }
        return provider;
    }

    public ProviderResponse create(ProviderRequest request) {
        Provider provider = new Provider();
        provider.setName(request.getName());
        provider.setBaseUrl(request.getBaseUrl());
        provider.setApiKey(encryptionUtil.encrypt(request.getApiKey()));
        provider.setEnabled(request.getEnabled());
        provider.setCreatedAt(LocalDateTime.now());
        provider.setUpdatedAt(LocalDateTime.now());
        providerMapper.insert(provider);
        return toResponse(provider);
    }

    public ProviderResponse update(Long id, ProviderRequest request) {
        Provider provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + id);
        }
        provider.setName(request.getName());
        provider.setBaseUrl(request.getBaseUrl());
        if (request.getApiKey() != null && !request.getApiKey().isEmpty()) {
            provider.setApiKey(encryptionUtil.encrypt(request.getApiKey()));
        }
        provider.setEnabled(request.getEnabled());
        provider.setUpdatedAt(LocalDateTime.now());
        providerMapper.updateById(provider);
        return toResponse(provider);
    }

    public void toggleEnabled(Long id, boolean enabled) {
        Provider provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + id);
        }
        provider.setEnabled(enabled);
        provider.setUpdatedAt(LocalDateTime.now());
        providerMapper.updateById(provider);
    }

    public String getDecryptedApiKey(Long id) {
        Provider provider = providerMapper.selectById(id);
        if (provider == null) {
            throw new RuntimeException("供应商不存在: " + id);
        }
        return encryptionUtil.decrypt(provider.getApiKey());
    }

    private ProviderResponse toResponse(Provider provider) {
        ProviderResponse resp = new ProviderResponse();
        resp.setId(provider.getId());
        resp.setName(provider.getName());
        resp.setBaseUrl(provider.getBaseUrl());
        resp.setApiKeySet(provider.getApiKey() != null && !provider.getApiKey().isEmpty());
        resp.setEnabled(provider.getEnabled());
        resp.setCreatedAt(provider.getCreatedAt());
        resp.setUpdatedAt(provider.getUpdatedAt());
        return resp;
    }
}
