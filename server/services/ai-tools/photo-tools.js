/**
 * AI Tools — 照片管理工具
 * 
 * search_photos, get_photo_detail, get_roll_photos, get_photo_neighbors (read)
 * update_photo_metadata, batch_update_photos, set_photo_rating, toggle_photo_favorite, delete_photo (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');
const { buildSourceTypeClause } = require('../../../packages/shared/photographyMode');

const PHOTO_TOOLS = {

  search_photos: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_photos',
        description: '搜索用户的胶片照片。支持关键词、设备、地点、时间、评分筛选。',
        parameters: {
          type: 'object',
          properties: {
            query:         { type: 'string',  description: '全文搜索（匹配 caption / roll title）' },
            roll_id:       { type: 'integer', description: '按胶卷 ID 筛选' },
            camera:        { type: 'string',  description: '相机名称（模糊匹配）' },
            lens:          { type: 'string',  description: '镜头名称（模糊匹配）' },
            year:          { type: 'integer', description: '拍摄年份' },
            month:         { type: 'integer', minimum: 1, maximum: 12, description: '拍摄月份（1-12），需与 year 配合使用' },
            date_from:     { type: 'string',  description: '拍摄日期起始（含），格式 YYYY-MM-DD' },
            date_to:       { type: 'string',  description: '拍摄日期结束（含），格式 YYYY-MM-DD' },
            favorite_only: { type: 'boolean', description: '仅返回有评分的照片' },
            min_rating:    { type: 'integer', minimum: 1, maximum: 5, description: '最低评分' },
            limit:         { type: 'integer', default: 20, maximum: 50 },
          },
        },
      },
    },
    handler: async (args, context = {}) => {
      const { query, roll_id, camera, lens, year, month, date_from, date_to, favorite_only, min_rating, limit = 20 } = args;
      const { clause: sourceClause, params: sourceParams } = buildSourceTypeClause(context.mode, 'p.source_type');
      const sourceFilter = sourceClause ? `AND ${sourceClause}` : '';
      let sql = `
        SELECT p.id, p.frame_number, p.caption, p.rating,
               p.aperture, p.shutter_speed, p.iso, p.focal_length,
               p.date_taken, p.camera, p.lens, p.location_name,
               r.title AS roll_title, f.name AS film_name
        FROM photos p
        LEFT JOIN rolls r ON p.roll_id = r.id
        LEFT JOIN films f ON r.filmId = f.id
        WHERE 1=1
        ${sourceFilter}
      `;
      const params = [...sourceParams];
      if (roll_id)       { sql += ' AND p.roll_id = ?';                        params.push(roll_id); }
      if (query)         { sql += ' AND (p.caption LIKE ? OR r.title LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
      if (camera)        { sql += ' AND p.camera LIKE ?';                      params.push(`%${camera}%`); }
      if (lens)          { sql += ' AND p.lens LIKE ?';                        params.push(`%${lens}%`); }
      if (year && month) {
        sql += " AND strftime('%Y', p.date_taken) = ? AND strftime('%m', p.date_taken) = ?";
        params.push(String(year), String(month).padStart(2, '0'));
      } else if (year) {
        sql += " AND strftime('%Y', p.date_taken) = ?";
        params.push(String(year));
      }
      if (date_from)     { sql += ' AND p.date_taken >= ?';                    params.push(date_from); }
      if (date_to)       { sql += ' AND p.date_taken <= ?';                    params.push(date_to + ' 23:59:59'); }
      if (favorite_only) { sql += ' AND p.rating > 0'; }
      if (min_rating)    { sql += ' AND p.rating >= ?';                        params.push(min_rating); }
      sql += ' ORDER BY p.date_taken DESC, p.id DESC LIMIT ?';
      params.push(Math.min(Number(limit) || 20, 50));

      const photos = await allAsync(sql, params);
      return sanitizeToolResult(JSON.stringify({ count: photos.length, photos }));
    },
  },

  get_photo_detail: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_photo_detail',
        description: '获取单张照片的完整元数据，包括 EXIF、标签、备注等。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
          },
          required: ['photo_id'],
        },
      },
    },
    handler: async ({ photo_id }, context = {}) => {
      const { clause: sourceClause, params: sourceParams } = buildSourceTypeClause(context.mode, 'p.source_type');
      const sourceFilter = sourceClause ? `AND ${sourceClause}` : '';
      const photo = await getAsync(
        `SELECT p.*, r.title AS roll_title, f.name AS film_name
         FROM photos p
         LEFT JOIN rolls r ON p.roll_id = r.id
         LEFT JOIN films f ON r.filmId = f.id
         WHERE p.id = ?
         ${sourceFilter}`,
        [photo_id, ...sourceParams]
      );
      if (!photo) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));
      const tags = await allAsync(
        `SELECT t.name FROM tags t JOIN photo_tags pt ON pt.tag_id = t.id WHERE pt.photo_id = ?`,
        [photo_id]
      );
      photo.tags = tags.map(t => t.name);
      return sanitizeToolResult(JSON.stringify(photo));
    },
  },

  get_roll_photos: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_roll_photos',
        description: '获取一卷胶卷中所有照片的元数据摘要（批量，避免逐张查询）。',
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
      const photos = await allAsync(
        `SELECT id, frame_number, caption, rating, aperture, shutter_speed, iso,
                focal_length, date_taken, camera, lens, location_name
         FROM photos WHERE roll_id = ? ORDER BY frame_number ASC, id ASC`,
        [roll_id]
      );
      return sanitizeToolResult(JSON.stringify({ roll_id, count: photos.length, photos }));
    },
  },

  // ─── 新增 Read 工具 ───

  get_photo_neighbors: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_photo_neighbors',
        description: '获取某张照片前后 N 张照片（同一卷内），提供上下文感知能力。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
            count:    { type: 'integer', default: 3, maximum: 10, description: '前后各取几张（默认 3）' },
          },
          required: ['photo_id'],
        },
      },
    },
    handler: async ({ photo_id, count = 3 }, context = {}) => {
      const n = Math.min(Number(count) || 3, 10);
      const { clause: sourceClause, params: sourceParams } = buildSourceTypeClause(context.mode, 'photos.source_type');
      const sourceFilter = sourceClause ? `AND ${sourceClause}` : '';
      const photo = await getAsync(`SELECT roll_id, frame_number, display_seq FROM photos WHERE id = ? ${sourceFilter}`, [photo_id, ...sourceParams]);
      if (!photo) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));

      const orderCol = photo.frame_number ? 'frame_number' : 'display_seq';
      const orderVal = photo[orderCol] || 0;

      const before = await allAsync(
        `SELECT id, frame_number, caption, rating, date_taken, camera, lens, location_name
         FROM photos WHERE roll_id = ? ${sourceFilter} AND ${orderCol} < ? ORDER BY ${orderCol} DESC LIMIT ?`,
        [photo.roll_id, ...sourceParams, orderVal, n]
      );
      const after = await allAsync(
        `SELECT id, frame_number, caption, rating, date_taken, camera, lens, location_name
         FROM photos WHERE roll_id = ? ${sourceFilter} AND ${orderCol} > ? ORDER BY ${orderCol} ASC LIMIT ?`,
        [photo.roll_id, ...sourceParams, orderVal, n]
      );

      return sanitizeToolResult(JSON.stringify({
        photo_id,
        roll_id: photo.roll_id,
        before: before.reverse(),
        after,
      }));
    },
  },

  // ─── 新增 Write 工具 ───

  update_photo_metadata: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'update_photo_metadata',
        description: '修改单张照片的元数据。可修改字段：caption、rating、date_taken、location_name、country、city、detail_location、latitude、longitude、notes。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
            changes:  {
              type: 'object',
              description: '要修改的字段键值对',
              properties: {
                caption:         { type: 'string' },
                rating:          { type: 'integer', minimum: 0, maximum: 5 },
                date_taken:      { type: 'string', description: 'YYYY-MM-DD' },
                location_name:   { type: 'string' },
                country:         { type: 'string' },
                city:            { type: 'string' },
                detail_location: { type: 'string' },
                latitude:        { type: 'number' },
                longitude:       { type: 'number' },
                notes:           { type: 'string' },
              },
            },
          },
          required: ['photo_id', 'changes'],
        },
      },
    },
    handler: async ({ photo_id, changes }) => {
      const ALLOWED = ['caption', 'rating', 'date_taken', 'location_name', 'country', 'city', 'detail_location', 'latitude', 'longitude', 'notes'];
      const filtered = {};
      for (const k of ALLOWED) {
        if (changes[k] !== undefined) filtered[k] = changes[k];
      }
      if (Object.keys(filtered).length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'no valid fields to update' }));
      }

      // 记录旧值用于审计
      const old = await getAsync('SELECT ' + Object.keys(filtered).join(', ') + ' FROM photos WHERE id = ?', [photo_id]);
      if (!old) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));

      const setCols = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(filtered), photo_id];
      await runAsync(`UPDATE photos SET ${setCols}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

      return sanitizeToolResult(JSON.stringify({ ok: true, photo_id, updated_fields: Object.keys(filtered), old_values: old }));
    },
  },

  batch_update_photos: {
    type: 'write',
    securityLevel: 2,
    schema: {
      type: 'function',
      function: {
        name: 'batch_update_photos',
        description: '批量修改多张照片的同一字段。需确认 + 预览。',
        parameters: {
          type: 'object',
          properties: {
            photo_ids: { type: 'array', items: { type: 'integer' }, description: '照片 ID 列表', maxItems: 100 },
            field:     { type: 'string', enum: ['caption', 'rating', 'date_taken', 'location_name', 'country', 'city', 'notes'], description: '要修改的字段' },
            value:     { description: '新值' },
          },
          required: ['photo_ids', 'field', 'value'],
        },
      },
    },
    handler: async ({ photo_ids, field, value }) => {
      const ALLOWED = ['caption', 'rating', 'date_taken', 'location_name', 'country', 'city', 'notes'];
      if (!ALLOWED.includes(field)) {
        return sanitizeToolResult(JSON.stringify({ error: `field "${field}" not allowed` }));
      }
      const ids = photo_ids.slice(0, 100);
      if (ids.length === 0) return sanitizeToolResult(JSON.stringify({ error: 'photo_ids is empty' }));

      const placeholders = ids.map(() => '?').join(',');
      const oldRows = await allAsync(`SELECT id, ${field} FROM photos WHERE id IN (${placeholders})`, ids);

      await runAsync(
        `UPDATE photos SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`,
        [value, ...ids]
      );

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        affected_count: ids.length,
        field,
        new_value: value,
        old_values: oldRows,
      }));
    },
  },

  set_photo_rating: {
    type: 'write',
    securityLevel: 0,
    schema: {
      type: 'function',
      function: {
        name: 'set_photo_rating',
        description: '设置单张照片的评分（0-5）。高频低风险操作，自动执行。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
            rating:   { type: 'integer', minimum: 0, maximum: 5, description: '评分' },
          },
          required: ['photo_id', 'rating'],
        },
      },
    },
    handler: async ({ photo_id, rating }) => {
      const old = await getAsync('SELECT rating FROM photos WHERE id = ?', [photo_id]);
      if (!old) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));

      await runAsync('UPDATE photos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [rating, photo_id]);
      return sanitizeToolResult(JSON.stringify({ ok: true, photo_id, old_rating: old.rating, new_rating: rating }));
    },
  },

  toggle_photo_favorite: {
    type: 'write',
    securityLevel: 0,
    schema: {
      type: 'function',
      function: {
        name: 'toggle_photo_favorite',
        description: '切换照片的收藏状态。rating > 0 视为已收藏，切换为 0；rating = 0 则设为 1。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
          },
          required: ['photo_id'],
        },
      },
    },
    handler: async ({ photo_id }) => {
      const photo = await getAsync('SELECT rating FROM photos WHERE id = ?', [photo_id]);
      if (!photo) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));

      const newRating = photo.rating > 0 ? 0 : 1;
      await runAsync('UPDATE photos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newRating, photo_id]);
      return sanitizeToolResult(JSON.stringify({ ok: true, photo_id, old_rating: photo.rating, new_rating: newRating }));
    },
  },

  delete_photo: {
    type: 'write',
    securityLevel: 2,
    schema: {
      type: 'function',
      function: {
        name: 'delete_photo',
        description: '删除照片记录。注意：此操作会从数据库中移除照片记录，请谨慎使用。',
        parameters: {
          type: 'object',
          properties: {
            photo_id: { type: 'integer', description: '照片 ID' },
            reason:   { type: 'string', description: '删除原因' },
          },
          required: ['photo_id'],
        },
      },
    },
    handler: async ({ photo_id, reason }) => {
      const photo = await getAsync('SELECT id, caption, roll_id, frame_number FROM photos WHERE id = ?', [photo_id]);
      if (!photo) return sanitizeToolResult(JSON.stringify({ error: 'photo not found' }));

      // 先删标签关联
      await runAsync('DELETE FROM photo_tags WHERE photo_id = ?', [photo_id]);
      // 再删照片
      await runAsync('DELETE FROM photos WHERE id = ?', [photo_id]);

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        deleted_photo: photo,
        reason: reason || 'user requested',
      }));
    },
  },
};

module.exports = PHOTO_TOOLS;
