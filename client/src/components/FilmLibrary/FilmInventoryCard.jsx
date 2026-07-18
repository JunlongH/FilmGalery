/**
 * FilmInventoryCard - 胶片库存卡片
 * 
 * 严格还原原来的设计风格 (Reference: old_FilmInventory.css)
 * - 核心: White background, Slate text, Clean separators
 * - 布局: 1:1 (Default) -> 2:1 (Expanded)
 * - Metadata: Name above Status in overlay
 */

import React from 'react';
// HeroUI components removed - using native elements for grid layout
import { 
  Camera, 
  Disc3, 
  Package, 
  FlaskConical, 
  Archive,
  Edit,
  Trash2,
  Eye,
  CheckCircle2,
  Film,
  BookOpen
} from 'lucide-react';
import { buildUploadUrl } from '../../api';
import useIsDarkMode from '../../hooks/useIsDarkMode';

// 状态和颜色配置
const STATUS_CONFIG = {
  in_stock: { label: 'In Stock', icon: Package, color: 'success' },
  loaded: { label: 'Loaded', icon: Camera, color: 'primary' },
  shot: { label: 'Shot', icon: Disc3, color: 'warning' },
  sent_to_lab: { label: 'At Lab', icon: FlaskConical, color: 'secondary' },
  developed: { label: 'Developed', icon: CheckCircle2, color: 'cyan' },
  archived: { label: 'Archived', icon: Archive, color: 'default' }
};

const getFilmThumbUrl = (film) => {
  if (!film) return null;
  const path = film.thumbPath || film.thumbnail_url;
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return buildUploadUrl(path.startsWith('/') ? path : `/uploads/films/${path}`);
};

// formatMoney removed - not used in card display

export default function FilmInventoryCard({
  item,
  film,
  isExpanded = false,
  onToggleExpand,
  onLoad,
  onUnload,
  onLogShots,
  onDevelop,
  onCreateRoll,
  onArchive,
  onEdit,
  onDelete,
  onViewRoll
}) {
  const status = STATUS_CONFIG[item.status] || STATUS_CONFIG.in_stock;
  const StatusIcon = status.icon;
  const thumbUrl = getFilmThumbUrl(film);
  const isExpired = item.expiry_date && new Date(item.expiry_date) < new Date();
  
  const filmName = film?.name || 'Unknown Film';
  const format = film?.format || '135';

  // Detect theme for action panel
  const isDark = useIsDarkMode();

  // 状态显示逻辑
  const statusLabel = item.status === 'loaded' && item.loaded_camera
    ? `Loaded on ${item.loaded_camera}`
    : status.label;

  const handleButtonClick = (e) => {
    e?.stopPropagation?.();
  };

  // 生成当前状态可用的动作按钮列表
  const getActionButtons = () => {
    const actions = [];

    // 1. Primary Actions based on status
    if (item.status === 'in_stock') {
      actions.push({
        label: 'Load',
        icon: Camera,
        color: 'primary',
        onClick: () => onLoad?.(item.id)
      });
    } else if (item.status === 'loaded') {
      actions.push({
        label: 'Log Shots',
        icon: BookOpen,
        color: 'secondary',
        onClick: () => onLogShots?.(item.id)
      });
      actions.push({
        label: 'Unload',
        icon: Disc3, // Logically "eject" or complete
        color: 'warning',
        onClick: () => onUnload?.(item.id)
      });
    } else if (item.status === 'shot') {
      actions.push({
        label: 'Develop',
        icon: FlaskConical,
        color: 'primary',
        onClick: () => onDevelop?.(item.id)
      });
    } else if (item.status === 'sent_to_lab') {
      actions.push({
        label: 'Create Roll',
        icon: CheckCircle2,
        color: 'success',
        onClick: () => onCreateRoll?.(item)
      });
    } else if ((item.status === 'developed' || item.status === 'archived') && item.roll_id) {
      actions.push({
        label: 'View Roll',
        icon: Eye,
        color: 'primary',
        onClick: () => onViewRoll?.(item.roll_id)
      });
      
      if (item.status === 'developed') {
        actions.push({
          label: 'Archive',
          icon: Archive,
          color: 'default',
          onClick: () => onArchive?.(item)
        });
      }
    }

    // 2. Always available: Edit
    actions.push({
      label: 'Edit',
      icon: Edit,
      color: 'default', // neutral
      variant: 'flat',
      onClick: () => onEdit?.(item)
    });

    // 3. Delete (only if no roll)
    if (!item.roll_id) {
      actions.push({
        label: 'Delete',
        icon: Trash2,
        color: 'danger',
        variant: 'flat',
        onClick: () => onDelete?.(item.id)
      });
    }

    return actions;
  };

  const actionButtons = getActionButtons();

  return (
    <div
      className="group relative overflow-hidden rounded-xl cursor-pointer bg-black shadow-sm hover:shadow-lg"
      style={{ 
        aspectRatio: isExpanded ? '2/1' : '1/1',
        width: '100%',
        height: '100%',
        transition: 'box-shadow 0.2s ease'
      }}
      onClick={() => onToggleExpand?.()}
    >
      {/* 内部容器 - 使用 flex 实现左右布局 */}
      <div 
        style={{
          display: 'flex',
          width: '100%',
          height: '100%',
        }}
      >
        {/* Left Side: Thumbnail & Overlay */}
        <div 
          style={{
            position: 'relative',
            width: isExpanded ? '50%' : '100%',
            height: '100%',
            flexShrink: 0,
            transition: 'width 0.3s ease-out'
          }}
        >
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={filmName}
              className={`w-full h-full object-cover ${!isExpanded && 'group-hover:scale-105'}`}
              style={{ transition: 'transform 0.5s ease' }}
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
              <Film size={isExpanded ? 64 : 40} className="text-zinc-600" />
            </div>
          )}
          
          {/* Expiry - Top Right */}
          {item.expiry_date && (
            <div className={`
              absolute top-2 right-2 px-2 py-1 rounded text-[10px] font-bold tracking-wide
              backdrop-blur-md shadow-sm border border-white/10
              ${isExpired ? 'bg-red-500/80 text-white' : 'bg-black/40 text-white/90'}
            `}>
              EXP {item.expiry_date}
            </div>
          )}
          
          {/* Bottom Overlay */}
          <div className="absolute inset-x-0 bottom-0 min-h-[80px] flex flex-col justify-end p-4 bg-gradient-to-t from-black via-black/70 to-transparent">
            {/* Name */}
            <div className={`text-white font-bold leading-tight dropshadow-md mb-2 truncate ${isExpanded ? 'text-xl' : 'text-lg'}`}>
              {filmName}
              {format !== '135' && <span className="text-xs opacity-60 ml-1 font-normal align-middle">({format})</span>}
            </div>

            {/* Status */}
            <div className="flex items-center">
              <div className={`
                inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full 
                text-[11px] font-medium tracking-wide backdrop-blur-md
                ${status.color === 'success' ? 'bg-green-500/20 text-green-300' : ''}
                ${status.color === 'primary' ? 'bg-blue-500/20 text-blue-300' : ''}
                ${status.color === 'warning' ? 'bg-yellow-500/20 text-yellow-300' : ''}
                ${status.color === 'secondary' ? 'bg-purple-500/20 text-purple-300' : ''}
                ${status.color === 'cyan' ? 'bg-cyan-500/20 text-cyan-300' : ''}
                ${status.color === 'default' ? 'bg-zinc-500/30 text-zinc-300' : ''}
              `}>
                <StatusIcon size={12} strokeWidth={2.5} />
                <span>{statusLabel}</span>
              </div>
            </div>
          </div>
        </div>
        
        {/* Right Side: Action Buttons - 2x2 Grid */}
        <div 
          style={{
            width: isExpanded ? '50%' : '0%',
            height: '100%',
            background: isDark ? '#18181b' : '#f4f4f5',
            borderLeft: isExpanded ? `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)'}` : 'none',
            overflow: 'hidden',
            flexShrink: 0,
            opacity: isExpanded ? 1 : 0,
            transition: 'width 0.3s ease-out, opacity 0.2s ease-out'
          }}
          onClick={handleButtonClick}
        >
          <div 
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr',
              width: '100%',
              height: '100%',
              gap: '8px',
              padding: '8px'
            }}
          >
            {actionButtons.slice(0, 4).map((action, idx) => (
              <button
                key={idx}
                onClick={action.onClick}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  height: '100%',
                  background: '#27272a',
                  border: '1px solid rgba(255,255,255,0.05)',
                  borderRadius: '12px',
                  cursor: 'pointer',
                  transition: 'background 0.15s, transform 0.1s',
                  gridColumn: idx === 2 && actionButtons.length === 3 ? 'span 2' : 'auto'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#3f3f46';
                  e.currentTarget.style.transform = 'scale(1.02)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#27272a';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
              >
                <action.icon 
                  size={28} 
                  strokeWidth={1.5} 
                  color={action.color === 'danger' ? '#f87171' : action.color === 'primary' ? '#60a5fa' : action.color === 'success' ? '#4ade80' : action.color === 'warning' ? '#facc15' : '#a1a1aa'} 
                />
                <span style={{
                  fontSize: '13px',
                  fontWeight: 500,
                  color: action.color === 'danger' ? '#f87171' : action.color === 'primary' ? '#60a5fa' : action.color === 'success' ? '#4ade80' : action.color === 'warning' ? '#facc15' : '#a1a1aa'
                }}>
                  {action.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// 辅助组件不再需要 DetailRow

