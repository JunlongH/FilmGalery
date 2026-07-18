/**
 * HoverPhotoCard - 悬浮显示信息的照片卡片
 * 
 * 特性:
 * - 1:1 正方形比例，居中裁剪
 * - 悬浮时显示信息和操作按钮
 * - 支持自定义操作按钮（左上、右上）
 * - 底部渐变显示标题和副标题
 */

import React, { useState, useEffect } from 'react';
import { ImageIcon } from 'lucide-react';
import { resolveThumbUrl } from '../../utils/thumbResolver';

/**
 * 获取照片的最佳缩略图 URL（统一走 thumbResolver：回退链 + updated_at 缓存键）
 */
function getPhotoUrl(photo) {
  return resolveThumbUrl(photo, 'auto');
}

/**
 * HoverPhotoCard Component
 * 
 * @param {Object} props
 * @param {string} props.imageUrl - 图片 URL (如果不传 photo 则使用此项)
 * @param {Object} props.photo - 照片对象 (自动解析 URL)
 * @param {string} props.alt - 图片 alt 文本
 * @param {Function} props.onPress - 点击卡片的回调
 * @param {React.ReactNode} props.topLeftAction - 左上角操作按钮
 * @param {React.ReactNode} props.topRightAction - 右上角操作按钮
 * @param {string} props.title - 底部标题
 * @param {string} props.subtitle - 底部副标题
 * @param {Function} props.onSubtitleClick - 副标题点击回调
 * @param {string} props.aspectRatio - 宽高比 (默认 "1/1")
 */
export function HoverPhotoCard({
  imageUrl,
  photo,
  alt = '',
  onPress,
  topLeftAction,
  topRightAction,
  title,
  subtitle,
  onSubtitleClick,
  aspectRatio = '1/1',
}) {
  const [url, setUrl] = useState(imageUrl || null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (photo) {
      setUrl(getPhotoUrl(photo));
    } else if (imageUrl) {
      setUrl(imageUrl);
    }
  }, [photo, imageUrl]);

  return (
    <div
      onClick={onPress}
      className="group cursor-pointer overflow-hidden rounded-lg transition-all duration-200 hover:shadow-lg hover:scale-[1.02] bg-white dark:bg-zinc-800"
    >
      {/* Use padding-bottom trick for reliable aspect ratio */}
      <div className="relative w-full" style={{ paddingBottom: aspectRatio === '1/1' ? '100%' : '75%' }}>
        <div className="absolute inset-0">
          {url ? (
            <img
              src={url}
              alt={alt}
              onLoad={() => setLoaded(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                opacity: loaded ? 1 : 0,
                transition: 'opacity 0.3s ease, transform 0.5s ease',
              }}
              className="group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500">
              <ImageIcon className="w-8 h-8" />
            </div>
          )}
        </div>

        {/* Top Left Action - Visible on hover */}
        {topLeftAction && (
          <div className="absolute top-2 left-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            {topLeftAction}
          </div>
        )}

        {/* Top Right Action - Visible on hover */}
        {topRightAction && (
          <div className="absolute top-2 right-2 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
            {topRightAction}
          </div>
        )}

        {/* Bottom Gradient Overlay - Only visible on hover */}
        {(title || subtitle) && (
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity z-10">
            {title && (
              <div className="text-white text-xs font-semibold truncate mb-1">
                {title}
              </div>
            )}
            {subtitle && (
              <div className="flex items-center gap-2 text-[10px] text-white/80">
                {onSubtitleClick ? (
                  <span
                    className="hover:text-white underline cursor-pointer truncate"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSubtitleClick();
                    }}
                  >
                    {subtitle}
                  </span>
                ) : (
                  <span className="truncate">{subtitle}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * ActionButton - 悬浮操作按钮 (使用原生 button 避免嵌套问题)
 */
export function ActionButton({ icon, onClick, variant = 'default', className = '' }) {
  const baseClass = 'inline-flex items-center justify-center w-8 h-8 rounded-full bg-black/40 backdrop-blur-md text-white transition-colors';
  const hoverClass = variant === 'danger' 
    ? 'hover:bg-danger/80' 
    : 'hover:bg-black/60';
  
  return (
    <button
      type="button"
      className={`${baseClass} ${hoverClass} ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
    >
      {icon}
    </button>
  );
}

export default HoverPhotoCard;
