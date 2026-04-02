/**
 * AI Tools — FilmLab 渲染工具
 * 
 * get_render_params (read)
 * suggest_render_params, batch_apply_preset (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

const RENDER_TOOLS = {

  get_render_params: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_render_params',
        description: '获取照片或胶卷当前的渲染参数（preset_json）。也可列出所有可用预设。',
        parameters: {
          type: 'object',
          properties: {
            roll_id:     { type: 'integer', description: '获取该卷的渲染参数' },
            preset_id:   { type: 'integer', description: '获取指定预设参数' },
            list_presets: { type: 'boolean', description: '列出所有可用预设（仅名称和分类）' },
          },
        },
      },
    },
    handler: async ({ roll_id, preset_id, list_presets }) => {
      if (list_presets) {
        const presets = await allAsync(
          'SELECT id, name, category, description FROM presets ORDER BY category, name'
        );
        return sanitizeToolResult(JSON.stringify({ count: presets.length, presets }));
      }

      if (preset_id) {
        const preset = await getAsync(
          'SELECT id, name, category, description, params_json, params FROM presets WHERE id = ?',
          [preset_id]
        );
        if (!preset) return sanitizeToolResult(JSON.stringify({ error: 'preset not found' }));
        let params;
        try { params = JSON.parse(preset.params_json || preset.params); } catch { params = null; }
        return sanitizeToolResult(JSON.stringify({ preset_id: preset.id, name: preset.name, category: preset.category, params }));
      }

      if (roll_id) {
        const roll = await getAsync('SELECT id, title, preset_json FROM rolls WHERE id = ?', [roll_id]);
        if (!roll) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));
        let params;
        try { params = JSON.parse(roll.preset_json); } catch { params = null; }
        return sanitizeToolResult(JSON.stringify({ roll_id, title: roll.title, has_preset: !!params, params }));
      }

      return sanitizeToolResult(JSON.stringify({ error: 'provide roll_id, preset_id, or list_presets=true' }));
    },
  },

  // ─── 新增 Write 工具 ───

  suggest_render_params: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'suggest_render_params',
        description: '基于场景分析为胶卷建议渲染参数调整。将建议的参数增量写入胶卷的 preset_json。可调整：exposure、contrast、highlights、shadows、temp、tint、saturation。',
        parameters: {
          type: 'object',
          properties: {
            roll_id: { type: 'integer', description: '胶卷 ID' },
            adjustments: {
              type: 'object',
              description: '渲染参数调整量（在当前值基础上叠加或覆盖）',
              properties: {
                exposure:   { type: 'number', description: '-3 到 3' },
                contrast:   { type: 'number', description: '-100 到 100' },
                highlights: { type: 'number', description: '-100 到 100' },
                shadows:    { type: 'number', description: '-100 到 100' },
                whites:     { type: 'number', description: '-100 到 100' },
                blacks:     { type: 'number', description: '-100 到 100' },
                temp:       { type: 'number', description: '色温偏移' },
                tint:       { type: 'number', description: '色调偏移' },
                saturation: { type: 'number', description: '-100 到 100' },
              },
            },
            reason: { type: 'string', description: '建议理由' },
          },
          required: ['roll_id', 'adjustments'],
        },
      },
    },
    handler: async ({ roll_id, adjustments, reason }) => {
      const ALLOWED = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'temp', 'tint', 'saturation'];

      const roll = await getAsync('SELECT id, title, preset_json FROM rolls WHERE id = ?', [roll_id]);
      if (!roll) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));

      let current = {};
      try { current = JSON.parse(roll.preset_json) || {}; } catch { current = {}; }

      const oldParams = {};
      const newParams = { ...current };
      for (const key of ALLOWED) {
        if (adjustments[key] !== undefined) {
          oldParams[key] = current[key] ?? 0;
          newParams[key] = adjustments[key];
        }
      }

      if (Object.keys(oldParams).length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'no valid adjustments provided' }));
      }

      await runAsync('UPDATE rolls SET preset_json = ? WHERE id = ?', [JSON.stringify(newParams), roll_id]);

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        roll_id,
        title: roll.title,
        adjusted_params: Object.keys(oldParams),
        old_values: oldParams,
        new_values: Object.fromEntries(Object.keys(oldParams).map(k => [k, newParams[k]])),
        reason: reason || '',
      }));
    },
  },

  batch_apply_preset: {
    type: 'write',
    securityLevel: 2,
    schema: {
      type: 'function',
      function: {
        name: 'batch_apply_preset',
        description: '批量将预设应用到多卷胶卷。高风险操作，需确认 + 预览。',
        parameters: {
          type: 'object',
          properties: {
            roll_ids:  { type: 'array', items: { type: 'integer' }, description: '胶卷 ID 列表', maxItems: 50 },
            preset_id: { type: 'integer', description: '要应用的预设 ID' },
          },
          required: ['roll_ids', 'preset_id'],
        },
      },
    },
    handler: async ({ roll_ids, preset_id }) => {
      const ids = (roll_ids || []).slice(0, 50);
      if (ids.length === 0) return sanitizeToolResult(JSON.stringify({ error: 'roll_ids is empty' }));

      const preset = await getAsync('SELECT id, name, params_json, params FROM presets WHERE id = ?', [preset_id]);
      if (!preset) return sanitizeToolResult(JSON.stringify({ error: 'preset not found' }));

      const paramsJson = preset.params_json || preset.params;

      // 记录哪些卷之前有/无 preset
      const placeholders = ids.map(() => '?').join(',');
      const oldRolls = await allAsync(
        `SELECT id, title, CASE WHEN preset_json IS NOT NULL THEN 1 ELSE 0 END AS had_preset
         FROM rolls WHERE id IN (${placeholders})`,
        ids
      );

      for (const id of ids) {
        await runAsync('UPDATE rolls SET preset_json = ? WHERE id = ?', [paramsJson, id]);
      }

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        preset_name: preset.name,
        affected_rolls: oldRolls.length,
        rolls: oldRolls.map(r => ({ id: r.id, title: r.title, had_preset: !!r.had_preset })),
      }));
    },
  },
};

module.exports = RENDER_TOOLS;
