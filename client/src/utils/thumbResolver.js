/**
 * Thumbnail URL Resolver
 *
 * Single source of truth for deciding which thumbnail/image path to display
 * on the client side.  Every component that shows a photo thumbnail should
 * import and use these helpers instead of hand‑rolling fallback chains.
 *
 * Priority rules (consistent everywhere):
 *   Positive mode:  positive_thumb_rel_path → thumb_rel_path → positive_rel_path → full_rel_path
 *   Negative mode:  negative_thumb_rel_path → thumb_rel_path → negative_rel_path
 *   Auto mode:      positive_thumb_rel_path → thumb_rel_path → negative_thumb_rel_path
 *                   → positive_rel_path → full_rel_path → negative_rel_path
 *
 * @module utils/thumbResolver
 */

import { buildUploadUrl } from '../api';
import { addCacheKey } from './imageOptimization';

// ── Thumb path (relative, DB value) ────────────────────────────────────────

/**
 * Return the best available *relative* thumb path for a photo object.
 *
 * @param {Object} photo        – Photo record (DB row or API response)
 * @param {'positive'|'negative'|'auto'} [mode='positive']
 * @returns {string|null}
 */
export function resolveThumbPath(photo, mode = 'positive') {
  if (!photo) return null;

  switch (mode) {
    case 'negative':
      return (
        photo.negative_thumb_rel_path ||
        photo.thumb_rel_path ||
        photo.negative_rel_path ||
        photo.full_rel_path ||
        photo.filename ||
        null
      );

    case 'auto':
      return (
        photo.positive_thumb_rel_path ||
        photo.thumb_rel_path ||
        photo.negative_thumb_rel_path ||
        photo.positive_rel_path ||
        photo.full_rel_path ||
        photo.negative_rel_path ||
        photo.filename ||
        null
      );

    case 'positive':
    default:
      return (
        photo.positive_thumb_rel_path ||
        photo.thumb_rel_path ||
        photo.positive_rel_path ||
        photo.full_rel_path ||
        photo.filename ||
        null
      );
  }
}

// ── Full‑size image path ────────────────────────────────────────────────────

/**
 * Return the best available *relative* full‑size image path.
 *
 * @param {Object} photo
 * @param {'positive'|'negative'|'auto'} [mode='positive']
 * @returns {string|null}
 */
export function resolveFullPath(photo, mode = 'positive') {
  if (!photo) return null;

  switch (mode) {
    case 'negative':
      return photo.negative_rel_path || photo.full_rel_path || photo.filename || null;

    case 'auto':
      return (
        photo.positive_rel_path ||
        photo.full_rel_path ||
        photo.negative_rel_path ||
        photo.filename ||
        null
      );

    case 'positive':
    default:
      return photo.positive_rel_path || photo.full_rel_path || photo.filename || null;
  }
}

// ── URL-level helpers（buildUploadUrl + updated_at 缓存键）────────────────
//
// 所有组件应使用这两个函数获得最终 <img src>，而不是自行拼接：
// - 统一 `?v=updated_at` 缓存键（文件未变命中浏览器 immutable 缓存，
//   更新后自动获得新 URL；无 updated_at 时不加参数）
// - 避免手写回退链与 `+ '?v='` 双问号拼接 bug

/**
 * 缩略图最终 URL
 * @param {Object} photo
 * @param {'positive'|'negative'|'auto'} [mode='positive']
 * @returns {string|null}
 */
export function resolveThumbUrl(photo, mode = 'positive') {
  const path = resolveThumbPath(photo, mode);
  if (!path) return null;
  const candidate = path.startsWith('/') || path.startsWith('http') ? path : `/uploads/${path}`;
  return addCacheKey(buildUploadUrl(candidate), photo?.updated_at);
}

/**
 * 全尺寸图最终 URL
 * @param {Object} photo
 * @param {'positive'|'negative'|'auto'} [mode='positive']
 * @returns {string|null}
 */
export function resolveFullUrl(photo, mode = 'positive') {
  const path = resolveFullPath(photo, mode);
  if (!path) return null;
  const candidate = path.startsWith('/') || path.startsWith('http') ? path : `/uploads/${path}`;
  return addCacheKey(buildUploadUrl(candidate), photo?.updated_at);
}
