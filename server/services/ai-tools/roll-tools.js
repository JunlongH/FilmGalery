/**
 * AI Tools — 胶卷管理工具
 * 
 * list_rolls, get_roll_detail (read)
 * update_roll, set_roll_cover, set_roll_preset (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

const ROLL_TOOLS = {

  list_rolls: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_rolls',
        description: '列出胶卷列表，支持按年份、胶片、相机筛选。',
        parameters: {
          type: 'object',
          properties: {
            year:    { type: 'integer', description: '按年份筛选' },
            month:   { type: 'integer', minimum: 1, maximum: 12, description: '按月份筛选（1-12），需与 year 配合' },
            film_id: { type: 'integer', description: '按胶片 ID 筛选' },
            camera:  { type: 'string',  description: '相机名称（模糊匹配）' },
            limit:   { type: 'integer', default: 20, maximum: 50 },
          },
        },
      },
    },
    handler: async (args) => {
      const { year, month, film_id, camera, limit = 20 } = args;
      let sql = `
        SELECT r.id, r.title, r.date_loaded, r.date_finished, r.notes,
               f.name AS film_name, r.camera,
               COUNT(p.id) AS photo_count
        FROM rolls r
        LEFT JOIN films f ON r.filmId = f.id
        LEFT JOIN photos p ON p.roll_id = r.id
        WHERE 1=1
      `;
      const params = [];
      if (year && month) {
        sql += " AND strftime('%Y', r.date_loaded) = ? AND strftime('%m', r.date_loaded) = ?";
        params.push(String(year), String(month).padStart(2, '0'));
      } else if (year) {
        sql += " AND strftime('%Y', r.date_loaded) = ?";
        params.push(String(year));
      }
      if (film_id) { sql += ' AND r.filmId = ?';    params.push(film_id); }
      if (camera)  { sql += ' AND r.camera LIKE ?';  params.push(`%${camera}%`); }
      sql += ' GROUP BY r.id ORDER BY r.date_loaded DESC, r.id DESC LIMIT ?';
      params.push(Math.min(Number(limit) || 20, 50));

      const rolls = await allAsync(sql, params);
      return sanitizeToolResult(JSON.stringify({ count: rolls.length, rolls }));
    },
  },

  get_roll_detail: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_roll_detail',
        description: '获取单卷胶卷的详情，包括基本信息和照片数量。',
        parameters: {
          type: 'object',
          properties: {
            roll_id: { type: 'integer', description: '胶卷 ID' },
          },
          required: ['roll_id'],
        },
      },
    },
    handler: async ({ roll_id }) => {
      const roll = await getAsync(
        `SELECT r.*, f.name AS film_name, COUNT(p.id) AS photo_count
         FROM rolls r
         LEFT JOIN films f ON r.filmId = f.id
         LEFT JOIN photos p ON p.roll_id = r.id
         WHERE r.id = ?
         GROUP BY r.id`,
        [roll_id]
      );
      if (!roll) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));
      return sanitizeToolResult(JSON.stringify(roll));
    },
  },

  // ─── 新增 Write 工具 ───

  update_roll: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'update_roll',
        description: '修改胶卷信息。可修改字段：title、date_loaded、date_finished、notes、camera、lens、photographer、iso、exposures。',
        parameters: {
          type: 'object',
          properties: {
            roll_id: { type: 'integer', description: '胶卷 ID' },
            changes: {
              type: 'object',
              description: '要修改的字段键值对',
              properties: {
                title:         { type: 'string' },
                date_loaded:   { type: 'string', description: 'YYYY-MM-DD' },
                date_finished: { type: 'string', description: 'YYYY-MM-DD' },
                notes:         { type: 'string' },
                camera:        { type: 'string' },
                lens:          { type: 'string' },
                photographer:  { type: 'string' },
                iso:           { type: 'integer' },
                exposures:     { type: 'integer' },
              },
            },
          },
          required: ['roll_id', 'changes'],
        },
      },
    },
    handler: async ({ roll_id, changes }) => {
      const ALLOWED = ['title', 'date_loaded', 'date_finished', 'notes', 'camera', 'lens', 'photographer', 'iso', 'exposures'];
      const filtered = {};
      for (const k of ALLOWED) {
        if (changes[k] !== undefined) filtered[k] = changes[k];
      }
      if (Object.keys(filtered).length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'no valid fields to update' }));
      }

      const old = await getAsync('SELECT ' + Object.keys(filtered).join(', ') + ' FROM rolls WHERE id = ?', [roll_id]);
      if (!old) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));

      const setCols = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(filtered), roll_id];
      await runAsync(`UPDATE rolls SET ${setCols} WHERE id = ?`, values);

      return sanitizeToolResult(JSON.stringify({ ok: true, roll_id, updated_fields: Object.keys(filtered), old_values: old }));
    },
  },

  set_roll_cover: {
    type: 'write',
    securityLevel: 0,
    schema: {
      type: 'function',
      function: {
        name: 'set_roll_cover',
        description: '设置胶卷的封面照片。低风险操作，自动执行。',
        parameters: {
          type: 'object',
          properties: {
            roll_id:  { type: 'integer', description: '胶卷 ID' },
            photo_id: { type: 'integer', description: '用作封面的照片 ID（须属于该卷）' },
          },
          required: ['roll_id', 'photo_id'],
        },
      },
    },
    handler: async ({ roll_id, photo_id }) => {
      const photo = await getAsync('SELECT id, roll_id, thumb_rel_path FROM photos WHERE id = ?', [photo_id]);
      if (!photo) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));
      if (photo.roll_id !== roll_id) {
        return sanitizeToolResult(JSON.stringify({ error: 'photo does not belong to this roll' }));
      }

      const roll = await getAsync('SELECT id FROM rolls WHERE id = ?', [roll_id]);
      if (!roll) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));

      // 用 photo 的缩略图路径作为封面
      const coverPath = photo.thumb_rel_path || null;
      await runAsync('UPDATE rolls SET cover_photo_id = ?, cover_path = ? WHERE id = ?', [photo_id, coverPath, roll_id]);

      return sanitizeToolResult(JSON.stringify({ ok: true, roll_id, cover_photo_id: photo_id }));
    },
  },

  set_roll_preset: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'set_roll_preset',
        description: '为整卷胶卷设置渲染预设（preset_json）。预设将应用到该卷所有照片的默认渲染。',
        parameters: {
          type: 'object',
          properties: {
            roll_id:   { type: 'integer', description: '胶卷 ID' },
            preset_id: { type: 'integer', description: '预设 ID（来自 presets 表）' },
          },
          required: ['roll_id', 'preset_id'],
        },
      },
    },
    handler: async ({ roll_id, preset_id }) => {
      const roll = await getAsync('SELECT id, preset_json FROM rolls WHERE id = ?', [roll_id]);
      if (!roll) return sanitizeToolResult(JSON.stringify({ error: 'roll not found' }));

      const preset = await getAsync('SELECT id, name, params_json, params FROM presets WHERE id = ?', [preset_id]);
      if (!preset) return sanitizeToolResult(JSON.stringify({ error: 'preset not found' }));

      const paramsJson = preset.params_json || preset.params;
      await runAsync('UPDATE rolls SET preset_json = ? WHERE id = ?', [paramsJson, roll_id]);

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        roll_id,
        preset_name: preset.name,
        old_preset: roll.preset_json ? '(had preset)' : '(none)',
      }));
    },
  },
};

module.exports = ROLL_TOOLS;
