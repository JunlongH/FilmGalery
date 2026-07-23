/**
 * AI 配置管理服务
 * 
 * 读写 ai_config 表（单行，id=1）
 * 环境变量可覆盖数据库配置（适用于 Docker 部署）
 */
const { getAsync, runAsync } = require('../utils/db-helpers');
const { encryptApiKey, decryptApiKey, isEncryptionAvailable } = require('./ai-keystore');

// 允许更新的字段白名单
const ALLOWED_FIELDS = [
  'api_base_url', 'api_key', 'text_model', 'vision_model',
  'temperature', 'max_tokens', 'monthly_budget_usd', 'monthly_tokens_used',
  'budget_reset_at',
  'allow_image_analysis', 'image_max_resolution', 'confirm_before_write',
  'max_tool_calls_per_request', 'engine',
];

/**
 * 获取当前 AI 配置。环境变量优先级高于数据库值。
 * @returns {Object}
 */
async function getAIConfig() {
  const row = await getAsync('SELECT * FROM ai_config WHERE id = 1');
  const cfg = row || {};

  // 解密 DB 中的 API key（若加密存储）
  if (cfg.api_key) {
    cfg.api_key = decryptApiKey(cfg.api_key);
  }

  // 环境变量覆盖（适用于 NAS/Docker 部署时通过 compose 注入）
  if (process.env.AI_API_BASE_URL) cfg.api_base_url = process.env.AI_API_BASE_URL;
  if (process.env.AI_API_KEY)      cfg.api_key      = process.env.AI_API_KEY;
  if (process.env.AI_TEXT_MODEL)   cfg.text_model   = process.env.AI_TEXT_MODEL;
  if (process.env.AI_VISION_MODEL) cfg.vision_model = process.env.AI_VISION_MODEL;

  // 默认值兜底
  cfg.api_base_url             = cfg.api_base_url             || 'https://api.openai.com/v1';
  cfg.text_model               = cfg.text_model               || 'gpt-4o-mini';
  cfg.vision_model             = cfg.vision_model             || 'gpt-4o';
  cfg.temperature              = cfg.temperature              ?? 0.7;
  cfg.max_tokens               = cfg.max_tokens               || 2048;
  cfg.monthly_budget_usd       = cfg.monthly_budget_usd       ?? 10.0;
  cfg.monthly_tokens_used      = cfg.monthly_tokens_used      || 0;
  cfg.allow_image_analysis     = cfg.allow_image_analysis     ?? 1;
  cfg.image_max_resolution     = cfg.image_max_resolution     || 'medium';
  cfg.confirm_before_write     = cfg.confirm_before_write     ?? 1;
  cfg.max_tool_calls_per_request = cfg.max_tool_calls_per_request || 15;
  cfg.engine                   = cfg.engine                   || 'legacy';

  return cfg;
}

/**
 * 更新 AI 配置（仅白名单字段）
 * @param {Object} patch
 */
async function updateAIConfig(patch) {
  const fields = Object.keys(patch).filter(k => ALLOWED_FIELDS.includes(k));
  if (fields.length === 0) return;

  // API key 特殊处理：safeStorage 可用时加密存储
  const values = fields.map(f => {
    if (f === 'api_key' && patch[f]) {
      return isEncryptionAvailable() ? encryptApiKey(patch[f]) : patch[f];
    }
    return patch[f];
  });
  const sets   = fields.map(f => `${f} = ?`).join(', ');
  values.push(new Date().toISOString()); // updated_at

  await runAsync(
    `UPDATE ai_config SET ${sets}, updated_at = ? WHERE id = 1`,
    values
  );
}

/**
 * AI 是否可用：api_key 已设置且未被环境变量完全禁用
 */
async function isAIAvailable() {
  if (process.env.AI_ENABLED === '0' || process.env.AI_ENABLED === 'false') return false;
  const cfg = await getAIConfig();
  return !!(cfg.api_key && cfg.api_key.trim());
}

/**
 * 检查是否超出月度预算。返回 { ok, reason, used, budget }。
 * monthly_budget_usd 为 0 表示不限制。
 */
async function checkBudget() {
  const cfg = await getAIConfig();
  const budget = cfg.monthly_budget_usd ?? 0;
  const used = cfg.monthly_tokens_used || 0;

  // 预算为 0 = 不限制
  if (budget <= 0) return { ok: true, used, budget: 0 };

  // 估算 token 上限（粗略：$10 ≈ 2M tokens for gpt-4o-mini 价格档）
  // 这里用保守估算 200K tokens/USD
  const tokenLimit = Math.floor(budget * 200000);
  if (used >= tokenLimit) {
    return { ok: false, reason: `已超出月度预算 ($${budget}). 已用约 ${used} tokens, 上限 ${tokenLimit}.`, used, budget };
  }
  return { ok: true, used, budget, tokenLimit };
}

module.exports = { getAIConfig, updateAIConfig, isAIAvailable, checkBudget };
