/**
 * AI 路由
 * 
 * POST /api/ai/chat          — 发送消息（SSE 流式响应）
 * GET  /api/ai/config        — 获取配置（API Key 脱敏）
 * PUT  /api/ai/config        — 更新配置
 * POST /api/ai/config/test   — 测试连接
 * GET  /api/ai/config/models — 获取可用模型列表
 * GET  /api/ai/conversations         — 对话列表
 * GET  /api/ai/conversations/:id     — 对话详情（含消息）
 * DELETE /api/ai/conversations/:id  — 删除对话
 * GET    /api/ai/shortcuts          — 快捷提示列表
 * POST   /api/ai/shortcuts          — 创建快捷提示
 * PUT    /api/ai/shortcuts/:id      — 更新快捷提示
 * DELETE /api/ai/shortcuts/:id      — 删除快捷提示
 */
const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');

const { getAIConfig, updateAIConfig, isAIAvailable } = require('../services/ai-config');
const aiGateway    = require('../services/ai-gateway');
const orchestrator = require('../services/ai-orchestrator');
const { getAsync, allAsync, runAsync } = require('../utils/db-helpers');
const { uploadsDir, rollsDir } = require('../config/paths');

// 图片分辨率映射（最长边像素）
const RESOLUTIONS = { low: 240, medium: 768, high: 1024, full: 2048 };

// ─── 中间件：AI 可用性检查（配置端点免检） ───
router.use(async (req, res, next) => {
  if (req.path.startsWith('/config')) return next();
  if (req.path.startsWith('/conversations')) return next();
  if (req.path.startsWith('/shortcuts')) return next();
  if (req.path.startsWith('/templates')) return next();
  if (req.path.startsWith('/models')) return next();
  if (req.path.startsWith('/confirm')) return next();
  const available = await isAIAvailable();
  if (!available) {
    return res.status(503).json({ error: 'AI 未配置。请在设置中填写 API Key。' });
  }
  next();
});

// ─────────────── POST /chat — SSE 流式聊天 ───────────────
router.post('/chat', async (req, res, next) => {
  const { message, context, conversation_id, attachments, template_id, model_id } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  // SSE 响应头
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // 禁止 Nginx 缓冲
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const imageContents = await prepareImageAttachments(attachments);

    // 加载模板（如指定）
    let template = null;
    if (template_id) {
      template = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [template_id]);
    }

    // 加载模型配置（如指定）
    let modelOverride = null;
    if (model_id) {
      modelOverride = await getAsync('SELECT * FROM ai_models WHERE id = ? AND enabled = 1', [model_id]);
    }

    for await (const event of orchestrator.handleMessage({
      conversationId: conversation_id,
      userMessage:    message,
      context:        context || {},
      imageContents,
      template,
      modelOverride,
    })) {
      send(event);
    }
  } catch (err) {
    console.error('[AI Chat Error]', err);
    send({ type: 'error', message: err.message || 'Internal server error' });
  } finally {
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// ─────────────── POST /confirm/:id — 用户确认/拒绝写入操作 ───────────────
router.post('/confirm/:confirmationId', (req, res) => {
  const { confirmationId } = req.params;
  const { decision } = req.body; // 'confirmed' | 'rejected'

  if (!['confirmed', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be "confirmed" or "rejected"' });
  }

  const resolved = orchestrator.resolveConfirmation(confirmationId, decision);
  if (!resolved) {
    return res.status(404).json({ error: 'Confirmation not found or expired' });
  }

  res.json({ success: true, decision });
});

// ─────────────── 配置端点 ───────────────

// GET /config — 脱敏返回
router.get('/config', async (req, res, next) => {
  try {
    const cfg = await getAIConfig();
    const result = { ...cfg };
    // 脱敏 API Key
    if (result.api_key) {
      const k = result.api_key;
      result.api_key_display = k.length > 8
        ? k.substring(0, 3) + '••••••' + k.substring(k.length - 4)
        : '••••••••';
      result.api_key_set = true;
    } else {
      result.api_key_display = '';
      result.api_key_set = false;
    }
    delete result.api_key;
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PUT /config
router.put('/config', async (req, res, next) => {
  try {
    await updateAIConfig(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /config/test
router.post('/config/test', async (req, res, next) => {
  try {
    const result = await aiGateway.testConnection();
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `连接失败: ${err.message}` });
  }
});

// GET /config/models
router.get('/config/models', async (req, res, next) => {
  try {
    const models = await aiGateway.listModels();
    res.json({ models: models || [] });
  } catch (err) {
    res.json({ models: [], error: err.message });
  }
});

// ─────────────── 对话管理 ───────────────

// GET /conversations
router.get('/conversations', async (req, res, next) => {
  try {
    const convs = await allAsync(`
      SELECT c.id, c.title, c.platform, c.created_at, c.updated_at,
             COUNT(m.id) AS message_count
      FROM ai_conversations c
      LEFT JOIN ai_messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT 50
    `);
    res.json(convs);
  } catch (err) {
    next(err);
  }
});

// GET /conversations/:id
router.get('/conversations/:id', async (req, res, next) => {
  try {
    const messages = await allAsync(
      `SELECT id, role, content, model, image_refs, tool_calls, tool_call_id, created_at
       FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// DELETE /conversations/:id
router.delete('/conversations/:id', async (req, res, next) => {
  try {
    await runAsync('DELETE FROM ai_conversations WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─────────────── 图片附件处理 ───────────────

async function prepareImageAttachments(attachments) {
  if (!attachments?.length) return null;
  const config = await getAIConfig();
  if (!config.allow_image_analysis) return null;

  const maxRes = RESOLUTIONS[config.image_max_resolution] || RESOLUTIONS.medium;
  const results = [];

  for (const att of attachments.slice(0, 5)) {  // 最多 5 张
    if (att.type !== 'photo' || !att.photo_id) continue;

    const photo = await getAsync(
      'SELECT positive_rel_path, thumb_rel_path, full_rel_path FROM photos WHERE id = ?',
      [att.photo_id]
    );
    if (!photo) continue;

    // 按分辨率选择合适的源文件
    const relPath = maxRes <= 240
      ? (photo.thumb_rel_path || photo.positive_rel_path || photo.full_rel_path)
      : (photo.positive_rel_path || photo.full_rel_path || photo.thumb_rel_path);

    if (!relPath) continue;

    const imgPath = path.join(uploadsDir, relPath);
    if (!fs.existsSync(imgPath)) continue;

    try {
      const buffer = await sharp(imgPath)
        .resize(maxRes, maxRes, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();

      results.push({
        photo_id: att.photo_id,
        base64:   buffer.toString('base64'),
        detail:   maxRes <= 512 ? 'low' : 'auto',
      });
    } catch (err) {
      console.error('[AI] Failed to process image:', imgPath, err.message);
    }
  }

  return results.length ? results : null;
}

// ─────────── 快捷提示 CRUD ───────────

// GET /shortcuts — 列出所有快捷提示
router.get('/shortcuts', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT * FROM ai_prompt_shortcuts ORDER BY scope, sort_order');
    res.json(rows);
  } catch (err) {
    console.error('[AI] Shortcuts list error:', err);
    next(err);
  }
});

// POST /shortcuts — 创建快捷提示
router.post('/shortcuts', async (req, res, next) => {
  try {
    const { label, prompt, icon, scope, sort_order } = req.body;
    if (!label?.trim() || !prompt?.trim()) {
      return res.status(400).json({ error: 'label and prompt are required' });
    }
    const result = await runAsync(
      `INSERT INTO ai_prompt_shortcuts (label, prompt, icon, scope, sort_order, is_built_in) VALUES (?, ?, ?, ?, ?, 0)`,
      [label.trim(), prompt.trim(), icon || 'zap', scope || 'general', sort_order ?? 99]
    );
    const row = await getAsync('SELECT * FROM ai_prompt_shortcuts WHERE id = ?', [result.lastID]);
    res.json(row);
  } catch (err) {
    console.error('[AI] Shortcut create error:', err);
    next(err);
  }
});

// PUT /shortcuts/:id — 更新快捷提示
router.put('/shortcuts/:id', async (req, res, next) => {
  try {
    const { label, prompt, icon, scope, sort_order } = req.body;
    const existing = await getAsync('SELECT * FROM ai_prompt_shortcuts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await runAsync(
      `UPDATE ai_prompt_shortcuts SET label = ?, prompt = ?, icon = ?, scope = ?, sort_order = ? WHERE id = ?`,
      [
        label?.trim() || existing.label,
        prompt?.trim() || existing.prompt,
        icon || existing.icon,
        scope || existing.scope,
        sort_order ?? existing.sort_order,
        req.params.id,
      ]
    );
    const row = await getAsync('SELECT * FROM ai_prompt_shortcuts WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error('[AI] Shortcut update error:', err);
    next(err);
  }
});

// DELETE /shortcuts/:id — 删除快捷提示
router.delete('/shortcuts/:id', async (req, res, next) => {
  try {
    const existing = await getAsync('SELECT * FROM ai_prompt_shortcuts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await runAsync('DELETE FROM ai_prompt_shortcuts WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[AI] Shortcut delete error:', err);
    next(err);
  }
});

// ─────────── 提示词模板 CRUD ───────────

// GET /templates — 列出所有模板
router.get('/templates', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT * FROM ai_prompt_templates ORDER BY sort_order, id');
    res.json(rows);
  } catch (err) {
    console.error('[AI] Templates list error:', err);
    next(err);
  }
});

// GET /templates/:id
router.get('/templates/:id', async (req, res, next) => {
  try {
    const row = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (err) {
    next(err);
  }
});

// POST /templates — 创建模板
router.post('/templates', async (req, res, next) => {
  try {
    const { name, icon, description, system_prompt, hidden_command, starter_prompt, sort_order } = req.body;
    if (!name?.trim() || !system_prompt?.trim()) {
      return res.status(400).json({ error: 'name and system_prompt are required' });
    }
    const now = new Date().toISOString();
    const result = await runAsync(
      `INSERT INTO ai_prompt_templates (name, icon, description, system_prompt, hidden_command, starter_prompt, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), icon || 'bot', description || '', system_prompt.trim(),
       hidden_command || '', starter_prompt || '', sort_order ?? 99, now, now]
    );
    const row = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [result.lastID]);
    res.json(row);
  } catch (err) {
    console.error('[AI] Template create error:', err);
    next(err);
  }
});

// PUT /templates/:id — 更新模板
router.put('/templates/:id', async (req, res, next) => {
  try {
    const existing = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { name, icon, description, system_prompt, hidden_command, starter_prompt, is_default, sort_order } = req.body;
    const now = new Date().toISOString();

    // 如果设为默认，先取消其他默认
    if (is_default) {
      await runAsync('UPDATE ai_prompt_templates SET is_default = 0');
    }

    await runAsync(
      `UPDATE ai_prompt_templates SET name=?, icon=?, description=?, system_prompt=?, hidden_command=?,
       starter_prompt=?, is_default=?, sort_order=?, updated_at=? WHERE id=?`,
      [
        name?.trim() || existing.name,
        icon || existing.icon,
        description ?? existing.description,
        system_prompt?.trim() || existing.system_prompt,
        hidden_command ?? existing.hidden_command,
        starter_prompt ?? existing.starter_prompt,
        is_default ?? existing.is_default,
        sort_order ?? existing.sort_order,
        now, req.params.id,
      ]
    );
    const row = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [req.params.id]);
    res.json(row);
  } catch (err) {
    console.error('[AI] Template update error:', err);
    next(err);
  }
});

// DELETE /templates/:id — 删除模板（内置模板不可删除）
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const existing = await getAsync('SELECT * FROM ai_prompt_templates WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    if (existing.is_built_in) return res.status(400).json({ error: '内置模板不可删除' });
    await runAsync('DELETE FROM ai_prompt_templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[AI] Template delete error:', err);
    next(err);
  }
});

// ─────────── AI 模型配置 CRUD ───────────

// GET /models/configured — 列出已配置的模型
router.get('/models/configured', async (req, res, next) => {
  try {
    const rows = await allAsync('SELECT * FROM ai_models ORDER BY sort_order, id');
    // 脱敏 api_key
    const safe = rows.map(r => {
      const out = { ...r };
      if (out.api_key) {
        const k = out.api_key;
        out.api_key_display = k.length > 8
          ? k.substring(0, 3) + '••••••' + k.substring(k.length - 4)
          : '••••••••';
        out.api_key_set = true;
      } else {
        out.api_key_display = '';
        out.api_key_set = false;
      }
      delete out.api_key;
      return out;
    });
    res.json(safe);
  } catch (err) {
    console.error('[AI] Models list error:', err);
    next(err);
  }
});

// POST /models/configured — 添加模型
router.post('/models/configured', async (req, res, next) => {
  try {
    const { name, model_id, provider, capabilities, api_base_url, api_key, enabled, is_default_text, is_default_vision, sort_order } = req.body;
    if (!name?.trim() || !model_id?.trim()) {
      return res.status(400).json({ error: 'name and model_id are required' });
    }
    const now = new Date().toISOString();

    // 如果设为默认，先取消同类型的其他默认
    if (is_default_text) {
      await runAsync('UPDATE ai_models SET is_default_text = 0');
    }
    if (is_default_vision) {
      await runAsync('UPDATE ai_models SET is_default_vision = 0');
    }

    const result = await runAsync(
      `INSERT INTO ai_models (name, model_id, provider, capabilities, api_base_url, api_key, enabled, is_default_text, is_default_vision, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name.trim(), model_id.trim(), provider || 'openai', capabilities || 'text',
       api_base_url || null, api_key || null, enabled ?? 1,
       is_default_text ?? 0, is_default_vision ?? 0, sort_order ?? 99, now, now]
    );
    const row = await getAsync('SELECT * FROM ai_models WHERE id = ?', [result.lastID]);
    // 脱敏
    if (row.api_key) { delete row.api_key; row.api_key_set = true; }
    res.json(row);
  } catch (err) {
    console.error('[AI] Model create error:', err);
    next(err);
  }
});

// PUT /models/configured/:id — 更新模型
router.put('/models/configured/:id', async (req, res, next) => {
  try {
    const existing = await getAsync('SELECT * FROM ai_models WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const { name, model_id, provider, capabilities, api_base_url, api_key, enabled, is_default_text, is_default_vision, sort_order } = req.body;
    const now = new Date().toISOString();

    if (is_default_text) {
      await runAsync('UPDATE ai_models SET is_default_text = 0');
    }
    if (is_default_vision) {
      await runAsync('UPDATE ai_models SET is_default_vision = 0');
    }

    await runAsync(
      `UPDATE ai_models SET name=?, model_id=?, provider=?, capabilities=?, api_base_url=?, enabled=?,
       is_default_text=?, is_default_vision=?, sort_order=?, updated_at=? WHERE id=?`,
      [
        name?.trim() || existing.name,
        model_id?.trim() || existing.model_id,
        provider || existing.provider,
        capabilities || existing.capabilities,
        api_base_url !== undefined ? api_base_url : existing.api_base_url,
        enabled ?? existing.enabled,
        is_default_text ?? existing.is_default_text,
        is_default_vision ?? existing.is_default_vision,
        sort_order ?? existing.sort_order,
        now, req.params.id,
      ]
    );

    // api_key 单独处理（只有明确传入时才更新）
    if (api_key !== undefined) {
      await runAsync('UPDATE ai_models SET api_key = ? WHERE id = ?', [api_key || null, req.params.id]);
    }

    const row = await getAsync('SELECT * FROM ai_models WHERE id = ?', [req.params.id]);
    if (row.api_key) { delete row.api_key; row.api_key_set = true; } else { row.api_key_set = false; }
    res.json(row);
  } catch (err) {
    console.error('[AI] Model update error:', err);
    next(err);
  }
});

// DELETE /models/configured/:id — 删除模型
router.delete('/models/configured/:id', async (req, res, next) => {
  try {
    const existing = await getAsync('SELECT * FROM ai_models WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    await runAsync('DELETE FROM ai_models WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[AI] Model delete error:', err);
    next(err);
  }
});

module.exports = router;
