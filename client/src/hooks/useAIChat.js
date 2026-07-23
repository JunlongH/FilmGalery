import { useCallback, useRef, useState } from 'react';
import { sendChatMessage, confirmWriteAction } from '../api/ai';

/**
 * AI 聊天 hook
 *
 * messages 数组条目格式:
 *   { id, role: 'user'|'assistant', content, toolCalls: [], isStreaming, error }
 *
 * toolCalls 条目格式:
 *   { id, name, status: 'running'|'done'|'error'|'waiting'|'confirmed'|'rejected', result, confirmation }
 */
export function useAIChat({ conversationId, onConversationCreated }) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const abortRef = useRef(false);

  // ─── 内部辅助 ───

  const upsertMessage = useCallback((id, updater) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const updated = [...prev];
      updated[idx] = updater(updated[idx]);
      return updated;
    });
  }, []);

  const upsertToolCall = useCallback((msgId, toolCallId, updater) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx === -1) return prev;
      const msg = prev[idx];
      const tcIdx = msg.toolCalls.findIndex(tc => tc.id === toolCallId);
      const newToolCalls = [...msg.toolCalls];
      if (tcIdx === -1) {
        newToolCalls.push(updater(null));
      } else {
        newToolCalls[tcIdx] = updater(newToolCalls[tcIdx]);
      }
      const updated = [...prev];
      updated[idx] = { ...msg, toolCalls: newToolCalls };
      return updated;
    });
  }, []);

  // ─── 发送消息 ───

  const sendMessage = useCallback(async ({ message, context, attachments, templateId, modelId }) => {
    if (isLoading) return;
    setError(null);
    abortRef.current = false;

    // 追加用户消息
    const userMsgId = `u-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: message,
      toolCalls: [],
      isStreaming: false,
    }]);

    // 占位 assistant 消息
    const asstMsgId = `a-${Date.now()}`;
    setMessages(prev => [...prev, {
      id: asstMsgId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      isStreaming: true,
    }]);

    setIsLoading(true);

    try {
      await sendChatMessage(
        { message, conversationId, context, attachments, templateId, modelId },
        (event) => {
          if (abortRef.current) return;

          switch (event.type) {
            case 'conversation_id':
              if (event.id && onConversationCreated) {
                onConversationCreated(event.id);
              }
              break;

            case 'tool_call':
              upsertToolCall(asstMsgId, event.tool_call_id, () => ({
                id: event.tool_call_id,
                name: event.tool_name,
                status: 'running',
                result: null,
                securityLevel: event.security_level,
              }));
              break;

            case 'write_confirmation':
              // 暂停工具调用，等待用户确认
              upsertToolCall(asstMsgId, event.tool_call_id, tc => ({
                ...(tc || { id: event.tool_call_id, name: event.tool_name }),
                status: 'waiting',
                confirmation: {
                  confirmationId: event.confirmation_id,
                  toolName: event.tool_name,
                  args: event.args,
                  securityLevel: event.security_level,
                },
              }));
              setPendingConfirmation({
                confirmationId: event.confirmation_id,
                toolCallId: event.tool_call_id,
                toolName: event.tool_name,
                args: event.args,
                securityLevel: event.security_level,
                msgId: asstMsgId,
              });
              break;

            case 'tool_result':
              upsertToolCall(asstMsgId, event.tool_call_id, tc => ({
                ...(tc || { id: event.tool_call_id, name: event.tool_name }),
                status: event.status === 'rejected' ? 'rejected'
                  : event.status === 'confirmed' ? 'confirmed'
                  : event.error ? 'error' : 'done',
                result: event.result ?? event.error,
              }));
              if (event.tool_call_id === pendingConfirmation?.toolCallId) {
                setPendingConfirmation(null);
              }
              break;

            case 'text_delta':
              upsertMessage(asstMsgId, msg => ({
                ...msg,
                content: msg.content + (event.delta || ''),
              }));
              break;

            case 'done':
              upsertMessage(asstMsgId, msg => ({ ...msg, isStreaming: false }));
              setIsLoading(false);
              break;

            case 'error':
              upsertMessage(asstMsgId, msg => ({
                ...msg,
                isStreaming: false,
                error: event.message || '未知错误',
              }));
              setIsLoading(false);
              break;

            default:
              break;
          }
        }
      );
    } catch (err) {
      upsertMessage(asstMsgId, msg => ({
        ...msg,
        isStreaming: false,
        error: err.message || '请求失败',
      }));
      setError(err.message || '请求失败');
      setIsLoading(false);
    }
  }, [isLoading, conversationId, onConversationCreated, upsertMessage, upsertToolCall, pendingConfirmation?.toolCallId]);

  // ─── 确认写入操作 ───

  const confirmAction = useCallback(async (confirmationId, decision) => {
    try {
      await confirmWriteAction(confirmationId, decision);
      // 本地状态在 tool_result 事件中更新
    } catch (err) {
      console.error('[useAIChat] 确认操作失败:', err);
    }
  }, []);

  const clearMessages = useCallback(() => {
    abortRef.current = true;
    setMessages([]);
    setError(null);
    setIsLoading(false);
    setPendingConfirmation(null);
  }, []);

  /** 从服务端对话历史恢复消息列表（含工具调用） */
  const loadConversationMessages = useCallback((serverMessages) => {
    const restored = serverMessages.map((m, i) => {
      // 恢复工具调用记录
      let toolCalls = [];
      if (m.tool_calls) {
        try {
          const parsed = typeof m.tool_calls === 'string' ? JSON.parse(m.tool_calls) : m.tool_calls;
          if (Array.isArray(parsed)) {
            toolCalls = parsed.map(tc => ({
              id: tc.id || `tc-${i}-${Math.random().toString(36).slice(2, 6)}`,
              name: tc.function?.name || tc.name || 'unknown',
              status: 'done',
              result: null,
            }));
          }
        } catch {}
      }
      return {
        id: `h-${m.id || i}`,
        role: m.role,
        content: m.content || '',
        toolCalls,
        isStreaming: false,
      };
    }).filter(m => m.role === 'user' || m.role === 'assistant');
    setMessages(restored);
  }, []);

  return { messages, isLoading, error, pendingConfirmation, sendMessage, confirmAction, clearMessages, loadConversationMessages };
}
