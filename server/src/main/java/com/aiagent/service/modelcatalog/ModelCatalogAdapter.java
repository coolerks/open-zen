package com.aiagent.service.modelcatalog;

import com.aiagent.entity.Provider;

import java.util.List;

/**
 * 模型目录适配器：负责从供应商接口发现可用模型及其元数据。
 */
public interface ModelCatalogAdapter {

    /**
     * 适配器名称，仅用于日志与排查。
     */
    String adapterName();

    /**
     * 匹配优先级，值越大优先级越高。
     */
    int priority();

    /**
     * 当前适配器是否适配该供应商。
     */
    boolean supports(Provider provider);

    /**
     * 拉取并解析模型列表。
     */
    List<DiscoveredModelInfo> discover(Provider provider, String apiKey);
}
