import React, { useEffect, useMemo, useState } from 'react';
import { useProviderStore } from '../store/providerStore';
import { useModelStore } from '../store/modelStore';
import { modelApi } from '../api/model';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Dialog } from '../components/ui/Dialog';
import { Toggle } from '../components/ui/Toggle';
import { Select } from '../components/ui/Select';
import type { ProviderRequest, ModelRequest, Provider, AiModel, ModelDiscoveryItem } from '../types';

type Tab = 'providers' | 'models';
const TOKENS_PER_MILLION = 1_000_000;

function formatTokenCount(value: number | null): string {
  if (value == null || value <= 0) {
    return '-';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(0)}K`;
  }
  return String(value);
}

function formatTokenCountK(value: number | null): string {
  if (value == null || value <= 0) {
    return '-';
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  const kiloValue = value / 1_000;
  const text = kiloValue >= 100
    ? kiloValue.toFixed(0)
    : kiloValue >= 10
      ? kiloValue.toFixed(1)
      : kiloValue.toFixed(2);
  // 仅在包含小数点时去掉无效尾零，避免 200 -> 2 这种误裁剪。
  const normalized = text.includes('.') ? text.replace(/\.?0+$/, '') : text;
  return `${normalized}K`;
}

function formatPrice(value: string | number | null): string {
  if (value == null || value === '') {
    return '-';
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return `$${value}/M`;
  }
  const perMillion = numericValue * TOKENS_PER_MILLION;
  if (perMillion === 0) {
    return '$0/M';
  }
  if (perMillion < 0.01) {
    return `$${perMillion.toFixed(4)}/M`;
  }
  if (perMillion < 1) {
    return `$${perMillion.toFixed(3)}/M`;
  }
  if (perMillion < 100) {
    return `$${perMillion.toFixed(2)}/M`;
  }
  return `$${perMillion.toFixed(1)}/M`;
}

/**
 * 将后端存储的 USD/Token 转换为表单展示值 USD/M Tokens。
 */
function toPerMillionInput(value: string | number | null | undefined): string {
  if (value == null || value === '') {
    return '';
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return String(value);
  }
  const perMillion = numericValue * TOKENS_PER_MILLION;
  return perMillion.toFixed(6).replace(/\.?0+$/, '');
}

/**
 * 将用户输入的 USD/M Tokens 转换回后端需要的 USD/Token。
 */
function toPerTokenPayload(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const numericValue = Number(trimmed);
  if (!Number.isFinite(numericValue)) {
    return trimmed;
  }
  const perToken = numericValue / TOKENS_PER_MILLION;
  return perToken.toFixed(12).replace(/\.?0+$/, '');
}

const ModelsPage: React.FC = () => {
  const [tab, setTab] = useState<Tab>('providers');

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-gray-100">模型管理</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => setTab('providers')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${tab === 'providers'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
          >
            供应商管理
          </button>
          <button
            onClick={() => setTab('models')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${tab === 'models'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400'
              }`}
          >
            模型管理
          </button>
        </div>

        {tab === 'providers' ? <ProviderPanel /> : <ModelPanel />}
      </div>
    </div>
  );
};

// ========== Provider Panel ==========
const ProviderPanel: React.FC = () => {
  const { providers, loading, fetchProviders, createProvider, updateProvider, toggleProvider } = useProviderStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const filteredProviders = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return providers;
    }
    return providers.filter((provider) => {
      const nameText = provider.name.toLowerCase();
      const baseUrlText = provider.baseUrl.toLowerCase();
      return nameText.includes(keyword) || baseUrlText.includes(keyword);
    });
  }, [providers, searchKeyword]);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleEdit = (provider: Provider) => {
    setEditing(provider);
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          管理 AI 供应商的 API 连接配置
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索名称 / Base URL"
            className="w-[240px]"
          />
          <Button onClick={handleCreate}>添加供应商</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : providers.length === 0 ? (
        <p className="text-gray-500 text-center py-12">暂无供应商，请点击"添加供应商"</p>
      ) : filteredProviders.length === 0 ? (
        <p className="text-gray-500 text-center py-12">未找到匹配的供应商</p>
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">名称</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">Base URL</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">API Key</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">状态</th>
                <th className="text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredProviders.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100">{p.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs">{p.baseUrl}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                      ${p.apiKeySet
                        ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                      }`}
                    >
                      {p.apiKeySet ? '已设置' : '未设置'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Toggle
                      checked={p.enabled}
                      onChange={(val) => toggleProvider(p.id, val)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(p)}>
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProviderDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        onSubmit={async (data) => {
          if (editing) {
            await updateProvider(editing.id, data);
          } else {
            await createProvider(data);
          }
          setDialogOpen(false);
        }}
      />
    </div>
  );
};

const ProviderDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  editing: Provider | null;
  onSubmit: (data: ProviderRequest) => Promise<void>;
}> = ({ open, onClose, editing, onSubmit }) => {
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setBaseUrl(editing.baseUrl);
      setApiKey('');
    } else {
      setName('');
      setBaseUrl('https://openrouter.ai/api/v1');
      setApiKey('');
    }
  }, [editing, open]);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        baseUrl,
        apiKey: apiKey || undefined,
        enabled: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={editing ? '编辑供应商' : '添加供应商'}>
      <div className="flex flex-col gap-4">
        <Input label="名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="如: OpenRouter" />
        <Input label="Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" />
        <Input
          label={editing ? 'API Key (留空保持不变)' : 'API Key'}
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={editing ? '留空则保持现有 Key' : '输入 API Key'}
        />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !name || !baseUrl}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

// ========== Model Panel ==========
const ModelPanel: React.FC = () => {
  const { models, loading, fetchModels, createModel, updateModel, toggleModel, setDefaultModel } = useModelStore();
  const { providers, fetchProviders } = useProviderStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiModel | null>(null);
  const [updatingDefaultId, setUpdatingDefaultId] = useState<number | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');

  const filteredModels = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return models;
    }
    return models.filter((model) => {
      const text = [
        model.displayName,
        model.modelKey,
        model.providerName,
        model.supportsTools ? '工具' : '',
        model.supportsVision ? '视觉' : '',
        model.supportsReasoning ? '推理' : '',
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(keyword);
    });
  }, [models, searchKeyword]);

  useEffect(() => {
    fetchModels();
    fetchProviders();
  }, [fetchModels, fetchProviders]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          管理可用的 AI 模型，绑定到供应商
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索模型名 / Key / 供应商 / 能力"
            className="w-[280px]"
          />
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>添加模型</Button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : models.length === 0 ? (
        <p className="text-gray-500 text-center py-12">暂无模型，请先添加供应商后再添加模型</p>
      ) : filteredModels.length === 0 ? (
        <p className="text-gray-500 text-center py-12">未找到匹配的模型</p>
      ) : (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="w-[24%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">显示名称</th>
                <th className="w-[24%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">模型 Key</th>
                <th className="w-[12%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">供应商</th>
                <th className="w-[18%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">能力</th>
                <th className="w-[8%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">状态</th>
                <th className="w-[6%] text-center px-4 py-3 font-medium text-gray-700 dark:text-gray-300">默认</th>
                <th className="w-[8%] text-left px-4 py-3 font-medium text-gray-700 dark:text-gray-300">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {filteredModels.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td className="px-4 py-3 text-gray-900 dark:text-gray-100 align-middle">
                    <p className="break-words">{m.displayName}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 font-mono text-xs align-middle">
                    <p className="break-all">{m.modelKey}</p>
                    <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                      窗口 {formatTokenCount(m.contextWindowTokens)} / 最大输出 {formatTokenCount(m.maxCompletionTokens)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                      输入 {formatPrice(m.inputPrice)} · 输出 {formatPrice(m.outputPrice)}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400 align-middle">
                    <span className="whitespace-nowrap">{m.providerName}</span>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.supportsTools && (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-900 dark:text-sky-200">
                          工具
                        </span>
                      )}
                      {m.supportsVision && (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                          视觉
                        </span>
                      )}
                      {m.supportsReasoning && (
                        <span className="inline-flex items-center whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                          推理
                        </span>
                      )}
                      {!m.supportsTools && !m.supportsVision && !m.supportsReasoning && (
                        <span className="text-xs text-gray-400 dark:text-gray-500">无</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Toggle checked={m.enabled} onChange={(val) => toggleModel(m.id, val)} />
                  </td>
                  <td className="px-4 py-3 align-middle text-center">
                    <input
                      type="checkbox"
                      checked={m.isDefault}
                      disabled={updatingDefaultId != null || m.isDefault}
                      onChange={async (event) => {
                        if (!event.target.checked || m.isDefault) {
                          return;
                        }
                        setUpdatingDefaultId(m.id);
                        try {
                          await setDefaultModel(m.id, true);
                        } finally {
                          setUpdatingDefaultId(null);
                        }
                      }}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-70 dark:border-gray-600 dark:bg-gray-800 dark:text-blue-500"
                      aria-label={`${m.displayName} 默认模型`}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle whitespace-nowrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="whitespace-nowrap px-2.5 py-1 text-xs"
                      onClick={() => { setEditing(m); setDialogOpen(true); }}
                    >
                      编辑
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ModelDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        editing={editing}
        providers={providers}
        onSubmit={async (data) => {
          if (editing) {
            await updateModel(editing.id, data);
          } else {
            await createModel(data);
          }
          setDialogOpen(false);
        }}
      />
    </div>
  );
};

const ModelDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  editing: AiModel | null;
  providers: Provider[];
  onSubmit: (data: ModelRequest) => Promise<void>;
}> = ({ open, onClose, editing, providers, onSubmit }) => {
  const [providerId, setProviderId] = useState<string>('');
  const [modelKey, setModelKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [supportsTools, setSupportsTools] = useState(false);
  const [supportsVision, setSupportsVision] = useState(false);
  const [supportsReasoning, setSupportsReasoning] = useState(false);
  const [contextWindowTokens, setContextWindowTokens] = useState('');
  const [maxCompletionTokens, setMaxCompletionTokens] = useState('');
  const [inputPrice, setInputPrice] = useState('');
  const [outputPrice, setOutputPrice] = useState('');
  const [cacheReadPrice, setCacheReadPrice] = useState('');
  const [cacheWritePrice, setCacheWritePrice] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [defaultParams, setDefaultParams] = useState('');
  const [discoveredModels, setDiscoveredModels] = useState<ModelDiscoveryItem[]>([]);
  const [selectedDiscoveredKey, setSelectedDiscoveredKey] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editing) {
      setProviderId(String(editing.providerId));
      setModelKey(editing.modelKey);
      setDisplayName(editing.displayName);
      setSupportsTools(editing.supportsTools);
      setSupportsVision(editing.supportsVision);
      setSupportsReasoning(editing.supportsReasoning);
      setContextWindowTokens(editing.contextWindowTokens ? String(editing.contextWindowTokens) : '');
      setMaxCompletionTokens(editing.maxCompletionTokens ? String(editing.maxCompletionTokens) : '');
      setInputPrice(toPerMillionInput(editing.inputPrice));
      setOutputPrice(toPerMillionInput(editing.outputPrice));
      setCacheReadPrice(toPerMillionInput(editing.cacheReadPrice));
      setCacheWritePrice(toPerMillionInput(editing.cacheWritePrice));
      setIsDefault(editing.isDefault);
      setDefaultParams(editing.defaultParams || '');
    } else {
      setProviderId(providers.length > 0 ? String(providers[0].id) : '');
      setModelKey('');
      setDisplayName('');
      setSupportsTools(false);
      setSupportsVision(false);
      setSupportsReasoning(false);
      setContextWindowTokens('');
      setMaxCompletionTokens('');
      setInputPrice('');
      setOutputPrice('');
      setCacheReadPrice('');
      setCacheWritePrice('');
      setIsDefault(false);
      setDefaultParams('{"temperature":0.7,"max_tokens":4096}');
    }
    setDiscoveredModels([]);
    setSelectedDiscoveredKey('');
    setDiscoverError(null);
  }, [editing, open, providers]);

  const applyDiscoveredModel = (discovered: ModelDiscoveryItem) => {
    setModelKey(discovered.modelKey);
    setDisplayName(discovered.displayName || discovered.modelKey);
    setSupportsTools(Boolean(discovered.supportsTools));
    setSupportsVision(Boolean(discovered.supportsVision));
    setSupportsReasoning(Boolean(discovered.supportsReasoning));
    setContextWindowTokens(discovered.contextWindowTokens ? String(discovered.contextWindowTokens) : '');
    setMaxCompletionTokens(discovered.maxCompletionTokens ? String(discovered.maxCompletionTokens) : '');
    setInputPrice(toPerMillionInput(discovered.inputPrice));
    setOutputPrice(toPerMillionInput(discovered.outputPrice));
    setCacheReadPrice(toPerMillionInput(discovered.cacheReadPrice));
    setCacheWritePrice(toPerMillionInput(discovered.cacheWritePrice));
  };

  const handleDiscoverModels = async () => {
    if (!providerId) {
      return;
    }
    setDiscovering(true);
    setDiscoverError(null);
    try {
      const discovered = await modelApi.discover(Number(providerId));
      setDiscoveredModels(discovered);
      if (discovered.length === 0) {
        setSelectedDiscoveredKey('');
        return;
      }

      const preferred = discovered.find((item) => item.modelKey === modelKey) ?? discovered[0];
      setSelectedDiscoveredKey(preferred.modelKey);
      applyDiscoveredModel(preferred);
    } catch (error: any) {
      setDiscoverError(error?.message ?? '拉取模型列表失败');
    } finally {
      setDiscovering(false);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const parsedContextWindowTokens = contextWindowTokens.trim() ? Number(contextWindowTokens) : undefined;
      const parsedMaxCompletionTokens = maxCompletionTokens.trim() ? Number(maxCompletionTokens) : undefined;
      await onSubmit({
        providerId: Number(providerId),
        modelKey,
        displayName,
        supportsTools,
        supportsVision,
        supportsReasoning,
        contextWindowTokens: Number.isFinite(parsedContextWindowTokens) ? parsedContextWindowTokens : undefined,
        maxCompletionTokens: Number.isFinite(parsedMaxCompletionTokens) ? parsedMaxCompletionTokens : undefined,
        inputPrice: toPerTokenPayload(inputPrice),
        outputPrice: toPerTokenPayload(outputPrice),
        cacheReadPrice: toPerTokenPayload(cacheReadPrice),
        cacheWritePrice: toPerTokenPayload(cacheWritePrice),
        isDefault,
        defaultParams: defaultParams || undefined,
        enabled: true,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? '编辑模型' : '添加模型'}
      size="xl"
      bodyClassName="max-h-[80vh]"
    >
      <div className="flex flex-col gap-4">
        <Select
          label="供应商"
          options={providers.map((provider) => ({
            value: provider.id,
            label: provider.name,
            meta: provider.baseUrl.replace(/^https?:\/\//, ''),
            searchText: `${provider.name} ${provider.baseUrl}`,
          }))}
          value={providerId}
          onChange={setProviderId}
          searchable
          searchPlaceholder="搜索供应商..."
        />
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              支持 OpenAI 兼容 `GET /models`，并对 OpenRouter 做扩展字段解析。
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDiscoverModels()}
              disabled={discovering || !providerId}
              className="whitespace-nowrap"
            >
              {discovering ? '加载中...' : '从供应商拉取模型'}
            </Button>
          </div>
          {discoverError && <p className="mt-2 text-xs text-red-500">{discoverError}</p>}
          {discoveredModels.length > 0 && (
            <div className="mt-3">
              <Select
                label="已发现模型"
                options={discoveredModels.map((item) => ({
                  value: item.modelKey,
                  label: item.displayName || item.modelKey,
                  meta: (
                    <span className="inline-flex items-center gap-2 whitespace-nowrap">
                      <span title="上下文窗口 Token">{formatTokenCountK(item.contextWindowTokens)}</span>
                      <span title="输入价格">↓{formatPrice(item.inputPrice)}</span>
                      <span title="输出价格">↑{formatPrice(item.outputPrice)}</span>
                    </span>
                  ),
                  searchText: [
                    item.modelKey,
                    item.displayName,
                    formatTokenCountK(item.contextWindowTokens),
                    formatPrice(item.inputPrice),
                    formatPrice(item.outputPrice),
                  ]
                    .filter(Boolean)
                    .join(' '),
                }))}
                value={selectedDiscoveredKey}
                onChange={(value) => {
                  setSelectedDiscoveredKey(value);
                  const matched = discoveredModels.find((item) => item.modelKey === value);
                  if (matched) {
                    applyDiscoveredModel(matched);
                  }
                }}
                searchable
                searchPlaceholder="搜索模型..."
              />
            </div>
          )}
        </div>
        <Input label="模型 Key" value={modelKey} onChange={(e) => setModelKey(e.target.value)}
          placeholder="如: qwen/qwen3-coder:free" />
        <Input label="显示名称" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          placeholder="如: Qwen3 Coder (Free)" />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="上下文窗口 Token"
            value={contextWindowTokens}
            onChange={(e) => setContextWindowTokens(e.target.value)}
            placeholder="如: 128000"
          />
          <Input
            label="最大输出 Token"
            value={maxCompletionTokens}
            onChange={(e) => setMaxCompletionTokens(e.target.value)}
            placeholder="如: 8192"
          />
        </div>
        <div className="flex gap-6">
          <Toggle checked={supportsTools} onChange={setSupportsTools} label="支持工具调用" />
          <Toggle checked={supportsVision} onChange={setSupportsVision} label="支持视觉" />
          <Toggle checked={supportsReasoning} onChange={setSupportsReasoning} label="支持推理输出" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="输入价格（USD/M Tokens）" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} placeholder="如: 5" />
          <Input label="输出价格（USD/M Tokens）" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} placeholder="如: 25" />
          <Input label="缓存读价格（可选，USD/M Tokens）" value={cacheReadPrice} onChange={(e) => setCacheReadPrice(e.target.value)} placeholder="如: 0.5" />
          <Input label="缓存写价格（可选，USD/M Tokens）" value={cacheWritePrice} onChange={(e) => setCacheWritePrice(e.target.value)} placeholder="如: 6.25" />
        </div>
        <Toggle
          checked={isDefault}
          onChange={setIsDefault}
          label="设为默认模型（未手动选择模型时自动使用）"
        />
        <Input label="默认参数 (JSON)" value={defaultParams} onChange={(e) => setDefaultParams(e.target.value)}
          placeholder='{"temperature":0.7,"max_tokens":4096}' />
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !providerId || !modelKey || !displayName}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default ModelsPage;
