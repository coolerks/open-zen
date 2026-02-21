import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import katexCssText from 'katex/dist/katex.min.css?raw';
import { chatApi } from '../api/chat';
import { useChatStore } from '../store/chatStore';
import { useModelStore } from '../store/modelStore';
import { useAgentStore } from '../store/agentStore';
import { useAppCenterStore } from '../store/appCenterStore';
import { useProjectStore } from '../store/projectStore';
import { useThemeStore } from '../store/themeStore';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Input, Textarea } from '../components/ui/Input';
import { DirectoryPickerDialog } from '../components/project/DirectoryPickerDialog';
import ModelsPage from './ModelsPage';
import AgentsPage from './AgentsPage';
import AppsPage from './AppsPage';
import ProjectsPage from './ProjectsPage';
import type {
  ChatMessage,
  ChatSearchResult,
  ChatSession,
  ChatSessionContextStats,
  ChatToolDefinition,
} from '../types';

const TOKENS_PER_MILLION = 1_000_000;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'chat.sidebar.collapsed';
const LAST_SELECTED_MODEL_STORAGE_KEY = 'chat.lastSelectedModelId';
const TOOLBAR_FEEDBACK_DURATION_MS = 3000;
const STREAM_MARKDOWN_MIN_COMMIT_CHARS = 10;
const STREAM_MARKDOWN_FORCE_COMMIT_CHARS = 120;
const CODE_LANGUAGE_ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  'c++': 'cpp',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
  md: 'markdown',
  csharp: 'cs',
  'c#': 'cs',
  text: 'plaintext',
};
const CODE_LANGUAGE_LABEL_MAP: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  python: 'Python',
  java: 'Java',
  go: 'Go',
  rust: 'Rust',
  cpp: 'C++',
  c: 'C',
  cs: 'C#',
  php: 'PHP',
  ruby: 'Ruby',
  bash: 'Bash',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
  plaintext: 'Text',
};
const CODE_EXTENSION_MAP: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  python: 'py',
  java: 'java',
  go: 'go',
  rust: 'rs',
  cpp: 'cpp',
  c: 'c',
  cs: 'cs',
  php: 'php',
  ruby: 'rb',
  bash: 'sh',
  sql: 'sql',
  html: 'html',
  css: 'css',
  json: 'json',
  yaml: 'yml',
  markdown: 'md',
  plaintext: 'txt',
};

const APP_ICON_EMOJIS = ['🚀', '📊', '🧩', '🛠️', '💡', '🧠', '🌐', '📚', '🎨', '📦'];
type MaxTokensPresetKey = 'default' | 'low' | 'medium' | 'high' | 'ultra' | 'custom';
type TemperaturePresetKey = 'default' | 'precise' | 'balanced' | 'creative' | 'divergent' | 'custom';
type ToolPermissionPresetKey = 'require_approval' | 'auto';
type MemoryPresetKey = 'off' | 'on';

const MAX_TOKENS_PRESETS: Array<{ key: MaxTokensPresetKey; label: string; value: number | null }> = [
  { key: 'default', label: '默认（模型配置）', value: null },
  { key: 'low', label: '短', value: 2048 },
  { key: 'medium', label: '中', value: 4096 },
  { key: 'high', label: '长', value: 8192 },
  { key: 'ultra', label: '超长', value: 16384 },
  { key: 'custom', label: '自定义', value: null },
];

const TEMPERATURE_PRESETS: Array<{ key: TemperaturePresetKey; label: string; value: number | null }> = [
  { key: 'default', label: '默认（模型配置）', value: null },
  { key: 'precise', label: '严谨', value: 0.2 },
  { key: 'balanced', label: '平衡', value: 0.7 },
  { key: 'creative', label: '创意', value: 1.0 },
  { key: 'divergent', label: '发散', value: 1.3 },
  { key: 'custom', label: '自定义', value: null },
];

const TOOL_PERMISSION_PRESETS: Array<{ key: ToolPermissionPresetKey; label: string }> = [
  { key: 'require_approval', label: '需要用户授权（默认）' },
  { key: 'auto', label: '自动调用工具' },
];

const MEMORY_PRESETS: Array<{ key: MemoryPresetKey; label: string }> = [
  { key: 'off', label: '关闭（默认）' },
  { key: 'on', label: '开启记忆检索' },
];

function resolveStreamMarkdownInterval(contentLength: number): number {
  // 内容越长，Markdown 重渲染间隔越大，用于平衡流畅度与性能。
  if (contentLength < 800) {
    return 90;
  }
  if (contentLength < 3_000) {
    return 130;
  }
  if (contentLength < 8_000) {
    return 190;
  }
  return 240;
}

type ExportImageFormat = 'svg' | 'png' | 'jpeg';

type ProjectCreateDialogState = {
  open: boolean;
  name: string;
  description: string;
  realDirectoryPath: string;
  realDirectoryName: string;
  error: string | null;
  submitting: boolean;
};

type SaveCodeBlockPayload = {
  sourceKey: string;
  sourceSessionId: number | null;
  sourceSessionTitle: string | null;
  sourceMessageId: number | null;
  sourceModelId: number | null;
  sourceModelName: string | null;
  language: string;
  codeContent: string;
};

type HighlightResult = {
  value: string;
  language?: string;
};
type HighlightJsApi = {
  getLanguage: (languageName: string) => unknown;
  highlight: (code: string, options: { language: string; ignoreIllegals?: boolean }) => HighlightResult;
  highlightAuto: (code: string) => HighlightResult;
};

let highlightJsLoader: Promise<HighlightJsApi> | null = null;

function readStoredModelId(): number | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(LAST_SELECTED_MODEL_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseImageUrls(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return '暂无';
  }
  const date = new Date(value);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatMonthDay(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  return date.toLocaleDateString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  });
}

function isWithinDays(value: string | null | undefined, days: number): boolean {
  if (!value) {
    return false;
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return false;
  }
  return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000;
}

function isTextInputLikeElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tagName = target.tagName.toLowerCase();
  if (tagName === 'textarea') {
    return true;
  }
  if (tagName === 'input') {
    const input = target as HTMLInputElement;
    return input.type !== 'checkbox' && input.type !== 'radio' && input.type !== 'button';
  }
  return target.isContentEditable;
}

function formatUsd(value: string | number | null): string {
  if (value == null || value === '') {
    return '-';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `$${value}`;
  }
  if (numeric === 0) {
    return '$0';
  }
  if (numeric < 0.0001) {
    return `$${numeric.toExponential(2)}`;
  }
  return `$${numeric.toFixed(6)}`;
}

function formatUsdPerMillion(value: string | number | null): string {
  if (value == null || value === '') {
    return '-';
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `$${value}/M`;
  }

  const perMillion = numeric * TOKENS_PER_MILLION;
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

function formatTokenNumber(value: number | null | undefined): string {
  if (value == null) {
    return '-';
  }
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatReasoningDuration(durationMs: number | null | undefined): string | null {
  if (durationMs == null || durationMs < 0) {
    return null;
  }

  // 毫秒转秒后向上取整，避免出现“0秒”的体验。
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (seconds === 0) {
    return `${minutes}分钟`;
  }
  return `${minutes}分钟${seconds}秒`;
}

function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function parseTemperature(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed > 2) {
    return null;
  }
  return parsed;
}

function parseEnabledToolNames(value: string | null | undefined): string[] | null {
  if (!value || !value.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return Array.from(
      new Set(
        parsed
          .filter((item) => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    );
  } catch {
    return null;
  }
}

function formatShortNumber(value: number): string {
  const withTwo = value.toFixed(2);
  return withTwo.replace(/\.?0+$/, '');
}

function formatQuotedTextForPrompt(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function buildOutgoingUserContent(inputValue: string, quotedText: string | null): string {
  const normalizedInput = inputValue.trim();
  const normalizedQuotedText = quotedText?.trim() ?? '';
  if (!normalizedQuotedText) {
    return normalizedInput;
  }

  const quoteBlock = formatQuotedTextForPrompt(normalizedQuotedText);
  if (!normalizedInput) {
    return quoteBlock;
  }
  return `${quoteBlock}\n\n${normalizedInput}`;
}

type EmbeddedToolInvocation = {
  id: string;
  name: string;
  argumentsText: string | null;
  resultText: string | null;
};

type DisplayChatMessage = {
  message: ChatMessage;
  embeddedTools: EmbeddedToolInvocation[];
  mergedMessageIds: number[];
  preToolContent: string | null;
  requiresToolApproval: boolean;
  approvalMessageId: number | null;
};

type ParsedToolCall = {
  id: string | null;
  name: string;
  argumentsText: string | null;
};

function tryFormatToolJson(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = JSON.parse(normalized);
    if (typeof parsed === 'string') {
      return parsed;
    }
    return JSON.stringify(parsed, null, 2);
  } catch {
    return normalized;
  }
}

function parseToolCalls(rawToolCalls: string | null): ParsedToolCall[] {
  if (!rawToolCalls?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawToolCalls);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const objectItem = item as {
          id?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const nameCandidate = objectItem.function?.name;
        const name =
          typeof nameCandidate === 'string' && nameCandidate.trim()
            ? nameCandidate.trim()
            : `工具${index + 1}`;

        const argumentsRaw = objectItem.function?.arguments;
        const argumentsText =
          typeof argumentsRaw === 'string'
            ? tryFormatToolJson(argumentsRaw)
            : argumentsRaw != null
              ? tryFormatToolJson(JSON.stringify(argumentsRaw))
              : null;

        const idCandidate = objectItem.id;
        const id =
          typeof idCandidate === 'string' && idCandidate.trim()
            ? idCandidate.trim()
            : null;

        return { id, name, argumentsText };
      })
      .filter((item): item is ParsedToolCall => item != null);
  } catch {
    return [];
  }
}

function buildDisplayMessages(messages: ChatMessage[]): DisplayChatMessage[] {
  const result: DisplayChatMessage[] = [];
  const syntheticSessionId = messages[0]?.sessionId ?? 0;
  const syntheticCreatedAt = messages[0]?.createdAt ?? new Date().toISOString();
  let syntheticCounter = 0;

  let pending:
    | {
        anchorMessage: ChatMessage | null;
        invocations: EmbeddedToolInvocation[];
        mergedMessageIds: number[];
        preToolContents: string[];
      }
    | null = null;

  const resolveToolApprovalState = (
    baseMessage: ChatMessage,
    embeddedTools: EmbeddedToolInvocation[],
  ): { requiresToolApproval: boolean; approvalMessageId: number | null } => {
    const hasPendingResult = embeddedTools.some((item) => !item.resultText);
    if (!hasPendingResult) {
      return { requiresToolApproval: false, approvalMessageId: null };
    }
    if (baseMessage.id <= 0) {
      return { requiresToolApproval: false, approvalMessageId: null };
    }
    return {
      requiresToolApproval: true,
      approvalMessageId: baseMessage.id,
    };
  };

  const flushPendingAsStandalone = () => {
    if (!pending || pending.invocations.length === 0) {
      pending = null;
      return;
    }
    const preToolContent = pending.preToolContents
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n\n') || null;

    syntheticCounter += 1;
    const syntheticId = -9_000_000_000 - syntheticCounter;
    const syntheticMessage: ChatMessage = pending.anchorMessage
      ? {
          ...pending.anchorMessage,
          content: null,
          role: 'assistant',
          toolCalls: null,
          toolCallId: null,
        }
      : {
          id: syntheticId,
          sessionId: syntheticSessionId,
          role: 'assistant',
          content: null,
          toolCalls: null,
          toolCallId: null,
          tokenUsage: null,
          promptTokens: null,
          completionTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          costUsd: null,
          modelId: null,
          modelName: null,
          agentId: null,
          agentName: null,
          agentAvatarType: null,
          agentAvatarValue: null,
          reasoningContent: null,
          reasoningDurationMs: null,
          imageUrls: null,
          createdAt: syntheticCreatedAt,
        };

    result.push({
      message: syntheticMessage,
      embeddedTools: pending.invocations,
      mergedMessageIds: pending.mergedMessageIds,
      preToolContent,
      ...resolveToolApprovalState(syntheticMessage, pending.invocations),
    });
    pending = null;
  };

  for (const message of messages) {
    if (message.role === 'assistant') {
      const parsedToolCalls = parseToolCalls(message.toolCalls);
      if (parsedToolCalls.length > 0) {
        if (!pending) {
          pending = {
            anchorMessage: message,
            invocations: [],
            mergedMessageIds: [],
            preToolContents: [],
          };
        }
        if (!pending.anchorMessage) {
          pending.anchorMessage = message;
        }
        pending.mergedMessageIds.push(message.id);
        const assistantContent = message.content?.trim();
        if (assistantContent) {
          pending.preToolContents.push(assistantContent);
        }
        parsedToolCalls.forEach((toolCall, index) => {
          pending?.invocations.push({
            id: toolCall.id ?? `tool-${message.id}-${index}`,
            name: toolCall.name,
            argumentsText: toolCall.argumentsText,
            resultText: null,
          });
        });
        continue;
      }

      if (pending && pending.invocations.length > 0) {
        const mergedIds = pending.mergedMessageIds.includes(message.id)
          ? pending.mergedMessageIds
          : [...pending.mergedMessageIds, message.id];
        const preToolContent = pending.preToolContents
          .map((item) => item.trim())
          .filter(Boolean)
          .join('\n\n') || null;
        const fallbackReasoning = pending.anchorMessage?.reasoningContent?.trim() || null;
        const mergedMessage =
          (message.reasoningContent?.trim() || null) == null && fallbackReasoning
            ? {
                ...message,
                reasoningContent: fallbackReasoning,
                reasoningDurationMs:
                  message.reasoningDurationMs ?? pending.anchorMessage?.reasoningDurationMs ?? null,
              }
            : message;
        result.push({
          message: mergedMessage,
          embeddedTools: pending.invocations,
          mergedMessageIds: mergedIds,
          preToolContent,
          ...resolveToolApprovalState(mergedMessage, pending.invocations),
        });
        pending = null;
        continue;
      }
    }

    if (message.role === 'tool') {
      if (!pending) {
        pending = {
          anchorMessage: null,
          invocations: [],
          mergedMessageIds: [],
          preToolContents: [],
        };
      }
      pending.mergedMessageIds.push(message.id);
      const resultText = message.content?.trim() || '(空返回)';
      const callId = message.toolCallId?.trim() || '';

      if (callId) {
        const matched = [...pending.invocations].reverse().find((item) => item.id === callId);
        if (matched) {
          matched.resultText = matched.resultText ? `${matched.resultText}\n${resultText}` : resultText;
        } else {
          pending.invocations.push({
            id: callId,
            name: '工具',
            argumentsText: null,
            resultText,
          });
        }
      } else {
        const unresolved = pending.invocations.find((item) => !item.resultText);
        if (unresolved) {
          unresolved.resultText = resultText;
        } else {
          pending.invocations.push({
            id: `tool-${message.id}`,
            name: '工具',
            argumentsText: null,
            resultText,
          });
        }
      }
      continue;
    }

    if (pending && pending.invocations.length > 0) {
      flushPendingAsStandalone();
    }

    result.push({
      message,
      embeddedTools: [],
      mergedMessageIds: [message.id],
      preToolContent: null,
      requiresToolApproval: false,
      approvalMessageId: null,
    });
  }

  if (pending && pending.invocations.length > 0) {
    flushPendingAsStandalone();
  }

  return result;
}

function resolveSelectionActionPosition(rect: DOMRect): { top: number; left: number } {
  const horizontalMargin = 88;
  const left = Math.min(
    window.innerWidth - horizontalMargin,
    Math.max(horizontalMargin, rect.left + rect.width / 2),
  );

  const preferredTop = rect.top - 46;
  const fallbackTop = rect.bottom + 10;
  const top = preferredTop >= 8 ? preferredTop : Math.min(window.innerHeight - 44, fallbackTop);

  return { top, left };
}

function buildMessageMarkdown(message: ChatMessage): string {
  const images = parseImageUrls(message.imageUrls);
  const parts: string[] = [];

  if (images.length > 0) {
    images.forEach((url, index) => {
      parts.push(`![图片${index + 1}](${url})`);
    });
  }

  if (message.content?.trim()) {
    parts.push(message.content.trim());
  }

  return parts.join('\n\n');
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`文件读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function normalizeCodeLanguage(rawLanguage: string | null | undefined): string {
  if (!rawLanguage) {
    return '';
  }
  const normalized = rawLanguage.trim().toLowerCase();
  return CODE_LANGUAGE_ALIAS_MAP[normalized] ?? normalized;
}

function toCodeLanguageLabel(language: string): string {
  if (!language) {
    return 'Text';
  }
  return CODE_LANGUAGE_LABEL_MAP[language] ?? language;
}

function toCodeFileExtension(language: string): string {
  if (!language) {
    return 'txt';
  }
  return CODE_EXTENSION_MAP[language] ?? 'txt';
}

function createTimestampSuffix(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(
    2,
    '0',
  )}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
    now.getSeconds(),
  ).padStart(2, '0')}`;
}

function canRunAsHtml(code: string, language: string): boolean {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === 'html') {
    return true;
  }
  if (normalized === 'xml' && /<html[\s>]/i.test(code)) {
    return true;
  }

  return /^\s*<!doctype\s+html/i.test(code) || /<html[\s>]/i.test(code);
}

function createCodeBlockSourceKey(messageId: number | null | undefined, blockIndex: number): string | null {
  if (messageId == null || messageId <= 0) {
    return null;
  }
  if (blockIndex < 0) {
    return null;
  }
  return `msg-${messageId}-code-${blockIndex}`;
}

function openHtmlCodePreview(code: string): void {
  const blob = new Blob([code], { type: 'text/html;charset=utf-8' });
  const previewUrl = URL.createObjectURL(blob);
  window.open(previewUrl, '_blank', 'noopener,noreferrer');
  // 预留足够时间给新标签页完成加载，避免过早回收导致页面无法打开。
  window.setTimeout(() => {
    URL.revokeObjectURL(previewUrl);
  }, 60_000);
}
function normalizeExportFileName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toMessageRoleLabel(role: ChatMessage['role']): string {
  if (role === 'user') {
    return '用户';
  }
  if (role === 'assistant') {
    return '助手';
  }
  if (role === 'tool') {
    return '工具';
  }
  return role;
}

function renderMarkdownHtmlForExport(markdown: string): string {
  if (!markdown.trim()) {
    return '<p>(空消息)</p>';
  }

  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlightMarks]}
    >
      {markdown}
    </ReactMarkdown>,
  );
}

function buildSessionExportMarkdown(sessionTitle: string, messages: ChatMessage[]): string {
  const parts: string[] = [
    `# ${sessionTitle || '未命名会话'}`,
    '',
    `导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    '',
    '---',
  ];

  messages.forEach((message) => {
    parts.push('', `## ${toMessageRoleLabel(message.role)}`);

    if (message.modelName) {
      parts.push(`- 模型：${message.modelName}`);
    }
    if (message.createdAt) {
      parts.push(`- 时间：${formatDateTime(message.createdAt)}`);
    }

    const reasoning = message.reasoningContent?.trim();
    if (reasoning) {
      parts.push('', '### 思考过程', '', reasoning);
    }

    const body = buildMessageMarkdown(message);
    parts.push('', body || '(空消息)', '', '---');
  });

  return parts.join('\n');
}

function buildSessionExportHtml(sessionTitle: string, messages: ChatMessage[]): string {
  const escapedTitle = escapeHtml(sessionTitle || '未命名会话');
  const exportedAt = escapeHtml(new Date().toLocaleString('zh-CN', { hour12: false }));
  const entries = messages
    .map((message) => {
      const role = escapeHtml(toMessageRoleLabel(message.role));
      const modelName = message.modelName ? escapeHtml(message.modelName) : '';
      const createdAt = message.createdAt ? escapeHtml(formatDateTime(message.createdAt)) : '';
      const reasoning = message.reasoningContent?.trim() ? escapeHtml(message.reasoningContent.trim()) : '';
      const markdownBody = buildMessageMarkdown(message);
      const markdownHtml = renderMarkdownHtmlForExport(markdownBody);

      return `
        <section class="message">
          <h2>${role}</h2>
          ${modelName ? `<p class="meta">模型：${modelName}</p>` : ''}
          ${createdAt ? `<p class="meta">时间：${createdAt}</p>` : ''}
          ${reasoning ? `<h3>思考过程</h3><pre>${reasoning}</pre>` : ''}
          <div class="markdown">${markdownHtml}</div>
        </section>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="zh-CN">
      <head>
        <meta charset="utf-8" />
        <title>${escapedTitle}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
            margin: 24px;
            color: #0f172a;
            background: #ffffff;
          }
          h1 {
            margin: 0 0 8px 0;
            font-size: 24px;
          }
          .export-meta {
            margin: 0 0 20px 0;
            color: #64748b;
            font-size: 12px;
          }
          .message {
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 12px;
            page-break-inside: avoid;
          }
          .message h2 {
            margin: 0 0 6px 0;
            font-size: 16px;
          }
          .message h3 {
            margin: 10px 0 6px 0;
            font-size: 13px;
            color: #334155;
          }
          .meta {
            margin: 2px 0;
            font-size: 12px;
            color: #64748b;
          }
          pre {
            margin: 8px 0 0 0;
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 13px;
            line-height: 1.6;
            background: #f8fafc;
            border-radius: 8px;
            padding: 10px;
          }
          .markdown {
            margin-top: 8px;
            color: #0f172a;
            line-height: 1.75;
          }
          .markdown > :first-child {
            margin-top: 0;
          }
          .markdown > :last-child {
            margin-bottom: 0;
          }
          .markdown p,
          .markdown ul,
          .markdown ol,
          .markdown blockquote,
          .markdown table,
          .markdown pre {
            margin: 0.65em 0;
          }
          .markdown h1,
          .markdown h2,
          .markdown h3,
          .markdown h4,
          .markdown h5,
          .markdown h6 {
            margin: 1.05em 0 0.55em;
            font-weight: 700;
            line-height: 1.4;
          }
          .markdown h1 { font-size: 1.5em; }
          .markdown h2 { font-size: 1.32em; }
          .markdown h3 { font-size: 1.2em; }
          .markdown h4,
          .markdown h5,
          .markdown h6 { font-size: 1.05em; }
          .markdown ul,
          .markdown ol {
            padding-left: 1.5em;
          }
          .markdown li + li {
            margin-top: 0.32em;
          }
          .markdown blockquote {
            margin: 0.7em 0;
            padding-left: 0.85em;
            border-left: 3px solid #cbd5e1;
            color: #475569;
          }
          .markdown code {
            font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
            font-size: 0.92em;
            background: #f1f5f9;
            border-radius: 6px;
            padding: 0.1em 0.35em;
          }
          .markdown pre {
            margin: 0.75em 0;
            border-radius: 10px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            overflow-x: auto;
            padding: 10px 12px;
          }
          .markdown pre code {
            background: transparent;
            padding: 0;
            border-radius: 0;
            white-space: pre;
          }
          .markdown table {
            width: 100%;
            border-collapse: collapse;
          }
          .markdown th,
          .markdown td {
            border: 1px solid #cbd5e1;
            padding: 6px 8px;
            text-align: left;
            vertical-align: top;
          }
          .markdown th {
            background: #f8fafc;
            font-weight: 600;
          }
          .markdown img {
            max-width: min(100%, 520px);
            border-radius: 8px;
            border: 1px solid #cbd5e1;
          }
          .markdown .katex-display {
            margin: 0.8em 0;
            overflow-x: auto;
            overflow-y: hidden;
            padding: 2px 0;
          }
          .katex {
            font: normal 1.1em KaTeX_Main, "Times New Roman", serif;
            line-height: 1.2;
          }
          ${katexCssText}
        </style>
      </head>
      <body>
        <h1>${escapedTitle}</h1>
        <p class="export-meta">导出时间：${exportedAt}</p>
        ${entries}
      </body>
    </html>
  `;
}

function printHtmlAsPdf(html: string): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  iframe.style.border = '0';

  let cleaned = false;
  let fallbackTimer: number | null = null;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (fallbackTimer != null) {
      window.clearTimeout(fallbackTimer);
    }
    try {
      if (iframe.contentWindow) {
        iframe.contentWindow.onafterprint = null;
      }
    } catch {
      // 忽略清理阶段异常。
    }
    iframe.remove();
  };

  iframe.onload = () => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) {
      cleanup();
      return;
    }

    frameWindow.onafterprint = () => {
      cleanup();
    };

    window.setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch (error) {
        console.error('PDF 打印触发失败', error);
        cleanup();
      }
    }, 80);
  };

  document.body.appendChild(iframe);
  const frameDocument = iframe.contentDocument;
  if (!frameDocument) {
    cleanup();
    return;
  }

  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();

  // 某些浏览器不会触发 onafterprint，兜底自动清理 iframe。
  fallbackTimer = window.setTimeout(() => {
    cleanup();
  }, 60_000);
}

function parseSvgDimension(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function readSvgSize(svgMarkup: string): { width: number; height: number } {
  try {
    const parser = new DOMParser();
    const documentElement = parser.parseFromString(svgMarkup, 'image/svg+xml').documentElement;
    const width = parseSvgDimension(documentElement.getAttribute('width'));
    const height = parseSvgDimension(documentElement.getAttribute('height'));

    if (width && height) {
      return { width, height };
    }

    const viewBox = documentElement.getAttribute('viewBox');
    if (viewBox) {
      const values = viewBox
        .split(/[\s,]+/)
        .map((item) => Number.parseFloat(item))
        .filter((item) => Number.isFinite(item));
      if (values.length === 4 && values[2] > 0 && values[3] > 0) {
        return { width: values[2], height: values[3] };
      }
    }
  } catch {
    // 解析失败时走兜底尺寸。
  }

  return { width: 1200, height: 800 };
}

async function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图像加载失败'));
    image.src = src;
  });
}

async function renderSvgToRasterBlob(svgMarkup: string, format: Exclude<ExportImageFormat, 'svg'>): Promise<Blob> {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImageElement(svgUrl);
    const { width, height } = readSvgSize(svgMarkup);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 上下文不可用');
    }

    if (format === 'jpeg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (!result) {
            reject(new Error('图像导出失败'));
            return;
          }
          resolve(result);
        },
        mimeType,
        format === 'jpeg' ? 0.92 : undefined,
      );
    });
    return blob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function getHighlightJsApi(): Promise<HighlightJsApi> {
  if (!highlightJsLoader) {
    highlightJsLoader = import('highlight.js/lib/common').then((module) => module.default as unknown as HighlightJsApi);
  }
  return highlightJsLoader;
}

type HastNode = {
  type: string;
  value?: string;
  tagName?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
};

type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

function splitHighlightSegments(text: string): HighlightSegment[] {
  const pattern = /==([^=\n][\s\S]*?)==/g;
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null = pattern.exec(text);

  while (match) {
    const start = match.index;
    const end = pattern.lastIndex;

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), highlighted: false });
    }

    const content = match[1];
    if (content) {
      segments.push({ text: content, highlighted: true });
    } else {
      segments.push({ text: match[0], highlighted: false });
    }

    cursor = end;
    match = pattern.exec(text);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), highlighted: false });
  }

  if (segments.length === 0) {
    segments.push({ text, highlighted: false });
  }
  return segments;
}

function applyHighlightSyntax(node: HastNode, insideLiteral = false): void {
  if (!node || !Array.isArray(node.children)) {
    return;
  }

  const currentInsideLiteral =
    insideLiteral || (node.type === 'element' && (node.tagName === 'pre' || node.tagName === 'code'));
  const nextChildren: HastNode[] = [];

  for (const child of node.children) {
    if (
      !currentInsideLiteral &&
      child.type === 'text' &&
      typeof child.value === 'string' &&
      child.value.includes('==')
    ) {
      const segments = splitHighlightSegments(child.value);
      const hasHighlighted = segments.some((segment) => segment.highlighted);
      if (!hasHighlighted) {
        nextChildren.push(child);
        continue;
      }

      for (const segment of segments) {
        if (!segment.text) {
          continue;
        }
        if (segment.highlighted) {
          nextChildren.push({
            type: 'element',
            tagName: 'mark',
            properties: {},
            children: [{ type: 'text', value: segment.text }],
          });
        } else {
          nextChildren.push({ type: 'text', value: segment.text });
        }
      }
      continue;
    }

    applyHighlightSyntax(child, currentInsideLiteral);
    nextChildren.push(child);
  }

  node.children = nextChildren;
}

function rehypeHighlightMarks() {
  return (tree: HastNode) => {
    applyHighlightSyntax(tree);
  };
}

const ToolbarIconButton: React.FC<{
  title: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ title, onClick, children, disabled = false }) => {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className="chat-toolbar-icon-button"
    >
      {children}
    </button>
  );
};

const MermaidBlock: React.FC<{ chart: string; isStreaming: boolean }> = ({ chart, isStreaming }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderSeedRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 9)}`);
  const renderIndexRef = useRef(0);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [svgMarkup, setSvgMarkup] = useState('');
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportImageFormat | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const render = async () => {
      if (!containerRef.current) {
        return;
      }

      // 流式输出阶段 Mermaid 文本可能尚未完整，先展示“生成中”占位，避免全局语法报错污染页面。
      if (isStreaming) {
        containerRef.current.innerHTML = '';
        setRenderError(null);
        setSvgMarkup('');
        return;
      }

      if (!chart.trim()) {
        containerRef.current.innerHTML = '';
        setRenderError(null);
        setSvgMarkup('');
        return;
      }

      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;
        const parseErrorHandler = (mermaid as unknown as { setParseErrorHandler?: (handler: (err: any, hash: any) => void) => void })
          .setParseErrorHandler;
        parseErrorHandler?.(() => {
          // 屏蔽 Mermaid 全局 parseError 输出，错误仅在当前消息卡片内展示。
        });
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'default',
        });

        renderIndexRef.current += 1;
        const renderId = `${renderSeedRef.current}-${renderIndexRef.current}`;
        const { svg } = await mermaid.render(renderId, chart);

        if (cancelled || !containerRef.current) {
          return;
        }

        containerRef.current.innerHTML = svg;
        setSvgMarkup(svg);
        setRenderError(null);
      } catch (error: any) {
        if (cancelled) {
          return;
        }
        setSvgMarkup('');
        setRenderError(error?.message ?? '渲染失败');
      }
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [chart, isStreaming]);

  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (exportMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setExportMenuOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), TOOLBAR_FEEDBACK_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  useEffect(() => {
    if (!downloaded) {
      return;
    }
    const timer = window.setTimeout(() => setDownloaded(false), TOOLBAR_FEEDBACK_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [downloaded]);

  const handleExport = async (format: ExportImageFormat): Promise<void> => {
    if (!svgMarkup) {
      return;
    }
    setExportingFormat(format);
    try {
      if (format === 'svg') {
        const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
        triggerBlobDownload(blob, `mermaid-${createTimestampSuffix()}.svg`);
      } else {
        const blob = await renderSvgToRasterBlob(svgMarkup, format);
        triggerBlobDownload(blob, `mermaid-${createTimestampSuffix()}.${format}`);
      }
      setDownloaded(true);
    } catch (error) {
      console.error('Mermaid 导出失败', error);
    } finally {
      setExportingFormat(null);
      setExportMenuOpen(false);
    }
  };

  const statusText = isStreaming ? '图表生成中，等待输出完成后自动渲染' : renderError ? '图表无法渲染，请检查 Mermaid 语法' : null;
  const statusClassName = isStreaming ? 'chat-mermaid-status chat-mermaid-status--pending' : 'chat-mermaid-status chat-mermaid-status--error';

  return (
    <div className="chat-mermaid-card">
      <div className="chat-code-toolbar">
        <span className="chat-code-language">Mermaid</span>
        <div className="flex items-center gap-1">
          {downloaded ? (
            <span className="chat-toolbar-feedback">已下载</span>
          ) : (
            <div ref={exportMenuRef} className="relative">
              <ToolbarIconButton
                title="下载图表"
                onClick={() => setExportMenuOpen((prev) => !prev)}
                disabled={Boolean(exportingFormat) || Boolean(isStreaming || renderError || !svgMarkup)}
              >
                <DownloadIcon />
              </ToolbarIconButton>
              {exportMenuOpen && !isStreaming && !renderError && (
                <div className="chat-export-menu">
                  <button
                    type="button"
                    className="chat-export-menu-item"
                    onClick={() => {
                      void handleExport('svg');
                    }}
                    disabled={Boolean(exportingFormat)}
                  >
                    导出 SVG
                  </button>
                  <button
                    type="button"
                    className="chat-export-menu-item"
                    onClick={() => {
                      void handleExport('png');
                    }}
                    disabled={Boolean(exportingFormat)}
                  >
                    导出 PNG
                  </button>
                  <button
                    type="button"
                    className="chat-export-menu-item"
                    onClick={() => {
                      void handleExport('jpeg');
                    }}
                    disabled={Boolean(exportingFormat)}
                  >
                    导出 JPEG
                  </button>
                </div>
              )}
            </div>
          )}

          {copied ? (
            <span className="chat-toolbar-feedback">已复制</span>
          ) : (
            <ToolbarIconButton
              title="复制 Mermaid 代码"
              onClick={() => {
                void copyTextToClipboard(chart)
                  .then(() => setCopied(true))
                  .catch((error) => {
                    console.error('Mermaid 代码复制失败', error);
                  });
              }}
              disabled={Boolean(isStreaming || !chart.trim())}
            >
              <CopyIcon />
            </ToolbarIconButton>
          )}
        </div>
      </div>

      <div ref={containerRef} className={`chat-mermaid ${statusText ? 'hidden' : ''}`} />
      {statusText && <div className={statusClassName}>{statusText}</div>}
    </div>
  );
};

function getMarkdownCodeText(raw: unknown): string | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    return raw.replace(/\n$/, '');
  }
  if (Array.isArray(raw)) {
    return raw
      .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
      .join('')
      .replace(/\n$/, '');
  }
  return String(raw).replace(/\n$/, '');
}

const CodeBlock: React.FC<{
  language: string;
  code: string;
  sourceKey: string | null;
  sourceSessionId: number | null;
  sourceSessionTitle: string | null;
  sourceMessageId: number | null;
  sourceModelId: number | null;
  sourceModelName: string | null;
  savedInAppCenter: boolean;
  onAddToAppCenter?: (payload: SaveCodeBlockPayload) => void;
}> = ({
  language,
  code,
  sourceKey,
  sourceSessionId,
  sourceSessionTitle,
  sourceMessageId,
  sourceModelId,
  sourceModelName,
  savedInAppCenter,
  onAddToAppCenter,
}) => {
  const [highlightedHtml, setHighlightedHtml] = useState(() => escapeHtml(code));
  const [resolvedLanguage, setResolvedLanguage] = useState(() => normalizeCodeLanguage(language));
  const [copied, setCopied] = useState(false);
  const [downloaded, setDownloaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const highlightCode = async () => {
      const normalizedLanguage = normalizeCodeLanguage(language);

      try {
        const highlightJs = await getHighlightJsApi();
        let html = '';
        let finalLanguage = normalizedLanguage;

        if (normalizedLanguage && highlightJs.getLanguage(normalizedLanguage)) {
          html = highlightJs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value;
        } else {
          const autoHighlighted = highlightJs.highlightAuto(code);
          html = autoHighlighted.value;
          finalLanguage = autoHighlighted.language ?? normalizedLanguage;
        }

        if (!cancelled) {
          setHighlightedHtml(html || escapeHtml(code));
          setResolvedLanguage(finalLanguage);
        }
      } catch {
        if (!cancelled) {
          setHighlightedHtml(escapeHtml(code));
          setResolvedLanguage(normalizedLanguage);
        }
      }
    };

    void highlightCode();
    return () => {
      cancelled = true;
    };
  }, [language, code]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = window.setTimeout(() => setCopied(false), TOOLBAR_FEEDBACK_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  useEffect(() => {
    if (!downloaded) {
      return;
    }

    const timer = window.setTimeout(() => setDownloaded(false), TOOLBAR_FEEDBACK_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [downloaded]);

  const currentLanguage = resolvedLanguage || normalizeCodeLanguage(language) || 'plaintext';
  const displayLanguage = toCodeLanguageLabel(currentLanguage);
  const fileExtension = toCodeFileExtension(currentLanguage);
  const canRunHtml = canRunAsHtml(code, currentLanguage);
  const canAddToAppCenter = canRunHtml && Boolean(sourceKey && onAddToAppCenter);

  return (
    <div className="chat-code-block">
      <div className="chat-code-toolbar">
        <span className="chat-code-language">{displayLanguage}</span>
        <div className="flex items-center gap-1">
          {canAddToAppCenter && (
            <ToolbarIconButton
              title={savedInAppCenter ? '该代码块已在应用中心' : '添加到应用中心'}
              onClick={() => {
                if (!sourceKey || !onAddToAppCenter || savedInAppCenter) {
                  return;
                }
                onAddToAppCenter({
                  sourceKey,
                  sourceSessionId,
                  sourceSessionTitle,
                  sourceMessageId,
                  sourceModelId,
                  sourceModelName,
                  language: currentLanguage,
                  codeContent: code,
                });
              }}
              disabled={savedInAppCenter}
            >
              <AddToAppIcon />
            </ToolbarIconButton>
          )}

          {canRunHtml && (
            <ToolbarIconButton
              title="运行 HTML"
              onClick={() => {
                openHtmlCodePreview(code);
              }}
            >
              <RunHtmlIcon />
            </ToolbarIconButton>
          )}

          {downloaded ? (
            <span className="chat-toolbar-feedback">已下载</span>
          ) : (
            <ToolbarIconButton
              title="下载代码"
              onClick={() => {
                const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
                triggerBlobDownload(blob, `code-${createTimestampSuffix()}.${fileExtension}`);
                setDownloaded(true);
              }}
            >
              <DownloadIcon />
            </ToolbarIconButton>
          )}

          {copied ? (
            <span className="chat-toolbar-feedback">已复制</span>
          ) : (
            <ToolbarIconButton
              title="复制代码"
              onClick={() => {
                void copyTextToClipboard(code)
                  .then(() => setCopied(true))
                  .catch((error) => {
                    console.error('代码复制失败', error);
                  });
              }}
            >
              <CopyIcon />
            </ToolbarIconButton>
          )}
        </div>
      </div>

      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      </pre>
    </div>
  );
};

const MessageMarkdown: React.FC<{
  content: string;
  isStreaming: boolean;
  messageId?: number | null;
  sourceSessionId?: number | null;
  sourceSessionTitle?: string | null;
  sourceModelId?: number | null;
  sourceModelName?: string | null;
  onAddToAppCenter?: (payload: SaveCodeBlockPayload) => void;
  savedSourceKeySet?: Set<string>;
}> = ({
  content,
  isStreaming,
  messageId = null,
  sourceSessionId = null,
  sourceSessionTitle = null,
  sourceModelId = null,
  sourceModelName = null,
  onAddToAppCenter,
  savedSourceKeySet,
}) => {
  const markdownComponents = useMemo(() => {
    let codeBlockIndex = 0;

    return {
      pre: ({ children, ...props }: any) => {
        const firstChild = Array.isArray(children) ? children[0] : children;
        const className = firstChild?.props?.className ?? '';
        const language = normalizeCodeLanguage(/language-([^\s]+)/i.exec(className)?.[1] ?? '');
        const code = getMarkdownCodeText(firstChild?.props?.children);

        if (code == null) {
          return <pre {...props}>{children}</pre>;
        }

        const sourceKey = createCodeBlockSourceKey(messageId, codeBlockIndex);
        codeBlockIndex += 1;

        if (language === 'mermaid') {
          return <MermaidBlock chart={code} isStreaming={isStreaming} />;
        }

        return (
          <CodeBlock
            language={language}
            code={code}
            sourceKey={sourceKey}
            sourceSessionId={sourceSessionId}
            sourceSessionTitle={sourceSessionTitle}
            sourceMessageId={messageId}
            sourceModelId={sourceModelId}
            sourceModelName={sourceModelName}
            savedInAppCenter={sourceKey != null && (savedSourceKeySet?.has(sourceKey) ?? false)}
            onAddToAppCenter={onAddToAppCenter}
          />
        );
      },
    };
  }, [
    isStreaming,
    messageId,
    onAddToAppCenter,
    savedSourceKeySet,
    sourceSessionId,
    sourceSessionTitle,
    sourceModelId,
    sourceModelName,
  ]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlightMarks]}
      components={markdownComponents}
    >
      {content}
    </ReactMarkdown>
  );
};

const StreamingMessageMarkdown: React.FC<{ content: string }> = ({ content }) => {
  const [markdownSnapshot, setMarkdownSnapshot] = useState('');
  const lastCommitAtRef = useRef<number>(0);
  const commitTimerRef = useRef<number | null>(null);
  const latestContentRef = useRef(content);

  const clearCommitTimer = () => {
    if (commitTimerRef.current == null) {
      return;
    }
    window.clearTimeout(commitTimerRef.current);
    commitTimerRef.current = null;
  };

  const commitSnapshot = useCallback((nextContent: string) => {
    clearCommitTimer();
    setMarkdownSnapshot(nextContent);
    lastCommitAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    latestContentRef.current = content;

    if (!content) {
      commitSnapshot('');
      return;
    }

    // 首屏先尽快展示，避免流式开始时短暂无内容。
    if (!markdownSnapshot) {
      commitSnapshot(content);
      return;
    }

    if (markdownSnapshot.length > content.length) {
      commitSnapshot(content);
      return;
    }

    const pendingChars = content.length - markdownSnapshot.length;
    if (pendingChars <= 0) {
      return;
    }

    const tail = content.slice(markdownSnapshot.length);
    const interval = resolveStreamMarkdownInterval(content.length);
    const elapsed = Date.now() - lastCommitAtRef.current;
    const hasNaturalBoundary = tail.includes('\n') || /[。！？!?;；:：]$/.test(tail);
    const shouldCommitImmediately =
      pendingChars >= STREAM_MARKDOWN_FORCE_COMMIT_CHARS ||
      (pendingChars >= STREAM_MARKDOWN_MIN_COMMIT_CHARS && hasNaturalBoundary) ||
      elapsed >= interval;

    if (shouldCommitImmediately) {
      commitSnapshot(content);
      return;
    }

    clearCommitTimer();
    commitTimerRef.current = window.setTimeout(() => {
      // 定时提交时始终使用最新内容，避免闭包拿到过期 content 造成“回跳”。
      commitSnapshot(latestContentRef.current);
      commitTimerRef.current = null;
    }, Math.max(24, interval - elapsed));
  }, [content, markdownSnapshot, commitSnapshot]);

  useEffect(
    () => () => {
      clearCommitTimer();
    },
    [],
  );

  return <MessageMarkdown content={markdownSnapshot} isStreaming />;
};

const MessageAvatar: React.FC<{ type: 'assistant' | 'user' | 'tool' }> = ({ type }) => {
  const styleMap = {
    assistant: 'bg-emerald-500 text-white',
    user: 'bg-slate-700 text-white dark:bg-slate-200 dark:text-slate-900',
    tool: 'bg-amber-500 text-white',
  } as const;

  const labelMap = {
    assistant: 'AI',
    user: '你',
    tool: '工',
  } as const;

  return (
    <div
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${styleMap[type]}`}
    >
      {labelMap[type]}
    </div>
  );
};

const IconActionButton: React.FC<{
  tooltip: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}> = ({ tooltip, onClick, danger = false, children }) => {
  return (
    <button
      onClick={onClick}
      className={`group/icon relative rounded-md p-1 transition-colors ${
        danger
          ? 'text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20'
          : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
      aria-label={tooltip}
      type="button"
    >
      {children}
      <span className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white opacity-0 transition-opacity group-hover/icon:opacity-100 dark:bg-slate-100 dark:text-slate-900">
        {tooltip}
      </span>
    </button>
  );
};

const ChevronDownIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronRightIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.5 5L12.5 10L7.5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 4V16M4 10H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const NewChatIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="3.2" width="14" height="13.6" rx="3" stroke="currentColor" strokeWidth="1.7" />
    <path d="M10 6.7V13.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M6.7 10H13.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const SearchChatIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="8.6" cy="8.6" r="5.5" stroke="currentColor" strokeWidth="1.7" />
    <path d="M12.8 12.8L16.4 16.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const SearchSessionIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M10 3.6C6.35 3.6 3.4 6.26 3.4 9.55C3.4 10.96 3.95 12.24 4.86 13.24L4.45 16.2L7.54 15.18C8.28 15.4 9.11 15.5 10 15.5C13.65 15.5 16.6 12.84 16.6 9.55C16.6 6.26 13.65 3.6 10 3.6Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
);

const SidebarAppsIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="6.2" cy="6.2" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="13.8" cy="6.2" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="6.2" cy="13.8" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="13.8" cy="13.8" r="2.1" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const NewProjectIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.9 6.2C2.9 5.43 3.53 4.8 4.3 4.8H8.2L9.5 6.2H15.7C16.47 6.2 17.1 6.83 17.1 7.6V14.8C17.1 15.57 16.47 16.2 15.7 16.2H4.3C3.53 16.2 2.9 15.57 2.9 14.8V6.2Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M10 9V13.2M7.9 11.1H12.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const SidebarProjectIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.9 6.2C2.9 5.43 3.53 4.8 4.3 4.8H8.2L9.5 6.2H15.7C16.47 6.2 17.1 6.83 17.1 7.6V14.8C17.1 15.57 16.47 16.2 15.7 16.2H4.3C3.53 16.2 2.9 15.57 2.9 14.8V6.2Z" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const CollapseIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.8" y="3.2" width="14.4" height="13.6" rx="3.8" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7.6 4.6V15.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const ExpandIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.8" y="3.2" width="14.4" height="13.6" rx="3.8" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7.6 4.6V15.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const CopyIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M6.5 15V6.8C6.5 5.81 7.31 5 8.3 5H16.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const AskSelectionIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M7.3 14.7H4.7C3.76 14.7 3 13.94 3 13V5.7C3 4.76 3.76 4 4.7 4H10.5C11.44 4 12.2 4.76 12.2 5.7V13C12.2 13.94 11.44 14.7 10.5 14.7H9.2L7.3 16.8V14.7Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.8 11.7H18.6C19.37 11.7 20 12.33 20 13.1V17.6C20 18.37 19.37 19 18.6 19H17L14.8 21V19H13.8C13.03 19 12.4 18.37 12.4 17.6V13.1C12.4 12.33 13.03 11.7 13.8 11.7Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M5.6 7.4H7.2M8.8 7.4H10.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14.8 14.9H16.4M17.6 14.9H19.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const QuoteContextIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M9 7L4 12L9 17" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 12H13.5C16.81 12 19.5 14.69 19.5 18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const RunHtmlIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 4.5L15 10L6 15.5V4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const AddToAppIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5V19" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M5 12H19" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
  </svg>
);

const DownloadIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 4.5V15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M8 11.5L12 15.5L16 11.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M5.5 19.5H18.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const BranchIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="6" r="2.1" stroke="currentColor" strokeWidth="1.8" />
    <circle cx="17" cy="18" r="2.1" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7 8.1V13C7 15.21 8.79 17 11 17H14.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const DeleteIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 7H19.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M9.5 7V5.8C9.5 4.81 10.31 4 11.3 4H12.7C13.69 4 14.5 4.81 14.5 5.8V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M7.5 7L8.2 18.1C8.27 19.12 9.12 19.9 10.14 19.9H13.86C14.88 19.9 15.73 19.12 15.8 18.1L16.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const PencilIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 20L8.6 18.9L19 8.5C19.79 7.71 19.79 6.43 19 5.64L18.36 5C17.57 4.21 16.29 4.21 15.5 5L5.1 15.4L4 20Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
  </svg>
);

const UploadIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 4V13M10 4L6.5 7.5M10 4L13.5 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 15.5H16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const SparkIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 2.8L11.9 7.2L16.3 9.1L11.9 11L10 15.4L8.1 11L3.7 9.1L8.1 7.2L10 2.8Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
);

const OutputLengthIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 6H15.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M4.5 10H12.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M4.5 14H10.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const TemperatureIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 4.2V11.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path
      d="M12 11.3V4.9C12 3.85 11.15 3 10.1 3H9.9C8.85 3 8 3.85 8 4.9V11.3C7.01 11.92 6.4 13 6.4 14.2C6.4 16.08 7.92 17.6 9.8 17.6H10.2C12.08 17.6 13.6 16.08 13.6 14.2C13.6 13 12.99 11.92 12 11.3Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ToolPermissionIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M10 2.8L15.4 5V9.7C15.4 13.1 13.3 16.2 10 17.4C6.7 16.2 4.6 13.1 4.6 9.7V5L10 2.8Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path d="M7.7 10.2L9.2 11.7L12.5 8.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MemoryIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3.6" y="5.2" width="12.8" height="9.6" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
    <path d="M7.3 5V3.7M12.7 5V3.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M7.5 9.4H12.5M7.5 12H11.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const MoreIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="5" cy="10" r="1.4" fill="currentColor" />
    <circle cx="10" cy="10" r="1.4" fill="currentColor" />
    <circle cx="15" cy="10" r="1.4" fill="currentColor" />
  </svg>
);

const InfoIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="6.8" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="10" cy="6.6" r="1" fill="currentColor" />
    <path d="M10 9.2V13.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const CheckIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.5 10.5L8 14L15.5 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ModelManageIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 3.6L15.7 6.6L10 9.6L4.3 6.6L10 3.6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M4.3 10L10 13L15.7 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.3 13.4L10 16.4L15.7 13.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AgentManageIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 3.1V5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="4.2" y="5.8" width="11.6" height="10.1" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="7.8" cy="10.3" r="1" fill="currentColor" />
    <circle cx="12.2" cy="10.3" r="1" fill="currentColor" />
    <path d="M7.3 13H12.7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const SettingsIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M19.14 12.94C19.18 12.63 19.2 12.32 19.2 12C19.2 11.68 19.18 11.37 19.14 11.06L21.17 9.48C21.36 9.34 21.41 9.07 21.29 8.86L19.37 5.54C19.25 5.33 18.99 5.24 18.76 5.33L16.37 6.29C15.86 5.9 15.31 5.57 14.73 5.35L14.37 2.8C14.34 2.56 14.13 2.4 13.89 2.4H10.11C9.87 2.4 9.66 2.56 9.63 2.8L9.27 5.35C8.69 5.57 8.14 5.9 7.63 6.29L5.24 5.33C5.01 5.24 4.75 5.33 4.63 5.54L2.71 8.86C2.59 9.07 2.64 9.34 2.83 9.48L4.86 11.06C4.82 11.37 4.8 11.68 4.8 12C4.8 12.32 4.82 12.63 4.86 12.94L2.83 14.52C2.64 14.66 2.59 14.93 2.71 15.14L4.63 18.46C4.75 18.67 5.01 18.76 5.24 18.67L7.63 17.71C8.14 18.1 8.69 18.43 9.27 18.65L9.63 21.2C9.66 21.44 9.87 21.6 10.11 21.6H13.89C14.13 21.6 14.34 21.44 14.37 21.2L14.73 18.65C15.31 18.43 15.86 18.1 16.37 17.71L18.76 18.67C18.99 18.76 19.25 18.67 19.37 18.46L21.29 15.14C21.41 14.93 21.36 14.66 21.17 14.52L19.14 12.94Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

const SunIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="10" cy="10" r="3.3" stroke="currentColor" strokeWidth="1.7" />
    <path d="M10 2.5V4.2M10 15.8V17.5M2.5 10H4.2M15.8 10H17.5M4.7 4.7L5.9 5.9M14.1 14.1L15.3 15.3M15.3 4.7L14.1 5.9M5.9 14.1L4.7 15.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
  </svg>
);

const MoonIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M16.9 13.5A7.2 7.2 0 0 1 7.2 3.8A7.8 7.8 0 1 0 16.9 13.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const TemporaryModeIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M10 3.4C13.53 3.4 16.4 6.01 16.4 9.25C16.4 12.49 13.53 15.1 10 15.1C9.44 15.1 8.9 15.03 8.38 14.9L5.5 15.9L6.44 13.58C4.82 12.54 3.8 10.99 3.8 9.25C3.8 6.01 6.67 3.4 10 3.4Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="2.2 2.2"
    />
  </svg>
);

const TemporaryModeActiveIcon: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M10 3.4C13.53 3.4 16.4 6.01 16.4 9.25C16.4 12.49 13.53 15.1 10 15.1C9.44 15.1 8.9 15.03 8.38 14.9L5.5 15.9L6.44 13.58C4.82 12.54 3.8 10.99 3.8 9.25C3.8 6.01 6.67 3.4 10 3.4Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray="2.2 2.2"
    />
    <path
      d="M8.1 9.7L9.55 11.05L12.3 8.45"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ExportPdfIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 2.8H11.5L15 6.3V16.8C15 17.46 14.46 18 13.8 18H5C4.34 18 3.8 17.46 3.8 16.8V4C3.8 3.34 4.34 2.8 5 2.8Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M11.2 2.9V6.5H14.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6.2 13.8H12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M6.2 10.8H12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const ExportMarkdownIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3.5" y="2.8" width="13" height="14.4" rx="2.1" stroke="currentColor" strokeWidth="1.6" />
    <path d="M6.5 8.3V12.8M6.5 12.8L4.9 11.2M6.5 12.8L8.1 11.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10.1 12.8V8.3L11.9 10.8L13.7 8.3V12.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ShareIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="14.6" cy="4.9" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="5.4" cy="10" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="14.6" cy="15.1" r="2.1" stroke="currentColor" strokeWidth="1.6" />
    <path d="M7.3 9L12.7 5.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <path d="M7.3 11L12.7 14.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

type ChatModelOption = {
  value: number;
  label: string;
  supportsTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
};

const ReasoningCapabilityIcon: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
    <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
    <path d="M6 18a4 4 0 0 1-1.938-.5" />
    <path d="M19.938 17.5A4 4 0 0 1 18 18" />
  </svg>
);

const VisionCapabilityIcon: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ToolsCapabilityIcon: React.FC<{ className?: string }> = ({ className = 'h-5 w-5' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.9 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

function calcModelSelectWidths(options: ChatModelOption[], activeLabel: string): { triggerWidth: number; menuWidth: number } {
  const labels = ['选择模型', ...options.map((item) => item.label)];
  const triggerLabels = ['选择模型', activeLabel];
  const maxCapabilityCount = Math.max(
    0,
    ...options.map((item) => Number(item.supportsReasoning) + Number(item.supportsVision) + Number(item.supportsTools)),
  );
  const capabilityExtra = maxCapabilityCount * 18;

  if (typeof document === 'undefined') {
    const triggerWidth = Math.max(220, Math.min(380, Math.max(...triggerLabels.map((item) => item.length)) * 13 + 42));
    const menuWidth = Math.max(triggerWidth + 16, Math.max(300, Math.min(460, Math.max(...labels.map((item) => item.length)) * 13 + capabilityExtra + 62)));
    return { triggerWidth, menuWidth };
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    const triggerWidth = Math.max(220, Math.min(380, Math.max(...triggerLabels.map((item) => item.length)) * 13 + 42));
    const menuWidth = Math.max(triggerWidth + 16, Math.max(300, Math.min(460, Math.max(...labels.map((item) => item.length)) * 13 + capabilityExtra + 62)));
    return { triggerWidth, menuWidth };
  }

  context.font = "600 16px 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
  const maxTriggerWidth = Math.max(...triggerLabels.map((item) => context.measureText(item).width));
  const maxLabelWidth = Math.max(...labels.map((item) => context.measureText(item).width));
  const viewportCap = typeof window !== 'undefined' ? Math.max(320, window.innerWidth - 320) : 460;
  const triggerWidth = Math.max(220, Math.min(380, Math.ceil(maxTriggerWidth + 42)));
  const desiredMenuWidth = Math.ceil(maxLabelWidth + capabilityExtra + 62);
  const menuMax = Math.min(460, viewportCap);
  const menuWidth = Math.max(triggerWidth + 16, Math.max(300, Math.min(menuMax, desiredMenuWidth)));
  return { triggerWidth, menuWidth };
}

const SessionItem: React.FC<{
  session: ChatSession;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
  onAbout: () => void;
  onRename: () => void;
  onCopy: () => void;
  onDelete: () => void;
}> = ({ session, active, collapsed, onSelect, onAbout, onRename, onCopy, onDelete }) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setMenuOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [menuOpen]);

  if (collapsed) {
    return (
      <button
        onClick={onSelect}
        title={session.title}
        className={`flex h-10 w-full items-center justify-center rounded-xl text-sm font-normal transition-colors ${
          active
            ? 'bg-[rgb(234,234,234)] text-[#0d0d0d] dark:bg-[#2a2a2a] dark:text-slate-100'
            : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:text-slate-300 dark:hover:bg-[#242424]'
        }`}
      >
        {session.title.slice(0, 1) || '会'}
      </button>
    );
  }

  return (
    <div
      className={`group/session relative mx-[6px] flex items-center gap-1 rounded-xl px-[10px] py-[6px] transition-colors ${
        active
          ? 'bg-[rgb(234,234,234)] text-[#0d0d0d] dark:bg-[#2a2a2a] dark:text-slate-100'
          : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:text-slate-300 dark:hover:bg-[#242424]'
      }`}
    >
      <button onClick={onSelect} className="min-w-0 flex-1 text-left leading-6">
        <p className="truncate text-[14px] font-normal leading-6">{session.title}</p>
      </button>

      <div
        ref={menuRef}
        className={`relative shrink-0 transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 group-hover/session:opacity-100 group-focus-within/session:opacity-100'
        }`}
      >
        <button
          className="rounded-lg p-1.5 text-[#8f8f8f] transition-colors hover:bg-[rgb(234,234,234)] hover:text-[#0d0d0d] dark:text-slate-300 dark:hover:bg-[#3a3a3a] dark:hover:text-slate-100"
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
          type="button"
          title="更多"
        >
          <MoreIcon />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-9 z-40 min-w-[180px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-[#2f2f2f]">
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[#0d0d0d] hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
              onClick={() => {
                setMenuOpen(false);
                onAbout();
              }}
              type="button"
            >
              <InfoIcon />
              <span>关于此聊天</span>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[#0d0d0d] hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
              onClick={() => {
                setMenuOpen(false);
                onRename();
              }}
              type="button"
            >
              <PencilIcon />
              <span>重命名</span>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-[#0d0d0d] hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
              onClick={() => {
                setMenuOpen(false);
                onCopy();
              }}
              type="button"
            >
              <CopyIcon />
              <span>复制</span>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
              type="button"
            >
              <DeleteIcon />
              <span>删除</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

type SessionAboutDialogState = {
  open: boolean;
  loading: boolean;
  session: ChatSession | null;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  error: string | null;
};

type SaveAppDialogState = {
  open: boolean;
  sourceKey: string;
  sourceSessionId: number | null;
  sourceSessionTitle: string | null;
  sourceMessageId: number | null;
  sourceModelId: number | null;
  sourceModelName: string | null;
  language: string;
  codeContent: string;
  name: string;
  iconMode: 'none' | 'emoji' | 'image';
  iconEmoji: string;
  iconImage: string;
  error: string | null;
};

function createInitialSaveAppDialogState(): SaveAppDialogState {
  return {
    open: false,
    sourceKey: '',
    sourceSessionId: null,
    sourceSessionTitle: null,
    sourceMessageId: null,
    sourceModelId: null,
    sourceModelName: null,
    language: 'html',
    codeContent: '',
    name: '',
    iconMode: 'none',
    iconEmoji: APP_ICON_EMOJIS[0],
    iconImage: '',
    error: null,
  };
}

function createInitialProjectCreateDialogState(): ProjectCreateDialogState {
  return {
    open: false,
    name: '',
    description: '',
    realDirectoryPath: '',
    realDirectoryName: '',
    error: null,
    submitting: false,
  };
}

const initialSessionAboutState: SessionAboutDialogState = {
  open: false,
  loading: false,
  session: null,
  messageCount: 0,
  firstMessageAt: null,
  lastMessageAt: null,
  error: null,
};

const SessionAboutDialog: React.FC<{
  state: SessionAboutDialogState;
  onClose: () => void;
}> = ({ state, onClose }) => {
  return (
    <Dialog open={state.open} onClose={onClose} title="关于此聊天">
      <div className="space-y-4">
        <div>
          <p className="text-xs text-slate-400 dark:text-slate-500">聊天标题</p>
          <p className="mt-1 break-words text-sm font-medium text-slate-800 dark:text-slate-100">{state.session?.title ?? '未命名会话'}</p>
        </div>
        {state.loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">正在加载...</p>
        ) : state.error ? (
          <p className="text-sm text-rose-500">{state.error}</p>
        ) : (
          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-[#242424]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">消息条数</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{state.messageCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">最开始消息时间</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{formatDateTime(state.firstMessageAt)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">最后一条消息时间</span>
              <span className="font-medium text-slate-800 dark:text-slate-100">{formatDateTime(state.lastMessageAt)}</span>
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

const ChatSearchDialog: React.FC<{
  open: boolean;
  keyword: string;
  sessions: ChatSession[];
  searchResults: ChatSearchResult[];
  searchLoading: boolean;
  currentSessionId: number | null;
  onKeywordChange: (keyword: string) => void;
  onClose: () => void;
  onCreateSession: () => void;
  onSelectSession: (sessionId: number, messageId?: number | null) => void;
}> = ({
  open,
  keyword,
  sessions,
  searchResults,
  searchLoading,
  currentSessionId,
  onKeywordChange,
  onClose,
  onCreateSession,
  onSelectSession,
}) => {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trimmedKeyword = keyword.trim();

  const groupedSessionsWhenIdle = useMemo(() => {
    const recent: ChatSession[] = [];
    const older: ChatSession[] = [];
    sessions.forEach((session) => {
      const timestamp = session.updatedAt || session.createdAt;
      if (isWithinDays(timestamp, 7)) {
        recent.push(session);
      } else {
        older.push(session);
      }
    });
    return { recent, older };
  }, [sessions]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[1.5px]" onClick={onClose}>
      <div
        className="mx-auto mt-20 w-[min(840px,calc(100vw-30px))] overflow-hidden rounded-2xl border border-[rgb(209,209,209)] bg-[#f7f7f8] shadow-2xl dark:border-slate-700 dark:bg-[#2a2a2a]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[rgb(209,209,209)] px-4 py-3 dark:border-slate-700">
          <SearchChatIcon className="h-5 w-5 text-[#8f8f8f]" />
          <input
            ref={searchInputRef}
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            placeholder="搜索聊天..."
            className="h-10 flex-1 border-none bg-transparent text-[15px] font-normal text-[#0d0d0d] outline-none placeholder:text-[#8f8f8f] dark:text-slate-100"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#8f8f8f] transition-colors hover:bg-[rgb(239,239,239)] hover:text-[#0d0d0d] dark:hover:bg-[#3a3a3a] dark:hover:text-slate-100"
            title="关闭"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M5.2 5.2L14.8 14.8M14.8 5.2L5.2 14.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-2">
          <button
            type="button"
            onClick={onCreateSession}
            className="mb-2 flex w-full items-center gap-2 rounded-xl bg-[rgb(234,234,234)] px-4 py-3 text-left text-[15px] font-medium text-[#0d0d0d] transition-colors hover:bg-[rgb(228,228,228)] dark:bg-[#3a3a3a] dark:text-slate-100 dark:hover:bg-[#454545]"
          >
            <NewChatIcon />
            <span>新聊天</span>
          </button>

          {trimmedKeyword ? (
            searchLoading ? (
              <div className="px-2 py-6 text-center text-sm text-[#8f8f8f] dark:text-slate-400">正在搜索...</div>
            ) : searchResults.length === 0 ? (
              <div className="px-2 py-6 text-center text-sm text-[#8f8f8f] dark:text-slate-400">没有匹配的聊天</div>
            ) : (
              <div className="space-y-1">
                {searchResults.map((result) => {
                  const active = currentSessionId === result.sessionId;
                  return (
                    <button
                      key={`${result.sessionId}-${result.matchedMessageId ?? 'title'}`}
                      type="button"
                      onClick={() => onSelectSession(result.sessionId, result.matchedMessageId)}
                      className={`flex w-full items-start gap-2 rounded-xl px-3 py-2.5 text-left transition-colors ${
                        active
                          ? 'bg-[rgb(234,234,234)] text-[#0d0d0d] dark:bg-[#3a3a3a] dark:text-slate-100'
                          : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] dark:text-slate-200 dark:hover:bg-[#343434]'
                      }`}
                    >
                      <span className="mt-0.5 shrink-0 text-[#4b5563] dark:text-slate-400">
                        <SearchSessionIcon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-medium leading-6">{result.title}</span>
                          {result.matchedAt && (
                            <span className="shrink-0 text-[12px] text-[#8f8f8f]">{formatMonthDay(result.matchedAt)}</span>
                          )}
                        </span>
                        {result.snippet && (
                          <span className="mt-0.5 block truncate text-[13px] leading-5 text-[#6b7280] dark:text-slate-400">
                            {result.snippet}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <>
              {groupedSessionsWhenIdle.recent.length > 0 && (
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-[#8f8f8f]">前 7 天</p>
              )}
              {groupedSessionsWhenIdle.recent.map((session) => {
                const active = currentSessionId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${
                      active
                        ? 'bg-[rgb(234,234,234)] text-[#0d0d0d] dark:bg-[#3a3a3a] dark:text-slate-100'
                        : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] dark:text-slate-200 dark:hover:bg-[#343434]'
                    }`}
                  >
                    <SearchSessionIcon />
                    <span className="truncate">{session.title}</span>
                  </button>
                );
              })}

              {groupedSessionsWhenIdle.older.length > 0 && (
                <p className="px-3 pb-1 pt-3 text-xs font-medium text-[#8f8f8f]">更早</p>
              )}
              {groupedSessionsWhenIdle.older.map((session) => {
                const active = currentSessionId === session.id;
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onSelectSession(session.id)}
                    className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] transition-colors ${
                      active
                        ? 'bg-[rgb(234,234,234)] text-[#0d0d0d] dark:bg-[#3a3a3a] dark:text-slate-100'
                        : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] dark:text-slate-200 dark:hover:bg-[#343434]'
                    }`}
                  >
                    <SearchSessionIcon />
                    <span className="truncate">{session.title}</span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const ContextUsageIndicator: React.FC<{
  stats: ChatSessionContextStats | null;
  loading: boolean;
  tooltipPlacement?: 'top' | 'bottom';
}> = ({ stats, loading, tooltipPlacement = 'top' }) => {
  const ratio = Math.max(0, Math.min(1, stats?.contextUsageRatio ?? 0));
  const degree = Math.round(ratio * 360);
  const ringColor = ratio >= 0.85 ? '#ef4444' : ratio >= 0.65 ? '#f59e0b' : '#64748b';
  const ratioText = `${(ratio * 100).toFixed(1)}%`;
  const ratioCenterText = `${Math.round(ratio * 100)}%`;
  const tooltipPositionClass =
    tooltipPlacement === 'bottom'
      ? 'right-0 top-10'
      : 'bottom-10 right-0';

  return (
    <div className="group/context relative">
      <div
        className={`relative h-7 w-7 rounded-full ${loading ? 'animate-pulse' : ''}`}
        style={{
          background: `conic-gradient(${ringColor} ${degree}deg, rgba(148,163,184,0.3) ${degree}deg)`,
        }}
      >
        <div className="absolute inset-[2.5px] flex items-center justify-center rounded-full bg-white dark:bg-[#2f2f2f]">
          <span className="text-[8px] font-semibold leading-none text-slate-500 dark:text-slate-300">
            {ratioCenterText}
          </span>
        </div>
      </div>

      <div
        className={`pointer-events-none absolute z-40 w-[320px] max-w-[calc(100vw-24px)] rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-600 opacity-0 shadow-xl transition-opacity group-hover/context:opacity-100 dark:border-slate-700 dark:bg-[#2f2f2f] dark:text-slate-300 ${tooltipPositionClass}`}
      >
        <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">上下文信息</p>
        <div className="space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0">模型</span>
            <span className="min-w-0 text-right font-medium break-words">{stats?.modelName ?? '-'}</span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0">当前上下文</span>
            <span className="min-w-0 text-right font-medium break-all">
              {formatTokenNumber(stats?.contextUsedTokens)} / {formatTokenNumber(stats?.contextWindowTokens)}
            </span>
          </div>
          <div className="flex items-start justify-between gap-3">
            <span className="shrink-0">窗口占比</span>
            <span className="min-w-0 text-right font-medium break-all">{ratioText}</span>
          </div>
          <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0">输入价格（M）</span>
              <span className="min-w-0 text-right font-medium break-all">{formatUsdPerMillion(stats?.inputPrice ?? null)}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0">输出价格（M）</span>
              <span className="min-w-0 text-right font-medium break-all">{formatUsdPerMillion(stats?.outputPrice ?? null)}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0">缓存读价格（M）</span>
              <span className="min-w-0 text-right font-medium break-all">{formatUsdPerMillion(stats?.cacheReadPrice ?? null)}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="shrink-0">缓存写价格（M）</span>
              <span className="min-w-0 text-right font-medium break-all">{formatUsdPerMillion(stats?.cacheWritePrice ?? null)}</span>
            </div>
            <div className="mt-1 flex items-start justify-between gap-3 text-slate-800 dark:text-slate-100">
              <span className="shrink-0">当前会话花费</span>
              <span className="min-w-0 text-right font-semibold break-all">{formatUsd(stats?.sessionCostUsd ?? null)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const ChatModelSelect: React.FC<{
  value: number | null;
  options: ChatModelOption[];
  onChange: (value: number | null) => void;
}> = ({ value, options, onChange }) => {
  const [open, setOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const activeOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value],
  );
  const activeLabel = activeOption?.label ?? '选择模型';
  const { triggerWidth, menuWidth } = useMemo(
    () => calcModelSelectWidths(options, activeLabel),
    [options, activeLabel],
  );
  const filteredOptions = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return options;
    }
    return options.filter((option) => option.label.toLowerCase().includes(keyword));
  }, [options, searchKeyword]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative" style={{ width: `${triggerWidth}px` }}>
      <button
        className="inline-flex h-10 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-[#2f2f2f] transition-colors hover:bg-[#f3f4f6] dark:text-slate-100 dark:hover:bg-[#2f2f2f]"
        style={{ width: `${triggerWidth}px` }}
        type="button"
        onClick={() =>
          setOpen((prev) => {
            const next = !prev;
            if (!next) {
              setSearchKeyword('');
            }
            return next;
          })
        }
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left" title={activeOption?.label ?? '选择模型'}>
          {activeOption?.label ?? '选择模型'}
        </span>
        <ChevronDownIcon className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="absolute top-12 z-40 overflow-hidden rounded-xl border border-[rgb(209,209,209)] bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-[#2f2f2f]"
          style={{ width: `${menuWidth}px` }}
        >
          <div className="px-2 pb-1 pt-1">
            <input
              ref={searchInputRef}
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-600 dark:bg-[#212121] dark:text-slate-100"
              placeholder="搜索模型..."
            />
          </div>
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setSearchKeyword('');
                    setOpen(false);
                  }}
                  role="option"
                  aria-selected={active}
                >
                  <span className="min-w-0 flex-1 truncate whitespace-nowrap" title={option.label}>
                    {option.label}
                  </span>
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-slate-500 dark:text-slate-300">
                    {option.supportsReasoning && (
                      <span className="inline-flex h-4 w-4 items-center justify-center" title="支持推理" aria-label="支持推理">
                        <ReasoningCapabilityIcon />
                      </span>
                    )}
                    {option.supportsVision && (
                      <span className="inline-flex h-4 w-4 items-center justify-center" title="支持视觉" aria-label="支持视觉">
                        <VisionCapabilityIcon />
                      </span>
                    )}
                    {option.supportsTools && (
                      <span className="inline-flex h-4 w-4 items-center justify-center" title="支持工具" aria-label="支持工具">
                        <ToolsCapabilityIcon />
                      </span>
                    )}
                  </span>
                  {active && <CheckIcon />}
                </button>
              );
            })
          ) : (
            <p className="px-3 py-2 text-sm text-slate-400 dark:text-slate-500">未找到匹配模型</p>
          )}
        </div>
      )}
    </div>
  );
};

type AssistantProfile = {
  displayName: string;
  avatarType: 'emoji' | 'image' | null;
  avatarValue: string | null;
};

type SelectionActionPayload = {
  messageId: number;
  text: string;
  rect: DOMRect;
};

const DEFAULT_MESSAGE_ASSISTANT_PROFILE: AssistantProfile = {
  displayName: 'AI',
  avatarType: null,
  avatarValue: null,
};

const AssistantAvatar: React.FC<{ profile: AssistantProfile }> = ({ profile }) => {
  if (profile.avatarType === 'image' && profile.avatarValue) {
    return (
      <img
        src={profile.avatarValue}
        alt={`${profile.displayName}-头像`}
        className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }

  if (profile.avatarType === 'emoji' && profile.avatarValue) {
    return (
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm dark:bg-slate-800">
        {profile.avatarValue}
      </div>
    );
  }

  return <MessageAvatar type="assistant" />;
};

const MessageCardBase: React.FC<{
  message: ChatMessage;
  embeddedTools: EmbeddedToolInvocation[];
  preToolContent: string | null;
  toolApprovalStatus: 'approved' | 'rejected' | null;
  requiresToolApproval: boolean;
  approvalMessageId: number | null;
  toolApprovalPending: boolean;
  isStreaming: boolean;
  copied: boolean;
  sessionTitle: string | null;
  assistantProfile: AssistantProfile;
  onCopy: (message: ChatMessage) => void;
  onBranch: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onSelectForAction: (payload: SelectionActionPayload | null) => void;
  onAddToAppCenter: (payload: SaveCodeBlockPayload) => void;
  onToolApproval: (assistantMessageId: number, approved: boolean) => void;
  savedSourceKeySet: Set<string>;
}> = ({
  message,
  embeddedTools,
  preToolContent,
  toolApprovalStatus,
  requiresToolApproval,
  approvalMessageId,
  toolApprovalPending,
  isStreaming,
  copied,
  sessionTitle,
  assistantProfile,
  onCopy,
  onBranch,
  onDelete,
  onSelectForAction,
  onAddToAppCenter,
  onToolApproval,
  savedSourceKeySet,
}) => {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const images = parseImageUrls(message.imageUrls);
  const reasoning = message.reasoningContent?.trim() || '';
  const hasEmbeddedTools = embeddedTools.length > 0;
  const content = message.content ?? '';
  const hasContent = content.length > 0;
  const normalizedPreToolContent = preToolContent?.trim() ?? '';
  const hasPreToolContent = hasEmbeddedTools && normalizedPreToolContent.length > 0;
  const shouldHideEmptyContent = !isUser && !isTool && hasEmbeddedTools && !hasContent && !isStreaming;
  const isReasoningInProgress = Boolean(reasoning) && isStreaming && !hasContent;
  const reasoningSummary = isReasoningInProgress
    ? '思考中'
    : (() => {
        const durationText = formatReasoningDuration(message.reasoningDurationMs);
        return durationText ? `已思考（用时${durationText}）` : '已思考';
      })();
  const [reasoningOpen, setReasoningOpen] = useState(isReasoningInProgress);
  const [toolsOpen, setToolsOpen] = useState(() => hasEmbeddedTools && requiresToolApproval);
  const [actionsVisible, setActionsVisible] = useState(false);
  const hideActionsTimerRef = useRef<number | null>(null);

  const showActions = () => {
    if (hideActionsTimerRef.current != null) {
      window.clearTimeout(hideActionsTimerRef.current);
    }
    setActionsVisible(true);
  };

  const hideActions = () => {
    if (hideActionsTimerRef.current != null) {
      window.clearTimeout(hideActionsTimerRef.current);
    }
    hideActionsTimerRef.current = window.setTimeout(() => {
      setActionsVisible(false);
    }, 80);
  };

  useEffect(() => {
    return () => {
      if (hideActionsTimerRef.current != null) {
        window.clearTimeout(hideActionsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // 思考过程中自动展开，思考结束后自动收起。
    setReasoningOpen(isReasoningInProgress);
  }, [isReasoningInProgress, message.id]);

  const toolsSummaryText = useMemo(() => {
    if (!hasEmbeddedTools) {
      return '';
    }
    const distinctNames = Array.from(new Set(embeddedTools.map((item) => item.name).filter(Boolean)));
    if (distinctNames.length === 1) {
      return `${distinctNames[0]} 工具调用`;
    }
    if (distinctNames.length > 1) {
      return `${distinctNames[0]} 等 ${distinctNames.length} 个工具调用`;
    }
    return `工具调用 ${embeddedTools.length} 次`;
  }, [embeddedTools, hasEmbeddedTools]);
  const canApproveTools = requiresToolApproval && approvalMessageId != null && approvalMessageId > 0;

  useEffect(() => {
    // 出现待授权工具调用时自动展开，避免用户看不到“允许/拒绝”操作入口。
    if (canApproveTools) {
      setToolsOpen(true);
    }
  }, [canApproveTools, message.id]);

  const actionButtons = (
    <div className="flex items-center gap-0.5">
      <IconActionButton tooltip={copied ? '已复制' : '复制 Markdown'} onClick={() => onCopy(message)}>
        <CopyIcon />
      </IconActionButton>
      <IconActionButton tooltip="创建分支" onClick={() => onBranch(message)}>
        <BranchIcon />
      </IconActionButton>
      <IconActionButton tooltip="删除消息" onClick={() => onDelete(message)} danger>
        <DeleteIcon />
      </IconActionButton>
    </div>
  );

  const handleAssistantMouseUp = () => {
    if (isUser || isTool) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      onSelectForAction(null);
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      onSelectForAction(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const containerNode = range.commonAncestorContainer;
    const containerElement = containerNode instanceof Element ? containerNode : containerNode.parentElement;
    const host = containerElement?.closest(`[data-assistant-message-id="${message.id}"]`);
    if (!host) {
      onSelectForAction(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const fallbackRect = range.getClientRects().item(0);
    const resolvedRect = rect.width > 0 || rect.height > 0 ? rect : fallbackRect;
    if (!resolvedRect) {
      onSelectForAction(null);
      return;
    }

    onSelectForAction({
      messageId: message.id,
      text: selectedText,
      rect: resolvedRect,
    });
  };

  const renderMarkdownBlock = (
    markdownContent: string,
    streamingMode: boolean,
    scopeToMessage: boolean,
  ) => {
    if (streamingMode) {
      return <StreamingMessageMarkdown content={markdownContent} />;
    }

    return (
      <MessageMarkdown
        content={markdownContent}
        isStreaming={streamingMode}
        messageId={scopeToMessage && message.id > 0 ? message.id : null}
        sourceSessionId={scopeToMessage && message.sessionId > 0 ? message.sessionId : null}
        sourceSessionTitle={scopeToMessage ? sessionTitle : null}
        sourceModelId={scopeToMessage ? message.modelId : null}
        sourceModelName={scopeToMessage ? message.modelName : null}
        onAddToAppCenter={scopeToMessage ? onAddToAppCenter : undefined}
        savedSourceKeySet={scopeToMessage ? savedSourceKeySet : undefined}
      />
    );
  };

  const bodyContent = (
    <>
      {reasoning && (
        <details
          open={reasoningOpen}
          onToggle={(event) => setReasoningOpen(event.currentTarget.open)}
          className="mb-3 rounded-xl border border-[rgb(209,209,209)] bg-[rgb(249,249,249)] px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/70"
        >
          <summary className="cursor-pointer select-none text-slate-600 dark:text-slate-300">{reasoningSummary}</summary>
          <div className="mt-2 whitespace-pre-wrap text-slate-500 dark:text-slate-400">{reasoning}</div>
        </details>
      )}

      {hasPreToolContent && (
        <div className="chat-markdown mb-3 text-sm leading-7 text-slate-800 dark:text-slate-100">
          {renderMarkdownBlock(normalizedPreToolContent, false, false)}
        </div>
      )}

      {hasEmbeddedTools && (
        <details
          open={toolsOpen}
          onToggle={(event) => setToolsOpen(event.currentTarget.open)}
          className="mb-3 rounded-xl border border-[rgb(209,209,209)] bg-[rgb(249,249,249)] px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800/70"
        >
          <summary className="cursor-pointer select-none text-slate-600 dark:text-slate-300">
            {toolsSummaryText}
            {toolApprovalStatus === 'approved' && (
              <span className="ml-2 text-emerald-600 dark:text-emerald-400">已允许</span>
            )}
            {toolApprovalStatus === 'rejected' && (
              <span className="ml-2 text-rose-600 dark:text-rose-400">已拒绝</span>
            )}
          </summary>
          <div className="mt-2 space-y-2">
            {embeddedTools.map((tool, index) => (
              <div
                key={`${tool.id}-${index}`}
                className="rounded-lg border border-[rgb(209,209,209)] bg-white/80 px-2.5 py-2 text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300"
              >
                <p className="text-[12px] font-medium text-slate-700 dark:text-slate-200">{tool.name}</p>
                {tool.argumentsText && (
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[rgb(245,245,245)] px-2 py-1.5 text-[11px] leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    参数：{tool.argumentsText}
                  </pre>
                )}
                {tool.resultText && (
                  <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[rgb(245,245,245)] px-2 py-1.5 text-[11px] leading-5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    结果：{tool.resultText}
                  </pre>
                )}
              </div>
            ))}
          </div>
          {canApproveTools && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled={toolApprovalPending}
                onClick={() => onToolApproval(approvalMessageId, true)}
                className="inline-flex h-7 items-center rounded-lg border border-emerald-300 bg-emerald-50 px-2 text-[12px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700/70 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30"
              >
                {toolApprovalPending ? '处理中...' : '允许'}
              </button>
              <button
                type="button"
                disabled={toolApprovalPending}
                onClick={() => onToolApproval(approvalMessageId, false)}
                className="inline-flex h-7 items-center rounded-lg border border-rose-300 bg-rose-50 px-2 text-[12px] font-medium text-rose-700 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-700/70 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"
              >
                {toolApprovalPending ? '处理中...' : '拒绝'}
              </button>
            </div>
          )}
        </details>
      )}

      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((url, index) => (
            <img
              key={`${message.id}-${index}`}
              src={url}
              alt={`上传图片-${index + 1}`}
              className="h-24 w-24 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
            />
          ))}
        </div>
      )}

      {!shouldHideEmptyContent && (
        <div className="chat-markdown text-sm leading-7 text-slate-800 dark:text-slate-100">
          {hasContent ? (
            renderMarkdownBlock(content, isStreaming, true)
          ) : isStreaming ? (
            <div className="flex h-7 items-center">
              <span className="chat-loading-dot" aria-label="加载中" />
            </div>
          ) : (
            <span className="opacity-60">(空消息)</span>
          )}
          {isStreaming && hasContent && <span className="chat-loading-inline" aria-label="加载中" />}
        </div>
      )}
    </>
  );

  if (isUser) {
    return (
      <div
        className="relative mx-auto flex w-full max-w-[860px] justify-end gap-3 animate-fade-up"
        onMouseEnter={showActions}
        onMouseLeave={hideActions}
      >
        <div className="min-w-0 max-w-[78%] rounded-[24px] bg-[#f4f4f4] px-4 py-3 text-sm text-slate-900 dark:bg-[#303030] dark:text-slate-100">
          {bodyContent}
        </div>
        <MessageAvatar type="user" />

        {message.id > 0 && (
          <div
            className={`absolute right-10 top-full z-10 transition-opacity ${
              actionsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
            onMouseEnter={showActions}
            onMouseLeave={hideActions}
          >
            {actionButtons}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex w-full max-w-[860px] gap-3 animate-fade-up"
      onMouseEnter={showActions}
      onMouseLeave={hideActions}
      onMouseUp={handleAssistantMouseUp}
      data-assistant-message-id={isTool ? undefined : message.id}
    >
      {isTool ? <MessageAvatar type="tool" /> : <AssistantAvatar profile={assistantProfile} />}
      <div className="min-w-0 flex-1">
        {!isTool && (
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-200">{assistantProfile.displayName}</span>
            {message.modelName && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                {message.modelName}
              </span>
            )}
          </div>
        )}

        <div
          className={`text-sm leading-7 ${
            isTool
              ? 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-100'
              : 'px-1 text-slate-800 dark:text-slate-100'
          }`}
        >
          {bodyContent}

          {(message.tokenUsage != null || message.id > 0) && (
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-slate-400 dark:text-slate-500">
                {message.tokenUsage != null ? `tokens: ${message.tokenUsage}` : ''}
              </span>
              {message.id > 0 && (
                <div
                  className={`transition-opacity ${
                    actionsVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
                  }`}
                  onMouseEnter={showActions}
                  onMouseLeave={hideActions}
                >
                  {actionButtons}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const MessageCard = React.memo(
  MessageCardBase,
  (prev, next) =>
    prev.message === next.message &&
    prev.embeddedTools === next.embeddedTools &&
    prev.preToolContent === next.preToolContent &&
    prev.toolApprovalStatus === next.toolApprovalStatus &&
    prev.requiresToolApproval === next.requiresToolApproval &&
    prev.approvalMessageId === next.approvalMessageId &&
    prev.toolApprovalPending === next.toolApprovalPending &&
    prev.isStreaming === next.isStreaming &&
    prev.copied === next.copied &&
    prev.sessionTitle === next.sessionTitle &&
    prev.assistantProfile.displayName === next.assistantProfile.displayName &&
    prev.assistantProfile.avatarType === next.assistantProfile.avatarType &&
    prev.assistantProfile.avatarValue === next.assistantProfile.avatarValue &&
    prev.onCopy === next.onCopy &&
    prev.onBranch === next.onBranch &&
    prev.onDelete === next.onDelete &&
    prev.onSelectForAction === next.onSelectForAction &&
    prev.onAddToAppCenter === next.onAddToAppCenter &&
    prev.onToolApproval === next.onToolApproval &&
    prev.savedSourceKeySet === next.savedSourceKeySet,
);

const ChatPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId: routeSessionIdParam, projectId: routeProjectIdParam } = useParams<{
    sessionId?: string;
    projectId?: string;
  }>();
  const { theme, toggleTheme } = useThemeStore();
  const {
    sessions,
    currentSessionId,
    currentSession,
    draftTemporary,
    messages,
    selectedModelId,
    streaming,
    loading,
    error,
    fetchSessions,
    createSession,
    startDraftSession,
    deleteSession,
    copySession,
    renameSession,
    selectSession,
    sendMessage,
    resolveToolApproval,
    stopStreaming,
    deleteMessage,
    branchFromMessage,
    setSelectedModelId,
    setSelectedAgentId,
    setEnabledToolNames,
    clearError,
  } = useChatStore();

  const { enabledModels, fetchEnabledModels } = useModelStore();
  const { enabledAgents, fetchEnabledAgents } = useAgentStore();
  const { items: appCenterItems, fetchItems: fetchAppCenterItems, createItem: createAppCenterItem } = useAppCenterStore();
  const {
    items: projectItems,
    error: projectError,
    fetchItems: fetchProjectItems,
    createItem: createProjectItem,
    deleteItem: deleteProjectItem,
    setLastRealDirectoryPath: setLastProjectRealDirectoryPath,
    clearError: clearProjectError,
  } = useProjectStore();

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [quotedSelection, setQuotedSelection] = useState<{ messageId: number; text: string } | null>(null);
  const [selectionAction, setSelectionAction] = useState<{ messageId: number; text: string; top: number; left: number } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<number | null>(null);
  const [toolApprovalStatusMap, setToolApprovalStatusMap] = useState<Record<number, 'approved' | 'rejected'>>({});
  const [draftAgentId, setDraftAgentId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  });
  const [projectSectionExpanded, setProjectSectionExpanded] = useState(false);
  const [chatSectionExpanded, setChatSectionExpanded] = useState(true);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuAgentOpen, setAddMenuAgentOpen] = useState(false);
  const [addMenuOutputLengthOpen, setAddMenuOutputLengthOpen] = useState(false);
  const [addMenuTemperatureOpen, setAddMenuTemperatureOpen] = useState(false);
  const [addMenuToolPermissionOpen, setAddMenuToolPermissionOpen] = useState(false);
  const [addMenuMemoryOpen, setAddMenuMemoryOpen] = useState(false);
  const [addMenuToolsOpen, setAddMenuToolsOpen] = useState(false);
  const [addMenuSubmenuTop, setAddMenuSubmenuTop] = useState(0);
  const [quickOutputMenuOpen, setQuickOutputMenuOpen] = useState(false);
  const [quickTemperatureMenuOpen, setQuickTemperatureMenuOpen] = useState(false);
  const [quickToolPermissionMenuOpen, setQuickToolPermissionMenuOpen] = useState(false);
  const [quickMemoryMenuOpen, setQuickMemoryMenuOpen] = useState(false);
  const [quickToolsMenuOpen, setQuickToolsMenuOpen] = useState(false);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [sidebarSettingsOpen, setSidebarSettingsOpen] = useState(false);
  const [headerMoreOpen, setHeaderMoreOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchKeyword, setChatSearchKeyword] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState<ChatSearchResult[]>([]);
  const [chatSearchLoading, setChatSearchLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [saveAppDialog, setSaveAppDialog] = useState<SaveAppDialogState>(() => createInitialSaveAppDialogState());
  const [saveAppSubmitting, setSaveAppSubmitting] = useState(false);
  const [projectCreateDialog, setProjectCreateDialog] = useState<ProjectCreateDialogState>(() => createInitialProjectCreateDialogState());
  const [projectDirectoryPickerOpen, setProjectDirectoryPickerOpen] = useState(false);

  const [renameDialog, setRenameDialog] = useState<{ open: boolean; session: ChatSession | null; title: string }>({
    open: false,
    session: null,
    title: '',
  });
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<ChatSession | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ id: string; name: string } | null>(null);
  const [copyDialog, setCopyDialog] = useState<{ open: boolean; session: ChatSession | null; title: string }>({
    open: false,
    session: null,
    title: '',
  });
  const [preferredModelId, setPreferredModelId] = useState<number | null>(() => readStoredModelId());
  const [maxTokensPreset, setMaxTokensPreset] = useState<MaxTokensPresetKey>('default');
  const [maxTokensCustomInput, setMaxTokensCustomInput] = useState('4096');
  const [temperaturePreset, setTemperaturePreset] = useState<TemperaturePresetKey>('default');
  const [temperatureCustomInput, setTemperatureCustomInput] = useState('0.7');
  const [toolPermissionPreset, setToolPermissionPreset] = useState<ToolPermissionPresetKey>('require_approval');
  const [memoryPreset, setMemoryPreset] = useState<MemoryPresetKey>('off');
  const [availableTools, setAvailableTools] = useState<ChatToolDefinition[]>([]);
  const [selectedToolNames, setSelectedToolNames] = useState<string[]>([]);
  const [composerParamError, setComposerParamError] = useState<string | null>(null);
  const [inputVisualLineCount, setInputVisualLineCount] = useState(1);
  const [hasWrappedInCompactComposer, setHasWrappedInCompactComposer] = useState(false);
  const [toolApprovalPendingMessageId, setToolApprovalPendingMessageId] = useState<number | null>(null);

  const [branchDialog, setBranchDialog] = useState<{ open: boolean; message: ChatMessage | null; title: string }>({
    open: false,
    message: null,
    title: '',
  });
  const [deleteMessageTarget, setDeleteMessageTarget] = useState<ChatMessage | null>(null);
  const [sessionAboutDialog, setSessionAboutDialog] = useState<SessionAboutDialogState>(initialSessionAboutState);
  const [contextStats, setContextStats] = useState<ChatSessionContextStats | null>(null);
  const [contextStatsLoading, setContextStatsLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveAppIconInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addMenuPanelRef = useRef<HTMLDivElement>(null);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const quickOutputMenuRef = useRef<HTMLDivElement>(null);
  const quickTemperatureMenuRef = useRef<HTMLDivElement>(null);
  const quickToolPermissionMenuRef = useRef<HTMLDivElement>(null);
  const quickMemoryMenuRef = useRef<HTMLDivElement>(null);
  const quickToolsMenuRef = useRef<HTMLDivElement>(null);
  const sidebarSettingsRef = useRef<HTMLDivElement>(null);
  const headerMoreRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesContentRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastMessagesScrollTopRef = useRef(0);
  const copiedTimerRef = useRef<number | null>(null);
  const composingRef = useRef(false);
  const routeSessionSelectingRef = useRef(false);
  const routeSessionAttemptedRef = useRef<number | null>(null);
  const routeMessageJumpRef = useRef<string | null>(null);
  const routeMessageJumpTimerRef = useRef<number | null>(null);
  const shareCopiedTimerRef = useRef<number | null>(null);
  const chatSearchRequestIdRef = useRef(0);

  const routeSessionId = useMemo(() => {
    if (!routeSessionIdParam) {
      return null;
    }
    const parsed = Number.parseInt(routeSessionIdParam, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }, [routeSessionIdParam]);

  const routeProjectId = useMemo(() => {
    if (!routeProjectIdParam) {
      return null;
    }
    const normalized = routeProjectIdParam.trim();
    return normalized ? normalized : null;
  }, [routeProjectIdParam]);

  const routeMessageId = useMemo(() => {
    const raw = new URLSearchParams(location.search).get('messageId');
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }, [location.search]);

  const pageMode = useMemo<'chat' | 'models' | 'agents' | 'apps' | 'projects'>(() => {
    if (location.pathname === '/models') {
      return 'models';
    }
    if (location.pathname === '/agents') {
      return 'agents';
    }
    if (location.pathname === '/apps') {
      return 'apps';
    }
    if (location.pathname === '/projects' || location.pathname.startsWith('/projects/')) {
      return 'projects';
    }
    return 'chat';
  }, [location.pathname]);

  const isChatRoute = pageMode === 'chat';
  const showGlobalSidebar = pageMode !== 'projects';
  const topBarTitle = pageMode === 'models'
    ? '模型管理'
    : pageMode === 'agents'
      ? '智能体管理'
      : pageMode === 'apps'
        ? '应用中心'
        : pageMode === 'projects'
          ? '项目中心'
        : '';

  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  const defaultModel = useMemo(
    () => enabledModels.find((model) => model.isDefault) ?? enabledModels[0] ?? null,
    [enabledModels],
  );

  const enabledModelIdSet = useMemo(
    () => new Set(enabledModels.map((model) => model.id)),
    [enabledModels],
  );

  const hasValidSelectedModel = selectedModelId != null && enabledModelIdSet.has(selectedModelId);
  const hasValidPreferredModel = preferredModelId != null && enabledModelIdSet.has(preferredModelId);
  // 已有会话优先使用该会话当前模型（无效则降级默认）；草稿态优先使用浏览器记忆模型。
  const effectiveSelectedModelId = currentSessionId
    ? hasValidSelectedModel
      ? selectedModelId
      : defaultModel?.id ?? null
    : hasValidSelectedModel
      ? selectedModelId
      : hasValidPreferredModel
        ? preferredModelId
        : defaultModel?.id ?? null;

  const selectedModel = useMemo(
    () => enabledModels.find((model) => model.id === effectiveSelectedModelId) ?? null,
    [enabledModels, effectiveSelectedModelId],
  );

  const selectedModelMaxCompletionTokens = useMemo(() => {
    if (!selectedModel?.maxCompletionTokens || selectedModel.maxCompletionTokens <= 0) {
      return null;
    }
    return selectedModel.maxCompletionTokens;
  }, [selectedModel?.maxCompletionTokens]);

  const parsedCustomMaxTokens = useMemo(
    () => parsePositiveInteger(maxTokensCustomInput),
    [maxTokensCustomInput],
  );
  const parsedCustomTemperature = useMemo(
    () => parseTemperature(temperatureCustomInput),
    [temperatureCustomInput],
  );

  const resolvedMaxTokens = useMemo(() => {
    if (maxTokensPreset === 'default') {
      return null;
    }
    const presetValue = MAX_TOKENS_PRESETS.find((item) => item.key === maxTokensPreset)?.value ?? null;
    const rawValue = maxTokensPreset === 'custom' ? parsedCustomMaxTokens : presetValue;
    if (rawValue == null) {
      return null;
    }
    if (selectedModelMaxCompletionTokens != null) {
      return Math.min(rawValue, selectedModelMaxCompletionTokens);
    }
    return rawValue;
  }, [maxTokensPreset, parsedCustomMaxTokens, selectedModelMaxCompletionTokens]);

  const resolvedTemperature = useMemo(() => {
    if (temperaturePreset === 'default') {
      return null;
    }
    const presetValue = TEMPERATURE_PRESETS.find((item) => item.key === temperaturePreset)?.value ?? null;
    return temperaturePreset === 'custom' ? parsedCustomTemperature : presetValue;
  }, [temperaturePreset, parsedCustomTemperature]);

  const maxTokensDisplayText = useMemo(() => {
    if (maxTokensPreset === 'default' || resolvedMaxTokens == null) {
      return null;
    }
    if (maxTokensPreset === 'custom') {
      return `输出长度：自定义（${resolvedMaxTokens}）`;
    }
    const label = MAX_TOKENS_PRESETS.find((item) => item.key === maxTokensPreset)?.label ?? '自定义';
    return `输出长度：${label}（${resolvedMaxTokens}）`;
  }, [maxTokensPreset, resolvedMaxTokens]);

  const temperatureDisplayText = useMemo(() => {
    if (temperaturePreset === 'default' || resolvedTemperature == null) {
      return null;
    }
    if (temperaturePreset === 'custom') {
      return `温度：自定义（${formatShortNumber(resolvedTemperature)}）`;
    }
    const label = TEMPERATURE_PRESETS.find((item) => item.key === temperaturePreset)?.label ?? '自定义';
    return `温度：${label}（${formatShortNumber(resolvedTemperature)}）`;
  }, [temperaturePreset, resolvedTemperature]);

  const toolPermissionDisplayText = useMemo(() => {
    if (toolPermissionPreset === 'require_approval') {
      return null;
    }
    const label = TOOL_PERMISSION_PRESETS.find((item) => item.key === toolPermissionPreset)?.label ?? '自动调用工具';
    return `工具权限：${label}`;
  }, [toolPermissionPreset]);

  const memoryDisplayText = useMemo(() => {
    if (memoryPreset === 'off') {
      return null;
    }
    const label = MEMORY_PRESETS.find((item) => item.key === memoryPreset)?.label ?? '开启记忆检索';
    return `记忆设置：${label}`;
  }, [memoryPreset]);

  const maxTokensShortLabel = useMemo(() => {
    if (!maxTokensDisplayText) {
      return null;
    }
    const map: Record<Exclude<MaxTokensPresetKey, 'default'>, string> = {
      low: '短',
      medium: '中',
      high: '长',
      ultra: '超长',
      custom: '自定义',
    };
    return map[maxTokensPreset as Exclude<MaxTokensPresetKey, 'default'>] ?? null;
  }, [maxTokensDisplayText, maxTokensPreset]);

  const temperatureShortLabel = useMemo(() => {
    if (!temperatureDisplayText) {
      return null;
    }
    const map: Record<Exclude<TemperaturePresetKey, 'default'>, string> = {
      precise: '严谨',
      balanced: '平衡',
      creative: '创意',
      divergent: '发散',
      custom: '自定义',
    };
    return map[temperaturePreset as Exclude<TemperaturePresetKey, 'default'>] ?? null;
  }, [temperatureDisplayText, temperaturePreset]);

  const toolPermissionShortLabel = useMemo(() => {
    if (!toolPermissionDisplayText) {
      return null;
    }
    return '自动授权';
  }, [toolPermissionDisplayText]);

  const memoryShortLabel = useMemo(() => {
    if (!memoryDisplayText) {
      return null;
    }
    return '记忆';
  }, [memoryDisplayText]);

  const allAvailableToolNames = useMemo(
    () => availableTools.map((tool) => tool.name),
    [availableTools],
  );

  const selectedToolNameSet = useMemo(
    () => new Set(selectedToolNames),
    [selectedToolNames],
  );

  const isToolSelectionDefault = useMemo(() => {
    if (allAvailableToolNames.length === 0) {
      return true;
    }
    return selectedToolNames.length === allAvailableToolNames.length;
  }, [allAvailableToolNames.length, selectedToolNames.length]);

  const toolSelectionDisplayText = useMemo(() => {
    if (allAvailableToolNames.length === 0 || isToolSelectionDefault) {
      return null;
    }
    if (selectedToolNames.length === 0) {
      return '可用工具：未选择';
    }
    return `可用工具：${selectedToolNames.length}/${allAvailableToolNames.length}`;
  }, [allAvailableToolNames.length, isToolSelectionDefault, selectedToolNames.length]);

  const toolSelectionShortLabel = useMemo(() => {
    if (!toolSelectionDisplayText) {
      return null;
    }
    if (selectedToolNames.length === 0) {
      return '无工具';
    }
    return `工具${selectedToolNames.length}/${allAvailableToolNames.length}`;
  }, [allAvailableToolNames.length, selectedToolNames.length, toolSelectionDisplayText]);

  const hasComposerParamSummary = Boolean(
    maxTokensShortLabel || temperatureShortLabel || toolPermissionShortLabel || memoryShortLabel || toolSelectionShortLabel,
  );
  const maxTokensCustomInvalid = maxTokensPreset === 'custom' && parsedCustomMaxTokens == null;
  const temperatureCustomInvalid = temperaturePreset === 'custom' && parsedCustomTemperature == null;

  const defaultAgent = useMemo(
    () => enabledAgents.find((agent) => agent.isDefault) ?? enabledAgents[0] ?? null,
    [enabledAgents],
  );

  const enabledAgentIdSet = useMemo(
    () => new Set(enabledAgents.map((agent) => agent.id)),
    [enabledAgents],
  );

  const activeAgentId = useMemo(() => {
    // 智能体被删除后，旧会话或草稿中可能残留无效 ID，这里统一回退到默认智能体。
    const candidate = currentSessionId ? currentSession?.agentId ?? null : draftAgentId ?? null;
    if (candidate != null && enabledAgentIdSet.has(candidate)) {
      return candidate;
    }
    return defaultAgent?.id ?? null;
  }, [currentSessionId, currentSession?.agentId, draftAgentId, enabledAgentIdSet, defaultAgent?.id]);

  const activeAgent = useMemo(
    () => enabledAgents.find((agent) => agent.id === activeAgentId) ?? defaultAgent,
    [enabledAgents, activeAgentId, defaultAgent],
  );
  const showAgentChip = Boolean(activeAgent && !activeAgent.isDefault);
  const allComposerSettingsDefault =
    !showAgentChip &&
    maxTokensPreset === 'default' &&
    temperaturePreset === 'default' &&
    toolPermissionPreset === 'require_approval' &&
    memoryPreset === 'off' &&
    isToolSelectionDefault;
  const isCompactComposer = allComposerSettingsDefault && !hasWrappedInCompactComposer && inputVisualLineCount <= 1;

  const assistantProfile = useMemo<AssistantProfile>(() => {
    if (!activeAgent || activeAgent.isDefault) {
      return DEFAULT_MESSAGE_ASSISTANT_PROFILE;
    }

    return {
      displayName: activeAgent.name,
      avatarType: activeAgent.avatarType,
      avatarValue: activeAgent.avatarValue,
    };
  }, [activeAgent]);

  const resolveMessageAssistantProfile = (message: ChatMessage): AssistantProfile => {
    // 优先使用消息级快照，保证历史消息不受智能体后续编辑影响。
    if (message.agentName) {
      return {
        displayName: message.agentName,
        avatarType: message.agentAvatarType,
        avatarValue: message.agentAvatarValue,
      };
    }
    // 临时流式消息还未落库，可回退到当前会话智能体展示。
    if (message.id < 0) {
      return assistantProfile;
    }
    // 兼容历史数据：没有快照时固定回退到通用 AI，避免后续编辑智能体导致历史头像变化。
    return DEFAULT_MESSAGE_ASSISTANT_PROFILE;
  };

  const visibleAgents = useMemo(() => {
    // 兼容历史数据：若出现多个同名“默认”，前端仅展示系统默认那条，避免用户误解。
    const defaultNamed = enabledAgents.filter((agent) => agent.name === '默认');
    if (defaultNamed.length <= 1) {
      return enabledAgents;
    }

    const keepId = defaultNamed.find((agent) => agent.isDefault)?.id ?? defaultNamed[0].id;
    return enabledAgents.filter((agent) => agent.name !== '默认' || agent.id === keepId);
  }, [enabledAgents]);

  const activeStreamingMessageId = useMemo(() => {
    if (!streaming) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === 'assistant' && candidate.id < 0) {
        return candidate.id;
      }
    }

    return null;
  }, [messages, streaming]);

  const displayMessages = useMemo(() => buildDisplayMessages(messages), [messages]);
  const hasPendingToolApproval = useMemo(
    () => displayMessages.some((item) => item.requiresToolApproval && item.approvalMessageId != null),
    [displayMessages],
  );
  const temporaryChatActive = isChatRoute && (draftTemporary || currentSession?.isTemporary === true);
  const isTemporaryDraft = isChatRoute && !currentSessionId && draftTemporary;
  const showTemporaryToggle = isChatRoute && !currentSessionId;
  const hasCurrentSession = isChatRoute && currentSessionId != null && currentSession != null;
  const shouldCenterComposer = isChatRoute && !currentSessionId;
  const canExportCurrentSession = hasCurrentSession && messages.length > 0;
  const activeSidebarProjectId = pageMode === 'projects' ? routeProjectId : null;
  const askActionLabel = activeAgent && !activeAgent.isDefault ? `问${activeAgent.name}` : '问AI';
  const appSourceKeySet = useMemo(() => new Set(appCenterItems.map((item) => item.sourceKey)), [appCenterItems]);

  useEffect(() => {
    fetchEnabledModels();
    fetchEnabledAgents();
    fetchAppCenterItems();
  }, [fetchEnabledModels, fetchEnabledAgents, fetchAppCenterItems]);

  useEffect(() => {
    if (!showGlobalSidebar || sidebarCollapsed || !chatSectionExpanded) {
      return;
    }
    fetchSessions();
  }, [showGlobalSidebar, sidebarCollapsed, chatSectionExpanded, fetchSessions]);

  useEffect(() => {
    if (pageMode === 'projects') {
      fetchProjectItems();
      return;
    }
    if (!showGlobalSidebar || sidebarCollapsed || !projectSectionExpanded) {
      return;
    }
    fetchProjectItems();
  }, [pageMode, showGlobalSidebar, sidebarCollapsed, projectSectionExpanded, fetchProjectItems]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }

    let cancelled = false;
    chatApi
      .listTools()
      .then((tools) => {
        if (!cancelled) {
          setAvailableTools(tools);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableTools([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isChatRoute]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }

    const allNames = allAvailableToolNames;
    if (allNames.length === 0) {
      setSelectedToolNames([]);
      return;
    }

    if (!currentSessionId) {
      // 草稿态默认全选，首次发送前也可继续手动调整。
      setSelectedToolNames(allNames);
      return;
    }

    const parsedNames = parseEnabledToolNames(currentSession?.enabledToolNames);
    if (parsedNames == null) {
      setSelectedToolNames(allNames);
      return;
    }
    const parsedSet = new Set(parsedNames);
    setSelectedToolNames(allNames.filter((name) => parsedSet.has(name)));
  }, [isChatRoute, currentSessionId, currentSession?.enabledToolNames, allAvailableToolNames]);

  useEffect(() => {
    if (!isChatRoute) {
      routeSessionAttemptedRef.current = null;
      routeSessionSelectingRef.current = false;
      return;
    }
    // 路由会话 ID 变化后，允许对新 ID 重新尝试加载一次。
    routeSessionAttemptedRef.current = null;
  }, [isChatRoute, routeSessionId]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }
    if (routeSessionId == null) {
      routeSessionSelectingRef.current = false;
      routeSessionAttemptedRef.current = null;
      return;
    }
    if (currentSessionId === routeSessionId) {
      routeSessionSelectingRef.current = false;
      routeSessionAttemptedRef.current = routeSessionId;
      return;
    }
    if (routeSessionSelectingRef.current) {
      return;
    }
    if (routeSessionAttemptedRef.current === routeSessionId) {
      // 同一路由 ID 已尝试过，避免在“会话不存在/加载失败”时循环请求。
      return;
    }

    routeSessionSelectingRef.current = true;
    routeSessionAttemptedRef.current = routeSessionId;
    void selectSession(routeSessionId).finally(() => {
      routeSessionSelectingRef.current = false;
    });
  }, [isChatRoute, routeSessionId, currentSessionId, selectSession]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }
    if (routeSessionId != null && routeSessionId !== currentSessionId) {
      // URL 已指定目标会话且尚未切换完成时，不要把地址改回旧会话。
      return;
    }

    const targetPath = currentSessionId ? `/chat/${currentSessionId}` : '/chat';
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [isChatRoute, routeSessionId, currentSessionId, location.pathname, navigate]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }
    if (routeSessionId == null || currentSessionId != null || loading) {
      return;
    }
    if (!error) {
      return;
    }
    // 非法会话链接回退到聊天主页，避免停留在无效地址。
    navigate('/chat', { replace: true });
  }, [isChatRoute, routeSessionId, currentSessionId, loading, error, navigate]);

  useEffect(() => {
    if (!isChatRoute) {
      routeMessageJumpRef.current = null;
      return;
    }
    if (!currentSessionId || !routeMessageId) {
      routeMessageJumpRef.current = null;
      return;
    }

    const jumpKey = `${currentSessionId}-${routeMessageId}`;
    if (routeMessageJumpRef.current === jumpKey) {
      return;
    }

    let targetElement = document.querySelector(`[data-message-id="${routeMessageId}"]`) as HTMLElement | null;
    if (!targetElement) {
      targetElement = document.querySelector(
        `[data-message-ids~="${routeMessageId}"]`,
      ) as HTMLElement | null;
    }
    if (!targetElement) {
      return;
    }

    routeMessageJumpRef.current = jumpKey;
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedMessageId(routeMessageId);

    if (routeMessageJumpTimerRef.current != null) {
      window.clearTimeout(routeMessageJumpTimerRef.current);
    }
    routeMessageJumpTimerRef.current = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === routeMessageId ? null : current));
    }, 2200);
  }, [isChatRoute, currentSessionId, routeMessageId, displayMessages]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }
    if (!shouldAutoScrollRef.current) {
      return;
    }
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    // 会话切换或消息更新时立即吸底，避免 smooth 动画阶段出现短暂底部留白。
    container.scrollTop = container.scrollHeight;
  }, [isChatRoute, messages, streaming]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }
    // 切换会话或进入草稿后，默认回到底部。
    shouldAutoScrollRef.current = true;
    lastMessagesScrollTopRef.current = 0;
    setSelectionAction(null);
    setQuotedSelection(null);
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isChatRoute, currentSessionId]);

  useEffect(() => {
    setToolApprovalPendingMessageId(null);
  }, [currentSessionId]);

  useEffect(() => {
    if (!isChatRoute) {
      return;
    }

    const container = messagesContainerRef.current;
    const content = messagesContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') {
      return;
    }

    // Markdown/代码高亮等异步渲染会改变消息高度，这里在“自动跟随”模式下持续吸底。
    const observer = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) {
        return;
      }
      container.scrollTop = container.scrollHeight;
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [isChatRoute, currentSessionId, messages.length]);

  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        setSelectionAction(null);
      }
    };

    const onViewportChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSelectionAction(null);
        return;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const fallbackRect = range.getClientRects().item(0);
      const resolvedRect = rect.width > 0 || rect.height > 0 ? rect : fallbackRect;
      if (!resolvedRect) {
        setSelectionAction(null);
        return;
      }

      const { top, left } = resolveSelectionActionPosition(resolvedRect);
      setSelectionAction((current) => {
        if (!current) {
          return current;
        }
        return { ...current, top, left };
      });
    };

    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, []);

  useEffect(() => {
    if (pageMode === 'models') {
      document.title = '模型管理 · Open Zen';
      return;
    }
    if (pageMode === 'agents') {
      document.title = '智能体管理 · Open Zen';
      return;
    }
    if (pageMode === 'apps') {
      document.title = '应用中心 · Open Zen';
      return;
    }
    if (pageMode === 'projects') {
      const currentProject = routeProjectId
        ? projectItems.find((item) => item.id === routeProjectId) ?? null
        : null;
      document.title = currentProject?.name
        ? `${currentProject.name} · 项目中心 · Open Zen`
        : '项目中心 · Open Zen';
      return;
    }
    document.title = currentSession?.title ? `${currentSession.title} · Open Zen` : 'Open Zen';
  }, [pageMode, currentSession?.title, routeProjectId, projectItems]);

  useEffect(() => {
    if (!isChatRoute) {
      setContextStats(null);
      setContextStatsLoading(false);
      return;
    }
    if (!currentSessionId) {
      setContextStats(null);
      setContextStatsLoading(false);
      return;
    }
    // 流式中增量更新频繁，结束后再统一刷新上下文统计，避免高频请求。
    if (streaming) {
      return;
    }

    let cancelled = false;
    setContextStatsLoading(true);
    chatApi
      .getSessionContextStats(currentSessionId, effectiveSelectedModelId)
      .then((stats) => {
        if (!cancelled) {
          setContextStats(stats);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setContextStats(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setContextStatsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isChatRoute, currentSessionId, effectiveSelectedModelId, streaming, messages.length]);

  useEffect(() => {
    if (!currentSessionId && draftAgentId == null && defaultAgent) {
      setDraftAgentId(defaultAgent.id);
    }
  }, [currentSessionId, draftAgentId, defaultAgent]);

  useEffect(() => {
    if (currentSessionId) {
      return;
    }
    if (draftAgentId != null && !enabledAgentIdSet.has(draftAgentId)) {
      setDraftAgentId(defaultAgent?.id ?? null);
    }
  }, [currentSessionId, draftAgentId, enabledAgentIdSet, defaultAgent]);

  useEffect(() => {
    if (enabledModels.length === 0) {
      // 首次加载期间 enabledModels 可能暂时为空，这里不能清空本地模型偏好。
      return;
    }

    if (preferredModelId != null && enabledModelIdSet.has(preferredModelId)) {
      return;
    }

    const storedModelId = readStoredModelId();
    if (storedModelId != null && enabledModelIdSet.has(storedModelId)) {
      setPreferredModelId(storedModelId);
      return;
    }

    const fallbackModelId = defaultModel?.id ?? null;
    setPreferredModelId(fallbackModelId);
    if (typeof window !== 'undefined') {
      if (fallbackModelId != null) {
        window.localStorage.setItem(LAST_SELECTED_MODEL_STORAGE_KEY, String(fallbackModelId));
      } else {
        window.localStorage.removeItem(LAST_SELECTED_MODEL_STORAGE_KEY);
      }
    }
  }, [enabledModels.length, preferredModelId, enabledModelIdSet, defaultModel?.id]);

  useEffect(() => {
    if (currentSessionId) {
      return;
    }
    if (effectiveSelectedModelId != null && selectedModelId !== effectiveSelectedModelId) {
      void setSelectedModelId(effectiveSelectedModelId);
    }
  }, [currentSessionId, effectiveSelectedModelId, selectedModelId, setSelectedModelId]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      if (routeMessageJumpTimerRef.current != null) {
        window.clearTimeout(routeMessageJumpTimerRef.current);
      }
      if (shareCopiedTimerRef.current != null) {
        window.clearTimeout(shareCopiedTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      !addMenuOpen &&
      !agentPickerOpen &&
      !quickOutputMenuOpen &&
      !quickTemperatureMenuOpen &&
      !quickToolPermissionMenuOpen &&
      !quickMemoryMenuOpen &&
      !quickToolsMenuOpen &&
      !addMenuToolsOpen
    ) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (agentPickerRef.current?.contains(event.target as Node)) {
        return;
      }
      if (quickOutputMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (quickTemperatureMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (quickToolPermissionMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (quickMemoryMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      if (quickToolsMenuRef.current?.contains(event.target as Node)) {
        return;
      }
      setAddMenuOpen(false);
      setAddMenuAgentOpen(false);
      setAddMenuOutputLengthOpen(false);
      setAddMenuTemperatureOpen(false);
      setAddMenuToolPermissionOpen(false);
      setAddMenuMemoryOpen(false);
      setAddMenuToolsOpen(false);
      setQuickOutputMenuOpen(false);
      setQuickTemperatureMenuOpen(false);
      setQuickToolPermissionMenuOpen(false);
      setQuickMemoryMenuOpen(false);
      setQuickToolsMenuOpen(false);
      setAgentPickerOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [
    addMenuOpen,
    agentPickerOpen,
    quickOutputMenuOpen,
    quickTemperatureMenuOpen,
    quickToolPermissionMenuOpen,
    quickMemoryMenuOpen,
    quickToolsMenuOpen,
    addMenuToolsOpen,
  ]);

  useEffect(() => {
    if (!sidebarSettingsOpen && !headerMoreOpen) {
      return;
    }

    const onMouseDown = (event: MouseEvent) => {
      if (sidebarSettingsRef.current?.contains(event.target as Node)) {
        return;
      }
      if (headerMoreRef.current?.contains(event.target as Node)) {
        return;
      }
      setSidebarSettingsOpen(false);
      setHeaderMoreOpen(false);
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [sidebarSettingsOpen, headerMoreOpen]);

  useEffect(() => {
    if (!chatSearchOpen) {
      setChatSearchResults([]);
      setChatSearchLoading(false);
      return;
    }

    const normalizedKeyword = chatSearchKeyword.trim();
    if (!normalizedKeyword) {
      setChatSearchResults([]);
      setChatSearchLoading(false);
      return;
    }

    const requestId = chatSearchRequestIdRef.current + 1;
    chatSearchRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      setChatSearchLoading(true);
      chatApi.searchSessions(normalizedKeyword, 120)
        .then((results) => {
          if (chatSearchRequestIdRef.current !== requestId) {
            return;
          }
          setChatSearchResults(results);
        })
        .catch(() => {
          if (chatSearchRequestIdRef.current !== requestId) {
            return;
          }
          setChatSearchResults([]);
        })
        .finally(() => {
          if (chatSearchRequestIdRef.current !== requestId) {
            return;
          }
          setChatSearchLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
    };
  }, [chatSearchOpen, chatSearchKeyword]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputLikeElement(event.target)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSidebarSettingsOpen(false);
        setHeaderMoreOpen(false);
        setChatSearchOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (sidebarCollapsed) {
      setSidebarSettingsOpen(false);
    }
  }, [sidebarCollapsed]);

  const adjustInputHeight = (target?: HTMLTextAreaElement | null) => {
    const element = target ?? textareaRef.current;
    if (!element) {
      return;
    }

    const lineHeight = 24;
    const maxHeight = lineHeight * 8;

    element.style.height = 'auto';
    const visualLineCount = Math.max(1, Math.ceil(element.scrollHeight / lineHeight));
    setInputVisualLineCount((prev) => (prev === visualLineCount ? prev : visualLineCount));
    const nextHeight = Math.min(Math.max(element.scrollHeight, lineHeight), maxHeight);
    element.style.height = `${nextHeight}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

  useEffect(() => {
    adjustInputHeight();
  }, [input]);

  useEffect(() => {
    if (!allComposerSettingsDefault || input.length === 0) {
      if (hasWrappedInCompactComposer) {
        setHasWrappedInCompactComposer(false);
      }
      return;
    }

    if (!hasWrappedInCompactComposer && inputVisualLineCount > 1) {
      // 一旦在紧凑模式触发自动换行，锁定为展开布局，避免首行与按钮区域反复抖动。
      setHasWrappedInCompactComposer(true);
    }
  }, [allComposerSettingsDefault, input.length, inputVisualLineCount, hasWrappedInCompactComposer]);

  useEffect(() => {
    if (!composerParamError) {
      return;
    }
    if (!maxTokensCustomInvalid && !temperatureCustomInvalid) {
      setComposerParamError(null);
    }
  }, [composerParamError, maxTokensCustomInvalid, temperatureCustomInvalid]);

  useEffect(() => {
    if (!hasPendingToolApproval) {
      return;
    }
    // 工具调用待授权期间禁止继续发送，避免模型在未确认权限前继续推进。
    setComposerParamError('当前有待确认的工具调用，请先允许或拒绝后再发送下一条消息。');
  }, [hasPendingToolApproval]);

  const resolvePreferredModelForNewSession = useCallback(() => {
    if (preferredModelId != null && enabledModelIdSet.has(preferredModelId)) {
      return preferredModelId;
    }
    return defaultModel?.id ?? null;
  }, [preferredModelId, enabledModelIdSet, defaultModel?.id]);

  const persistPreferredModel = (modelId: number | null) => {
    setPreferredModelId(modelId);
    if (typeof window === 'undefined') {
      return;
    }
    if (modelId == null) {
      window.localStorage.removeItem(LAST_SELECTED_MODEL_STORAGE_KEY);
    } else {
      window.localStorage.setItem(LAST_SELECTED_MODEL_STORAGE_KEY, String(modelId));
    }
  };

  const handleModelChange = async (modelId: number | null) => {
    if (modelId == null) {
      return;
    }
    persistPreferredModel(modelId);
    await setSelectedModelId(modelId);
  };

  const enterDraftSession = useCallback(async (temporary: boolean) => {
    // 草稿态不立即落库，避免侧栏出现多个空会话。
    const desiredModelId = resolvePreferredModelForNewSession();
    navigate('/chat');
    startDraftSession({ temporary });
    clearError();
    setInput('');
    setPendingImages([]);
    setQuotedSelection(null);
    setSelectionAction(null);
    shouldAutoScrollRef.current = true;

    if (desiredModelId != null && selectedModelId !== desiredModelId) {
      await setSelectedModelId(desiredModelId);
    }
  }, [
    resolvePreferredModelForNewSession,
    navigate,
    startDraftSession,
    clearError,
    selectedModelId,
    setSelectedModelId,
  ]);

  const handleCreateSession = useCallback(async () => {
    await enterDraftSession(false);
  }, [enterDraftSession]);

  const handleOpenCreateProjectDialog = useCallback(() => {
    clearProjectError();
    setProjectCreateDialog(createInitialProjectCreateDialogState());
    setProjectCreateDialog((prev) => ({
      ...prev,
      open: true,
    }));
  }, [clearProjectError]);

  const handleCloseCreateProjectDialog = useCallback(() => {
    if (projectCreateDialog.submitting) {
      return;
    }
    setProjectDirectoryPickerOpen(false);
    setProjectCreateDialog(createInitialProjectCreateDialogState());
  }, [projectCreateDialog.submitting]);

  const handleConfirmProjectDirectory = useCallback(
    async (payload: { path: string; name: string }) => {
      setProjectCreateDialog((prev) => ({
        ...prev,
        realDirectoryPath: payload.path,
        realDirectoryName: payload.name,
        error: null,
      }));
      setProjectDirectoryPickerOpen(false);
    },
    [],
  );

  const handleSubmitCreateProject = useCallback(async () => {
    if (!projectCreateDialog.open) {
      return;
    }

    const trimmedName = projectCreateDialog.name.trim();
    if (!trimmedName) {
      setProjectCreateDialog((prev) => ({
        ...prev,
        error: '请输入项目名称',
      }));
      return;
    }
    if (!projectCreateDialog.realDirectoryPath.trim()) {
      setProjectCreateDialog((prev) => ({
        ...prev,
        error: '请选择真实目录',
      }));
      return;
    }

    setProjectCreateDialog((prev) => ({
      ...prev,
      submitting: true,
      error: null,
    }));
    try {
      const created = await createProjectItem({
        name: trimmedName,
        description: projectCreateDialog.description.trim(),
        realDirPath: projectCreateDialog.realDirectoryPath.trim(),
        rootDirName: projectCreateDialog.realDirectoryName || undefined,
      });
      setLastProjectRealDirectoryPath(projectCreateDialog.realDirectoryPath.trim());
      setProjectDirectoryPickerOpen(false);
      setProjectCreateDialog(createInitialProjectCreateDialogState());
      navigate(`/projects/${created.id}`);
    } catch (error: any) {
      setProjectCreateDialog((prev) => ({
        ...prev,
        submitting: false,
        error: error?.message ?? '创建项目失败',
      }));
    }
  }, [projectCreateDialog, createProjectItem, navigate, setLastProjectRealDirectoryPath]);

  const handleSelectProjectFromSidebar = useCallback(
    (projectId: string) => {
      navigate(`/projects/${projectId}`);
    },
    [navigate],
  );

  const handleConfirmDeleteProject = useCallback(async () => {
    if (!deleteProjectTarget) {
      return;
    }
    const targetId = deleteProjectTarget.id;
    await deleteProjectItem(targetId);
    if (routeProjectId === targetId) {
      navigate('/chat');
    }
    setDeleteProjectTarget(null);
  }, [deleteProjectTarget, deleteProjectItem, routeProjectId, navigate]);

  const handleBackToChatFromProject = useCallback(() => {
    if (currentSessionId) {
      navigate(`/chat/${currentSessionId}`);
      return;
    }
    navigate('/chat');
  }, [currentSessionId, navigate]);

  const handleToggleTemporaryChat = useCallback(() => {
    if (currentSessionId) {
      return;
    }
    const nextTemporary = !draftTemporary;
    startDraftSession({ temporary: nextTemporary });
    if (nextTemporary) {
      // 临时聊天固定禁用记忆，避免误写入长期记忆。
      setMemoryPreset('off');
    }
    clearError();
  }, [currentSessionId, draftTemporary, startDraftSession, clearError]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputLikeElement(event.target)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        void handleCreateSession();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [handleCreateSession]);

  const ensureSessionReady = async (): Promise<boolean> => {
    if (!currentSessionId) {
      const desiredModelId = resolvePreferredModelForNewSession();
      if (!desiredModelId) {
        return false;
      }
      const createPayload: { agentId?: number | null; temporary?: boolean } = {};
      if (activeAgentId != null) {
        createPayload.agentId = activeAgentId;
      }
      if (draftTemporary) {
        createPayload.temporary = true;
      }
      const created = await createSession(Object.keys(createPayload).length > 0 ? createPayload : undefined);
      persistPreferredModel(desiredModelId);
      // 新建会话接口默认回填“系统默认模型”，此处强制覆盖为用户偏好模型。
      if (created.modelId !== desiredModelId || selectedModelId !== desiredModelId) {
        await setSelectedModelId(desiredModelId);
      }
      return true;
    }

    const desiredModelId = effectiveSelectedModelId;
    if (!desiredModelId) {
      return false;
    }

    if (selectedModelId !== desiredModelId) {
      await setSelectedModelId(desiredModelId);
    }
    return true;
  };

  const handleSend = async () => {
    if (streaming) {
      return;
    }
    if (hasPendingToolApproval) {
      setComposerParamError('当前有待确认的工具调用，请先允许或拒绝后再发送下一条消息。');
      return;
    }

    if (maxTokensCustomInvalid) {
      setComposerParamError('自定义输出长度无效，请输入大于 0 的整数。');
      return;
    }
    if (temperatureCustomInvalid) {
      setComposerParamError('自定义温度无效，请输入 0 到 2 之间的数字。');
      return;
    }

    clearError();
    setComposerParamError(null);
    shouldAutoScrollRef.current = true;
    const ready = await ensureSessionReady();
    if (!ready) {
      return;
    }

    const text = buildOutgoingUserContent(input, quotedSelection?.text ?? null);
    const images = [...pendingImages];
    setInput('');
    setPendingImages([]);
    setQuotedSelection(null);
    setSelectionAction(null);

    await sendMessage(text, images, {
      maxTokens: resolvedMaxTokens,
      temperature: resolvedTemperature,
      toolPermissionMode: toolPermissionPreset,
      memoryEnabled: !temporaryChatActive && memoryPreset === 'on',
      enabledToolNames: allAvailableToolNames.length > 0 ? selectedToolNames : undefined,
    });
  };

  const handleCopyMessage = useCallback(async (message: ChatMessage) => {
    const markdown = buildMessageMarkdown(message);
    if (!markdown) {
      return;
    }

    try {
      await copyTextToClipboard(markdown);
      setCopiedMessageId(message.id);

      if (copiedTimerRef.current != null) {
        window.clearTimeout(copiedTimerRef.current);
      }

      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1500);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const handleOpenSaveCodeBlock = useCallback(
    (payload: SaveCodeBlockPayload) => {
      if (!payload.sourceKey || appSourceKeySet.has(payload.sourceKey)) {
        return;
      }

      const resolvedLanguage = normalizeCodeLanguage(payload.language) || 'html';
      const languageLabel = toCodeLanguageLabel(resolvedLanguage);
      const sessionTitle = currentSession?.title?.trim() || '应用';
      const defaultName = `${sessionTitle}-${languageLabel}`;

      setSaveAppDialog({
        open: true,
        sourceKey: payload.sourceKey,
        sourceSessionId: payload.sourceSessionId,
        sourceSessionTitle: payload.sourceSessionTitle,
        sourceMessageId: payload.sourceMessageId,
        sourceModelId: payload.sourceModelId,
        sourceModelName: payload.sourceModelName,
        language: resolvedLanguage,
        codeContent: payload.codeContent,
        name: defaultName,
        iconMode: 'none',
        iconEmoji: APP_ICON_EMOJIS[0],
        iconImage: '',
        error: null,
      });
    },
    [appSourceKeySet, currentSession?.title],
  );

  const closeSaveAppDialog = () => {
    if (saveAppSubmitting) {
      return;
    }
    setSaveAppDialog(createInitialSaveAppDialogState());
  };

  const handleSubmitSaveApp = async () => {
    if (!saveAppDialog.open) {
      return;
    }

    const payload = {
      name: saveAppDialog.name.trim() || '未命名应用',
      sourceKey: saveAppDialog.sourceKey,
      sourceSessionId: saveAppDialog.sourceSessionId ?? undefined,
      sourceSessionTitle: saveAppDialog.sourceSessionTitle ?? undefined,
      sourceMessageId: saveAppDialog.sourceMessageId ?? undefined,
      sourceModelId: saveAppDialog.sourceModelId ?? undefined,
      sourceModelName: saveAppDialog.sourceModelName ?? undefined,
      language: saveAppDialog.language,
      codeContent: saveAppDialog.codeContent,
    } as {
      name: string;
      sourceKey: string;
      sourceSessionId?: number;
      sourceSessionTitle?: string;
      sourceMessageId?: number;
      sourceModelId?: number;
      sourceModelName?: string;
      language: string;
      codeContent: string;
      iconType?: 'emoji' | 'image';
      iconValue?: string;
    };

    if (saveAppDialog.iconMode === 'emoji' && saveAppDialog.iconEmoji) {
      payload.iconType = 'emoji';
      payload.iconValue = saveAppDialog.iconEmoji;
    }
    if (saveAppDialog.iconMode === 'image' && saveAppDialog.iconImage) {
      payload.iconType = 'image';
      payload.iconValue = saveAppDialog.iconImage;
    }

    setSaveAppSubmitting(true);
    try {
      await createAppCenterItem(payload);
      setSaveAppDialog(createInitialSaveAppDialogState());
    } catch (error: any) {
      setSaveAppDialog((prev) => ({
        ...prev,
        error: error?.message ?? '添加应用失败',
      }));
    } finally {
      setSaveAppSubmitting(false);
    }
  };

  const handleBranchMessage = useCallback(
    (target: ChatMessage) => {
      setBranchDialog({
        open: true,
        message: target,
        title: `${currentSession?.title ?? '会话'}（分支）`,
      });
    },
    [currentSession?.title],
  );

  const handleDeleteMessage = useCallback((target: ChatMessage) => {
    setDeleteMessageTarget(target);
  }, []);

  const handleSelectForAction = useCallback((payload: SelectionActionPayload | null) => {
    if (!payload || !payload.text.trim()) {
      setSelectionAction(null);
      return;
    }

    const { top, left } = resolveSelectionActionPosition(payload.rect);
    setSelectionAction({
      messageId: payload.messageId,
      text: payload.text,
      top,
      left,
    });
  }, []);

  const handleAskFromSelection = useCallback(() => {
    if (!selectionAction?.text) {
      return;
    }

    setQuotedSelection({
      messageId: selectionAction.messageId,
      text: selectionAction.text,
    });
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();

    textareaRef.current?.focus();
  }, [selectionAction]);

  const applySelectedTools = useCallback((names: string[]) => {
    if (allAvailableToolNames.length === 0) {
      setSelectedToolNames([]);
      return;
    }
    const selectedSet = new Set(names);
    const normalized = allAvailableToolNames.filter((name) => selectedSet.has(name));
    setSelectedToolNames(normalized);
    if (currentSessionId) {
      void setEnabledToolNames(normalized);
    }
  }, [allAvailableToolNames, currentSessionId, setEnabledToolNames]);

  const handleSelectAllTools = useCallback(() => {
    applySelectedTools(allAvailableToolNames);
  }, [allAvailableToolNames, applySelectedTools]);

  const handleToggleTool = useCallback((toolName: string) => {
    if (!allAvailableToolNames.includes(toolName)) {
      return;
    }
    if (selectedToolNameSet.has(toolName)) {
      applySelectedTools(selectedToolNames.filter((name) => name !== toolName));
      return;
    }
    applySelectedTools([...selectedToolNames, toolName]);
  }, [allAvailableToolNames, selectedToolNameSet, selectedToolNames, applySelectedTools]);

  const handleSelectAgent = async (agentId: number) => {
    if (currentSessionId) {
      await setSelectedAgentId(agentId);
    } else {
      setDraftAgentId(agentId);
    }
    setAddMenuOpen(false);
    setAddMenuAgentOpen(false);
    setAddMenuOutputLengthOpen(false);
    setAddMenuTemperatureOpen(false);
    setAddMenuToolPermissionOpen(false);
    setAddMenuMemoryOpen(false);
    setAddMenuToolsOpen(false);
    setQuickOutputMenuOpen(false);
    setQuickTemperatureMenuOpen(false);
    setQuickToolPermissionMenuOpen(false);
    setQuickMemoryMenuOpen(false);
    setQuickToolsMenuOpen(false);
    setAgentPickerOpen(false);
  };

  const handleToolApproval = useCallback(async (assistantMessageId: number, approved: boolean) => {
    if (toolApprovalPendingMessageId != null) {
      return;
    }

    setToolApprovalPendingMessageId(assistantMessageId);
    try {
      await resolveToolApproval(assistantMessageId, approved);
      setToolApprovalStatusMap((prev) => ({
        ...prev,
        [assistantMessageId]: approved ? 'approved' : 'rejected',
      }));
    } finally {
      setToolApprovalPendingMessageId((current) => (current === assistantMessageId ? null : current));
    }
  }, [toolApprovalPendingMessageId, resolveToolApproval]);

  const handleOpenSessionAbout = async (session: ChatSession) => {
    setSessionAboutDialog({
      open: true,
      loading: true,
      session,
      messageCount: 0,
      firstMessageAt: null,
      lastMessageAt: null,
      error: null,
    });

    try {
      const sessionMessages = await chatApi.getMessages(session.id);
      const messageCount = sessionMessages.length;
      const firstMessageAt = messageCount > 0 ? sessionMessages[0].createdAt : null;
      const lastMessageAt = messageCount > 0 ? sessionMessages[messageCount - 1].createdAt : null;

      setSessionAboutDialog({
        open: true,
        loading: false,
        session,
        messageCount,
        firstMessageAt,
        lastMessageAt,
        error: null,
      });
    } catch (e: any) {
      setSessionAboutDialog({
        open: true,
        loading: false,
        session,
        messageCount: 0,
        firstMessageAt: null,
        lastMessageAt: null,
        error: e?.message ?? '加载聊天信息失败',
      });
    }
  };

  const collectExportMessages = () =>
    messages.filter((message) => message.id > 0 && message.role !== 'system');

  const handleExportMarkdown = () => {
    if (!currentSessionId) {
      return;
    }

    const sessionTitle = currentSession?.title?.trim() || '未命名会话';
    const markdown = buildSessionExportMarkdown(sessionTitle, collectExportMessages());
    const safeTitle = normalizeExportFileName(sessionTitle) || 'chat';
    triggerBlobDownload(
      new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      `${safeTitle}-${createTimestampSuffix()}.md`,
    );
  };

  const handleExportPdf = () => {
    if (!currentSessionId) {
      return;
    }

    const sessionTitle = currentSession?.title?.trim() || '未命名会话';
    const printableHtml = buildSessionExportHtml(sessionTitle, collectExportMessages());
    printHtmlAsPdf(printableHtml);
  };

  const handleShareCurrentSession = async () => {
    if (!currentSessionId) {
      return;
    }

    const shareUrl = `${window.location.origin}/chat/${currentSessionId}`;
    try {
      await copyTextToClipboard(shareUrl);
      setShareCopied(true);
      if (shareCopiedTimerRef.current != null) {
        window.clearTimeout(shareCopiedTimerRef.current);
      }
      shareCopiedTimerRef.current = window.setTimeout(() => {
        setShareCopied(false);
      }, 1500);
    } catch (e) {
      console.error(e);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const nativeEvent = event.nativeEvent as KeyboardEvent & { keyCode?: number };
    if (event.key === 'Enter' && !event.shiftKey) {
      // 输入法组合输入阶段（中文/日文等）按回车用于上屏，不应触发发送。
      if (composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) {
        return;
      }
      event.preventDefault();
      void handleSend();
    }
  };

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    adjustInputHeight(event.currentTarget);
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageFiles = items
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null);

    if (imageFiles.length === 0) {
      return;
    }

    event.preventDefault();
    try {
      const imageData = await Promise.all(imageFiles.map((file) => fileToDataUrl(file)));
      setPendingImages((prev) => [...prev, ...imageData].slice(0, 6));
    } catch (e) {
      console.error(e);
    }
  };

  const handleUploadImages = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const imageData = await Promise.all(files.map((file) => fileToDataUrl(file)));
      setPendingImages((prev) => [...prev, ...imageData].slice(0, 6));
    } catch (e: any) {
      console.error(e);
    } finally {
      event.target.value = '';
    }
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const currentScrollTop = container.scrollTop;
    const isScrollingUp = currentScrollTop < lastMessagesScrollTopRef.current;
    lastMessagesScrollTopRef.current = currentScrollTop;

    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    // 仅在“非常接近底部”时恢复自动跟随，避免用户轻微上滑仍被强制拉回。
    if (distanceToBottom <= 8) {
      shouldAutoScrollRef.current = true;
      return;
    }

    if (isScrollingUp) {
      shouldAutoScrollRef.current = false;
    }
  };

  const handleMessagesWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // 用户滚轮向上时立即退出自动跟随，避免下一批 token 抢滚动。
    if (event.deltaY < 0) {
      shouldAutoScrollRef.current = false;
    }
  };

  const closeChatSearchDialog = () => {
    chatSearchRequestIdRef.current += 1;
    setChatSearchOpen(false);
    setChatSearchKeyword('');
    setChatSearchResults([]);
    setChatSearchLoading(false);
  };

  const handleOpenChatSearch = () => {
    setSidebarSettingsOpen(false);
    setHeaderMoreOpen(false);
    setChatSearchOpen(true);
  };

  const handleCreateSessionFromSearch = () => {
    closeChatSearchDialog();
    void handleCreateSession();
  };

  const handleSelectSessionFromSearch = (sessionId: number, messageId?: number | null) => {
    closeChatSearchDialog();
    if (messageId != null && messageId > 0) {
      navigate(`/chat/${sessionId}?messageId=${messageId}`);
      return;
    }
    navigate(`/chat/${sessionId}`);
  };

  const anchorAddSubmenuToTrigger = (trigger: HTMLElement) => {
    const panel = addMenuPanelRef.current;
    if (!panel) {
      return;
    }
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const rawTop = triggerRect.top - panelRect.top;
    const boundedTop = Math.max(0, Math.min(rawTop, Math.max(0, panelRect.height - 40)));
    setAddMenuSubmenuTop(boundedTop);
  };

  const renderComposerSendControls = () => (
    <div className="flex items-center gap-2">
      {streaming ? (
        <button
          onClick={() => void stopStreaming()}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
            temporaryChatActive
              ? 'bg-white text-[#0d0d0d] hover:bg-[rgb(236,236,236)]'
              : 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300'
          }`}
          title="停止生成"
          type="button"
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="3.5" y="3.5" width="13" height="13" rx="2.2" fill="currentColor" />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => void handleSend()}
          disabled={hasPendingToolApproval || (!input.trim() && pendingImages.length === 0 && !quotedSelection)}
          className={`inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed ${
            temporaryChatActive
              ? 'bg-white text-[#0d0d0d] hover:bg-[rgb(236,236,236)] disabled:bg-white/25 disabled:text-white/70'
              : 'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-[rgb(217,217,217)] dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300 dark:disabled:bg-slate-700'
          }`}
          title={hasPendingToolApproval ? '请先允许或拒绝工具调用' : '发送'}
          type="button"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 3L10 15M10 3L5 8M10 3L15 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );

  const renderComposerAddMenuButton = () => (
    <div className="relative" ref={addMenuRef}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => void handleUploadImages(event)}
      />

      <button
        onClick={() => {
          setAddMenuOpen((prev) => !prev);
          setAddMenuAgentOpen(false);
          setAddMenuOutputLengthOpen(false);
          setAddMenuTemperatureOpen(false);
          setAddMenuToolPermissionOpen(false);
          setAddMenuMemoryOpen(false);
          setAddMenuToolsOpen(false);
          setQuickOutputMenuOpen(false);
          setQuickTemperatureMenuOpen(false);
          setQuickToolPermissionMenuOpen(false);
          setQuickMemoryMenuOpen(false);
          setQuickToolsMenuOpen(false);
          setAgentPickerOpen(false);
        }}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors ${
          temporaryChatActive
            ? 'border-white/30 text-white hover:bg-white/10'
            : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
        }`}
        type="button"
        title="更多"
      >
        <PlusIcon />
      </button>

      {addMenuOpen && (
        <div
          ref={addMenuPanelRef}
          className="absolute bottom-11 left-0 z-30 min-w-[180px] overflow-visible rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
        >
          <button
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={() => {
              fileInputRef.current?.click();
              setAddMenuOpen(false);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={() => {
              // 鼠标回到一级菜单项时，收起所有二级菜单，避免“悬挂”在右侧。
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
            }}
            type="button"
          >
            <UploadIcon />
            <span>上传图片</span>
          </button>

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuOutputLengthOpen((prev) => !prev);
              setAddMenuAgentOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuOutputLengthOpen(true);
              setAddMenuAgentOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <OutputLengthIcon />
              输出长度
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuOutputLengthOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-50 max-h-[62vh] min-w-[250px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              {MAX_TOKENS_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => {
                    setMaxTokensPreset(preset.key);
                    if (preset.key !== 'custom') {
                      setAddMenuOpen(false);
                      setAddMenuOutputLengthOpen(false);
                      setAddMenuTemperatureOpen(false);
                      setAddMenuToolPermissionOpen(false);
                      setAddMenuMemoryOpen(false);
                      setAddMenuToolsOpen(false);
                      setAddMenuAgentOpen(false);
                      setQuickOutputMenuOpen(false);
                      setQuickTemperatureMenuOpen(false);
                      setQuickToolPermissionMenuOpen(false);
                      setQuickMemoryMenuOpen(false);
                    }
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    maxTokensPreset === preset.key
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <OutputLengthIcon />
                    {preset.label}
                    {preset.value != null && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {preset.value}
                      </span>
                    )}
                  </span>
                  {maxTokensPreset === preset.key && <CheckIcon />}
                </button>
              ))}

              {maxTokensPreset === 'custom' && (
                <div className="px-2 pb-2 pt-1">
                  <input
                    value={maxTokensCustomInput}
                    onChange={(event) => setMaxTokensCustomInput(event.target.value)}
                    placeholder="输入 max_tokens（整数）"
                    className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-600 dark:bg-[#212121] dark:text-slate-100"
                  />
                  {selectedModelMaxCompletionTokens != null && (
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      当前模型上限：{selectedModelMaxCompletionTokens}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuTemperatureOpen((prev) => !prev);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuTemperatureOpen(true);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <TemperatureIcon />
              温度
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuTemperatureOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-50 max-h-[62vh] min-w-[250px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              {TEMPERATURE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => {
                    setTemperaturePreset(preset.key);
                    if (preset.key !== 'custom') {
                      setAddMenuOpen(false);
                      setAddMenuOutputLengthOpen(false);
                      setAddMenuTemperatureOpen(false);
                      setAddMenuToolPermissionOpen(false);
                      setAddMenuMemoryOpen(false);
                      setAddMenuToolsOpen(false);
                      setAddMenuAgentOpen(false);
                      setQuickOutputMenuOpen(false);
                      setQuickTemperatureMenuOpen(false);
                      setQuickToolPermissionMenuOpen(false);
                      setQuickMemoryMenuOpen(false);
                    }
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    temperaturePreset === preset.key
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <TemperatureIcon />
                    {preset.label}
                    {preset.value != null && (
                      <span className="text-xs text-slate-400 dark:text-slate-500">
                        {formatShortNumber(preset.value)}
                      </span>
                    )}
                  </span>
                  {temperaturePreset === preset.key && <CheckIcon />}
                </button>
              ))}

              {temperaturePreset === 'custom' && (
                <div className="px-2 pb-2 pt-1">
                  <input
                    value={temperatureCustomInput}
                    onChange={(event) => setTemperatureCustomInput(event.target.value)}
                    placeholder="输入温度（0 - 2）"
                    className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-600 dark:bg-[#212121] dark:text-slate-100"
                  />
                </div>
              )}
            </div>
          )}

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuToolPermissionOpen((prev) => !prev);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuToolPermissionOpen(true);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <ToolPermissionIcon />
              工具权限
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuToolPermissionOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-50 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              {TOOL_PERMISSION_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => {
                    setToolPermissionPreset(preset.key);
                    setAddMenuOpen(false);
                    setAddMenuOutputLengthOpen(false);
                    setAddMenuTemperatureOpen(false);
                    setAddMenuToolPermissionOpen(false);
                    setAddMenuMemoryOpen(false);
                    setAddMenuToolsOpen(false);
                    setAddMenuAgentOpen(false);
                    setQuickOutputMenuOpen(false);
                    setQuickTemperatureMenuOpen(false);
                    setQuickToolPermissionMenuOpen(false);
                    setQuickMemoryMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    toolPermissionPreset === preset.key
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <ToolPermissionIcon />
                    {preset.label}
                  </span>
                  {toolPermissionPreset === preset.key && <CheckIcon />}
                </button>
              ))}
            </div>
          )}

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuMemoryOpen((prev) => !prev);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuMemoryOpen(true);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <MemoryIcon />
              记忆设置
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuMemoryOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-50 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              {MEMORY_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => {
                    setMemoryPreset(preset.key);
                    setAddMenuOpen(false);
                    setAddMenuOutputLengthOpen(false);
                    setAddMenuTemperatureOpen(false);
                    setAddMenuToolPermissionOpen(false);
                    setAddMenuMemoryOpen(false);
                    setAddMenuToolsOpen(false);
                    setAddMenuAgentOpen(false);
                    setQuickOutputMenuOpen(false);
                    setQuickTemperatureMenuOpen(false);
                    setQuickToolPermissionMenuOpen(false);
                    setQuickMemoryMenuOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    memoryPreset === preset.key
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <MemoryIcon />
                    {preset.label}
                  </span>
                  {memoryPreset === preset.key && <CheckIcon />}
                </button>
              ))}
            </div>
          )}

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuToolsOpen((prev) => !prev);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuToolsOpen(true);
              setAddMenuAgentOpen(false);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <ToolsCapabilityIcon className="h-4 w-4" />
              选择工具
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuToolsOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-50 max-h-[62vh] min-w-[260px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              <button
                type="button"
                onClick={handleSelectAllTools}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                  isToolSelectionDefault
                    ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                    : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  <ToolsCapabilityIcon className="h-4 w-4" />
                  默认（全选）
                </span>
                {isToolSelectionDefault && <CheckIcon />}
              </button>

              {availableTools.length === 0 ? (
                <p className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500">暂无可用工具</p>
              ) : (
                availableTools.map((tool) => {
                  const selected = selectedToolNameSet.has(tool.name);
                  return (
                    <button
                      key={`tool-select-${tool.name}`}
                      type="button"
                      onClick={() => handleToggleTool(tool.name)}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                        selected
                          ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                          : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                      }`}
                    >
                      <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                        <ToolsCapabilityIcon className="h-4 w-4" />
                        <span className="truncate" title={tool.name}>
                          {tool.name}
                        </span>
                      </span>
                      {selected && <CheckIcon />}
                    </button>
                  );
                })
              )}
            </div>
          )}

          <button
            className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]"
            onClick={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuAgentOpen((prev) => !prev);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            onMouseEnter={(event) => {
              anchorAddSubmenuToTrigger(event.currentTarget);
              setAddMenuAgentOpen(true);
              setAddMenuOutputLengthOpen(false);
              setAddMenuTemperatureOpen(false);
              setAddMenuToolPermissionOpen(false);
              setAddMenuMemoryOpen(false);
              setAddMenuToolsOpen(false);
              setQuickOutputMenuOpen(false);
              setQuickTemperatureMenuOpen(false);
              setQuickToolPermissionMenuOpen(false);
              setQuickMemoryMenuOpen(false);
              setQuickToolsMenuOpen(false);
            }}
            type="button"
          >
            <span className="inline-flex items-center gap-2">
              <SparkIcon />
              选择智能体
            </span>
            <ChevronRightIcon className="h-4 w-4 text-slate-400" />
          </button>

          {addMenuAgentOpen && (
            <div
              className="absolute left-[calc(100%+6px)] z-40 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]"
              style={{ top: addMenuSubmenuTop }}
            >
              {visibleAgents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => void handleSelectAgent(agent.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                    activeAgentId === agent.id
                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                  }`}
                  type="button"
                >
                  <span className="inline-flex items-center gap-2">
                    <SparkIcon />
                    {agent.name}
                  </span>
                  {activeAgentId === agent.id && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 bg-[#f7f7f8] text-slate-900 dark:bg-[#212121] dark:text-slate-100">
      {showGlobalSidebar && (
      <aside
        className={`${sidebarCollapsed ? 'w-[52px] bg-white dark:bg-[#171717]' : 'w-[260px] bg-[#f5f5f5] dark:bg-[#171717]'} flex shrink-0 flex-col border-r border-slate-200 py-3 pr-0 transition-[width] duration-200 dark:border-[#2f2f2f]`}
      >
        <div className={`mb-2 flex items-center ${sidebarCollapsed ? 'justify-center' : 'justify-between pl-[6px] pr-[10px]'}`}>
          {!sidebarCollapsed && (
            <p className="truncate text-sm pl-3 font-medium text-[#0d0d0d] dark:text-slate-200">Open Zen</p>
          )}
          <button
            className="rounded-lg p-2 text-[#0d0d0d] transition-colors hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] hover:text-[#0d0d0d] dark:text-slate-300 dark:hover:bg-[#2a2a2a]"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            type="button"
          >
            {sidebarCollapsed ? <ExpandIcon /> : <CollapseIcon />}
          </button>
        </div>

        <div className={`mb-3 space-y-1 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
          <button
            className={`group/new-chat inline-flex items-center gap-2 rounded-xl text-sm font-normal leading-6 text-[#0d0d0d] transition-colors hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:text-slate-100 dark:hover:bg-[#2a2a2a] ${
              sidebarCollapsed
                ? 'mx-auto h-10 w-10 justify-center px-0 py-0'
                : 'mx-[6px] w-[calc(100%-12px)] justify-start px-[10px] py-[6px]'
            }`}
            onClick={() => void handleCreateSession()}
            title="新建会话"
            type="button"
          >
            <NewChatIcon />
            {!sidebarCollapsed && (
              <>
                <span>新建会话</span>
                <span className="ml-auto text-[12px] font-medium tracking-[0.02em] text-[#a1a1aa] opacity-0 transition-opacity group-hover/new-chat:opacity-100">
                  ⇧⌘O
                </span>
              </>
            )}
          </button>

          <button
            className={`group/chat-search inline-flex items-center gap-2 rounded-xl text-sm font-normal leading-6 text-[#0d0d0d] transition-colors dark:text-slate-100 ${
              chatSearchOpen
                ? 'bg-[rgb(234,234,234)] dark:bg-[#2a2a2a]'
                : 'hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:hover:bg-[#2a2a2a]'
            } ${
              sidebarCollapsed
                ? 'mx-auto h-10 w-10 justify-center px-0 py-0'
                : 'mx-[6px] w-[calc(100%-12px)] justify-start px-[10px] py-[6px]'
            }`}
            onClick={handleOpenChatSearch}
            title="搜索聊天"
            type="button"
          >
            <SearchChatIcon />
            {!sidebarCollapsed && (
              <>
                <span>搜索聊天</span>
                <span className="ml-auto text-[12px] font-medium tracking-[0.02em] text-[#a1a1aa] opacity-0 transition-opacity group-hover/chat-search:opacity-100">
                  ⌘K
                </span>
              </>
            )}
          </button>

          <Link
            to="/apps"
            className={`inline-flex items-center gap-2 rounded-xl text-sm font-normal leading-6 text-[#0d0d0d] transition-colors dark:text-slate-100 ${
              pageMode === 'apps'
                ? 'bg-[rgb(234,234,234)] dark:bg-[#2a2a2a]'
                : 'hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:hover:bg-[#2a2a2a]'
            } ${
              sidebarCollapsed
                ? 'mx-auto h-10 w-10 justify-center px-0 py-0'
                : 'mx-[6px] w-[calc(100%-12px)] justify-start px-[10px] py-[6px]'
            }`}
            title="应用中心"
          >
            <SidebarAppsIcon />
            {!sidebarCollapsed && <span>应用中心</span>}
          </Link>
        </div>

        {!sidebarCollapsed && (
          <div className="chat-sidebar-scroll min-h-0 flex-1 overflow-y-auto pr-0">
            <button
              type="button"
              onClick={() => setProjectSectionExpanded((prev) => !prev)}
              className="mb-2 mx-[6px] inline-flex h-[28px] w-[calc(100%-12px)] items-center rounded-lg px-[6px] text-xs font-normal text-[#8f8f8f] transition-colors hover:bg-[rgb(239,239,239)] dark:hover:bg-[#2a2a2a]"
              title={projectSectionExpanded ? '折叠项目' : '展开项目'}
            >
              <span>项目</span>
              {projectSectionExpanded ? (
                <ChevronDownIcon className="ml-auto h-3.5 w-3.5 text-[#8f8f8f]" />
              ) : (
                <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-[#8f8f8f]" />
              )}
            </button>
            {projectSectionExpanded && (
              <div className="mb-3 space-y-1">
                <button
                  className="mx-[6px] inline-flex h-[36px] w-[calc(100%-12px)] items-center gap-2 rounded-xl px-[10px] py-[6px] text-sm font-normal text-[#0d0d0d] transition-colors hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)]"
                  type="button"
                  onClick={handleOpenCreateProjectDialog}
                  title="新建项目"
                >
                  <NewProjectIcon />
                  <span>新项目</span>
                </button>

                {projectItems.map((project) => (
                  <div
                    key={project.id}
                    className={`group/project mx-[6px] flex h-[36px] w-[calc(100%-12px)] items-center gap-1 rounded-xl px-[10px] py-[6px] text-left text-sm font-normal transition-colors ${
                      activeSidebarProjectId === project.id
                        ? 'bg-[rgb(234,234,234)] text-[#0d0d0d]'
                        : 'text-[#0d0d0d] hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)]'
                    }`}
                  >
                    <button
                      className="inline-flex min-w-0 flex-1 items-center gap-2 text-left"
                      type="button"
                      onClick={() => handleSelectProjectFromSidebar(project.id)}
                      title={project.name}
                    >
                      <SidebarProjectIcon />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setDeleteProjectTarget({ id: project.id, name: project.name });
                      }}
                      className="rounded-lg p-1.5 text-[#8f8f8f] opacity-0 transition-colors transition-opacity hover:bg-[rgb(234,234,234)] hover:text-rose-500 group-hover/project:opacity-100 focus-visible:opacity-100"
                      title="删除项目"
                    >
                      <DeleteIcon />
                    </button>
                  </div>
                ))}

                {projectItems.length === 0 && (
                  <div className="mx-[6px] rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-[#8f8f8f] dark:border-slate-700">
                    还没有项目，点击上方按钮新建
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => setChatSectionExpanded((prev) => !prev)}
              className="mb-2 mx-[6px] inline-flex h-[28px] w-[calc(100%-12px)] items-center rounded-lg px-[6px] text-xs font-normal text-[#8f8f8f] transition-colors hover:bg-[rgb(239,239,239)] dark:hover:bg-[#2a2a2a]"
              title={chatSectionExpanded ? '折叠聊天' : '展开聊天'}
            >
              <span>聊天</span>
              {chatSectionExpanded ? (
                <ChevronDownIcon className="ml-auto h-3.5 w-3.5 text-[#8f8f8f]" />
              ) : (
                <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-[#8f8f8f]" />
              )}
            </button>
            {chatSectionExpanded && (
              <div className="space-y-1">
                {sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    collapsed={sidebarCollapsed}
                    active={currentSessionId === session.id}
                    onSelect={() => navigate(`/chat/${session.id}`)}
                    onAbout={() => void handleOpenSessionAbout(session)}
                    onRename={() => setRenameDialog({ open: true, session, title: session.title })}
                    onCopy={() =>
                      setCopyDialog({
                        open: true,
                        session,
                        title: `${session.title}（副本）`,
                      })
                    }
                    onDelete={() => setDeleteSessionTarget(session)}
                  />
                ))}

                {sessions.length === 0 && (
                  <div className="mx-[6px] rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-[#8f8f8f] dark:border-slate-700">
                    还没有会话，点击上方按钮开始
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {sidebarCollapsed && <div className="flex-1" />}

        <div
          ref={sidebarSettingsRef}
          className={`relative mt-2 border-t border-slate-200 pt-2 dark:border-[#2f2f2f] ${sidebarCollapsed ? 'flex justify-center' : ''}`}
        >
          <button
            type="button"
            onClick={() => {
              setHeaderMoreOpen(false);
              setSidebarSettingsOpen((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1.5 rounded-xl text-sm font-normal leading-6 text-[#0d0d0d] transition-colors hover:bg-[rgb(239,239,239)] active:bg-[rgb(234,234,234)] dark:text-slate-300 dark:hover:bg-[#2a2a2a] dark:hover:text-slate-100 ${
              sidebarCollapsed
                ? 'mx-auto h-9 w-9 justify-center px-0 py-0'
                : 'mx-[6px] w-[calc(100%-12px)] justify-start px-[10px] py-[6px]'
            }`}
            title="设置"
          >
            <SettingsIcon />
            {!sidebarCollapsed && <span>设置</span>}
            {!sidebarCollapsed && (
              <ChevronDownIcon className={`ml-auto h-4 w-4 text-[#8f8f8f] transition-transform ${sidebarSettingsOpen ? 'rotate-180' : ''}`} />
            )}
          </button>

          {sidebarSettingsOpen && (
            <div
              className={`absolute z-40 min-w-[180px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-[#2f2f2f] ${
                sidebarCollapsed ? 'bottom-0 left-[calc(100%+8px)]' : 'bottom-11 left-0'
              }`}
            >
              <Link
                to="/models"
                onClick={() => setSidebarSettingsOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors dark:text-slate-200 ${
                  pageMode === 'models'
                    ? 'bg-[rgb(245,245,245)] text-[#0d0d0d] dark:bg-[#242424]'
                    : 'text-[#0d0d0d] hover:bg-[rgb(245,245,245)] dark:hover:bg-[#242424]'
                }`}
              >
                <ModelManageIcon />
                <span>模型管理</span>
              </Link>
              <Link
                to="/agents"
                onClick={() => setSidebarSettingsOpen(false)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors dark:text-slate-200 ${
                  pageMode === 'agents'
                    ? 'bg-[rgb(245,245,245)] text-[#0d0d0d] dark:bg-[#242424]'
                    : 'text-[#0d0d0d] hover:bg-[rgb(245,245,245)] dark:hover:bg-[#242424]'
                }`}
              >
                <AgentManageIcon />
                <span>智能体管理</span>
              </Link>
            </div>
          )}
        </div>
      </aside>
      )}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-[#212121]">
        {pageMode !== 'projects' && (
        <div className="flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-5 dark:border-[#2f2f2f] dark:bg-[#212121]">
          {isChatRoute ? (
            <ChatModelSelect
              options={enabledModels.map((model) => ({
                value: model.id,
                label: model.displayName,
                supportsReasoning: Boolean(model.supportsReasoning),
                supportsVision: Boolean(model.supportsVision),
                supportsTools: Boolean(model.supportsTools),
              }))}
              value={effectiveSelectedModelId}
              onChange={(value) => void handleModelChange(value)}
            />
          ) : (
            <h1 className="text-lg font-semibold text-[#0d0d0d] dark:text-slate-100">{topBarTitle}</h1>
          )}

          <div className="ml-auto flex items-center gap-1">
            {showTemporaryToggle && (
              <button
                type="button"
                onClick={handleToggleTemporaryChat}
                className={`mr-1 inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
                  draftTemporary
                    ? 'bg-[rgb(245,245,245)] text-[#0d0d0d] hover:bg-[rgb(239,239,239)] dark:bg-[#2a2a2a] dark:text-slate-100 dark:hover:bg-[#303030]'
                    : 'text-[#0d0d0d] hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#2a2a2a]'
                }`}
                title={draftTemporary ? '退出临时聊天' : '开启临时聊天'}
                aria-label={draftTemporary ? '退出临时聊天' : '开启临时聊天'}
              >
                {draftTemporary ? (
                  <TemporaryModeActiveIcon className="h-5 w-5" />
                ) : (
                  <TemporaryModeIcon className="h-5 w-5" />
                )}
              </button>
            )}

            {hasCurrentSession && (
              <ContextUsageIndicator
                stats={contextStats}
                loading={contextStatsLoading}
                tooltipPlacement="bottom"
              />
            )}

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#0d0d0d] transition-colors hover:bg-slate-100 hover:text-[#0d0d0d] dark:text-slate-300 dark:hover:bg-[#2a2a2a] dark:hover:text-slate-100"
              title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>

            <div ref={headerMoreRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setSidebarSettingsOpen(false);
                  setHeaderMoreOpen((prev) => !prev);
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-[#0d0d0d] transition-colors hover:bg-slate-100 hover:text-[#0d0d0d] dark:text-slate-300 dark:hover:bg-[#2a2a2a] dark:hover:text-slate-100"
                title="更多"
              >
                <MoreIcon />
              </button>

              {headerMoreOpen && (
                <div className="absolute right-0 top-11 z-40 min-w-[180px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-[#2f2f2f]">
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMoreOpen(false);
                      handleExportPdf();
                    }}
                    disabled={!canExportCurrentSession}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-[rgb(245,245,245)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-[#242424]"
                  >
                    <ExportPdfIcon />
                    <span>导出 PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHeaderMoreOpen(false);
                      handleExportMarkdown();
                    }}
                    disabled={!canExportCurrentSession}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-[rgb(245,245,245)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-[#242424]"
                  >
                    <ExportMarkdownIcon />
                    <span>导出 Markdown</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleShareCurrentSession();
                    }}
                    disabled={!hasCurrentSession}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-[rgb(245,245,245)] disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-200 dark:hover:bg-[#242424]"
                  >
                    <ShareIcon />
                    <span>{shareCopied ? '链接已复制' : '分享'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!currentSession) {
                        return;
                      }
                      setHeaderMoreOpen(false);
                      setDeleteSessionTarget(currentSession);
                    }}
                    disabled={!hasCurrentSession}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rose-500 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-rose-900/20"
                  >
                    <DeleteIcon />
                    <span>删除会话</span>
                  </button>
                </div>
              )}
            </div>
            </div>
          </div>
        )}

        {isChatRoute ? (
          <>
            <div
              ref={messagesContainerRef}
              onScroll={handleMessagesScroll}
              onWheel={handleMessagesWheel}
              className={
                shouldCenterComposer
                  ? 'px-4 pt-28'
                  : 'flex-1 min-h-0 overflow-y-auto px-4 pb-4 pt-6'
              }
            >
              {!currentSessionId ? (
                <div className={`mx-auto max-w-2xl text-center ${isTemporaryDraft ? 'text-[#0d0d0d]' : 'text-[#0d0d0d] dark:text-slate-100'} ${shouldCenterComposer ? 'mt-6' : 'mt-24'}`}>
                  <h2 className="mb-3 text-[30px] font-semibold tracking-tight">
                    {isTemporaryDraft ? '临时聊天' : '今天想聊点什么？'}
                  </h2>
                  <p className={`text-sm ${isTemporaryDraft ? 'text-[#686868]' : ''}`}>
                    {isTemporaryDraft
                      ? '已针对此聊天禁用记忆功能，因此聊天内容不会包含在历史记录中。'
                      : '选择或创建会话后即可开始。支持 Markdown、公式、图片输入和流式输出。'}
                  </p>
                </div>
              ) : messages.length === 0 ? (
                <div className="mx-auto mt-24 max-w-2xl rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 dark:border-slate-700 dark:bg-[#212121] dark:text-slate-400">
                  <p className="text-lg">会话已创建</p>
                  <p className="mt-2 text-sm">输入你的问题，或拖拽/上传图片开始对话。</p>
                </div>
              ) : (
                <div ref={messagesContentRef} className="space-y-7 pb-3">
                  {displayMessages.map(({ message, embeddedTools, mergedMessageIds, preToolContent, requiresToolApproval, approvalMessageId }) => {
                    const explicitToolApprovalStatus =
                      mergedMessageIds
                        .map((id) => toolApprovalStatusMap[id])
                        .find((status): status is 'approved' | 'rejected' => status === 'approved' || status === 'rejected') ??
                      null;
                    const hasRejectedResult = embeddedTools.some((tool) =>
                      (tool.resultText ?? '').includes('用户拒绝执行工具'),
                    );
                    const toolApprovalStatus =
                      explicitToolApprovalStatus ?? (!requiresToolApproval && hasRejectedResult ? 'rejected' : null);

                    return (
                      <div
                        key={mergedMessageIds.join('-')}
                        data-message-id={message.id}
                        data-message-ids={mergedMessageIds.join(' ')}
                        className={`rounded-2xl transition-[background-color,box-shadow] duration-500 ${
                          highlightedMessageId != null && mergedMessageIds.includes(highlightedMessageId)
                            ? 'bg-amber-50/70 shadow-[0_0_0_1px_rgba(245,158,11,0.35)] dark:bg-amber-500/10 dark:shadow-[0_0_0_1px_rgba(251,191,36,0.45)]'
                            : ''
                        }`}
                      >
                        <MessageCard
                          message={message}
                          embeddedTools={embeddedTools}
                          preToolContent={preToolContent}
                          toolApprovalStatus={toolApprovalStatus}
                          requiresToolApproval={requiresToolApproval}
                          approvalMessageId={approvalMessageId}
                          toolApprovalPending={toolApprovalPendingMessageId === approvalMessageId}
                          isStreaming={activeStreamingMessageId === message.id}
                          copied={copiedMessageId === message.id}
                          sessionTitle={currentSession?.title ?? null}
                          assistantProfile={resolveMessageAssistantProfile(message)}
                          onCopy={handleCopyMessage}
                          onBranch={handleBranchMessage}
                          onDelete={handleDeleteMessage}
                          onSelectForAction={handleSelectForAction}
                          onAddToAppCenter={handleOpenSaveCodeBlock}
                          onToolApproval={handleToolApproval}
                          savedSourceKeySet={appSourceKeySet}
                        />
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            <div
              className={
                shouldCenterComposer
                  ? 'px-4 pb-5 pt-8'
                  : 'bg-gradient-to-t from-white via-white to-white px-4 pb-5 pt-3 dark:from-[#212121] dark:via-[#212121] dark:to-[#212121]'
              }
            >
              <div className="mx-auto max-w-[860px]">
                {error && (
                  <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
                    {error}
                  </div>
                )}

                {pendingImages.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {pendingImages.map((image, index) => (
                      <div key={`${image.slice(0, 32)}-${index}`} className="relative">
                        <img
                          src={image}
                          alt={`待发送图片-${index + 1}`}
                          className="h-16 w-16 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                        />
                        <button
                          onClick={() => setPendingImages((prev) => prev.filter((_, i) => i !== index))}
                          className="absolute -right-1 -top-1 rounded-full bg-slate-900 px-1 text-xs text-white"
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!selectedModel?.supportsVision && pendingImages.length > 0 && (
                  <p className="mb-2 text-xs text-amber-600 dark:text-amber-300">当前模型不支持图片输入，发送时会报错，请切换视觉模型。</p>
                )}

                <div className={`rounded-[30px] border px-4 pb-3 pt-3 shadow-[0_2px_10px_rgba(0,0,0,0.05)] ${
                  temporaryChatActive
                    ? 'border-[#3a3a3a] bg-[#2f2f2f] shadow-[0_2px_10px_rgba(0,0,0,0.2)]'
                    : 'border-[rgb(208,208,208)] bg-white dark:border-[#4a4a4a] dark:bg-[#2f2f2f]'
                }`}>
                  {quotedSelection && (
                    <div className="mb-2 flex items-start gap-2 rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-600 dark:bg-[#3a3a3a] dark:text-slate-200">
                      <span className="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400">
                        <QuoteContextIcon />
                      </span>
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                        “{quotedSelection.text}”
                      </p>
                      <button
                        type="button"
                        onClick={() => setQuotedSelection(null)}
                        className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600 dark:hover:bg-[#444444] dark:hover:text-slate-100"
                        title="移除引用"
                      >
                        ×
                      </button>
                    </div>
                  )}

                  <div className={isCompactComposer ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2' : ''}>
                    {isCompactComposer && <div className="shrink-0">{renderComposerAddMenuButton()}</div>}

                    <textarea
                      ref={textareaRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      onCompositionStart={() => {
                        composingRef.current = true;
                      }}
                      onCompositionEnd={() => {
                        composingRef.current = false;
                      }}
                      onPaste={(event) => void handlePaste(event)}
                      placeholder={'输入消息，Enter 发送，Shift + Enter 换行'}
                      rows={1}
                      disabled={streaming}
                      className={`resize-none border-none bg-transparent text-sm leading-6 outline-none ${
                        temporaryChatActive
                          ? 'text-white placeholder:text-[#a3a3a3]'
                          : 'placeholder:text-slate-400 dark:text-slate-100'
                      } ${
                        isCompactComposer ? 'min-h-[24px] min-w-0 w-full' : 'w-full'
                      }`}
                    />

                    {isCompactComposer && <div className="shrink-0">{renderComposerSendControls()}</div>}
                  </div>

                  {composerParamError && (
                    <p className="mt-2 text-xs text-rose-500 dark:text-rose-300">{composerParamError}</p>
                  )}
                  {hasPendingToolApproval && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-300">
                      当前有待确认的工具调用，请先允许或拒绝后再继续发送。
                    </p>
                  )}

                  {!isCompactComposer && (
                    <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {renderComposerAddMenuButton()}

                      {showAgentChip && activeAgent && (
                        <div className="relative" ref={agentPickerRef}>
                          <button
                            className="inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-200 dark:hover:bg-[#2d2d2d]"
                            type="button"
                            onClick={() => {
                              setAgentPickerOpen((prev) => !prev);
                              setAddMenuOpen(false);
                              setAddMenuAgentOpen(false);
                              setAddMenuOutputLengthOpen(false);
                              setAddMenuTemperatureOpen(false);
                              setAddMenuToolPermissionOpen(false);
                              setAddMenuMemoryOpen(false);
                              setAddMenuToolsOpen(false);
                              setQuickOutputMenuOpen(false);
                              setQuickTemperatureMenuOpen(false);
                              setQuickToolPermissionMenuOpen(false);
                              setQuickMemoryMenuOpen(false);
                            }}
                            title="切换智能体"
                          >
                            <SparkIcon />
                            <span>{activeAgent.name}</span>
                            <ChevronDownIcon className={`h-3.5 w-3.5 text-slate-400 transition-transform ${agentPickerOpen ? 'rotate-180' : ''}`} />
                          </button>

                          {agentPickerOpen && (
                            <div className="absolute bottom-10 left-0 z-40 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                              {visibleAgents.map((agent) => (
                                <button
                                  key={agent.id}
                                  onClick={() => void handleSelectAgent(agent.id)}
                                  className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                    activeAgentId === agent.id
                                      ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                      : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                  }`}
                                  type="button"
                                >
                                  <span className="inline-flex items-center gap-2">
                                    <SparkIcon />
                                    {agent.name}
                                  </span>
                                  {activeAgentId === agent.id && <CheckIcon />}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {hasComposerParamSummary && (
                        <div className="flex items-center gap-1">
                          {maxTokensShortLabel && (
                            <div className="relative" ref={quickOutputMenuRef}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickOutputMenuOpen((prev) => !prev);
                                  setQuickTemperatureMenuOpen(false);
                                  setQuickToolPermissionMenuOpen(false);
                                  setQuickMemoryMenuOpen(false);
                                  setQuickToolsMenuOpen(false);
                                  setAddMenuOpen(false);
                                  setAddMenuAgentOpen(false);
                                  setAddMenuOutputLengthOpen(false);
                                  setAddMenuTemperatureOpen(false);
                                  setAddMenuToolPermissionOpen(false);
                                  setAddMenuMemoryOpen(false);
                                  setAddMenuToolsOpen(false);
                                  setAgentPickerOpen(false);
                                }}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-300 dark:hover:bg-[#2d2d2d]"
                                title={maxTokensDisplayText ?? undefined}
                                aria-label={maxTokensDisplayText ?? undefined}
                              >
                                {maxTokensShortLabel}
                              </button>

                              {quickOutputMenuOpen && (
                                <div className="absolute bottom-11 left-0 z-50 max-h-[62vh] min-w-[250px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                                  {MAX_TOKENS_PRESETS.map((preset) => (
                                    <button
                                      key={`quick-output-${preset.key}`}
                                      onClick={() => {
                                        setMaxTokensPreset(preset.key);
                                        if (preset.key !== 'custom') {
                                          setQuickOutputMenuOpen(false);
                                          setQuickTemperatureMenuOpen(false);
                                          setQuickToolPermissionMenuOpen(false);
                                          setQuickMemoryMenuOpen(false);
                                          setQuickToolsMenuOpen(false);
                                        }
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                        maxTokensPreset === preset.key
                                          ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                          : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                      }`}
                                      type="button"
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        <OutputLengthIcon />
                                        {preset.label}
                                        {preset.value != null && (
                                          <span className="text-xs text-slate-400 dark:text-slate-500">
                                            {preset.value}
                                          </span>
                                        )}
                                      </span>
                                      {maxTokensPreset === preset.key && <CheckIcon />}
                                    </button>
                                  ))}

                                  {maxTokensPreset === 'custom' && (
                                    <div className="px-2 pb-2 pt-1">
                                      <input
                                        value={maxTokensCustomInput}
                                        onChange={(event) => setMaxTokensCustomInput(event.target.value)}
                                        placeholder="输入 max_tokens（整数）"
                                        className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-600 dark:bg-[#212121] dark:text-slate-100"
                                      />
                                      {selectedModelMaxCompletionTokens != null && (
                                        <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                                          当前模型上限：{selectedModelMaxCompletionTokens}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {temperatureShortLabel && (
                            <div className="relative" ref={quickTemperatureMenuRef}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickTemperatureMenuOpen((prev) => !prev);
                                  setQuickOutputMenuOpen(false);
                                  setQuickToolPermissionMenuOpen(false);
                                  setQuickMemoryMenuOpen(false);
                                  setQuickToolsMenuOpen(false);
                                  setAddMenuOpen(false);
                                  setAddMenuAgentOpen(false);
                                  setAddMenuOutputLengthOpen(false);
                                  setAddMenuTemperatureOpen(false);
                                  setAddMenuToolPermissionOpen(false);
                                  setAddMenuMemoryOpen(false);
                                  setAddMenuToolsOpen(false);
                                  setAgentPickerOpen(false);
                                }}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-300 dark:hover:bg-[#2d2d2d]"
                                title={temperatureDisplayText ?? undefined}
                                aria-label={temperatureDisplayText ?? undefined}
                              >
                                {temperatureShortLabel}
                              </button>

                              {quickTemperatureMenuOpen && (
                                <div className="absolute bottom-11 left-0 z-50 max-h-[62vh] min-w-[250px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                                  {TEMPERATURE_PRESETS.map((preset) => (
                                    <button
                                      key={`quick-temperature-${preset.key}`}
                                      onClick={() => {
                                        setTemperaturePreset(preset.key);
                                        if (preset.key !== 'custom') {
                                          setQuickOutputMenuOpen(false);
                                          setQuickTemperatureMenuOpen(false);
                                          setQuickToolPermissionMenuOpen(false);
                                          setQuickMemoryMenuOpen(false);
                                          setQuickToolsMenuOpen(false);
                                        }
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                        temperaturePreset === preset.key
                                          ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                          : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                      }`}
                                      type="button"
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        <TemperatureIcon />
                                        {preset.label}
                                        {preset.value != null && (
                                          <span className="text-xs text-slate-400 dark:text-slate-500">
                                            {formatShortNumber(preset.value)}
                                          </span>
                                        )}
                                      </span>
                                      {temperaturePreset === preset.key && <CheckIcon />}
                                    </button>
                                  ))}

                                  {temperaturePreset === 'custom' && (
                                    <div className="px-2 pb-2 pt-1">
                                      <input
                                        value={temperatureCustomInput}
                                        onChange={(event) => setTemperatureCustomInput(event.target.value)}
                                        placeholder="输入温度（0 - 2）"
                                        className="h-8 w-full rounded-md border border-[rgb(209,209,209)] bg-white px-2.5 text-xs text-slate-700 outline-none transition focus:border-slate-400 dark:border-slate-600 dark:bg-[#212121] dark:text-slate-100"
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          {toolPermissionShortLabel && (
                            <div className="relative" ref={quickToolPermissionMenuRef}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickToolPermissionMenuOpen((prev) => !prev);
                                  setQuickOutputMenuOpen(false);
                                  setQuickTemperatureMenuOpen(false);
                                  setQuickMemoryMenuOpen(false);
                                  setQuickToolsMenuOpen(false);
                                  setAddMenuOpen(false);
                                  setAddMenuAgentOpen(false);
                                  setAddMenuOutputLengthOpen(false);
                                  setAddMenuTemperatureOpen(false);
                                  setAddMenuToolPermissionOpen(false);
                                  setAddMenuMemoryOpen(false);
                                  setAddMenuToolsOpen(false);
                                  setAgentPickerOpen(false);
                                }}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-300 dark:hover:bg-[#2d2d2d]"
                                title={toolPermissionDisplayText ?? undefined}
                                aria-label={toolPermissionDisplayText ?? undefined}
                              >
                                {toolPermissionShortLabel}
                              </button>

                              {quickToolPermissionMenuOpen && (
                                <div className="absolute bottom-11 left-0 z-50 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                                  {TOOL_PERMISSION_PRESETS.map((preset) => (
                                    <button
                                      key={`quick-tool-permission-${preset.key}`}
                                      onClick={() => {
                                        setToolPermissionPreset(preset.key);
                                        setQuickOutputMenuOpen(false);
                                        setQuickTemperatureMenuOpen(false);
                                        setQuickToolPermissionMenuOpen(false);
                                        setQuickMemoryMenuOpen(false);
                                        setQuickToolsMenuOpen(false);
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                        toolPermissionPreset === preset.key
                                          ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                          : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                      }`}
                                      type="button"
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        <ToolPermissionIcon />
                                        {preset.label}
                                      </span>
                                      {toolPermissionPreset === preset.key && <CheckIcon />}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {memoryShortLabel && (
                            <div className="relative" ref={quickMemoryMenuRef}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickMemoryMenuOpen((prev) => !prev);
                                  setQuickOutputMenuOpen(false);
                                  setQuickTemperatureMenuOpen(false);
                                  setQuickToolPermissionMenuOpen(false);
                                  setQuickToolsMenuOpen(false);
                                  setAddMenuOpen(false);
                                  setAddMenuAgentOpen(false);
                                  setAddMenuOutputLengthOpen(false);
                                  setAddMenuTemperatureOpen(false);
                                  setAddMenuToolPermissionOpen(false);
                                  setAddMenuMemoryOpen(false);
                                  setAddMenuToolsOpen(false);
                                  setAgentPickerOpen(false);
                                }}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-300 dark:hover:bg-[#2d2d2d]"
                                title={memoryDisplayText ?? undefined}
                                aria-label={memoryDisplayText ?? undefined}
                              >
                                {memoryShortLabel}
                              </button>

                              {quickMemoryMenuOpen && (
                                <div className="absolute bottom-11 left-0 z-50 min-w-[220px] rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                                  {MEMORY_PRESETS.map((preset) => (
                                    <button
                                      key={`quick-memory-${preset.key}`}
                                      onClick={() => {
                                        setMemoryPreset(preset.key);
                                        setQuickOutputMenuOpen(false);
                                        setQuickTemperatureMenuOpen(false);
                                        setQuickToolPermissionMenuOpen(false);
                                        setQuickMemoryMenuOpen(false);
                                        setQuickToolsMenuOpen(false);
                                      }}
                                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                        memoryPreset === preset.key
                                          ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                          : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                      }`}
                                      type="button"
                                    >
                                      <span className="inline-flex items-center gap-2">
                                        <MemoryIcon />
                                        {preset.label}
                                      </span>
                                      {memoryPreset === preset.key && <CheckIcon />}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {toolSelectionShortLabel && (
                            <div className="relative" ref={quickToolsMenuRef}>
                              <button
                                type="button"
                                onClick={() => {
                                  setQuickToolsMenuOpen((prev) => !prev);
                                  setQuickOutputMenuOpen(false);
                                  setQuickTemperatureMenuOpen(false);
                                  setQuickToolPermissionMenuOpen(false);
                                  setQuickMemoryMenuOpen(false);
                                  setAddMenuOpen(false);
                                  setAddMenuAgentOpen(false);
                                  setAddMenuOutputLengthOpen(false);
                                  setAddMenuTemperatureOpen(false);
                                  setAddMenuToolPermissionOpen(false);
                                  setAddMenuMemoryOpen(false);
                                  setAddMenuToolsOpen(false);
                                  setAgentPickerOpen(false);
                                }}
                                className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-[#242424] dark:text-slate-300 dark:hover:bg-[#2d2d2d]"
                                title={toolSelectionDisplayText ?? undefined}
                                aria-label={toolSelectionDisplayText ?? undefined}
                              >
                                {toolSelectionShortLabel}
                              </button>

                              {quickToolsMenuOpen && (
                                <div className="absolute bottom-11 left-0 z-50 max-h-[62vh] min-w-[260px] overflow-y-auto rounded-xl border border-[rgb(209,209,209)] bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-[#2f2f2f]">
                                  <button
                                    type="button"
                                    onClick={handleSelectAllTools}
                                    className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                      isToolSelectionDefault
                                        ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                        : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                    }`}
                                  >
                                    <span className="inline-flex items-center gap-2">
                                      <ToolsCapabilityIcon className="h-4 w-4" />
                                      默认（全选）
                                    </span>
                                    {isToolSelectionDefault && <CheckIcon />}
                                  </button>

                                  {availableTools.length === 0 ? (
                                    <p className="px-2 py-2 text-xs text-slate-400 dark:text-slate-500">暂无可用工具</p>
                                  ) : (
                                    availableTools.map((tool) => {
                                      const selected = selectedToolNameSet.has(tool.name);
                                      return (
                                        <button
                                          key={`quick-tool-select-${tool.name}`}
                                          type="button"
                                          onClick={() => handleToggleTool(tool.name)}
                                          className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm transition-colors ${
                                            selected
                                              ? 'bg-[rgb(245,245,245)] text-slate-900 dark:bg-[#242424] dark:text-slate-100'
                                              : 'text-slate-700 hover:bg-[rgb(245,245,245)] dark:text-slate-200 dark:hover:bg-[#242424]'
                                          }`}
                                        >
                                          <span className="inline-flex min-w-0 flex-1 items-center gap-2">
                                            <ToolsCapabilityIcon className="h-4 w-4" />
                                            <span className="truncate" title={tool.name}>
                                              {tool.name}
                                            </span>
                                          </span>
                                          {selected && <CheckIcon />}
                                        </button>
                                      );
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {renderComposerSendControls()}
                  </div>
                  )}
                </div>

                <p className={`mt-2 text-center text-[11px] ${temporaryChatActive ? 'text-[#8f8f8f]' : 'text-slate-400 dark:text-slate-500'}`}>
                  AI 可能会犯错，请注意核验关键信息
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            {pageMode === 'models' ? (
              <ModelsPage />
            ) : pageMode === 'agents' ? (
              <AgentsPage />
            ) : pageMode === 'apps' ? (
              <AppsPage />
            ) : (
              <ProjectsPage
                routeProjectId={routeProjectId}
                onSelectProject={handleSelectProjectFromSidebar}
                onRequestCreateProject={handleOpenCreateProjectDialog}
                onBackToChat={handleBackToChatFromProject}
              />
            )}
          </div>
        )}
      </main>

      {isChatRoute && selectionAction && (
        <button
          type="button"
          onMouseDown={(event) => {
            // 保留当前选区，避免按钮点击前 selection 被浏览器清空。
            event.preventDefault();
          }}
          onClick={handleAskFromSelection}
          className="fixed z-50 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-lg transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-[#2f2f2f] dark:text-slate-100 dark:hover:bg-[#3a3a3a]"
          style={{ top: `${selectionAction.top}px`, left: `${selectionAction.left}px`, transform: 'translateX(-50%)' }}
        >
          <AskSelectionIcon />
          <span>{askActionLabel}</span>
        </button>
      )}

      <ChatSearchDialog
        open={chatSearchOpen}
        keyword={chatSearchKeyword}
        sessions={sessions}
        searchResults={chatSearchResults}
        searchLoading={chatSearchLoading}
        currentSessionId={currentSessionId}
        onKeywordChange={setChatSearchKeyword}
        onClose={closeChatSearchDialog}
        onCreateSession={handleCreateSessionFromSearch}
        onSelectSession={handleSelectSessionFromSearch}
      />

      <SessionAboutDialog
        state={sessionAboutDialog}
        onClose={() => setSessionAboutDialog(initialSessionAboutState)}
      />

      <Dialog
        open={saveAppDialog.open}
        onClose={closeSaveAppDialog}
        title="添加到应用中心"
        size="lg"
      >
        <div className="space-y-4">
          <Input
            label="应用名称"
            value={saveAppDialog.name}
            onChange={(event) => {
              const nextName = event.target.value;
              setSaveAppDialog((prev) => ({
                ...prev,
                name: nextName,
                error: null,
              }));
            }}
            placeholder="例如：销售报表看板"
            disabled={saveAppSubmitting}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">图标</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={saveAppDialog.iconMode === 'none' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                disabled={saveAppSubmitting}
                onClick={() => {
                  setSaveAppDialog((prev) => ({
                    ...prev,
                    iconMode: 'none',
                    iconImage: '',
                    error: null,
                  }));
                }}
              >
                使用 AI
              </Button>
              <Button
                variant={saveAppDialog.iconMode === 'emoji' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                disabled={saveAppSubmitting}
                onClick={() => {
                  setSaveAppDialog((prev) => ({
                    ...prev,
                    iconMode: 'emoji',
                    iconEmoji: prev.iconEmoji || APP_ICON_EMOJIS[0],
                    error: null,
                  }));
                }}
              >
                Emoji
              </Button>
              <Button
                variant={saveAppDialog.iconMode === 'image' ? 'primary' : 'secondary'}
                size="sm"
                type="button"
                disabled={saveAppSubmitting}
                onClick={() => {
                  setSaveAppDialog((prev) => ({
                    ...prev,
                    iconMode: 'image',
                    error: null,
                  }));
                  void saveAppIconInputRef.current?.click();
                }}
              >
                上传图片
              </Button>
              <input
                ref={saveAppIconInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) {
                    return;
                  }

                  void fileToDataUrl(file)
                    .then((dataUrl) => {
                      setSaveAppDialog((prev) => ({
                        ...prev,
                        iconMode: 'image',
                        iconImage: dataUrl,
                        error: null,
                      }));
                    })
                    .catch((error) => {
                      setSaveAppDialog((prev) => ({
                        ...prev,
                        error: error?.message ?? '图标读取失败',
                      }));
                    });
                }}
              />
            </div>

            {saveAppDialog.iconMode === 'emoji' && (
              <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
                {APP_ICON_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={saveAppSubmitting}
                    onClick={() => {
                      setSaveAppDialog((prev) => ({
                        ...prev,
                        iconEmoji: emoji,
                        error: null,
                      }));
                    }}
                    className={`h-8 w-8 rounded-md text-lg transition-colors ${
                      saveAppDialog.iconEmoji === emoji
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {saveAppDialog.iconMode === 'image' && saveAppDialog.iconImage && (
              <img
                src={saveAppDialog.iconImage}
                alt="应用图标预览"
                className="h-16 w-16 rounded-xl border border-slate-200 object-cover dark:border-slate-700"
              />
            )}
          </div>

          <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-[#2a2a2a] dark:text-slate-300">
            <p>语言：{toCodeLanguageLabel(normalizeCodeLanguage(saveAppDialog.language) || 'html')}</p>
            <p className="mt-1 truncate">来源：{saveAppDialog.sourceKey}</p>
            <p className="mt-1 truncate">来源会话：{saveAppDialog.sourceSessionTitle || '-'}</p>
            <p className="mt-1 truncate">来源模型：{saveAppDialog.sourceModelName || '-'}</p>
            <p className="mt-1">来源消息 ID：{saveAppDialog.sourceMessageId ?? '-'}</p>
          </div>

          {saveAppDialog.error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
              {saveAppDialog.error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={closeSaveAppDialog} disabled={saveAppSubmitting}>
              取消
            </Button>
            <Button onClick={() => void handleSubmitSaveApp()} disabled={saveAppSubmitting}>
              {saveAppSubmitting ? '保存中...' : '保存到应用中心'}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={projectCreateDialog.open}
        onClose={handleCloseCreateProjectDialog}
        title="新建项目"
      >
        <div className="space-y-4">
          <Input
            label="项目名称"
            value={projectCreateDialog.name}
            onChange={(event) => {
              const nextName = event.target.value;
              setProjectCreateDialog((prev) => ({
                ...prev,
                name: nextName,
                error: null,
              }));
            }}
            placeholder="例如：Open Zen Web"
            disabled={projectCreateDialog.submitting}
          />

          <Textarea
            label="项目描述（可选）"
            value={projectCreateDialog.description}
            onChange={(event) => {
              const nextDescription = event.target.value;
              setProjectCreateDialog((prev) => ({
                ...prev,
                description: nextDescription,
                error: null,
              }));
            }}
            placeholder="描述项目目标、技术栈或注意事项"
            rows={4}
            disabled={projectCreateDialog.submitting}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">关联真实目录（必填）</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                type="button"
                disabled={projectCreateDialog.submitting}
                onClick={() => {
                  setProjectDirectoryPickerOpen(true);
                }}
              >
                选择真实目录
              </Button>
              </div>
              <p className="break-all rounded-md bg-[rgb(245,245,245)] px-3 py-2 font-mono text-xs text-slate-600 dark:bg-[#2a2a2a] dark:text-slate-300">
                {projectCreateDialog.realDirectoryPath || '未选择'}
              </p>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              将保存真实绝对路径，用于后续后端读取目录内容。
            </p>
          </div>

          {(projectCreateDialog.error || projectError) && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
              {projectCreateDialog.error || projectError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={handleCloseCreateProjectDialog}
              disabled={projectCreateDialog.submitting}
            >
              取消
            </Button>
            <Button
              onClick={() => {
                void handleSubmitCreateProject();
              }}
              disabled={projectCreateDialog.submitting}
            >
              {projectCreateDialog.submitting ? '创建中...' : '创建项目'}
            </Button>
          </div>
        </div>
      </Dialog>

      <DirectoryPickerDialog
        open={projectDirectoryPickerOpen}
        title="选择真实目录"
        initialPath={projectCreateDialog.realDirectoryPath.trim() || '~/'}
        description="选择目标目录后点击确定，将保存项目的真实绝对路径。"
        onClose={() => {
          if (projectCreateDialog.submitting) {
            return;
          }
          setProjectDirectoryPickerOpen(false);
        }}
        onConfirm={handleConfirmProjectDirectory}
      />

      <Dialog
        open={renameDialog.open}
        onClose={() => setRenameDialog({ open: false, session: null, title: '' })}
        title="重命名会话"
      >
        <div className="space-y-4">
          <Input value={renameDialog.title} onChange={(event) => setRenameDialog((prev) => ({ ...prev, title: event.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameDialog({ open: false, session: null, title: '' })}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!renameDialog.session) {
                  return;
                }
                await renameSession(renameDialog.session.id, renameDialog.title.trim() || '新会话');
                setRenameDialog({ open: false, session: null, title: '' });
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={copyDialog.open}
        onClose={() => setCopyDialog({ open: false, session: null, title: '' })}
        title="复制会话"
      >
        <div className="space-y-4">
          <Input value={copyDialog.title} onChange={(event) => setCopyDialog((prev) => ({ ...prev, title: event.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCopyDialog({ open: false, session: null, title: '' })}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!copyDialog.session) {
                  return;
                }
                await copySession(copyDialog.session.id, copyDialog.title.trim());
                setCopyDialog({ open: false, session: null, title: '' });
              }}
            >
              复制
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteProjectTarget)}
        onClose={() => setDeleteProjectTarget(null)}
        title="删除项目"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            确认将项目「{deleteProjectTarget?.name}」从项目列表移除吗？不会删除真实目录中的文件。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteProjectTarget(null)}>
              取消
            </Button>
            <Button variant="danger" onClick={() => void handleConfirmDeleteProject()}>
              确认移除
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteSessionTarget)}
        onClose={() => setDeleteSessionTarget(null)}
        title="删除会话"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            确认删除会话「{deleteSessionTarget?.title}」吗？删除后不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteSessionTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleteSessionTarget) {
                  return;
                }
                await deleteSession(deleteSessionTarget.id);
                setDeleteSessionTarget(null);
              }}
            >
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={branchDialog.open}
        onClose={() => setBranchDialog({ open: false, message: null, title: '' })}
        title="从该消息创建分支"
      >
        <div className="space-y-4">
          <Input value={branchDialog.title} onChange={(event) => setBranchDialog((prev) => ({ ...prev, title: event.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setBranchDialog({ open: false, message: null, title: '' })}>
              取消
            </Button>
            <Button
              onClick={async () => {
                if (!branchDialog.message) {
                  return;
                }
                await branchFromMessage(branchDialog.message.id, branchDialog.title.trim());
                setBranchDialog({ open: false, message: null, title: '' });
              }}
            >
              创建分支
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(deleteMessageTarget)}
        onClose={() => setDeleteMessageTarget(null)}
        title="删除消息"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">确认删除这条消息吗？删除后不可恢复。</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteMessageTarget(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleteMessageTarget) {
                  return;
                }
                await deleteMessage(deleteMessageTarget.id);
                setDeleteMessageTarget(null);
              }}
            >
              确认删除
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

export default ChatPage;
