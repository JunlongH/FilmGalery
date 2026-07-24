/**
 * AI Orchestrator — 对话编排核心
 * 
 * 职责：
 *   1. 管理对话历史（加载/保存，滑动窗口）
 *   2. 构建 system prompt（含实时统计）
 *   3. 工具调用循环（非流式）→ 最终流式回复
 *   4. 审计日志
 */
const { runAsync, getAsync, allAsync } = require('../utils/db-helpers');
const { getAIConfig, checkBudget } = require('./ai-config');
const { buildSystemPrompt } = require('./ai-context-builder');
const { getToolSchemas, getToolHandler, getToolType, getToolSecurityLevel } = require('./ai-tools');
const aiGateway = require('./ai-gateway');

// ─────────────── 确认等待机制（DB 持久化，重启可恢复） ───────────────
// confirmationId → { resolve, reject, timer }
const pendingConfirmations = new Map();

/**
 * 创建确认请求并等待用户响应。
 * 写入 ai_pending_writes 表以支持重启恢复。
 * @returns {Promise<'confirmed'|'rejected'>}
 */
function waitForConfirmation(confirmationId, conversationId, toolCallId, toolName, toolArgs, timeoutMs = 300000) {
  return new Promise((resolve) => {
    // 持久化到 DB（fire-and-forget，不阻塞等待）
    runAsync(
      `INSERT OR REPLACE INTO ai_pending_writes (confirmation_id, conversation_id, tool_call_id, tool_name, args_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [confirmationId, conversationId, toolCallId, toolName, JSON.stringify(toolArgs), new Date().toISOString()]
    ).catch(() => {});

    const timer = setTimeout(() => {
      pendingConfirmations.delete(confirmationId);
      runAsync(
        `UPDATE ai_pending_writes SET status = 'rejected', resolved_at = ? WHERE confirmation_id = ? AND status = 'pending'`,
        [new Date().toISOString(), confirmationId]
      ).catch(() => {});
      resolve('rejected'); // 超时自动拒绝
    }, timeoutMs);

    pendingConfirmations.set(confirmationId, { resolve, timer, conversationId });
  });
}

/**
 * 用户响应确认请求。
 * 更新 DB 状态并 resolve 等待中的 Promise。
 * @param {string} confirmationId
 * @param {'confirmed'|'rejected'} decision
 */
function resolveConfirmation(confirmationId, decision) {
  const pending = pendingConfirmations.get(confirmationId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingConfirmations.delete(confirmationId);
  pending.resolve(decision);

  runAsync(
    `UPDATE ai_pending_writes SET status = ?, resolved_at = ? WHERE confirmation_id = ?`,
    [decision, new Date().toISOString(), confirmationId]
  ).catch(() => {});

  return true;
}

/**
 * 服务器启动时清理：将所有残留的 pending 确认标记为 rejected。
 * 这修复了重启后内存 Map 丢失导致确认永远卡住的问题。
 */
async function cleanupStaleConfirmations() {
  try {
    const result = await runAsync(
      `UPDATE ai_pending_writes SET status = 'rejected', resolved_at = ?
       WHERE status = 'pending'`,
      [new Date().toISOString()]
    );
    if (result.changes > 0) {
      console.warn(`[AI] Cleaned up ${result.changes} stale pending confirmation(s) on startup.`);
    }
  } catch (err) {
    console.warn('[AI] Stale confirmation cleanup failed:', err.message);
  }
}

// ─────────────── 内部辅助 ───────────────

async function getOrCreateConversation(id, context) {
  if (id) {
    const conv = await getAsync('SELECT * FROM ai_conversations WHERE id = ?', [id]);
    if (conv) return conv;
  }
  const now = new Date().toISOString();
  const res = await runAsync(
    `INSERT INTO ai_conversations (platform, context_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
    [context.platform || 'desktop', JSON.stringify(context), now, now]
  );
  return { id: res.lastID, title: null };
}

async function loadHistory(conversationId) {
  const rows = await allAsync(
    `SELECT role, content, tool_calls, tool_call_id
     FROM ai_messages WHERE conversation_id = ?
     ORDER BY created_at ASC`,
    [conversationId]
  );
  // 滑动窗口：保留最近 30 条
  const recent = rows.slice(-30);
  return recent.map(r => {
    const msg = { role: r.role, content: r.content };
    if (r.tool_calls)   msg.tool_calls   = JSON.parse(r.tool_calls);
    if (r.tool_call_id) msg.tool_call_id = r.tool_call_id;
    return msg;
  });
}

async function saveMessage(conversationId, role, content, extra = {}) {
  const now = new Date().toISOString();
  await runAsync(
    `INSERT INTO ai_messages
       (conversation_id, role, content, model, input_tokens, output_tokens,
        image_refs, tool_calls, tool_call_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      conversationId, role, content,
      extra.model        || null,
      extra.input_tokens || 0,
      extra.output_tokens || 0,
      extra.image_refs   ? JSON.stringify(extra.image_refs) : null,
      extra.tool_calls   ? JSON.stringify(extra.tool_calls)   : null,
      extra.tool_call_id || null,
      now,
    ]
  );
  await runAsync(
    `UPDATE ai_conversations SET updated_at = ? WHERE id = ?`,
    [now, conversationId]
  );
}

async function autoTitle(conversationId, firstMessage) {
  const title = firstMessage.substring(0, 30).replace(/\n/g, ' ')
    + (firstMessage.length > 30 ? '…' : '');
  await runAsync('UPDATE ai_conversations SET title = ? WHERE id = ?', [title, conversationId]);
}

async function auditLog(conversationId, actionType, toolName, toolArgs, resultSummary) {
  await runAsync(
    `INSERT INTO ai_audit_log (conversation_id, action_type, tool_name, tool_args, result_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conversationId, actionType, toolName, JSON.stringify(toolArgs),
     typeof resultSummary === 'string' ? resultSummary.substring(0, 500) : '',
     new Date().toISOString()]
  );
}

// ─────────────── 主流程（async generator） ───────────────

/**
 * 处理一次用户消息，以 async generator 形式 yield SSE 事件。
 * 
 * @param {Object} opts
 * @param {number|null} opts.conversationId
 * @param {string}      opts.userMessage
 * @param {Object}      opts.context         前端上下文
 * @param {Array|null}  opts.imageContents   [{base64, detail}]
 * @param {Object|null} opts.template        提示词模板
 * @param {Object|null} opts.modelOverride   模型配置覆盖
 */
async function* handleMessage({ conversationId, userMessage, context, imageContents, template, modelOverride }) {
  const config = await getAIConfig();

  // 0. 预算检查
  const budget = await checkBudget();
  if (!budget.ok) {
    yield { type: 'error', message: budget.reason };
    return;
  }

  // 1. 加载或创建对话
  const conversation = await getOrCreateConversation(conversationId, context || {});

  // 通知前端对话 ID（新建或已有）
  yield { type: 'conversation_id', id: conversation.id };

  // 2. 保存用户消息
  await saveMessage(conversation.id, 'user', userMessage, {
    image_refs: imageContents?.length ? imageContents.map(i => i.photo_id).filter(Boolean) : null,
  });

  // 3. 构建消息数组
  const hasImages = !!(imageContents?.length);
  let systemPrompt = await buildSystemPrompt(context || {}, hasImages);

  // 如果指定了模板，将模板 system_prompt 添加到系统提示词前面
  if (template) {
    const templateParts = [];
    templateParts.push(`## 当前角色: ${template.name}`);
    templateParts.push(template.system_prompt);
    if (template.hidden_command) {
      templateParts.push(`[internal] ${template.hidden_command}`);
    }
    systemPrompt = templateParts.join('\n') + '\n\n' + systemPrompt;
  }

  const history = await loadHistory(conversation.id);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
  ];

  // 4. 图片附件注入（替换最后一条 user 消息 content 为 multimodal 格式）
  if (hasImages) {
    const lastUserIdx = messages.length - 1;
    const lastUserMsg = messages[lastUserIdx];
    messages[lastUserIdx] = {
      ...lastUserMsg,
      content: [
        { type: 'text', text: lastUserMsg.content || '' },
        ...imageContents.map(img => ({
          type: 'image_url',
          image_url: {
            url: `data:image/jpeg;base64,${img.base64}`,
            detail: img.detail || 'auto',
          },
        })),
      ],
    };
  }

  // 5. 工具调用循环（非流式）
  const maxToolCalls = config.max_tool_calls_per_request || 15;
  let toolCallCount = 0;
  let continueLooping = true;

  // Read photography_mode once for tool filtering
  let photographyMode = 'all';
  try {
    const appCfg = await getAsync('SELECT photography_mode FROM app_config WHERE id = 1');
    if (appCfg && appCfg.photography_mode) photographyMode = appCfg.photography_mode;
  } catch (_) {
    console.warn('[ai-orchestrator] Could not read photography_mode from app_config, defaulting to all:', _.message || _);
  }

  // 模型选择：优先使用指定的模型覆盖，其次使用全局配置
  let modelForQuery;
  if (modelOverride) {
    modelForQuery = modelOverride.model_id;
    // 如果模型有独立的 API 配置，通知 gateway 使用
    if (modelOverride.api_base_url || modelOverride.api_key) {
      aiGateway.setTemporaryOverride({
        api_base_url: modelOverride.api_base_url,
        api_key: modelOverride.api_key,
      });
    }
  } else {
    modelForQuery = hasImages ? config.vision_model : config.text_model;
  }

  while (continueLooping && toolCallCount < maxToolCalls) {
    const response = await aiGateway.chatCompletion({
      messages,
      tools: getToolSchemas(photographyMode),
      model: modelForQuery,
    });

    // 累计 token 消耗（即使在工具调用循环中）
    if (response.usage?.prompt_tokens || response.usage?.completion_tokens) {
      await runAsync(
        `UPDATE ai_config SET monthly_tokens_used = monthly_tokens_used + ? WHERE id = 1`,
        [(response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)]
      ).catch(() => {});
    }

    const assistantMsg = response.choices[0].message;

    if (assistantMsg.tool_calls?.length) {
      // 将助手消息（含 tool_calls）加入历史
      messages.push(assistantMsg);

      for (const toolCall of assistantMsg.tool_calls) {
        toolCallCount++;
        const toolName = toolCall.function.name;
        let toolArgs = {};
        try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

        // 检查安全等级
        const securityLevel = getToolSecurityLevel(toolName);
        const needsConfirmation = securityLevel >= 1 && config.confirm_before_write;

        // 通知前端工具调用开始
        yield {
          type: 'tool_call',
          tool_call_id: toolCall.id,
          tool_name: toolName,
          args: toolArgs,
          security_level: securityLevel,
        };

        let resultStr;

        if (needsConfirmation) {
          // 生成确认 ID 并暂停等待用户响应
          const confirmationId = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          yield {
            type: 'write_confirmation',
            confirmation_id: confirmationId,
            tool_call_id: toolCall.id,
            tool_name: toolName,
            args: toolArgs,
            security_level: securityLevel,
          };

          const decision = await waitForConfirmation(
            confirmationId,
            conversation.id,
            toolCall.id,
            toolName,
            toolArgs,
            300000
          );

          if (decision === 'rejected') {
            resultStr = JSON.stringify({ rejected: true, message: '用户拒绝了此操作' });
            yield {
              type: 'tool_result',
              tool_call_id: toolCall.id,
              tool_name: toolName,
              result: '用户拒绝了此操作',
              status: 'rejected',
            };
          } else {
            // 确认后执行
            const handler = getToolHandler(toolName);
            resultStr = JSON.stringify({ error: `unknown tool: ${toolName}` });
            if (handler) {
              try { resultStr = await handler(toolArgs); }
              catch (err) { resultStr = JSON.stringify({ error: err.message }); }
            }
            yield {
              type: 'tool_result',
              tool_call_id: toolCall.id,
              tool_name: toolName,
              result: String(resultStr).substring(0, 200),
              status: 'confirmed',
            };
          }
        } else {
          // 无需确认，直接执行
          const handler = getToolHandler(toolName);
          resultStr = JSON.stringify({ error: `unknown tool: ${toolName}` });
          if (handler) {
            try { resultStr = await handler(toolArgs); }
            catch (err) { resultStr = JSON.stringify({ error: err.message }); }
          }
          yield { type: 'tool_result', tool_call_id: toolCall.id, tool_name: toolName, result: String(resultStr).substring(0, 200) };
        }

        // 审计
        await auditLog(conversation.id, getToolType(toolName) === 'write' ? 'data_write' : 'data_read',
          toolName, toolArgs, resultStr);

        // 工具结果加入消息
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }
      // 继续循环（AI 可能还需要工具）
    } else {
      // 无工具调用 → 直接用这条回复作为最终文本
      // 保存助手消息到 DB
      const finalContent = assistantMsg.content || '';
      const inputTokens  = response.usage?.prompt_tokens     || 0;
      const outputTokens = response.usage?.completion_tokens || 0;

      // 累计 token 消耗
      if (inputTokens || outputTokens) {
        await runAsync(
          `UPDATE ai_config SET monthly_tokens_used = monthly_tokens_used + ? WHERE id = 1`,
          [inputTokens + outputTokens]
        ).catch(() => {});
      }

      await saveMessage(conversation.id, 'assistant', finalContent, {
        model: modelForQuery,
        input_tokens:  inputTokens,
        output_tokens: outputTokens,
      });

      // 流式输出（字符级 yield，给前端打字机效果）
      yield { type: 'stream_start' };
      for (const char of finalContent) {
        yield { type: 'text_delta', delta: char };
      }
      continueLooping = false;
    }
  }

  // 如果循环因超过上限结束而没有拿到最终文本，做一次无工具流式补全
  if (continueLooping) {
    // 告知模型不要再尝试工具调用，直接用已有信息回答
    messages.push({
      role: 'system',
      content: '你已达到工具调用次数上限。请根据已获取的数据直接回答用户问题，不要再尝试调用工具。如果信息不足，告诉用户你目前获取到的数据并说明限制。',
    });

    yield { type: 'stream_start' };
    let fullContent = '';
    for await (const chunk of aiGateway.chatCompletionStream({ messages, model: modelForQuery })) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullContent += delta;
        yield { type: 'text_delta', delta: delta };
      }
    }
    await saveMessage(conversation.id, 'assistant', fullContent, { model: modelForQuery });
  }

  // 自动生成对话标题
  const conv = await getAsync('SELECT title FROM ai_conversations WHERE id = ?', [conversation.id]);
  if (!conv?.title) {
    await autoTitle(conversation.id, userMessage);
  }

  // 清除临时模型覆盖
  aiGateway.clearTemporaryOverride();

  yield { type: 'done', conversation_id: conversation.id };
}

module.exports = { handleMessage, resolveConfirmation, cleanupStaleConfirmations };
