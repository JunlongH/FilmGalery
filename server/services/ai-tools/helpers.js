/**
 * AI Tools — 共享工具辅助函数
 */

/**
 * 防 Prompt Injection：将工具结果包裹在 XML 标签内
 * 避免恶意数据库内容篡改对话上下文
 */
function sanitizeToolResult(jsonStr) {
  return `<database_result>\n${jsonStr}\n</database_result>`;
}

/**
 * 构建安全的动态 WHERE + 参数数组
 * @param {Array<{condition: string, params: any[]}>} clauses
 * @returns {{ where: string, params: any[] }}
 */
function buildWhere(clauses) {
  const conditions = [];
  const params = [];
  for (const c of clauses) {
    if (c) {
      conditions.push(c.condition);
      params.push(...c.params);
    }
  }
  return {
    where: conditions.length ? ' AND ' + conditions.join(' AND ') : '',
    params,
  };
}

/**
 * 白名单字段校验：只允许指定字段通过
 * @param {Object} input - 输入对象
 * @param {string[]} allowed - 允许的字段名
 * @returns {Object} 过滤后的对象（仅包含 allowed 中的非 undefined 字段）
 */
function pickAllowed(input, allowed) {
  const result = {};
  for (const key of allowed) {
    if (input[key] !== undefined) {
      result[key] = input[key];
    }
  }
  return result;
}

/**
 * 安全构建 UPDATE SET 子句
 * @param {Object} fields - { column: value } 键值对
 * @returns {{ setClause: string, values: any[] }}
 */
function buildUpdateSet(fields) {
  const keys = Object.keys(fields);
  if (keys.length === 0) return { setClause: '', values: [] };
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => fields[k]);
  return { setClause, values };
}

module.exports = { sanitizeToolResult, buildWhere, pickAllowed, buildUpdateSet };
