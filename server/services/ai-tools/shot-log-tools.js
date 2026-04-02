/**
 * AI Tools — 拍摄日志工具
 * 
 * get_shot_log (read)
 * update_shot_log, add_shot_log_entry (write)
 */
const { getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

// 共用：解析 shot_logs JSON
function parseShotLogs(item) {
  if (!item.shot_logs) return [];
  try {
    const parsed = typeof item.shot_logs === 'string' ? JSON.parse(item.shot_logs) : item.shot_logs;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// 共用：清洗日志条目字段
function sanitizeEntry(e) {
  return {
    date: e.date || '',
    shot_time: e.shot_time || '',
    count: Number(e.count || 0) || 0,
    lens: e.lens || '',
    focal_length: e.focal_length != null ? Number(e.focal_length) : null,
    aperture: e.aperture != null ? Number(e.aperture) : null,
    shutter_speed: e.shutter_speed || '',
    country: e.country || '',
    city: e.city || '',
    detail_location: e.detail_location || '',
    latitude: e.latitude != null ? Number(e.latitude) : null,
    longitude: e.longitude != null ? Number(e.longitude) : null,
    caption: e.caption || '',
  };
}

// 共用：按 film_item_id 或 roll_id 查找 film_item
async function resolveFilmItem(film_item_id, roll_id) {
  if (film_item_id) {
    return await getAsync('SELECT id, shot_logs FROM film_items WHERE id = ? AND deleted_at IS NULL', [film_item_id]);
  }
  if (roll_id) {
    return await getAsync('SELECT id, shot_logs FROM film_items WHERE roll_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', [roll_id]);
  }
  return null;
}

const SHOT_LOG_TOOLS = {

  get_shot_log: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_shot_log',
        description: '获取某胶片卷 (film_item) 的拍摄日志 (shot log)。需要提供 film_item_id 或 roll_id（会自动查找关联的胶片卷）。',
        parameters: {
          type: 'object',
          properties: {
            film_item_id: { type: 'integer', description: '胶片卷元素 ID（film_items 表）' },
            roll_id:       { type: 'integer', description: '胶卷 ID（rolls 表），自动查找关联的 film_item' },
          },
        },
      },
    },
    handler: async ({ film_item_id, roll_id }) => {
      const item = await resolveFilmItem(film_item_id, roll_id);
      if (!item) return sanitizeToolResult(JSON.stringify({ error: 'film_item not found' }));

      const entries = parseShotLogs(item);
      return sanitizeToolResult(JSON.stringify({ film_item_id: item.id, entry_count: entries.length, entries }));
    },
  },

  update_shot_log: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'update_shot_log',
        description: '增加、修改或删除胶片卷的拍摄日志条目。action=add 追加新条目；action=edit 按索引修改；action=delete 按索引删除；action=replace_all 替换全部（谨慎使用）。',
        parameters: {
          type: 'object',
          properties: {
            film_item_id: { type: 'integer', description: '胶片卷元素 ID（film_items 表）' },
            roll_id:       { type: 'integer', description: '胶卷 ID，自动查找关联的 film_item' },
            action:        { type: 'string', enum: ['add', 'edit', 'delete', 'replace_all'], description: '操作类型' },
            entry: {
              type: 'object',
              description: 'action=add/edit 时提供。字段：date(YYYY-MM-DD), shot_time(HH:MM), count(整数), lens, focal_length, aperture, shutter_speed, country, city, detail_location, latitude, longitude, caption',
            },
            index: { type: 'integer', description: 'action=edit/delete 时，0-based 条目索引' },
            entries: { type: 'array', description: 'action=replace_all 时，完整的新条目数组' },
          },
          required: ['action'],
        },
      },
    },
    handler: async ({ film_item_id, roll_id, action, entry, index, entries }) => {
      const item = await resolveFilmItem(film_item_id, roll_id);
      if (!item) return sanitizeToolResult(JSON.stringify({ error: 'film_item not found' }));

      const current = parseShotLogs(item);
      let updated;

      if (action === 'add') {
        if (!entry) return sanitizeToolResult(JSON.stringify({ error: 'entry is required for add' }));
        updated = [...current, sanitizeEntry(entry)].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      } else if (action === 'edit') {
        if (index == null || !entry) return sanitizeToolResult(JSON.stringify({ error: 'index and entry are required for edit' }));
        if (index < 0 || index >= current.length) return sanitizeToolResult(JSON.stringify({ error: 'index out of range' }));
        updated = current.map((e, i) => i === index ? sanitizeEntry({ ...e, ...entry }) : e);
      } else if (action === 'delete') {
        if (index == null) return sanitizeToolResult(JSON.stringify({ error: 'index is required for delete' }));
        if (index < 0 || index >= current.length) return sanitizeToolResult(JSON.stringify({ error: 'index out of range' }));
        updated = current.filter((_, i) => i !== index);
      } else if (action === 'replace_all') {
        if (!Array.isArray(entries)) return sanitizeToolResult(JSON.stringify({ error: 'entries array is required for replace_all' }));
        updated = entries.map(sanitizeEntry).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      } else {
        return sanitizeToolResult(JSON.stringify({ error: 'unknown action' }));
      }

      await runAsync('UPDATE film_items SET shot_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(updated), item.id]);
      return sanitizeToolResult(JSON.stringify({ ok: true, film_item_id: item.id, entry_count: updated.length }));
    },
  },

  // ─── 新增 Write 工具 ───

  add_shot_log_entry: {
    type: 'write',
    securityLevel: 0,
    schema: {
      type: 'function',
      function: {
        name: 'add_shot_log_entry',
        description: '为胶片卷快速新增一条拍摄日志。低风险操作，自动执行。相比 update_shot_log(action=add) 更简洁。',
        parameters: {
          type: 'object',
          properties: {
            film_item_id:    { type: 'integer', description: '胶片卷 ID' },
            roll_id:         { type: 'integer', description: '胶卷 ID（二选一）' },
            date:            { type: 'string', description: '拍摄日期 YYYY-MM-DD' },
            shot_time:       { type: 'string', description: '拍摄时间 HH:MM' },
            count:           { type: 'integer', description: '拍摄张数' },
            lens:            { type: 'string' },
            focal_length:    { type: 'number' },
            aperture:        { type: 'number' },
            shutter_speed:   { type: 'string' },
            country:         { type: 'string' },
            city:            { type: 'string' },
            detail_location: { type: 'string' },
            latitude:        { type: 'number' },
            longitude:       { type: 'number' },
            caption:         { type: 'string' },
          },
        },
      },
    },
    handler: async (args) => {
      const { film_item_id, roll_id, ...entryData } = args;
      const item = await resolveFilmItem(film_item_id, roll_id);
      if (!item) return sanitizeToolResult(JSON.stringify({ error: 'film_item not found' }));

      const current = parseShotLogs(item);
      const newEntry = sanitizeEntry(entryData);
      const updated = [...current, newEntry].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

      await runAsync('UPDATE film_items SET shot_logs = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(updated), item.id]);
      return sanitizeToolResult(JSON.stringify({ ok: true, film_item_id: item.id, entry_count: updated.length, new_entry: newEntry }));
    },
  },
};

module.exports = SHOT_LOG_TOOLS;
