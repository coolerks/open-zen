import React, { useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../store/agentStore';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import { Input, Textarea } from '../components/ui/Input';
import { Toggle } from '../components/ui/Toggle';
import type { Agent, AgentRequest } from '../types';

const AGENT_AVATAR_EMOJIS = ['🤖', '🧠', '🧑‍🏫', '🛠️', '📚', '💻', '🔬', '🎯'];

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`文件读取失败: ${file.name}`));
    reader.readAsDataURL(file);
  });
}

const AgentAvatarPreview: React.FC<{ agent: Pick<Agent, 'avatarType' | 'avatarValue' | 'name'> }> = ({ agent }) => {
  if (agent.avatarType === 'image' && agent.avatarValue) {
    return <img src={agent.avatarValue} alt={`${agent.name}-头像`} className="h-7 w-7 rounded-full object-cover" />;
  }

  if (agent.avatarType === 'emoji' && agent.avatarValue) {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-sm dark:bg-slate-800">
        {agent.avatarValue}
      </div>
    );
  }

  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-[11px] font-semibold text-white">
      AI
    </div>
  );
};

const AgentsPage: React.FC = () => {
  const { agents, loading, fetchAgents, createAgent, updateAgent, toggleAgent, deleteAgent } = useAgentStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex items-center justify-end">
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>新建智能体</Button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中...</p>
        ) : agents.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-16 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            暂无智能体，请先创建一个。
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/70">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">名称</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">描述</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">状态</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {agents.map((agent) => (
                  <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                      <div className="flex items-center gap-2">
                        <AgentAvatarPreview agent={agent} />
                        <span>{agent.name}</span>
                        {agent.isDefault && (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">
                            默认
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{agent.description || '-'}</td>
                    <td className="px-4 py-3">
                      <Toggle
                        checked={agent.enabled}
                        onChange={(enabled) => void toggleAgent(agent.id, enabled)}
                        disabled={agent.isDefault}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(agent); setDialogOpen(true); }}>
                          编辑
                        </Button>
                        {agent.isDefault ? (
                          <Button variant="ghost" size="sm" disabled>
                            系统内置
                          </Button>
                        ) : (
                          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(agent)}>
                            删除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AgentDialog
        open={dialogOpen}
        editing={editing}
        onClose={() => setDialogOpen(false)}
        onSubmit={async (data) => {
          if (editing) {
            await updateAgent(editing.id, data);
          } else {
            await createAgent(data);
          }
          setDialogOpen(false);
        }}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="删除智能体"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            确认删除智能体「{deleteTarget?.name}」吗？
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (!deleteTarget) {
                  return;
                }
                await deleteAgent(deleteTarget.id);
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

const AgentDialog: React.FC<{
  open: boolean;
  editing: Agent | null;
  onClose: () => void;
  onSubmit: (data: AgentRequest) => Promise<void>;
}> = ({ open, editing, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [avatarMode, setAvatarMode] = useState<'none' | 'emoji' | 'image'>('none');
  const [avatarEmoji, setAvatarEmoji] = useState<string>('');
  const [avatarImage, setAvatarImage] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (editing) {
      setName(editing.name);
      setDescription(editing.description || '');
      setSystemPrompt(editing.systemPrompt);
      setEnabled(editing.enabled);
      if (editing.avatarType === 'emoji' && editing.avatarValue) {
        setAvatarMode('emoji');
        setAvatarEmoji(editing.avatarValue);
        setAvatarImage('');
      } else if (editing.avatarType === 'image' && editing.avatarValue) {
        setAvatarMode('image');
        setAvatarImage(editing.avatarValue);
        setAvatarEmoji('');
      } else {
        setAvatarMode('none');
        setAvatarEmoji('');
        setAvatarImage('');
      }
    } else {
      setName('');
      setDescription('');
      setSystemPrompt('你是一个专业、严谨、乐于解释细节的智能体。');
      setEnabled(true);
      setAvatarMode('none');
      setAvatarEmoji('');
      setAvatarImage('');
    }
  }, [open, editing]);

  return (
    <Dialog open={open} onClose={onClose} title={editing ? '编辑智能体' : '新建智能体'}>
      <div className="space-y-4">
        <Input
          label="名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={Boolean(editing?.isDefault)}
        />
        <Input
          label="描述"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="例如：代码审查专家、数学老师"
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">头像</p>
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
                  setAvatarEmoji(AGENT_AVATAR_EMOJIS[0]);
                }
              }}
            >
              选择 Emoji
            </Button>
            <Button
              variant={avatarMode === 'image' ? 'primary' : 'secondary'}
              size="sm"
              type="button"
              onClick={() => {
                setAvatarMode('image');
                avatarInputRef.current?.click();
              }}
            >
              上传图片
            </Button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }
                try {
                  const dataUrl = await fileToDataUrl(file);
                  setAvatarMode('image');
                  setAvatarImage(dataUrl);
                  setAvatarEmoji('');
                } finally {
                  event.target.value = '';
                }
              }}
            />
          </div>

          {avatarMode === 'emoji' && (
            <div className="flex flex-wrap gap-2">
              {AGENT_AVATAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setAvatarEmoji(emoji)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                    avatarEmoji === emoji
                      ? 'border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30'
                      : 'border-gray-300 hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800'
                  }`}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {avatarMode === 'image' && avatarImage && (
            <div className="flex items-center gap-2">
              <img src={avatarImage} alt="头像预览" className="h-12 w-12 rounded-full object-cover" />
              <Button
                variant="secondary"
                size="sm"
                type="button"
                onClick={() => {
                  setAvatarMode('none');
                  setAvatarImage('');
                }}
              >
                移除图片
              </Button>
            </div>
          )}
        </div>

        <Textarea
          label="系统提示词"
          rows={8}
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
        />
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="启用"
          disabled={Boolean(editing?.isDefault)}
        />
        {editing?.isDefault && (
          <p className="text-xs text-amber-600 dark:text-amber-300">
            默认智能体不可删除、不可禁用，名称固定为“默认”，可修改描述和提示词。
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>取消</Button>
          <Button
            onClick={async () => {
              setSubmitting(true);
              try {
                const payload: AgentRequest = {
                  name: (editing?.isDefault ? '默认' : name),
                  description: description || undefined,
                  systemPrompt,
                  enabled,
                };

                if (avatarMode === 'emoji' && avatarEmoji) {
                  payload.avatarType = 'emoji';
                  payload.avatarValue = avatarEmoji;
                } else if (avatarMode === 'image' && avatarImage) {
                  payload.avatarType = 'image';
                  payload.avatarValue = avatarImage;
                }

                await onSubmit({
                  ...payload,
                });
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting || !(editing?.isDefault ? '默认' : name).trim() || !systemPrompt.trim()}
          >
            {submitting ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </Dialog>
  );
};

export default AgentsPage;
