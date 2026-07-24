/**
 * AI Tools — 模块化入口
 * 
 * 聚合 8 个域模块的工具定义，统一导出 getToolSchemas / getToolHandler / getToolType / getToolSecurityLevel
 * 
 * 模块结构：
 *   photo-tools.js      — 照片管理（search/detail/neighbors + update/batch/rating/favorite/delete）
 *   roll-tools.js       — 胶卷管理（list/detail + update/cover/preset）
 *   film-tools.js       — 胶片库存（info/items + inventory/purchase）
 *   equipment-tools.js  — 设备管理（search + add/update）
 *   tag-tools.js        — 标签系统（list + create/attach/detach）
 *   shot-log-tools.js   — 拍摄日志（get + update/add_entry）
 *   stats-tools.js      — 数据分析（stats + patterns/cost/equipment_usage）
 *   render-tools.js     — FilmLab 渲染（params + suggest/batch_apply）
 */

const PHOTO_TOOLS     = require('./photo-tools');
const ROLL_TOOLS      = require('./roll-tools');
const FILM_TOOLS      = require('./film-tools');
const EQUIPMENT_TOOLS = require('./equipment-tools');
const TAG_TOOLS       = require('./tag-tools');
const SHOT_LOG_TOOLS  = require('./shot-log-tools');
const STATS_TOOLS     = require('./stats-tools');
const RENDER_TOOLS    = require('./render-tools');
const DIGITAL_TOOLS   = require('./digital-tools');

// ─── 合并所有工具到单一注册表 ───
const TOOLS = {
  ...PHOTO_TOOLS,
  ...ROLL_TOOLS,
  ...FILM_TOOLS,
  ...EQUIPMENT_TOOLS,
  ...TAG_TOOLS,
  ...SHOT_LOG_TOOLS,
  ...STATS_TOOLS,
  ...RENDER_TOOLS,
  ...DIGITAL_TOOLS,
};

const FILM_ONLY_TOOL_KEYS = new Set([
  ...Object.keys(ROLL_TOOLS),
  ...Object.keys(FILM_TOOLS),
  ...Object.keys(SHOT_LOG_TOOLS),
  ...Object.keys(RENDER_TOOLS),
]);

// ─── 导出接口（与旧版 ai-tools.js 完全兼容） ───

function getToolSchemas(mode) {
  const allSchemas = Object.values(TOOLS).map(t => t.schema);
  if (mode === 'digital') {
    return allSchemas.filter(s => !FILM_ONLY_TOOL_KEYS.has(s.function.name));
  }
  return allSchemas;
}

function getToolHandler(name) {
  return TOOLS[name]?.handler;
}

function getToolType(name) {
  return TOOLS[name]?.type || 'read';
}

/**
 * 获取工具安全等级
 * @returns {number} 0=自动执行, 1=需确认, 2=需确认+预览
 */
function getToolSecurityLevel(name) {
  const tool = TOOLS[name];
  if (!tool) return 0;
  if (tool.securityLevel !== undefined) return tool.securityLevel;
  return tool.type === 'read' ? 0 : 1;
}

module.exports = { getToolSchemas, getToolHandler, getToolType, getToolSecurityLevel, TOOLS };
