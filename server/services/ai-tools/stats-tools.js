/**
 * AI Tools — 数据分析工具
 * 
 * get_stats (read) — 统计概览
 * analyze_shooting_patterns, cost_analysis, equipment_usage_stats (read) — 进阶分析
 */
const { allAsync, getAsync } = require('../../utils/db-helpers');
const { sanitizeToolResult } = require('./helpers');

const STATS_TOOLS = {

  get_stats: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'get_stats',
        description: '获取用户的摄影统计：胶卷总数、照片总数、设备使用频率、库存各状态数量、花费等。',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['summary', 'gear', 'spending'], description: '统计类型' },
          },
          required: ['type'],
        },
      },
    },
    handler: async ({ type }) => {
      if (type === 'summary') {
        const row = await getAsync(`
          SELECT
            (SELECT COUNT(*) FROM rolls)   AS total_rolls,
            (SELECT COUNT(*) FROM photos)  AS total_photos,
            (SELECT COUNT(*) FROM films)   AS total_films,
            (SELECT COUNT(*) FROM equip_cameras WHERE deleted_at IS NULL) AS cameras_count,
            (SELECT COUNT(*) FROM equip_lenses WHERE deleted_at IS NULL)  AS lenses_count,
            (SELECT COUNT(*) FROM film_items WHERE status = 'in_stock' AND deleted_at IS NULL) AS in_stock,
            (SELECT COUNT(*) FROM film_items WHERE status = 'loaded' AND deleted_at IS NULL) AS loaded,
            (SELECT COUNT(*) FROM film_items WHERE status = 'shot' AND deleted_at IS NULL) AS shot,
            (SELECT COUNT(*) FROM film_items WHERE status = 'sent_to_lab' AND deleted_at IS NULL) AS sent_to_lab,
            (SELECT COUNT(*) FROM film_items WHERE status = 'developed' AND deleted_at IS NULL) AS developed,
            (SELECT COUNT(*) FROM film_items WHERE status = 'archived' AND deleted_at IS NULL) AS archived
        `);
        return sanitizeToolResult(JSON.stringify(row));
      }
      if (type === 'gear') {
        const cameras = await allAsync(
          `SELECT camera, COUNT(*) AS roll_count FROM rolls WHERE camera IS NOT NULL GROUP BY camera ORDER BY roll_count DESC LIMIT 10`
        );
        const lenses = await allAsync(
          `SELECT lens, COUNT(*) AS photo_count FROM photos WHERE lens IS NOT NULL GROUP BY lens ORDER BY photo_count DESC LIMIT 10`
        );
        return sanitizeToolResult(JSON.stringify({ cameras, lenses }));
      }
      if (type === 'spending') {
        const row = await getAsync(`
          SELECT
            SUM(purchase_price) AS total_purchase,
            SUM(develop_price)  AS total_develop,
            COUNT(*)            AS total_items
          FROM film_items WHERE deleted_at IS NULL
        `);
        return sanitizeToolResult(JSON.stringify(row));
      }
      return sanitizeToolResult(JSON.stringify({ error: 'unknown type' }));
    },
  },

  // ─── 新增 Read 分析工具 ───

  analyze_shooting_patterns: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'analyze_shooting_patterns',
        description: '分析用户的拍摄习惯：常用相机/镜头组合、胶片类型偏好、拍摄时间分布、焦段分布。',
        parameters: {
          type: 'object',
          properties: {
            year:     { type: 'integer', description: '限定分析年份（可选）' },
            group_by: {
              type: 'string',
              enum: ['camera', 'lens', 'camera_lens', 'film', 'month', 'focal_length'],
              description: '分组维度',
            },
            limit: { type: 'integer', default: 15, maximum: 30 },
          },
          required: ['group_by'],
        },
      },
    },
    handler: async ({ year, group_by, limit = 15 }) => {
      const lim = Math.min(Number(limit) || 15, 30);
      const yearFilter = year ? ` AND strftime('%Y', r.date_loaded) = '${String(year)}'` : '';
      const yearFilterPhoto = year ? ` AND strftime('%Y', p.date_taken) = '${String(year)}'` : '';

      let rows;
      switch (group_by) {
        case 'camera':
          rows = await allAsync(
            `SELECT r.camera, COUNT(*) AS roll_count, COUNT(DISTINCT p.id) AS photo_count
             FROM rolls r LEFT JOIN photos p ON p.roll_id = r.id
             WHERE r.camera IS NOT NULL${yearFilter}
             GROUP BY r.camera ORDER BY roll_count DESC LIMIT ?`, [lim]
          );
          break;

        case 'lens':
          rows = await allAsync(
            `SELECT p.lens, COUNT(*) AS photo_count
             FROM photos p LEFT JOIN rolls r ON p.roll_id = r.id
             WHERE p.lens IS NOT NULL${yearFilterPhoto}
             GROUP BY p.lens ORDER BY photo_count DESC LIMIT ?`, [lim]
          );
          break;

        case 'camera_lens':
          rows = await allAsync(
            `SELECT p.camera, p.lens, COUNT(*) AS photo_count
             FROM photos p LEFT JOIN rolls r ON p.roll_id = r.id
             WHERE p.camera IS NOT NULL AND p.lens IS NOT NULL${yearFilterPhoto}
             GROUP BY p.camera, p.lens ORDER BY photo_count DESC LIMIT ?`, [lim]
          );
          break;

        case 'film':
          rows = await allAsync(
            `SELECT f.name AS film_name, f.iso AS film_iso, COUNT(r.id) AS roll_count
             FROM rolls r JOIN films f ON r.filmId = f.id
             WHERE 1=1${yearFilter}
             GROUP BY f.id ORDER BY roll_count DESC LIMIT ?`, [lim]
          );
          break;

        case 'month':
          rows = await allAsync(
            `SELECT strftime('%Y-%m', r.date_loaded) AS month, COUNT(*) AS roll_count
             FROM rolls r
             WHERE r.date_loaded IS NOT NULL${yearFilter}
             GROUP BY month ORDER BY month DESC LIMIT ?`, [lim]
          );
          break;

        case 'focal_length':
          rows = await allAsync(
            `SELECT
               CASE
                 WHEN p.focal_length < 28 THEN '超广角 (<28mm)'
                 WHEN p.focal_length < 40 THEN '广角 (28-39mm)'
                 WHEN p.focal_length < 60 THEN '标准 (40-59mm)'
                 WHEN p.focal_length < 100 THEN '中长焦 (60-99mm)'
                 ELSE '长焦 (100mm+)'
               END AS range,
               COUNT(*) AS photo_count,
               ROUND(AVG(p.focal_length), 1) AS avg_focal_length
             FROM photos p
             WHERE p.focal_length IS NOT NULL AND p.focal_length > 0${yearFilterPhoto}
             GROUP BY range ORDER BY photo_count DESC`, []
          );
          break;

        default:
          return sanitizeToolResult(JSON.stringify({ error: 'unknown group_by' }));
      }

      return sanitizeToolResult(JSON.stringify({ group_by, year: year || 'all', count: rows.length, data: rows }));
    },
  },

  cost_analysis: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'cost_analysis',
        description: '胶片花费分析：按时间段、品牌、类型统计购买和冲洗费用。',
        parameters: {
          type: 'object',
          properties: {
            group_by: {
              type: 'string',
              enum: ['month', 'year', 'film', 'vendor', 'lab'],
              description: '分组维度',
            },
            year: { type: 'integer', description: '限定年份（可选）' },
          },
          required: ['group_by'],
        },
      },
    },
    handler: async ({ group_by, year }) => {
      let rows;

      switch (group_by) {
        case 'month':
          rows = await allAsync(
            `SELECT strftime('%Y-%m', fi.purchase_date) AS month,
                    COUNT(*) AS item_count,
                    ROUND(SUM(fi.purchase_price), 2) AS purchase_total,
                    ROUND(SUM(fi.develop_price), 2)  AS develop_total
             FROM film_items fi
             WHERE fi.deleted_at IS NULL AND fi.purchase_date IS NOT NULL
               ${year ? `AND strftime('%Y', fi.purchase_date) = '${String(year)}'` : ''}
             GROUP BY month ORDER BY month DESC LIMIT 24`, []
          );
          break;

        case 'year':
          rows = await allAsync(
            `SELECT strftime('%Y', fi.purchase_date) AS year,
                    COUNT(*) AS item_count,
                    ROUND(SUM(fi.purchase_price), 2) AS purchase_total,
                    ROUND(SUM(fi.develop_price), 2)  AS develop_total
             FROM film_items fi
             WHERE fi.deleted_at IS NULL AND fi.purchase_date IS NOT NULL
             GROUP BY year ORDER BY year DESC`, []
          );
          break;

        case 'film':
          rows = await allAsync(
            `SELECT f.name AS film_name, f.iso AS film_iso,
                    COUNT(fi.id) AS item_count,
                    ROUND(SUM(fi.purchase_price), 2) AS purchase_total,
                    ROUND(SUM(fi.develop_price), 2)  AS develop_total,
                    ROUND(AVG(fi.purchase_price), 2) AS avg_purchase_price
             FROM film_items fi JOIN films f ON fi.film_id = f.id
             WHERE fi.deleted_at IS NULL
               ${year ? `AND strftime('%Y', fi.purchase_date) = '${String(year)}'` : ''}
             GROUP BY f.id ORDER BY purchase_total DESC LIMIT 20`, []
          );
          break;

        case 'vendor':
          rows = await allAsync(
            `SELECT fi.purchase_vendor AS vendor,
                    COUNT(*) AS item_count,
                    ROUND(SUM(fi.purchase_price), 2) AS purchase_total
             FROM film_items fi
             WHERE fi.deleted_at IS NULL AND fi.purchase_vendor IS NOT NULL
               ${year ? `AND strftime('%Y', fi.purchase_date) = '${String(year)}'` : ''}
             GROUP BY vendor ORDER BY purchase_total DESC LIMIT 15`, []
          );
          break;

        case 'lab':
          rows = await allAsync(
            `SELECT fi.develop_lab AS lab,
                    COUNT(*) AS item_count,
                    ROUND(SUM(fi.develop_price), 2) AS develop_total,
                    ROUND(AVG(fi.develop_price), 2) AS avg_develop_price
             FROM film_items fi
             WHERE fi.deleted_at IS NULL AND fi.develop_lab IS NOT NULL
               ${year ? `AND strftime('%Y', fi.develop_date) = '${String(year)}'` : ''}
             GROUP BY lab ORDER BY develop_total DESC LIMIT 15`, []
          );
          break;

        default:
          return sanitizeToolResult(JSON.stringify({ error: 'unknown group_by' }));
      }

      return sanitizeToolResult(JSON.stringify({ group_by, year: year || 'all', count: rows.length, data: rows }));
    },
  },

  equipment_usage_stats: {
    type: 'read',
    schema: {
      type: 'function',
      function: {
        name: 'equipment_usage_stats',
        description: '设备使用频率统计：各相机/镜头拍了多少卷、多少张、评分分布。',
        parameters: {
          type: 'object',
          properties: {
            equipment_type: {
              type: 'string',
              enum: ['camera', 'lens'],
              description: '设备类型',
            },
            year: { type: 'integer', description: '限定年份（可选）' },
          },
          required: ['equipment_type'],
        },
      },
    },
    handler: async ({ equipment_type, year }) => {
      const yearFilter = year ? ` AND strftime('%Y', r.date_loaded) = '${String(year)}'` : '';

      let rows;
      if (equipment_type === 'camera') {
        rows = await allAsync(
          `SELECT r.camera AS name,
                  COUNT(DISTINCT r.id) AS roll_count,
                  COUNT(p.id) AS photo_count,
                  ROUND(AVG(CASE WHEN p.rating > 0 THEN p.rating END), 2) AS avg_rating,
                  MIN(r.date_loaded) AS first_used,
                  MAX(r.date_loaded) AS last_used
           FROM rolls r
           LEFT JOIN photos p ON p.roll_id = r.id
           WHERE r.camera IS NOT NULL${yearFilter}
           GROUP BY r.camera ORDER BY roll_count DESC`, []
        );
      } else {
        rows = await allAsync(
          `SELECT p.lens AS name,
                  COUNT(DISTINCT r.id) AS roll_count,
                  COUNT(p.id) AS photo_count,
                  ROUND(AVG(CASE WHEN p.rating > 0 THEN p.rating END), 2) AS avg_rating,
                  MIN(p.date_taken) AS first_used,
                  MAX(p.date_taken) AS last_used
           FROM photos p
           LEFT JOIN rolls r ON p.roll_id = r.id
           WHERE p.lens IS NOT NULL${yearFilter}
           GROUP BY p.lens ORDER BY photo_count DESC`, []
        );
      }

      return sanitizeToolResult(JSON.stringify({ equipment_type, year: year || 'all', count: rows.length, data: rows }));
    },
  },
};

module.exports = STATS_TOOLS;
