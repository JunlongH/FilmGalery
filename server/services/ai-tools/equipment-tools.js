/**
 * AI Tools — 设备管理工具
 * 
 * search_equipment (read)
 * add_equipment, update_equipment (write)
 */
const { allAsync, getAsync, runAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

// 设备类型 → 表名映射
const EQUIP_TABLES = {
  camera:    'equip_cameras',
  lens:      'equip_lenses',
  flash:     'equip_flashes',
  scanner:   'equip_scanners',
  film_back: 'equip_film_backs',
};

const EQUIPMENT_TOOLS = {

  search_equipment: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'search_equipment',
        description: '搜索用户的相机、镜头等设备信息。支持 camera、lens、flash、scanner、film_back 五种类型。',
        parameters: {
          type: 'object',
          properties: {
            equipment_type: { type: 'string', enum: ['camera', 'lens', 'flash', 'scanner', 'film_back', 'all'], description: '设备类型' },
            query: { type: 'string', description: '搜索关键词' },
          },
          required: ['equipment_type'],
        },
      },
    },
    handler: async ({ equipment_type, query }) => {
      const result = {};
      const types = equipment_type === 'all' ? Object.keys(EQUIP_TABLES) : [equipment_type];

      for (const t of types) {
        const table = EQUIP_TABLES[t];
        if (!table) continue;
        const likeClause = query ? ' AND (name LIKE ? OR brand LIKE ?)' : '';
        const params = query ? [`%${query}%`, `%${query}%`] : [];
        result[t + 's'] = await allAsync(
          `SELECT * FROM ${table} WHERE deleted_at IS NULL${likeClause} ORDER BY name`,
          params
        );
      }
      return sanitizeToolResult(JSON.stringify(result));
    },
  },

  // ─── 新增 Write 工具 ───

  add_equipment: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'add_equipment',
        description: '新增设备（相机/镜头/闪光灯/扫描仪/片夹）。',
        parameters: {
          type: 'object',
          properties: {
            equipment_type: {
              type: 'string',
              enum: ['camera', 'lens', 'flash', 'scanner', 'film_back'],
              description: '设备类型',
            },
            data: {
              type: 'object',
              description: '设备信息。相机：name, brand, model, type, mount, serial_number, purchase_date, purchase_price, condition, notes, status。镜头：name, brand, model, focal_length_min, focal_length_max, max_aperture, mount, serial_number, purchase_date, purchase_price, condition, notes, status。',
              properties: {
                name:           { type: 'string', description: '设备名称（必填）' },
                brand:          { type: 'string' },
                model:          { type: 'string' },
                type:           { type: 'string', description: '相机类型：SLR/rangefinder/TLR/point-and-shoot/medium-format' },
                mount:          { type: 'string' },
                serial_number:  { type: 'string' },
                purchase_date:  { type: 'string', description: 'YYYY-MM-DD' },
                purchase_price: { type: 'number' },
                condition:      { type: 'string' },
                notes:          { type: 'string' },
                status:         { type: 'string', enum: ['owned', 'sold', 'wishlist'], description: '状态，默认 owned' },
              },
              required: ['name'],
            },
          },
          required: ['equipment_type', 'data'],
        },
      },
    },
    handler: async ({ equipment_type, data }) => {
      const table = EQUIP_TABLES[equipment_type];
      if (!table) return sanitizeToolResult(JSON.stringify({ error: `unknown equipment type: ${equipment_type}` }));
      if (!data.name) return sanitizeToolResult(JSON.stringify({ error: 'name is required' }));

      // 通用允许字段（各设备共有）
      const COMMON_ALLOWED = ['name', 'brand', 'model', 'type', 'mount', 'serial_number',
        'purchase_date', 'purchase_price', 'condition', 'notes', 'status'];
      // 镜头额外字段
      const LENS_EXTRA = ['focal_length_min', 'focal_length_max', 'max_aperture', 'min_aperture', 'filter_size', 'weight_g'];

      const allowed = equipment_type === 'lens' ? [...COMMON_ALLOWED, ...LENS_EXTRA] : COMMON_ALLOWED;
      const filtered = {};
      for (const k of allowed) {
        if (data[k] !== undefined) filtered[k] = data[k];
      }

      const keys = Object.keys(filtered);
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => filtered[k]);

      const result = await runAsync(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`,
        values
      );

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        equipment_type,
        id: result.lastID,
        name: data.name,
      }));
    },
  },

  update_equipment: {
    type: 'write',
    securityLevel: 1,
    schema: {
      type: 'function',
      function: {
        name: 'update_equipment',
        description: '修改已有设备的信息。',
        parameters: {
          type: 'object',
          properties: {
            equipment_type: {
              type: 'string',
              enum: ['camera', 'lens', 'flash', 'scanner', 'film_back'],
              description: '设备类型',
            },
            equipment_id: { type: 'integer', description: '设备 ID' },
            changes: {
              type: 'object',
              description: '要修改的字段键值对。支持：name, brand, model, type, mount, serial_number, purchase_date, purchase_price, condition, notes, status。',
            },
          },
          required: ['equipment_type', 'equipment_id', 'changes'],
        },
      },
    },
    handler: async ({ equipment_type, equipment_id, changes }) => {
      const table = EQUIP_TABLES[equipment_type];
      if (!table) return sanitizeToolResult(JSON.stringify({ error: `unknown equipment type: ${equipment_type}` }));

      const ALLOWED = ['name', 'brand', 'model', 'type', 'mount', 'serial_number',
        'purchase_date', 'purchase_price', 'condition', 'notes', 'status',
        'focal_length_min', 'focal_length_max', 'max_aperture', 'min_aperture'];
      const filtered = {};
      for (const k of ALLOWED) {
        if (changes[k] !== undefined) filtered[k] = changes[k];
      }
      if (Object.keys(filtered).length === 0) {
        return sanitizeToolResult(JSON.stringify({ error: 'no valid fields to update' }));
      }

      const old = await getAsync(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`, [equipment_id]);
      if (!old) return sanitizeToolResult(JSON.stringify({ error: 'equipment not found' }));

      const setCols = Object.keys(filtered).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(filtered), equipment_id];
      await runAsync(`UPDATE ${table} SET ${setCols}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, values);

      // 只返回修改前的相关字段值
      const oldValues = {};
      for (const k of Object.keys(filtered)) oldValues[k] = old[k];

      return sanitizeToolResult(JSON.stringify({
        ok: true,
        equipment_type,
        equipment_id,
        updated_fields: Object.keys(filtered),
        old_values: oldValues,
      }));
    },
  },
};

module.exports = EQUIPMENT_TOOLS;
