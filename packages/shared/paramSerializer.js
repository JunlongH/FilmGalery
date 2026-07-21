/**
 * 渲染参数稳定序列化模块
 *
 * 用于渲染脏标记/缓存键比较（替代手写键列表的 paramsEqual ——
 * 键列表漏检参数会导致预览冻结）。
 *
 * @module paramSerializer
 */

/**
 * 稳定序列化（对象键排序递归），保证键序无关的相等性。
 * TypedArray（如 3D LUT data）以 构造器名+长度+抽样哈希 表示，避免全量序列化。
 *
 * @param {*} value - 任意可序列化值
 * @returns {string} 稳定字符串表示
 */
function stableSerializeParams(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return '"##nonfinite##"';
    if (value === undefined) return '"##undefined##"';
    if (typeof value === 'function') return '"##function##"';
    return JSON.stringify(value);
  }
  if (ArrayBuffer.isView(value)) {
    let h = 0;
    const step = Math.max(1, Math.floor(value.length / 64));
    for (let i = 0; i < value.length; i += step) {
      h = (h * 31 + Math.round(value[i] * 1e6)) | 0;
    }
    return `"##typed:${value.constructor.name}:${value.length}:${h}##"`;
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableSerializeParams).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableSerializeParams(value[k])).join(',') + '}';
}

/**
 * 渲染参数相等性比较（全字段，键序无关）
 *
 * @param {Object} a - 参数 A
 * @param {Object} b - 参数 B
 * @returns {boolean} 是否相等
 */
function renderParamsEqual(a, b) {
  if (!a || !b) return false;
  return stableSerializeParams(a) === stableSerializeParams(b);
}

module.exports = {
  stableSerializeParams,
  renderParamsEqual,
};
