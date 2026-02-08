package com.aiagent.service.modelcatalog;

import com.aiagent.entity.Provider;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

/**
 * 模型目录发现服务：按优先级选择可用适配器。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ModelCatalogService {

    private final List<ModelCatalogAdapter> adapters;

    public List<DiscoveredModelInfo> discover(Provider provider, String apiKey) {
        ModelCatalogAdapter adapter = adapters.stream()
                .filter(candidate -> candidate.supports(provider))
                .max(Comparator.comparingInt(ModelCatalogAdapter::priority))
                .orElseThrow(() -> new RuntimeException("未找到可用的模型目录适配器"));

        log.info("使用模型目录适配器: {} (provider={})", adapter.adapterName(), provider.getName());
        return adapter.discover(provider, apiKey);
    }
}
