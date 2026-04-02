/**
 * AI Tools — 标签系统工具
 * 
 * list_tags (read)
 * create_tag, attach_tags, detach_tags (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

const TAG_TOOLS = {

  list_tags: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_tags',
        description: '列出所有标签及其使用次数。添加标签前应先查询避免重复。',
        parameters: { type: 'object', properties: {} },
      },
    },
    handler: async () => {
      const tags = await allAsync(
        `SELECT t.id, t.name, COUNT(pt.photo_id) AS usage_count
         FROM tags t LEFT JOIN photo_tags pt ON pt.tag_id = t.id
         GROUP BY t.id ORDER BY usage_count DESC, t.name`
      );
      return sanitizeToolResult(JSON.stringify({ count: tags.length, tags }));
    },
  },

  // ─── 新增 Write 工具 ───

  create_tag: {
    type: 'write',
    securityLevel: 0,
    schema: {
      type: 'function',
      function: {
        name: 'create_tag',
        description: '创建新标签。如果同名标签已存在，返回已有标签的 ID。低风险操作，自动执行。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '标签名称' },
          },
          required: ['name'],
        },
      },
    },
    handler: async ({ name }) => {
      const trimmed = (name || '').trim();
      if (!trimmed) return sanitizeToolResult(JSON.stringify({ error: 'tag name is empty' }));

      // 检查是否已存在
      const existing = await getAsync('SELECT id, name FROM tags WHERE name = ?', [trimmed]);
      if (existing) {
        return sanitizeToolResult(JSON.stringify({ ok: true, tag_id: existing.id, name: existing.name, already_existed: true }));
      }

      const result = await runAsync('INSERT INTO tags (name) VALUES (?)', [trimmed]);
      return sanitizeToolResult(JSON.stringify({ ok: true, tag_id: result.lastID, name: trimmed, already_existed: false }));
    },
  },

  attach_tags: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'attach_tags',
        description: '为一张或多张照片添加标签。支持批量操作。标签不存在时自动创建。',
        parameters: {
          type: 'object',
          properties: {
            photo_ids: { type: 'array', items: { type: 'integer' }, description: '照片 ID 列表', maxItems: 100 },
            tag_names: { type: 'array', items: { type: 'string' }, description: '标签名称列表', maxItems: 20 },
          },
          required: ['photo_ids', 'tag_names'],
        },
      },
    },
    handler: async ({ photo_ids, tag_names }) => {
      const ids = (photo_ids || []).slice(0, 100);
      const names = (tag_names || []).slice(0, 20).map(n => (n || '').trim()).filter(Boolean);
      if (ids.length === 0 || names.length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'photo_ids and tag_names are required' }));
      }

      // 确保所有标签存在
      const tagIds = [];
      for (const name of names) {
        let tag = await getAsync('SELECT id FROM tags WHERE name = ?', [name]);
        if (!tag) {
          const r = await runAsync('INSERT INTO tags (name) VALUES (?)', [name]);
          tag = { id: r.lastID };
        }
        tagIds.push({ id: tag.id, name });
      }

      // 批量关联
      let attachedCount = 0;
      for (const pid of ids) {
        for (const tag of tagIds) {
          try {
            await runAsync('INSERT OR IGNORE INTO photo_tags (photo_id, tag_id) VALUES (?, ?)', [pid, tag.id]);
            attachedCount++;
          } catch { /* ignore duplicates */ }
        }
      }

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        photo_count: ids.length,
        tags: tagIds.map(t => t.name),
        operations: attachedCount,
      }));
    },
  },

  detach_tags: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'detach_tags',
        description: '从一张或多张照片移除标签。',
        parameters: {
          type: 'object',
          properties: {
            photo_ids: { type: 'array', items: { type: 'integer' }, description: '照片 ID 列表', maxItems: 100 },
            tag_names: { type: 'array', items: { type: 'string' }, description: '要移除的标签名称列表', maxItems: 20 },
          },
          required: ['photo_ids', 'tag_names'],
        },
      },
    },
    handler: async ({ photo_ids, tag_names }) => {
      const ids = (photo_ids || []).slice(0, 100);
      const names = (tag_names || []).slice(0, 20).map(n => (n || '').trim()).filter(Boolean);
      if (ids.length === 0 || names.length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'photo_ids and tag_names are required' }));
      }

      let removedCount = 0;
      for (const name of names) {
        const tag = await getAsync('SELECT id FROM tags WHERE name = ?', [name]);
        if (!tag) continue;
        const placeholders = ids.map(() => '?').join(',');
        const result = await runAsync(
          `DELETE FROM photo_tags WHERE tag_id = ? AND photo_id IN (${placeholders})`,
          [tag.id, ...ids]
        );
        removedCount += result.changes;
      }

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        photo_count: ids.length,
        tags_removed: names,
        operations: removedCount,
      }));
    },
  },
};

module.exports = TAG_TOOLS;
