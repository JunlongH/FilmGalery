/**
 * AI Tools — 胶片与库存工具
 * 
 * get_film_info, list_film_items (read)
 * update_inventory_item, record_film_purchase (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

const VALID_STATUSES = ['in_stock', 'loaded', 'shot', 'sent_to_lab', 'developed', 'archived'];

const FILM_TOOLS = {

  get_film_info: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_film_info',
        description: '查询胶片信息和库存。',
        parameters: {
          type: 'object',
          properties: {
            film_id:  { type: 'integer', description: '胶片 ID（精确查询）' },
            query:    { type: 'string',  description: '名称关键词搜索' },
            in_stock: { type: 'boolean', description: '仅返回有库存的胶片' },
          },
        },
      },
    },
    handler: async ({ film_id, query, in_stock }) => {
      let sql = `
        SELECT f.*, COUNT(fi.id) AS stock_count
        FROM films f
        LEFT JOIN film_items fi ON fi.film_id = f.id AND fi.status = 'in_stock' AND fi.deleted_at IS NULL
        WHERE 1=1
      `;
      const params = [];
      if (film_id) { sql += ' AND f.id = ?';      params.push(film_id); }
      if (query)   { sql += ' AND f.name LIKE ?';  params.push(`%${query}%`); }
      sql += ' GROUP BY f.id';
      if (in_stock) sql += ' HAVING stock_count > 0';
      sql += ' ORDER BY f.name LIMIT 30';

      const films = await allAsync(sql, params);
      return sanitizeToolResult(JSON.stringify({ count: films.length, films }));
    },
  },

  list_film_items: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'list_film_items',
        description: '列出胶片库存条目（film_items），支持按状态、胶片类型筛选。可查看正在拍摄(loaded)、已拍完(shot)、送冲(sent_to_lab)、已冲洗(developed)、库存(in_stock)、归档(archived)的胶片。',
        parameters: {
          type: 'object',
          properties: {
            status:  { type: 'string', enum: VALID_STATUSES, description: '按状态筛选' },
            film_id: { type: 'integer', description: '按胶片种类 ID 筛选' },
            query:   { type: 'string', description: '按胶片名称或标签关键词搜索' },
            limit:   { type: 'integer', default: 30, maximum: 100 },
          },
        },
      },
    },
    handler: async (args) => {
      const { status, film_id, query, limit = 30 } = args;
      let sql = `
        SELECT fi.id, fi.status, fi.label, fi.loaded_camera, fi.loaded_date,
               fi.finished_date, fi.develop_lab, fi.develop_date,
               fi.purchase_price, fi.develop_price, fi.expiry_date,
               fi.roll_id, fi.created_at,
               f.name AS film_name, f.brand AS film_brand, f.iso AS film_iso, f.format AS film_format
        FROM film_items fi
        LEFT JOIN films f ON fi.film_id = f.id
        WHERE fi.deleted_at IS NULL
      `;
      const params = [];
      if (status)  { sql += ' AND fi.status = ?';    params.push(status); }
      if (film_id) { sql += ' AND fi.film_id = ?';   params.push(film_id); }
      if (query)   { sql += ' AND (f.name LIKE ? OR fi.label LIKE ?)'; params.push(`%${query}%`, `%${query}%`); }
      sql += ' ORDER BY fi.updated_at DESC, fi.id DESC LIMIT ?';
      params.push(Math.min(Number(limit) || 30, 100));

      const items = await allAsync(sql, params);
      return sanitizeToolResult(JSON.stringify({ count: items.length, items }));
    },
  },

  // ─── 新增 Write 工具 ───

  update_inventory_item: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'update_inventory_item',
        description: '修改胶片库存条目。可修改：status、label、loaded_camera、loaded_date、finished_date、develop_lab、develop_process、develop_price、develop_date、purchase_price、expiry_date、purchase_note、develop_note。',
        parameters: {
          type: 'object',
          properties: {
            film_item_id: { type: 'integer', description: '胶片库存条目 ID' },
            changes: {
              type: 'object',
              description: '要修改的字段键值对',
              properties: {
                status:          { type: 'string', enum: VALID_STATUSES },
                label:           { type: 'string' },
                loaded_camera:   { type: 'string' },
                loaded_date:     { type: 'string', description: 'YYYY-MM-DD' },
                finished_date:   { type: 'string', description: 'YYYY-MM-DD' },
                develop_lab:     { type: 'string' },
                develop_process: { type: 'string' },
                develop_price:   { type: 'number' },
                develop_date:    { type: 'string', description: 'YYYY-MM-DD' },
                purchase_price:  { type: 'number' },
                expiry_date:     { type: 'string', description: 'YYYY-MM-DD' },
                purchase_note:   { type: 'string' },
                develop_note:    { type: 'string' },
              },
            },
          },
          required: ['film_item_id', 'changes'],
        },
      },
    },
    handler: async ({ film_item_id, changes }) => {
      const ALLOWED = ['status', 'label', 'loaded_camera', 'loaded_date', 'finished_date',
        'develop_lab', 'develop_process', 'develop_price', 'develop_date',
        'purchase_price', 'expiry_date', 'purchase_note', 'develop_note'];
      const filtered = {};
      for (const k of ALLOWED) {
        if (changes[k] !== undefined) filtered[k] = changes[k];
      }
      if (Object.keys(filtered).length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'no valid fields to update' }));
      }
      if (filtered.status && !VALID_STATUSES.includes(filtered.status)) {
        return sanitizeToolResult(JSON.stringify({ error: `invalid status: ${filtered.status}` }));
      }

      const old = await getAsync('SELECT ' + Object.keys(filtered).join(', ') + ' FROM film_items WHERE id = ? AND deleted_at IS NULL', [film_item_id]);
      if (!old) return sanitizeToolResult(JSON.stringify({ error: 'film_item not found' }));

      const setCols = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(filtered), film_item_id];
      await runAsync(`UPDATE film_items SET ${setCols}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

      return sanitizeToolResult(JSON.stringify({ ok: true, film_item_id, updated_fields: Object.keys(filtered), old_values: old }));
    },
  },

  record_film_purchase: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'record_film_purchase',
        description: '记录一卷胶片的购入信息，创建新的 film_item 库存条目。',
        parameters: {
          type: 'object',
          properties: {
            film_id:          { type: 'integer', description: '胶片种类 ID（films 表）' },
            quantity:         { type: 'integer', default: 1, minimum: 1, maximum: 50, description: '购入数量' },
            purchase_price:   { type: 'number', description: '单卷价格' },
            purchase_channel: { type: 'string', description: '购买渠道' },
            purchase_vendor:  { type: 'string', description: '卖家名称' },
            purchase_date:    { type: 'string', description: '购买日期 YYYY-MM-DD' },
            expiry_date:      { type: 'string', description: '过期日期 YYYY-MM-DD' },
            batch_number:     { type: 'string', description: '批号' },
            purchase_note:    { type: 'string', description: '备注' },
          },
          required: ['film_id'],
        },
      },
    },
    handler: async (args) => {
      const { film_id, quantity = 1, purchase_price, purchase_channel, purchase_vendor,
              purchase_date, expiry_date, batch_number, purchase_note } = args;

      // 检查胶片是否存在
      const film = await getAsync('SELECT id, name FROM films WHERE id = ?', [film_id]);
      if (!film) return sanitizeToolResult(JSON.stringify({ error: 'film not found' }));

      const qty = Math.min(Math.max(Number(quantity) || 1, 1), 50);
      const createdIds = [];

      for (let i = 0; i < qty; i++) {
        const result = await runAsync(
          `INSERT INTO film_items (film_id, status, purchase_price, purchase_channel, purchase_vendor, purchase_date, expiry_date, batch_number, purchase_note)
           VALUES (?, 'in_stock', ?, ?, ?, ?, ?, ?, ?)`,
          [film_id, purchase_price ?? null, purchase_channel ?? null, purchase_vendor ?? null,
           purchase_date ?? null, expiry_date ?? null, batch_number ?? null, purchase_note ?? null]
        );
        createdIds.push(result.lastID);
      }

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        film_name: film.name,
        created_count: qty,
        film_item_ids: createdIds,
      }));
    },
  },
};

module.exports = FILM_TOOLS;
