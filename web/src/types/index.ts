// API 通用响应
export interface ApiResult<T> {
  success: boolean;
  message: string;
  data: T;
}

// 供应商
export interface Provider {
  id: number;
  name: string;
  baseUrl: string;
  apiKeySet: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderRequest {
  name: string;
  baseUrl: string;
  apiKey?: string;
  enabled?: boolean;
}

// 模型
export interface AiModel {
  id: number;
  providerId: number;
  providerName: string;
  modelKey: string;
  displayName: string;
  isDefault: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  contextWindowTokens: number | null;
  maxCompletionTokens: number | null;
  inputPrice: string | number | null;
  outputPrice: string | number | null;
  cacheReadPrice: string | number | null;
  cacheWritePrice: string | number | null;
  defaultParams: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRequest {
  providerId: number;
  modelKey: string;
  displayName: string;
  isDefault?: boolean;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  contextWindowTokens?: number;
  maxCompletionTokens?: number;
  inputPrice?: string | number;
  outputPrice?: string | number;
  cacheReadPrice?: string | number;
  cacheWritePrice?: string | number;
  defaultParams?: string;
  enabled?: boolean;
}

export interface ModelDiscoveryItem {
  modelKey: string;
  displayName: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  contextWindowTokens: number | null;
  maxCompletionTokens: number | null;
  inputPrice: string | number | null;
  outputPrice: string | number | null;
  cacheReadPrice: string | number | null;
  cacheWritePrice: string | number | null;
}

// 智能体
export interface Agent {
  id: number;
  name: string;
  description: string | null;
  systemPrompt: string;
  avatarType: 'emoji' | 'image' | null;
  avatarValue: string | null;
  isDefault: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRequest {
  name: string;
  description?: string;
  systemPrompt: string;
  avatarType?: 'emoji' | 'image';
  avatarValue?: string;
  enabled?: boolean;
}

// 应用中心
export interface AppCenterItem {
  id: number;
  name: string;
  iconType: 'emoji' | 'image' | null;
  iconValue: string | null;
  sourceKey: string;
  sourceSessionId: number | null;
  sourceSessionTitle: string | null;
  sourceMessageId: number | null;
  sourceModelId: number | null;
  sourceModelName: string | null;
  language: string;
  codeContent: string;
  originalCodeContent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppCenterItemCreateRequest {
  name: string;
  iconType?: 'emoji' | 'image';
  iconValue?: string;
  sourceKey: string;
  sourceSessionId?: number;
  sourceSessionTitle?: string;
  sourceMessageId?: number;
  sourceModelId?: number;
  sourceModelName?: string;
  language: string;
  codeContent: string;
  originalCodeContent?: string;
}

export interface AppCenterItemUpdateRequest {
  name: string;
  iconType?: 'emoji' | 'image';
  iconValue?: string;
  codeContent?: string;
  resetToOriginal?: boolean;
}

// 会话
export interface ChatSession {
  id: number;
  title: string;
  modelId: number | null;
  agentId: number | null;
  enabledToolNames: string | null;
  parentSessionId: number | null;
  parentMessageId: number | null;
  isTemporary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSearchResult {
  sessionId: number;
  title: string;
  snippet: string | null;
  matchedMessageId: number | null;
  matchedBy: 'title' | 'message' | 'both';
  matchedAt: string | null;
}

export interface ChatSessionCreateRequest {
  title?: string;
  agentId?: number | null;
  temporary?: boolean;
}

export interface ChatSessionUpdateRequest {
  title?: string;
  modelId?: number | null;
  agentId?: number | null;
  enabledToolNames?: string[];
}

export interface ChatToolDefinition {
  name: string;
  description: string;
  memoryTool: boolean;
}

// 消息
export interface ChatMessage {
  id: number;
  sessionId: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  toolCalls: string | null;
  toolCallId: string | null;
  tokenUsage: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: string | number | null;
  modelId: number | null;
  modelName: string | null;
  agentId: number | null;
  agentName: string | null;
  agentAvatarType: 'emoji' | 'image' | null;
  agentAvatarValue: string | null;
  reasoningContent: string | null;
  reasoningDurationMs: number | null;
  imageUrls: string | null;
  createdAt: string;
}

export interface ChatSendRequest {
  sessionId: number;
  modelId: number;
  content?: string;
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  toolPermissionMode?: 'require_approval' | 'auto';
  memoryEnabled?: boolean;
  enabledToolNames?: string[] | null;
}

export interface StreamDonePayload {
  messageId: number;
  sessionId: number;
  modelId: number;
  modelName: string;
  tokenUsage: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: string | number | null;
  sessionCostUsd: string | number | null;
  toolApprovalRequired?: boolean;
  title: string;
}

export interface ChatSessionContextStats {
  sessionId: number;
  modelId: number | null;
  modelName: string | null;
  contextUsedTokens: number;
  contextWindowTokens: number;
  contextUsageRatio: number;
  inputPrice: string | number | null;
  outputPrice: string | number | null;
  cacheReadPrice: string | number | null;
  cacheWritePrice: string | number | null;
  sessionPromptTokens: number;
  sessionCompletionTokens: number;
  sessionCacheReadTokens: number;
  sessionCacheWriteTokens: number;
  sessionCostUsd: string | number | null;
}
