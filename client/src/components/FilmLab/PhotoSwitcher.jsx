/**
 * PhotoSwitcher 组件
 * 
 * 在 FilmLab 中显示当前卷的所有照片缩略图
 * 支持照片切换和 "Apply to batch" 功能
 * 
 * 位置: 左侧垂直条（避免与底部缩放控件冲突）
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getPhotos, buildUploadUrl, createBatchRenderLibrary } from '../../api';

// ============================================================================
// 常量
// ============================================================================

const THUMB_SIZE = 48;
const STRIP_WIDTH = 80;

// ============================================================================
// 缩略图组件
// ============================================================================

const PhotoThumb = React.memo(function PhotoThumb({ photo, isActive, onClick, hasPositive, isSelected, showCheckbox }) {
  const thumbUrl = useMemo(() => {
    // 优先使用正片缩略图，然后其他缩略图，最后回退到全尺寸图片
    const thumbPath = photo.positive_thumb_path || 
                      photo.positive_thumb_rel_path ||
                      photo.negative_thumb_path || 
                      photo.thumb_path || 
                      photo.thumb_rel_path;
    if (thumbPath) {
      return buildUploadUrl(`/uploads/${thumbPath}`);
    }
    // 如果没有缩略图，尝试使用正片或底片的全尺寸图片（会更慢但至少能显示）
    const fullPath = photo.positive_rel_path || 
                     photo.full_rel_path || 
                     photo.negative_rel_path || 
                     photo.original_rel_path;
    return fullPath ? buildUploadUrl(`/uploads/${fullPath}`) : null;
  }, [photo]);
  
  return (
    <div
      onClick={onClick}
      style={{
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'pointer',
        border: isActive ? '2px solid #2196F3' : '2px solid transparent',
        background: '#222',
        flexShrink: 0,
        position: 'relative'
      }}
      title={`#${photo.frame_number || photo.id}${hasPositive ? ' ✓' : ''}`}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={`#${photo.frame_number}`}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
          loading="lazy"
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 10
        }}>
          {photo.frame_number || photo.id}
        </div>
      )}
      
      {/* 正片标记 */}
      {hasPositive && !showCheckbox && (
        <div style={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#4CAF50'
        }} />
      )}
      
      {/* 批量选择勾选框 */}
      {showCheckbox && (
        <div
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            width: 14,
            height: 14,
            borderRadius: 3,
            background: isSelected ? '#2196F3' : 'rgba(0,0,0,0.6)',
            border: '1px solid #fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            color: '#fff'
          }}
        >
          {isSelected && '✓'}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// 主组件
// ============================================================================

export default function PhotoSwitcher({
  rollId,
  currentPhotoId,
  onPhotoChange,
  onApplyToBatch,
  currentParams,
  collapsed = false,
  onToggleCollapse
}) {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedForBatch, setSelectedForBatch] = useState([]);
  const [batchMode, setBatchMode] = useState(false);
  const [applying, setApplying] = useState(false);
  const scrollRef = useRef(null);
  
  // 加载照片列表
  useEffect(() => {
    if (!rollId) return;
    
    setLoading(true);
    getPhotos(rollId)
      .then(data => setPhotos(data))
      .catch(err => console.error('Failed to load photos:', err))
      .finally(() => setLoading(false));
  }, [rollId]);
  
  // 当前照片索引
  const currentIndex = useMemo(() => {
    return photos.findIndex(p => p.id === currentPhotoId);
  }, [photos, currentPhotoId]);
  
  // 滚动到当前照片
  useEffect(() => {
    if (scrollRef.current && currentIndex >= 0) {
      const container = scrollRef.current;
      const thumbHeight = THUMB_SIZE + 6;
      const scrollTop = currentIndex * thumbHeight - container.clientHeight / 2 + thumbHeight / 2;
      container.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
    }
  }, [currentIndex]);
  
  // 切换到上一张
  const goPrev = useCallback(() => {
    if (currentIndex > 0 && onPhotoChange) {
      onPhotoChange(photos[currentIndex - 1]);
    }
  }, [currentIndex, photos, onPhotoChange]);
  
  // 切换到下一张
  const goNext = useCallback(() => {
    if (currentIndex < photos.length - 1 && onPhotoChange) {
      onPhotoChange(photos[currentIndex + 1]);
    }
  }, [currentIndex, photos, onPhotoChange]);
  
  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.ctrlKey && e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goPrev, goNext]);
  
  // 切换批量选择
  const toggleBatchSelect = useCallback((photoId) => {
    setSelectedForBatch(prev => {
      if (prev.includes(photoId)) {
        return prev.filter(id => id !== photoId);
      } else {
        return [...prev, photoId];
      }
    });
  }, []);
  
  const thumbClickHandlers = useMemo(() => {
    return photos.map((photo) => () => {
      if (batchMode) {
        toggleBatchSelect(photo.id);
      } else if (onPhotoChange) {
        onPhotoChange(photo);
      }
    });
  }, [photos, batchMode, onPhotoChange, toggleBatchSelect]);
  
  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedForBatch.length === photos.length) {
      setSelectedForBatch([]);
    } else {
      setSelectedForBatch(photos.map(p => p.id));
    }
  };
  
  // 选择无正片的照片
  const selectNoPositive = () => {
    const noPositive = photos.filter(p => !p.positive_rel_path).map(p => p.id);
    setSelectedForBatch(noPositive);
  };
  
  // 应用到批量
  const handleApplyToBatch = async () => {
    if (selectedForBatch.length === 0 || !currentParams) return;
    
    setApplying(true);
    
    try {
      const result = await createBatchRenderLibrary({
        rollId,
        scope: 'selected',
        photoIds: selectedForBatch,
        paramsSource: {
          type: 'custom',
          params: currentParams
        },
        format: 'jpeg',
        quality: 95
      });
      
      if (result.jobId) {
        if (onApplyToBatch) {
          onApplyToBatch(result.jobId, selectedForBatch.length);
        }
        setSelectedForBatch([]);
        setBatchMode(false);
      } else {
        alert('启动批量应用失败: ' + (result.error || '未知错误'));
      }
    } catch (e) {
      console.error('Apply to batch failed:', e);
      alert('批量应用失败: ' + e.message);
    } finally {
      setApplying(false);
    }
  };
  
  // 收起状态 - 显示小按钮
  if (collapsed) {
    return (
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 10,
          background: 'rgba(0,0,0,0.8)',
          borderRadius: 4,
          padding: '6px 10px',
          cursor: 'pointer',
          color: '#fff',
          fontSize: 11,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          zIndex: 100
        }}
        onClick={onToggleCollapse}
        title="展开照片列表"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="21" x2="9" y2="9"/>
        </svg>
        <span>{currentIndex + 1}/{photos.length}</span>
      </div>
    );
  }
  
  // 展开状态 - 左侧垂直条
  return (
    <div style={{
      position: 'absolute',
      top: 60,
      left: 0,
      bottom: 60,
      width: STRIP_WIDTH,
      background: 'rgba(0,0,0,0.85)',
      borderRight: '1px solid #333',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 100
    }}>
      {/* 头部 */}
      <div style={{
        padding: 6,
        borderBottom: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4
      }}>
        {/* 导航 */}
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={goPrev}
            disabled={currentIndex <= 0}
            style={{
              background: '#333',
              border: 'none',
              borderRadius: 3,
              color: currentIndex > 0 ? '#fff' : '#555',
              cursor: currentIndex > 0 ? 'pointer' : 'default',
              width: 22,
              height: 22,
              fontSize: 10
            }}
            title="上一张 (Ctrl+↑)"
          >
            ▲
          </button>
          <button
            onClick={goNext}
            disabled={currentIndex >= photos.length - 1}
            style={{
              background: '#333',
              border: 'none',
              borderRadius: 3,
              color: currentIndex < photos.length - 1 ? '#fff' : '#555',
              cursor: currentIndex < photos.length - 1 ? 'pointer' : 'default',
              width: 22,
              height: 22,
              fontSize: 10
            }}
            title="下一张 (Ctrl+↓)"
          >
            ▼
          </button>
        </div>
        
        {/* 计数 */}
        <span style={{ color: '#888', fontSize: 10 }}>
          {currentIndex + 1}/{photos.length}
        </span>
        
        {/* 收起按钮 */}
        <button
          onClick={onToggleCollapse}
          style={{
            background: 'none',
            border: 'none',
            color: '#666',
            cursor: 'pointer',
            fontSize: 10,
            padding: 2
          }}
          title="收起"
        >
          ◀
        </button>
      </div>
      
      {/* 照片列表 */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '6px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6
        }}
      >
        {loading ? (
          <div style={{ color: '#888', fontSize: 10, textAlign: 'center', padding: 10 }}>
            ...
          </div>
        ) : photos.map((photo, index) => (
          <PhotoThumb
            key={photo.id}
            photo={photo}
            isActive={photo.id === currentPhotoId}
            hasPositive={!!photo.positive_rel_path}
            isSelected={selectedForBatch.includes(photo.id)}
            showCheckbox={batchMode}
            onClick={thumbClickHandlers[index]}
          />
        ))}
      </div>
      
      {/* 底部工具栏 */}
      <div style={{
        padding: 6,
        borderTop: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4
      }}>
        {batchMode ? (
          <>
            <div style={{ display: 'flex', gap: 2 }}>
              <button
                onClick={toggleSelectAll}
                style={{
                  background: '#333',
                  border: 'none',
                  borderRadius: 3,
                  padding: '3px 6px',
                  color: '#fff',
                  fontSize: 9,
                  cursor: 'pointer'
                }}
                title={selectedForBatch.length === photos.length ? '取消全选' : '全选'}
              >
                All
              </button>
              <button
                onClick={selectNoPositive}
                style={{
                  background: '#333',
                  border: 'none',
                  borderRadius: 3,
                  padding: '3px 6px',
                  color: '#fff',
                  fontSize: 9,
                  cursor: 'pointer'
                }}
                title="仅选择无正片"
              >
                New
              </button>
            </div>
            <span style={{ color: '#888', fontSize: 9 }}>
              {selectedForBatch.length} 选中
            </span>
            <button
              onClick={handleApplyToBatch}
              disabled={selectedForBatch.length === 0 || applying}
              style={{
                background: selectedForBatch.length > 0 ? '#4CAF50' : '#333',
                border: 'none',
                borderRadius: 3,
                padding: '4px 8px',
                color: '#fff',
                fontSize: 9,
                cursor: selectedForBatch.length > 0 ? 'pointer' : 'default',
                width: '100%'
              }}
            >
              {applying ? '...' : '应用'}
            </button>
            <button
              onClick={() => { setBatchMode(false); setSelectedForBatch([]); }}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: 9,
                cursor: 'pointer'
              }}
            >
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setBatchMode(true)}
            style={{
              background: '#333',
              border: 'none',
              borderRadius: 3,
              padding: '4px 8px',
              color: '#fff',
              fontSize: 9,
              cursor: 'pointer',
              width: '100%'
            }}
            title="批量应用当前参数"
          >
            批量
          </button>
        )}
      </div>
    </div>
  );
}
