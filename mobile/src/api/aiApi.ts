import { fetchEventSource } from '@microsoft/fetch-event-source';

export interface AIConfig {
  [key: string]: unknown;
}

export interface ChatContext {
  [key: string]: unknown;
}

export interface SendChatOptions {
  message: string;
  conversationId?: number;
  context?: ChatContext;
}

export type ChatEvent = Record<string, unknown>;

export async function getAIConfig(apiBase: string): Promise<AIConfig> {
  const res = await fetch(`${apiBase}/api/ai/config`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateAIConfig(apiBase: string, patch: AIConfig): Promise<AIConfig> {
  const res = await fetch(`${apiBase}/api/ai/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function testAIConnection(apiBase: string): Promise<any> {
  const res = await fetch(`${apiBase}/api/ai/config/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getAIModels(apiBase: string): Promise<any> {
  const res = await fetch(`${apiBase}/api/ai/config/models`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function getConversations(apiBase: string): Promise<any[]> {
  const res = await fetch(`${apiBase}/api/ai/conversations`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteConversation(apiBase: string, id: number | string): Promise<any> {
  const res = await fetch(`${apiBase}/api/ai/conversations/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function sendChatMessage(
  apiBase: string,
  { message, conversationId, context }: SendChatOptions,
  onEvent: (event: ChatEvent) => void,
  abortController?: AbortController
): Promise<void> {
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
      throw err;
    },
  });
}
