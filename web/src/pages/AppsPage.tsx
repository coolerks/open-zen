import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Input } from '../components/ui/Input';
import { useAppCenterStore } from '../store/appCenterStore';
import type { AppCenterItem, AppCenterItemUpdateRequest } from '../types';

const APP_ICON_EMOJIS = ['🚀', '📊', '🧩', '🛠️', '💡', '🧠', '🌐', '📚', '🎨', '📦'];

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`文件读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function openHtmlPreview(codeContent: string): void {
  const blob = new Blob([codeContent], { type: 'text/html;charset=utf-8' });
  const previewUrl = URL.createObjectURL(blob);
  window.open(previewUrl, '_blank', 'noopener,noreferrer');
  // 预留足够时间给新标签页读取 Blob 内容，避免过早释放。
  window.setTimeout(() => {
    URL.revokeObjectURL(previewUrl);
  }, 60_000);
}

const AppIconPreview: React.FC<{ item: Pick<AppCenterItem, 'iconType' | 'iconValue' | 'name'> }> = ({ item }) => {
  if (item.iconType === 'image' && item.iconValue) {
    return <img src={item.iconValue} alt={`${item.name}-图标`} className="h-9 w-9 rounded-lg object-cover" />;
  }

  if (item.iconType === 'emoji' && item.iconValue) {
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-base dark:bg-slate-800">
        {item.iconValue}
      </div>
    );
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-xs font-semibold text-white">
      AI
    </div>
  );
};

const LocateSourceIcon: React.FC = () => (
  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.4 10H14.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <path d="M11.8 7.2L14.6 10L11.8 12.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const AppsPage: React.FC = () => {
  const navigate = useNavigate();
  const { items, loading, error, fetchItems, updateItem, deleteItem } = useAppCenterStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [editing, setEditing] = useState<AppCenterItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppCenterItem | null>(null);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const filteredItems = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return items;
    }

    return items.filter((item) => {
      const nameText = item.name.toLowerCase();
      const languageText = item.language.toLowerCase();
      const sourceText = item.sourceKey.toLowerCase();
      const sourceSessionText = (item.sourceSessionTitle ?? '').toLowerCase();
      const sourceModelText = (item.sourceModelName ?? '').toLowerCase();
      return (
        nameText.includes(keyword) ||
        languageText.includes(keyword) ||
        sourceText.includes(keyword) ||
        sourceSessionText.includes(keyword) ||
        sourceModelText.includes(keyword)
      );
    });
  }, [items, searchKeyword]);

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">应用中心</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              保存 AI 生成的 HTML 应用，随时一键打开。
            </p>
          </div>
          <Input
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            placeholder="搜索应用名称 / 语言 / 来源"
            className="w-[280px]"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600 dark:border-rose-900/40 dark:bg-rose-900/20 dark:text-rose-300">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">加载中...</p>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            暂无应用，请先在聊天代码块中点击“添加到应用中心”。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-[#171717] dark:hover:border-slate-600"
              >
                <div className="mb-3 flex items-start gap-3">
                  <AppIconPreview item={item} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{item.name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.language.toUpperCase()}</p>
                  </div>
                </div>

                <div className="mb-3 space-y-1 text-xs text-slate-400 dark:text-slate-500">
                  <p className="truncate">来源：{item.sourceKey}</p>
                  <p className="truncate">会话：{item.sourceSessionTitle ?? '-'}</p>
                  <p className="truncate">模型：{item.sourceModelName ?? '-'}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => openHtmlPreview(item.codeContent)}>
                    打开
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!item.sourceSessionId}
                    onClick={() => {
                      if (!item.sourceSessionId) {
                        return;
                      }
                      const query = item.sourceMessageId ? `?messageId=${item.sourceMessageId}` : '';
                      navigate(`/chat/${item.sourceSessionId}${query}`);
                    }}
                  >
                    <span className="inline-flex items-center gap-1">
                      <LocateSourceIcon />
                      <span>定位来源</span>
                    </span>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditing(item)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteTarget(item)}>
                    删除
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AppEditDialog
        open={Boolean(editing)}
        item={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (payload) => {
          if (!editing) {
            return;
          }
          await updateItem(editing.id, payload);
          setEditing(null);
        }}
      />

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="删除应用">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            确认删除应用「{deleteTarget?.name}」吗？删除后不可恢复。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleteTarget) {
                  return;
                }
                await deleteItem(deleteTarget.id);
                setDeleteTarget(null);
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

const AppEditDialog: React.FC<{
  open: boolean;
  item: AppCenterItem | null;
  onClose: () => void;
  onSubmit: (payload: AppCenterItemUpdateRequest) => Promise<void>;
}> = ({ open, item, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [avatarMode, setAvatarMode] = useState<'none' | 'emoji' | 'image'>('none');
  const [avatarEmoji, setAvatarEmoji] = useState<string>('');
  const [avatarImage, setAvatarImage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !item) {
      return;
    }

    setName(item.name);
    if (item.iconType === 'emoji' && item.iconValue) {
      setAvatarMode('emoji');
      setAvatarEmoji(item.iconValue);
      setAvatarImage('');
    } else if (item.iconType === 'image' && item.iconValue) {
      setAvatarMode('image');
      setAvatarImage(item.iconValue);
      setAvatarEmoji('');
    } else {
      setAvatarMode('none');
      setAvatarEmoji('');
      setAvatarImage('');
    }
  }, [open, item]);

  return (
    <Dialog open={open} onClose={onClose} title="编辑应用" size="lg">
      <div className="space-y-4">
        <Input label="名称" value={name} onChange={(event) => setName(event.target.value)} />

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">图标</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={avatarMode === 'none' ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => {
                setAvatarMode('none');
                setAvatarEmoji('');
                setAvatarImage('');
              }}
            >
              使用 AI
            </Button>
            <Button
              variant={avatarMode === 'emoji' ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => {
                setAvatarMode('emoji');
                if (!avatarEmoji) {
                  setAvatarEmoji(APP_ICON_EMOJIS[0]);
                }
              }}
            >
              Emoji
            </Button>
            <Button
              variant={avatarMode === 'image' ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => {
                setAvatarMode('image');
                void avatarInputRef.current?.click();
              }}
            >
              上传图片
            </Button>
            <input
              ref={avatarInputRef}
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
                    setAvatarMode('image');
                    setAvatarImage(dataUrl);
                  })
                  .catch((error) => {
                    console.error(error);
                  });
              }}
            />
          </div>

          {avatarMode === 'emoji' && (
            <div className="flex flex-wrap gap-2 rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              {APP_ICON_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatarEmoji(emoji)}
                  className={`h-8 w-8 rounded-md text-lg transition-colors ${
                    avatarEmoji === emoji
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {avatarMode === 'image' && avatarImage && (
            <img src={avatarImage} alt="图标预览" className="h-14 w-14 rounded-lg border border-gray-200 object-cover dark:border-gray-700" />
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>取消</Button>
          <Button
            onClick={async () => {
              const payload: AppCenterItemUpdateRequest = { name: name.trim() || '未命名应用' };
              if (avatarMode === 'emoji' && avatarEmoji) {
                payload.iconType = 'emoji';
                payload.iconValue = avatarEmoji;
              }
              if (avatarMode === 'image' && avatarImage) {
                payload.iconType = 'image';
                payload.iconValue = avatarImage;
              }

              setSubmitting(true);
              try {
                await onSubmit(payload);
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
          >
            保存
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default AppsPage;
