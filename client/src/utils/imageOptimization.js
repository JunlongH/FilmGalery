/**
 * 图片缓存键工具
 *
 * 为图片 URL 添加基于文件更新时间的缓存键：
 * - 相同文件未修改时命中浏览器 HTTP 缓存（服务端原图为 immutable）
 * - 文件更新后 updated_at 变化，自动获得新 URL
 *
 * @version 2.0.0
 * @date 2026-07-17
 */

/**
 * 为图片 URL 添加基于更新时间的缓存键
 * @param {string} url - 原始图片URL
 * @param {string|Date|number} updatedAt - 文件更新时间
 * @returns {string} 带缓存键的URL
 */
export function addCacheKey(url, updatedAt) {
  if (!url) return '';
  if (!updatedAt) return url;

  const timestamp = updatedAt instanceof Date
    ? updatedAt.getTime()
    : typeof updatedAt === 'string'
      ? new Date(updatedAt).getTime()
      : updatedAt;

  // 如果时间戳无效，返回原URL
  if (!timestamp || isNaN(timestamp)) return url;

  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${timestamp}`;
}

/**
 * 从照片对象生成带缓存键的URL
 * @param {string} url - 原始图片URL
 * @param {Object} photo - 照片对象 (需要有 updated_at 字段)
 * @returns {string} 带缓存键的URL
 */
export function getPhotoUrlWithCache(url, photo) {
  return addCacheKey(url, photo?.updated_at);
}

const imageOptimization = {
  addCacheKey,
  getPhotoUrlWithCache,
};

export default imageOptimization;
