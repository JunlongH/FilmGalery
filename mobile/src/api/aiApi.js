/**
 * AI 助手 API 模块 (移动端)
 * 使用 @microsoft/fetch-event-source 处理 SSE 流
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';

// ─── 配置 ───

export async function getAIConfig(apiBase) {
  const res = await fetch(`${apiBase}/api/ai/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateAIConfig(apiBase, patch) {
  const res = await fetch(`${apiBase}/api/ai/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function testAIConnection(apiBase) {
  const res = await fetch(`${apiBase}/api/ai/config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getAIModels(apiBase) {
  const res = await fetch(`${apiBase}/api/ai/config/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── 对话 ───

export async function getConversations(apiBase) {
  const res = await fetch(`${apiBase}/api/ai/conversations`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteConversation(apiBase, id) {
  const res = await fetch(`${apiBase}/api/ai/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── 聊天 ───

/**
 * 发送聊天消息，通过 SSE 流式返回事件
 *
 * @param {string}   apiBase
 * @param {Object}   opts
 * @param {string}   opts.message
 * @param {number}   [opts.conversationId]
 * @param {Object}   [opts.context]
 * @param {Function} onEvent  (event: Object) => void
 * @param {AbortController} [abortController]
 * @returns {Promise<void>}
 */
export async function sendChatMessage(apiBase, { message, conversationId, context }, onEvent, abortController) {
  await fetchEventSource(`${apiBase}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      context,
    }),
    signal: abortController?.signal,
    onmessage(ev) {
      if (ev.data === '[DONE]') return;
      try {
        onEvent(JSON.parse(ev.data));
      } catch {
        // ignore non-JSON
      }
    },
    onerror(err) {
      throw err; // re-throw to propagate
    },
  });
}
