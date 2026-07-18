/**
 * AI 助手设置页
 * 
 * 使用 SettingsRow 组件保持与其他设置页的 UI 一致性。
 * 配置项变更即保存（updateAIConfig 自动调 PUT API）。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Chip, Divider, Textarea, Switch, Tooltip } from '@heroui/react';
import { Plus, Trash2, Pencil, Check, X, Star, Cpu, Eye } from 'lucide-react';
import SettingsRow from './SettingsRow';
import {
  getAIConfig, updateAIConfig, testAIConnection, getAIModels,
  getPromptShortcuts, createPromptShortcut, updatePromptShortcut, deletePromptShortcut,
  getPromptTemplates, createPromptTemplate, updatePromptTemplate, deletePromptTemplate,
  getConfiguredModels, createConfiguredModel, updateConfiguredModel, deleteConfiguredModel,
} from '../../api/ai';

// 局部 Section 标题组件（与其他设置页一致）
const Section = ({ title }) => (
  <p className="text-xs font-semibold text-default-500 uppercase tracking-widest pt-4 pb-1 px-1">
    {title}
  </p>
);

export default function AISettings() {
  const [config, setConfig]       = useState(null);
  const [models, setModels]       = useState([]);
  const [testing, setTesting]     = useState(false);
  const [testResult, setTestResult] = useState(null);   // {success, model|message}
  const [apiKeyInput, setApiKeyInput] = useState('');   // 单独管理 Key 输入
  const [shortcuts, setShortcuts] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ label: '', prompt: '', scope: 'general' });
  const [addingNew, setAddingNew] = useState(false);
  const [newForm, setNewForm] = useState({ label: '', prompt: '', scope: 'general' });

  // ── 模板状态 ──
  const [tplList, setTplList] = useState([]);
  const [tplEditId, setTplEditId] = useState(null);
  const [tplEditForm, setTplEditForm] = useState({ name: '', icon: 'bot', description: '', system_prompt: '', hidden_command: '', starter_prompt: '' });
  const [tplAdding, setTplAdding] = useState(false);
  const [tplNewForm, setTplNewForm] = useState({ name: '', icon: 'bot', description: '', system_prompt: '', hidden_command: '', starter_prompt: '' });

  // 通知 AIPanel 刷新数据
  const notifyAIPanel = () => window.dispatchEvent(new Event('ai-panel-data-changed'));

  // ── 模型配置状态 ──
  const [modelList, setModelList] = useState([]);
  const [modelEditId, setModelEditId] = useState(null);
  const [modelEditForm, setModelEditForm] = useState({ name: '', model_id: '', provider: 'openai', capabilities: 'text', api_base_url: '', api_key: '' });
  const [modelAdding, setModelAdding] = useState(false);
  const [modelNewForm, setModelNewForm] = useState({ name: '', model_id: '', provider: 'openai', capabilities: 'text', api_base_url: '', api_key: '' });

  // 加载配置
  useEffect(() => {
    getAIConfig().then(cfg => {
      setConfig(cfg);
    }).catch(console.error);
  }, []);

  // 更新单个字段（即存）
  const updateField = useCallback(async (field, value) => {
    setConfig(prev => ({ ...prev, [field]: value }));
    try {
      await updateAIConfig({ [field]: value });
    } catch (err) {
      console.error('[AISettings] 保存失败:', err);
    }
  }, []);

  // 保存 API Key
  const saveApiKey = useCallback(async () => {
    if (!apiKeyInput.trim()) return;
    try {
      await updateAIConfig({ api_key: apiKeyInput.trim() });
      setConfig(prev => ({ ...prev, api_key_set: true }));
      setApiKeyInput('');
    } catch (err) {
      console.error('[AISettings] 保存 Key 失败:', err);
    }
  }, [apiKeyInput]);

  // 测试连接
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAIConnection();
      setTestResult({ success: true, model: res.model });
    } catch (err) {
      setTestResult({ success: false, message: err.message });
    } finally {
      setTesting(false);
    }
  }, []);

  // 拉取模型列表
  const fetchModels = useCallback(async () => {
    try {
      const res = await getAIModels();
      setModels(res.models || []);
    } catch {
      setModels([]);
    }
  }, []);

  // ─── 快捷提示管理 ───

  useEffect(() => {
    getPromptShortcuts()
      .then(list => setShortcuts(Array.isArray(list) ? list : []))
      .catch(() => setShortcuts([]));
  }, []);

  const handleStartEdit = useCallback((s) => {
    setEditingId(s.id);
    setEditForm({ label: s.label, prompt: s.prompt, scope: s.scope });
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editForm.label.trim() || !editForm.prompt.trim()) return;
    try {
      const updated = await updatePromptShortcut(editingId, editForm);
      setShortcuts(prev => prev.map(s => s.id === editingId ? updated : s));
      setEditingId(null);
    } catch (err) {
      console.error('[AISettings] 更新快捷提示失败:', err);
    }
  }, [editingId, editForm]);

  const handleDeleteShortcut = useCallback(async (id) => {
    try {
      await deletePromptShortcut(id);
      setShortcuts(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('[AISettings] 删除快捷提示失败:', err);
    }
  }, []);

  const handleAddShortcut = useCallback(async () => {
    if (!newForm.label.trim() || !newForm.prompt.trim()) return;
    try {
      const created = await createPromptShortcut(newForm);
      setShortcuts(prev => [...prev, created]);
      setNewForm({ label: '', prompt: '', scope: 'general' });
      setAddingNew(false);
    } catch (err) {
      console.error('[AISettings] 创建快捷提示失败:', err);
    }
  }, [newForm]);

  // ─── 模板管理 ───

  useEffect(() => {
    getPromptTemplates()
      .then(list => setTplList(Array.isArray(list) ? list : []))
      .catch(() => setTplList([]));
  }, []);

  const handleSetDefaultTemplate = useCallback(async (id) => {
    try {
      await updatePromptTemplate(id, { is_default: 1 });
      setTplList(prev => prev.map(t => ({ ...t, is_default: t.id === id ? 1 : 0 })));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 设置默认模板失败:', err);
    }
  }, []);

  const handleSaveTplEdit = useCallback(async () => {
    if (!tplEditForm.name.trim() || !tplEditForm.system_prompt.trim()) return;
    try {
      const updated = await updatePromptTemplate(tplEditId, tplEditForm);
      setTplList(prev => prev.map(t => t.id === tplEditId ? updated : t));
      setTplEditId(null);
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 更新模板失败:', err);
    }
  }, [tplEditId, tplEditForm]);

  const handleDeleteTemplate = useCallback(async (id) => {
    try {
      await deletePromptTemplate(id);
      setTplList(prev => prev.filter(t => t.id !== id));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 删除模板失败:', err);
    }
  }, []);

  const handleAddTemplate = useCallback(async () => {
    if (!tplNewForm.name.trim() || !tplNewForm.system_prompt.trim()) return;
    try {
      const created = await createPromptTemplate(tplNewForm);
      setTplList(prev => [...prev, created]);
      setTplNewForm({ name: '', icon: 'bot', description: '', system_prompt: '', hidden_command: '', starter_prompt: '' });
      setTplAdding(false);
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 创建模板失败:', err);
    }
  }, [tplNewForm]);

  // ─── 模型配置管理 ───

  useEffect(() => {
    getConfiguredModels()
      .then(list => setModelList(Array.isArray(list) ? list : []))
      .catch(() => setModelList([]));
  }, []);

  const handleToggleModelEnabled = useCallback(async (id, enabled) => {
    try {
      const updated = await updateConfiguredModel(id, { enabled: enabled ? 1 : 0 });
      setModelList(prev => prev.map(m => m.id === id ? updated : m));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 切换模型状态失败:', err);
    }
  }, []);

  const handleSetDefaultTextModel = useCallback(async (id) => {
    try {
      await updateConfiguredModel(id, { is_default_text: 1 });
      setModelList(prev => prev.map(m => ({ ...m, is_default_text: m.id === id ? 1 : 0 })));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 设置默认文本模型失败:', err);
    }
  }, []);

  const handleSetDefaultVisionModel = useCallback(async (id) => {
    try {
      await updateConfiguredModel(id, { is_default_vision: 1 });
      setModelList(prev => prev.map(m => ({ ...m, is_default_vision: m.id === id ? 1 : 0 })));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 设置默认视觉模型失败:', err);
    }
  }, []);

  const handleSaveModelEdit = useCallback(async () => {
    if (!modelEditForm.name.trim() || !modelEditForm.model_id.trim()) return;
    try {
      const payload = { ...modelEditForm };
      if (!payload.api_key) delete payload.api_key; // 不更新空密钥
      const updated = await updateConfiguredModel(modelEditId, payload);
      setModelList(prev => prev.map(m => m.id === modelEditId ? updated : m));
      setModelEditId(null);
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 更新模型失败:', err);
    }
  }, [modelEditId, modelEditForm]);

  const handleDeleteModel = useCallback(async (id) => {
    try {
      await deleteConfiguredModel(id);
      setModelList(prev => prev.filter(m => m.id !== id));
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 删除模型失败:', err);
    }
  }, []);

  const handleAddModel = useCallback(async () => {
    if (!modelNewForm.name.trim() || !modelNewForm.model_id.trim()) return;
    try {
      const created = await createConfiguredModel(modelNewForm);
      setModelList(prev => [...prev, created]);
      setModelNewForm({ name: '', model_id: '', provider: 'openai', capabilities: 'text', api_base_url: '', api_key: '' });
      setModelAdding(false);
      notifyAIPanel();
    } catch (err) {
      console.error('[AISettings] 创建模型失败:', err);
    }
  }, [modelNewForm]);

  if (!config) {
    return (
      <div className="p-8 text-center text-zinc-400 text-sm">加载中...</div>
    );
  }

  // 从列表推导建议项（去除重复），用于 chip 快选
  const modelSuggestions = models.map(m => m.id).filter(Boolean);

  return (
    <div className="space-y-1">

      {/* ═══ API 连接 ═══ */}
      <Section title="API 连接" />

      <SettingsRow
        label="API 端点"
        description="OpenAI 兼容的 API 地址（如 https://api.openai.com/v1）"
        type="text"
        value={config.api_base_url || ''}
        onChange={(v) => updateField('api_base_url', v)}
      />

      <SettingsRow
        label="API Key"
        description={config.api_key_set ? '密钥已设置（输入新值可覆盖）' : '请输入 API Key'}
      >
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            variant="bordered"
            className="w-56"
            type="password"
            placeholder={config.api_key_set ? config.api_key_display : 'sk-...'}
            value={apiKeyInput}
            onValueChange={setApiKeyInput}
            onKeyDown={(e) => e.key === 'Enter' && saveApiKey()}
          />
          <Button size="sm" variant="flat" color="primary"
            isDisabled={!apiKeyInput.trim()} onPress={saveApiKey}>
            保存
          </Button>
        </div>
      </SettingsRow>

      <SettingsRow label="连接测试">
        <div className="flex items-center gap-3">
          <Button size="sm" color="primary" variant="flat"
            isLoading={testing} onPress={handleTest}>
            测试连接
          </Button>
          {testResult && (
            <Chip size="sm" color={testResult.success ? 'success' : 'danger'} variant="flat">
              {testResult.success ? `✓ ${testResult.model}` : `✗ ${testResult.message}`}
            </Chip>
          )}
        </div>
      </SettingsRow>

      <Divider className="my-3" />

      {/* ═══ 模型选择 ═══ */}
      <Section title="模型" />

      <SettingsRow label="刷新模型列表" description="从 API 端点拉取可用模型">
        <Button size="sm" variant="flat" onPress={fetchModels}>
          {models.length > 0 ? `已加载 ${models.length} 个模型` : '获取模型列表'}
        </Button>
      </SettingsRow>

      <SettingsRow label="文本模型" description="用于文本对话和数据查询">
        <div className="flex flex-col gap-1.5 w-full">
          <Input
            size="sm"
            variant="bordered"
            className="w-64"
            placeholder="输入或选择模型名称，如 gpt-4o-mini"
            value={config.text_model || ''}
            onValueChange={(v) => updateField('text_model', v)}
          />
          {modelSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {modelSuggestions.map(id => (
                <Chip
                  key={id}
                  size="sm"
                  variant={config.text_model === id ? 'solid' : 'flat'}
                  color={config.text_model === id ? 'primary' : 'default'}
                  className="cursor-pointer"
                  onClick={() => updateField('text_model', id)}
                >
                  {id}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </SettingsRow>

      <SettingsRow label="视觉模型" description="用于照片分析（需支持 Vision）">
        <div className="flex flex-col gap-1.5 w-full">
          <Input
            size="sm"
            variant="bordered"
            className="w-64"
            placeholder="输入或选择模型名称，如 gpt-4o"
            value={config.vision_model || ''}
            onValueChange={(v) => updateField('vision_model', v)}
          />
          {modelSuggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {modelSuggestions.map(id => (
                <Chip
                  key={id}
                  size="sm"
                  variant={config.vision_model === id ? 'solid' : 'flat'}
                  color={config.vision_model === id ? 'primary' : 'default'}
                  className="cursor-pointer"
                  onClick={() => updateField('vision_model', id)}
                >
                  {id}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </SettingsRow>

      <Divider className="my-3" />

      {/* ═══ 行为设置 ═══ */}
      <Section title="行为" />

      <SettingsRow
        label="修改前确认"
        description="AI 修改数据（标签、评分、备注）前需用户点击确认"
        type="switch"
        value={!!config.confirm_before_write}
        onChange={(v) => updateField('confirm_before_write', v ? 1 : 0)}
      />

      <SettingsRow
        label="允许照片分析"
        description="将照片发送给视觉模型分析构图和曝光"
        type="switch"
        value={!!config.allow_image_analysis}
        onChange={(v) => updateField('allow_image_analysis', v ? 1 : 0)}
      />

      <SettingsRow
        label="图片分辨率"
        description="发送给 AI 的图片最大分辨率"
        type="select"
        value={config.image_max_resolution || 'medium'}
        options={[
          { value: 'low',    label: '低 (240px · 使用缩略图)' },
          { value: 'medium', label: '中 (768px · 推荐)' },
          { value: 'high',   label: '高 (1024px)' },
          { value: 'full',   label: '完整 (2048px · 高 Token 消耗)' },
        ]}
        onChange={(v) => updateField('image_max_resolution', v)}
      />

      <Divider className="my-3" />

      {/* ═══ 成本控制 ═══ */}
      <Section title="成本控制" />

      <SettingsRow
        label="月度预算 (USD)"
        description="达到预算上限时 AI 将停止响应"
        type="text"
        value={String(config.monthly_budget_usd ?? 10)}
        onChange={(v) => {
          const n = parseFloat(v);
          if (!isNaN(n) && n >= 0) updateField('monthly_budget_usd', n);
        }}
      />

      <SettingsRow label="本月已用 Token" type="display">
        <Chip size="sm" variant="flat">
          {(config.monthly_tokens_used || 0).toLocaleString()} tokens
        </Chip>
      </SettingsRow>

      <Divider className="my-3" />

      {/* ═══ 快捷提示 ═══ */}
      <Section title="快捷提示" />

      <div className="px-1 space-y-2">
        <p className="text-xs text-default-400">
          在 AI 对话中显示的快捷操作按钮。点击即自动发送预设 prompt。
        </p>

        {shortcuts.map(s => (
          <div key={s.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-default-200 dark:border-default-100 group">
            {editingId === s.id ? (
              <div className="flex-1 space-y-2">
                <Input size="sm" variant="bordered" label="名称" value={editForm.label}
                  onValueChange={v => setEditForm(f => ({ ...f, label: v }))} />
                <Textarea size="sm" variant="bordered" label="Prompt" minRows={2} maxRows={5}
                  value={editForm.prompt}
                  onValueChange={v => setEditForm(f => ({ ...f, prompt: v }))} />
                <div className="flex gap-1">
                  {['general', 'photo', 'filmlab'].map(sc => (
                    <Chip key={sc} size="sm" className="cursor-pointer"
                      variant={editForm.scope === sc ? 'solid' : 'flat'}
                      color={editForm.scope === sc ? 'primary' : 'default'}
                      onClick={() => setEditForm(f => ({ ...f, scope: sc }))}
                    >
                      {sc === 'general' ? '通用' : sc === 'photo' ? '照片' : 'FilmLab'}
                    </Chip>
                  ))}
                </div>
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="flat" onPress={() => setEditingId(null)} isIconOnly>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" color="primary" variant="flat" onPress={handleSaveEdit} isIconOnly>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{s.label}</span>
                    <Chip size="sm" variant="flat" color={s.scope === 'photo' ? 'warning' : s.scope === 'filmlab' ? 'secondary' : 'default'}>
                      {s.scope === 'general' ? '通用' : s.scope === 'photo' ? '照片' : 'FilmLab'}
                    </Chip>
                    {!!s.is_built_in && <Chip size="sm" variant="flat" color="success">内置</Chip>}
                  </div>
                  <p className="text-xs text-default-400 mt-0.5 line-clamp-2">{s.prompt}</p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <Button size="sm" variant="light" isIconOnly onPress={() => handleStartEdit(s)}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="light" color="danger" isIconOnly
                    onPress={() => handleDeleteShortcut(s.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}

        {/* 添加新快捷提示 */}
        {addingNew ? (
          <div className="p-2.5 rounded-lg border-2 border-dashed border-primary-200 dark:border-primary-800 space-y-2">
            <Input size="sm" variant="bordered" label="名称" placeholder="如：色彩分析"
              value={newForm.label}
              onValueChange={v => setNewForm(f => ({ ...f, label: v }))} />
            <Textarea size="sm" variant="bordered" label="Prompt" placeholder="发送给 AI 的提示词" minRows={2} maxRows={5}
              value={newForm.prompt}
              onValueChange={v => setNewForm(f => ({ ...f, prompt: v }))} />
            <div className="flex gap-1">
              {['general', 'photo', 'filmlab'].map(sc => (
                <Chip key={sc} size="sm" className="cursor-pointer"
                  variant={newForm.scope === sc ? 'solid' : 'flat'}
                  color={newForm.scope === sc ? 'primary' : 'default'}
                  onClick={() => setNewForm(f => ({ ...f, scope: sc }))}
                >
                  {sc === 'general' ? '通用' : sc === 'photo' ? '照片' : 'FilmLab'}
                </Chip>
              ))}
            </div>
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="flat" onPress={() => setAddingNew(false)}>取消</Button>
              <Button size="sm" color="primary" onPress={handleAddShortcut}
                isDisabled={!newForm.label.trim() || !newForm.prompt.trim()}>
                添加
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="flat" startContent={<Plus className="w-3.5 h-3.5" />}
            onPress={() => setAddingNew(true)} className="w-full">
            添加快捷提示
          </Button>
        )}
      </div>

      <Divider className="my-3" />

      {/* ═══ 提示词模板 ═══ */}
      <Section title="提示词模板" />

      <div className="px-1 space-y-2">
        <p className="text-xs text-default-400">
          AI 对话角色模板。在对话界面顶部选择不同角色以获得专用的系统提示词。
        </p>

        {tplList.map(t => (
          <div key={t.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-default-200 dark:border-default-100 group">
            {tplEditId === t.id ? (
              <div className="flex-1 space-y-2.5">
                <Input size="sm" variant="bordered" label="名称" labelPlacement="outside"
                  value={tplEditForm.name}
                  onValueChange={v => setTplEditForm(f => ({ ...f, name: v }))} />
                <div className="space-y-1">
                  <p className="text-xs text-default-500 px-0.5">图标</p>
                  <div className="flex gap-1 flex-wrap">
                    {['bot', 'camera', 'database', 'sliders-horizontal'].map(ic => (
                      <Chip key={ic} size="sm" className="cursor-pointer"
                        variant={tplEditForm.icon === ic ? 'solid' : 'flat'}
                        color={tplEditForm.icon === ic ? 'primary' : 'default'}
                        onClick={() => setTplEditForm(f => ({ ...f, icon: ic }))}
                      >
                        {ic}
                      </Chip>
                    ))}
                  </div>
                </div>
                <Input size="sm" variant="bordered" label="描述" labelPlacement="outside"
                  value={tplEditForm.description}
                  onValueChange={v => setTplEditForm(f => ({ ...f, description: v }))} />
                <Textarea size="sm" variant="bordered" label="系统提示词" labelPlacement="outside"
                  minRows={3} maxRows={8}
                  value={tplEditForm.system_prompt}
                  onValueChange={v => setTplEditForm(f => ({ ...f, system_prompt: v }))} />
                <Input size="sm" variant="bordered" label="隐藏层命令" labelPlacement="outside"
                  placeholder="skill=...; style=..."
                  value={tplEditForm.hidden_command}
                  onValueChange={v => setTplEditForm(f => ({ ...f, hidden_command: v }))} />
                <Input size="sm" variant="bordered" label="首次输入提示" labelPlacement="outside"
                  placeholder="引导用户的开场白"
                  value={tplEditForm.starter_prompt}
                  onValueChange={v => setTplEditForm(f => ({ ...f, starter_prompt: v }))} />
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="flat" onPress={() => setTplEditId(null)} isIconOnly>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" color="primary" variant="flat" onPress={handleSaveTplEdit} isIconOnly>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium">{t.name}</span>
                    {!!t.is_default && <Chip size="sm" variant="flat" color="primary">默认</Chip>}
                    {!!t.is_built_in && <Chip size="sm" variant="flat" color="success">内置</Chip>}
                  </div>
                  <p className="text-xs text-default-400 mt-0.5">{t.description}</p>
                  <p className="text-xs text-default-300 mt-0.5 line-clamp-2 italic">{t.system_prompt}</p>
                </div>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {!t.is_default && (
                    <Tooltip content="设为默认" size="sm">
                      <Button size="sm" variant="light" isIconOnly onPress={() => handleSetDefaultTemplate(t.id)}>
                        <Star className="w-3.5 h-3.5" />
                      </Button>
                    </Tooltip>
                  )}
                  <Button size="sm" variant="light" isIconOnly
                    onPress={() => { setTplEditId(t.id); setTplEditForm({ name: t.name, icon: t.icon, description: t.description, system_prompt: t.system_prompt, hidden_command: t.hidden_command || '', starter_prompt: t.starter_prompt || '' }); }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {!t.is_built_in && (
                    <Button size="sm" variant="light" color="danger" isIconOnly
                      onPress={() => handleDeleteTemplate(t.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}

        {tplAdding ? (
          <div className="p-2.5 rounded-lg border-2 border-dashed border-primary-200 dark:border-primary-800 space-y-2.5">
            <Input size="sm" variant="bordered" label="名称" labelPlacement="outside"
              placeholder="如：翻译专家"
              value={tplNewForm.name} onValueChange={v => setTplNewForm(f => ({ ...f, name: v }))} />
            <div className="space-y-1">
              <p className="text-xs text-default-500 px-0.5">图标</p>
              <div className="flex gap-1 flex-wrap">
                {['bot', 'camera', 'database', 'sliders-horizontal'].map(ic => (
                  <Chip key={ic} size="sm" className="cursor-pointer"
                    variant={tplNewForm.icon === ic ? 'solid' : 'flat'}
                    color={tplNewForm.icon === ic ? 'primary' : 'default'}
                    onClick={() => setTplNewForm(f => ({ ...f, icon: ic }))}
                  >
                    {ic}
                  </Chip>
                ))}
              </div>
            </div>
            <Input size="sm" variant="bordered" label="描述" labelPlacement="outside"
              placeholder="简短描述此角色的能力"
              value={tplNewForm.description} onValueChange={v => setTplNewForm(f => ({ ...f, description: v }))} />
            <Textarea size="sm" variant="bordered" label="系统提示词" labelPlacement="outside"
              placeholder="定义 AI 的角色和行为" minRows={3} maxRows={8}
              value={tplNewForm.system_prompt} onValueChange={v => setTplNewForm(f => ({ ...f, system_prompt: v }))} />
            <Input size="sm" variant="bordered" label="隐藏层命令" labelPlacement="outside"
              placeholder="skill=...; style=..."
              value={tplNewForm.hidden_command} onValueChange={v => setTplNewForm(f => ({ ...f, hidden_command: v }))} />
            <Input size="sm" variant="bordered" label="首次输入提示" labelPlacement="outside"
              placeholder="引导用户的开场白"
              value={tplNewForm.starter_prompt} onValueChange={v => setTplNewForm(f => ({ ...f, starter_prompt: v }))} />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="flat" onPress={() => setTplAdding(false)}>取消</Button>
              <Button size="sm" color="primary" onPress={handleAddTemplate}
                isDisabled={!tplNewForm.name.trim() || !tplNewForm.system_prompt.trim()}>
                添加
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="flat" startContent={<Plus className="w-3.5 h-3.5" />}
            onPress={() => setTplAdding(true)} className="w-full">
            添加模板
          </Button>
        )}
      </div>

      <Divider className="my-3" />

      {/* ═══ 模型配置 ═══ */}
      <Section title="模型配置" />

      <div className="px-1 space-y-2">
        <p className="text-xs text-default-400">
          添加和管理 AI 模型。启用的模型会在对话界面中作为选项出现。不添加时使用上方的全局模型设置。
        </p>

        {modelList.map(m => (
          <div key={m.id} className="flex items-start gap-2 p-2.5 rounded-lg border border-default-200 dark:border-default-100 group">
            {modelEditId === m.id ? (
              <div className="flex-1 space-y-2.5">
                <Input size="sm" variant="bordered" label="显示名称" labelPlacement="outside"
                  value={modelEditForm.name}
                  onValueChange={v => setModelEditForm(f => ({ ...f, name: v }))} />
                <Input size="sm" variant="bordered" label="模型 ID" labelPlacement="outside"
                  placeholder="如 gpt-4o, claude-3-opus"
                  value={modelEditForm.model_id}
                  onValueChange={v => setModelEditForm(f => ({ ...f, model_id: v }))} />
                <div className="space-y-1">
                  <p className="text-xs text-default-500 px-0.5">能力</p>
                  <div className="flex gap-1">
                    {['text', 'text,vision'].map(cap => (
                      <Chip key={cap} size="sm" className="cursor-pointer"
                        variant={modelEditForm.capabilities === cap ? 'solid' : 'flat'}
                        color={modelEditForm.capabilities === cap ? 'primary' : 'default'}
                        onClick={() => setModelEditForm(f => ({ ...f, capabilities: cap }))}
                      >
                        {cap === 'text' ? '仅文本' : '文本 + 视觉'}
                      </Chip>
                    ))}
                  </div>
                </div>
                <Input size="sm" variant="bordered" label="API 端点（可选）" labelPlacement="outside"
                  placeholder="留空使用全局设置"
                  value={modelEditForm.api_base_url}
                  onValueChange={v => setModelEditForm(f => ({ ...f, api_base_url: v }))} />
                <Input size="sm" variant="bordered" label="API Key（可选）" labelPlacement="outside"
                  type="password"
                  placeholder={m.api_key_set ? '已设置（输入新值覆盖）' : '留空使用全局设置'}
                  value={modelEditForm.api_key}
                  onValueChange={v => setModelEditForm(f => ({ ...f, api_key: v }))} />
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="flat" onPress={() => setModelEditId(null)} isIconOnly>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" color="primary" variant="flat" onPress={handleSaveModelEdit} isIconOnly>
                    <Check className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="text-sm font-medium">{m.name}</span>
                    {!!m.is_default_text && <Chip size="sm" variant="flat" color="primary">默认文本</Chip>}
                    {!!m.is_default_vision && <Chip size="sm" variant="flat" color="secondary">默认视觉</Chip>}
                    {!m.enabled && <Chip size="sm" variant="flat" color="danger">已禁用</Chip>}
                  </div>
                  <p className="text-xs text-default-400 mt-0.5">{m.model_id}</p>
                  {m.api_base_url && <p className="text-xs text-default-300 mt-0.5 truncate">{m.api_base_url}</p>}
                </div>
                <div className="flex gap-0.5 items-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <Tooltip content="启用/禁用" size="sm">
                    <div>
                      <Switch size="sm" isSelected={!!m.enabled}
                        onValueChange={(v) => handleToggleModelEnabled(m.id, v)} />
                    </div>
                  </Tooltip>
                  <Tooltip content="设为默认文本模型" size="sm">
                    <Button size="sm" variant="light" isIconOnly
                      className={m.is_default_text ? 'text-primary' : ''}
                      onPress={() => handleSetDefaultTextModel(m.id)}>
                      <Star className="w-3.5 h-3.5" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="设为默认视觉模型" size="sm">
                    <Button size="sm" variant="light" isIconOnly
                      className={m.is_default_vision ? 'text-secondary' : ''}
                      onPress={() => handleSetDefaultVisionModel(m.id)}>
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </Tooltip>
                  <Button size="sm" variant="light" isIconOnly
                    onPress={() => { setModelEditId(m.id); setModelEditForm({ name: m.name, model_id: m.model_id, provider: m.provider || 'openai', capabilities: m.capabilities || 'text', api_base_url: m.api_base_url || '', api_key: '' }); }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="light" color="danger" isIconOnly
                    onPress={() => handleDeleteModel(m.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ))}

        {modelAdding ? (
          <div className="p-2.5 rounded-lg border-2 border-dashed border-primary-200 dark:border-primary-800 space-y-2.5">
            <Input size="sm" variant="bordered" label="显示名称" labelPlacement="outside"
              placeholder="如：GPT-4o"
              value={modelNewForm.name} onValueChange={v => setModelNewForm(f => ({ ...f, name: v }))} />
            <Input size="sm" variant="bordered" label="模型 ID" labelPlacement="outside"
              placeholder="如 gpt-4o, deepseek-chat"
              value={modelNewForm.model_id} onValueChange={v => setModelNewForm(f => ({ ...f, model_id: v }))} />
            <div className="space-y-1">
              <p className="text-xs text-default-500 px-0.5">能力</p>
              <div className="flex gap-1">
                {['text', 'text,vision'].map(cap => (
                  <Chip key={cap} size="sm" className="cursor-pointer"
                    variant={modelNewForm.capabilities === cap ? 'solid' : 'flat'}
                    color={modelNewForm.capabilities === cap ? 'primary' : 'default'}
                    onClick={() => setModelNewForm(f => ({ ...f, capabilities: cap }))}
                  >
                    {cap === 'text' ? '仅文本' : '文本 + 视觉'}
                  </Chip>
                ))}
              </div>
            </div>
            <Input size="sm" variant="bordered" label="API 端点（可选）" labelPlacement="outside"
              placeholder="留空使用全局设置"
              value={modelNewForm.api_base_url} onValueChange={v => setModelNewForm(f => ({ ...f, api_base_url: v }))} />
            <Input size="sm" variant="bordered" label="API Key（可选）" labelPlacement="outside"
              type="password" placeholder="留空使用全局设置"
              value={modelNewForm.api_key} onValueChange={v => setModelNewForm(f => ({ ...f, api_key: v }))} />
            <div className="flex gap-1 justify-end">
              <Button size="sm" variant="flat" onPress={() => setModelAdding(false)}>取消</Button>
              <Button size="sm" color="primary" onPress={handleAddModel}
                isDisabled={!modelNewForm.name.trim() || !modelNewForm.model_id.trim()}>
                添加
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="flat" startContent={<Plus className="w-3.5 h-3.5" />}
            onPress={() => setModelAdding(true)} className="w-full">
            添加模型
          </Button>
        )}
      </div>

    </div>
  );
}
