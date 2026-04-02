/**
 * AI 助手 API 模块
 */
import { jsonFetch, putJson, postJson, getApiBase } from './core';

// ─ 配置 ─
export const getAIConfig     = ()      => jsonFetch('/api/ai/config');
export const updateAIConfig  = (patch) => putJson('/api/ai/config', patch);
export const testAIConnection = ()     => postJson('/api/ai/config/test', {});
export const getAIModels     = ()      => jsonFetch('/api/ai/config/models');

// ─ 对话 ─
export const getConversations   = ()   => jsonFetch('/api/ai/conversations');
export const getConversation    = (id) => jsonFetch(`/api/ai/conversations/${id}`);
export const deleteConversation = (id) =>
  jsonFetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });

// ─ 快捷提示 ─
export const getPromptShortcuts   = ()           => jsonFetch('/api/ai/shortcuts');
export const createPromptShortcut = (data)       => postJson('/api/ai/shortcuts', data);
export const updatePromptShortcut = (id, data)   => putJson(`/api/ai/shortcuts/${id}`, data);
export const deletePromptShortcut = (id)         =>
  jsonFetch(`/api/ai/shortcuts/${id}`, { method: 'DELETE' });

// ─ 提示词模板 ─
export const getPromptTemplates   = ()           => jsonFetch('/api/ai/templates');
export const getPromptTemplate    = (id)         => jsonFetch(`/api/ai/templates/${id}`);
export const createPromptTemplate = (data)       => postJson('/api/ai/templates', data);
export const updatePromptTemplate = (id, data)   => putJson(`/api/ai/templates/${id}`, data);
export const deletePromptTemplate = (id)         =>
  jsonFetch(`/api/ai/templates/${id}`, { method: 'DELETE' });

// ─ AI 模型配置 ─
export const getConfiguredModels  = ()           => jsonFetch('/api/ai/models/configured');
export const createConfiguredModel = (data)      => postJson('/api/ai/models/configured', data);
export const updateConfiguredModel = (id, data)  => putJson(`/api/ai/models/configured/${id}`, data);
export const deleteConfiguredModel = (id)        =>
  jsonFetch(`/api/ai/models/configured/${id}`, { method: 'DELETE' });

// ─ 写入确认 ─
export const confirmWriteAction = (confirmationId, decision) =>
  postJson(`/api/ai/confirm/${confirmationId}`, { decision });

/**
 * 发送聊天消息，通过 SSE 流式返回事件
 * 
 * @param {Object}   opts
 * @param {string}   opts.message
 * @param {number}   [opts.conversationId]
 * @param {Object}   [opts.context]
 * @param {Array}    [opts.attachments]
 * @param {number}   [opts.templateId]
 * @param {number}   [opts.modelId]
 * @param {Function} onEvent  (event: Object) => void
 * @returns {Promise<void>}
 */
export async function sendChatMessage({ message, conversationId, context, attachments, templateId, modelId }, onEvent) {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      context,
      attachments,
      template_id: templateId,
      model_id: modelId,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop(); // 保留未完整的行

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try { onEvent(JSON.parse(data)); } catch { /* non-JSON */ }
    }
  }
}
