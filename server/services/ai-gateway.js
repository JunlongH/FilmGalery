/**
 * AI Gateway — OpenAI 兼容 API 适配器
 * 
 * 支持所有 OpenAI 兼容端点：
 *   OpenAI / Azure OpenAI / DeepSeek / Ollama / Together / Groq / vLLM
 * 
 * 懒加载：仅在首次使用时创建 OpenAI 客户端，配置变更时自动重建。
 */
const { OpenAI } = require('openai');
const { getAIConfig } = require('./ai-config');

// 当前客户端实例及其配置指纹（用于检测配置变更）
let _client = null;
let _clientHash = null;

/**
 * 计算配置指纹（用于检测 api_base_url / api_key 变更）
 */
function configHash(cfg) {
  return `${cfg.api_base_url}|${cfg.api_key || ''}`;
}

// 临时覆盖配置（用于单次请求级别的模型独立 API 配置）
let _tempOverride = null;

/**
 * 设置临时覆盖配置（单次请求后应调用 clearTemporaryOverride 清除）
 */
function setTemporaryOverride(override) {
  _tempOverride = override;
}

/**
 * 清除临时覆盖配置
 */
function clearTemporaryOverride() {
  _tempOverride = null;
}

/**
 * 获取（或重建）OpenAI 客户端
 */
async function getClient() {
  const cfg = await getAIConfig();

  // 临时覆盖时创建独立客户端（不缓存）
  if (_tempOverride && (_tempOverride.api_base_url || _tempOverride.api_key)) {
    const tmpClient = new OpenAI({
      apiKey:  _tempOverride.api_key || cfg.api_key || 'no-key',
      baseURL: _tempOverride.api_base_url || cfg.api_base_url,
      timeout: 120_000,
      maxRetries: 1,
    });
    return { client: tmpClient, cfg };
  }

  const hash = configHash(cfg);

  if (!_client || _clientHash !== hash) {
    _client = new OpenAI({
      apiKey:  cfg.api_key || 'no-key',
      baseURL: cfg.api_base_url,
      timeout: 120_000,
      maxRetries: 1,
    });
    _clientHash = hash;
  }
  return { client: _client, cfg };
}

/**
 * 非流式对话补全（用于工具调用循环阶段）
 * 
 * @param {Object} opts
 * @param {Array}  opts.messages
 * @param {Array}  [opts.tools]
 * @param {string} [opts.model]
 * @returns {Promise<Object>} OpenAI ChatCompletion response
 */
async function chatCompletion({ messages, tools, model }) {
  const { client, cfg } = await getClient();
  const params = {
    model: model || cfg.text_model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
  };
  if (tools && tools.length > 0) {
    params.tools = tools;
    params.tool_choice = 'auto';
  }
  return client.chat.completions.create(params);
}

/**
 * 流式对话补全（用于最终回复阶段）
 * 
 * @param {Object} opts
 * @param {Array}  opts.messages
 * @param {string} [opts.model]
 * @returns {AsyncIterable} 流式 chunks
 */
async function* chatCompletionStream({ messages, model }) {
  const { client, cfg } = await getClient();
  const stream = await client.chat.completions.create({
    model: model || cfg.text_model,
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.max_tokens,
    stream: true,
  });
  for await (const chunk of stream) {
    yield chunk;
  }
}

/**
 * 测试连接：发送一条简单消息，返回模型名称
 */
async function testConnection() {
  const { client, cfg } = await getClient();
  const res = await client.chat.completions.create({
    model: cfg.text_model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 5,
  });
  return { ok: true, model: res.model || cfg.text_model };
}

/**
 * 获取可用模型列表（不是所有端点都支持，失败时返回 null）
 */
async function listModels() {
  try {
    const { client } = await getClient();
    const res = await client.models.list();
    return (res.data || []).sort((a, b) => (a.id > b.id ? 1 : -1));
  } catch {
    return null;
  }
}

module.exports = { chatCompletion, chatCompletionStream, testConnection, listModels, setTemporaryOverride, clearTemporaryOverride };
