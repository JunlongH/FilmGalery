import React, { useEffect, useRef, useState, useMemo } from 'react';
import { buildUploadUrl, updatePositiveFromNegative, getSingleDownloadUrl } from '../api';
import FilmLab from './FilmLab/FilmLab';
import ModalDialog from './ModalDialog';
import PhotoDetailsSidebar from './PhotoDetailsSidebar.jsx';
import { useAIPanel } from './AIPanel/AIPanelContext';

export default function ImageViewer({ images = [], index = 0, onClose, onPhotoUpdate, viewMode = 'positive', roll, batchRenderCallback }) {
  const [i, setI] = useState(index);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showInverter, setShowInverter] = useState(false);
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef();
  const [showDetails, setShowDetails] = useState(false);
  const { isOpen: isAIPanelOpen, panelWidth: aiPanelWidth, pushOverlayContext, popOverlayContext, updateOverlayContext } = useAIPanel();
  
  // FilmLab源图像类型选择
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [filmLabSourceType, setFilmLabSourceType] = useState('original'); // 'original' | 'negative' | 'positive'

  // Image Context
  const img = (images && images.length > i) ? images[i] : null;

  // 检查各源类型是否可用 (wrapped in useMemo to avoid dependency issues)
  const availableSources = useMemo(() => {
    if (!img) return { original: false, negative: false, positive: false };
    return {
      original: !!(img.original_rel_path || img.negative_rel_path || img.full_rel_path),
      negative: !!(img.negative_rel_path || img.full_rel_path),
      positive: !!(img.positive_rel_path)
    };
  }, [img]);

  useEffect(() => {
    setI(index);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [index, images]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setScale(s => Math.min(4, +(s + 0.25).toFixed(2)));
      if (e.key === '-') setScale(s => Math.max(0.25, +(s - 0.25).toFixed(2)));
      if (e.key === 'ArrowLeft') setI(k => Math.max(0, k - 1));
      if (e.key === 'ArrowRight') setI(k => Math.min(images.length - 1, k + 1));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images, onClose]);

  // AI 上下文：ImageViewer 打开/关闭时 push/pop
  useEffect(() => {
    if (!img) return;
    pushOverlayContext({
      entityType: 'photo',
      entityId: String(img.id),
      rollId: img.roll_id ? String(img.roll_id) : undefined,
      viewMode: showInverter ? 'filmlab' : 'viewer',
      photoFilename: img.filename || undefined,
    });
    return () => popOverlayContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅挂载/卸载

  // AI 上下文：切换照片时更新
  useEffect(() => {
    if (!img) return;
    updateOverlayContext({
      entityType: 'photo',
      entityId: String(img.id),
      rollId: img.roll_id ? String(img.roll_id) : undefined,
      viewMode: showInverter ? 'filmlab' : 'viewer',
      photoFilename: img.filename || undefined,
    });
  }, [i, img, showInverter, updateOverlayContext]);

  useEffect(() => {
    // reset offset when image index changes
    setOffset({ x: 0, y: 0 });
    setScale(1);
  }, [i]);
  
  // Auto-open FilmLab in Batch Mode
  // Moved up here to avoid conditional hook call (before early return)
  useEffect(() => {
    if (batchRenderCallback && img) {
        // Determine best available source type
        let bestSource = 'original';
        if (availableSources.original) bestSource = 'original';
        else if (availableSources.negative) bestSource = 'negative';
        else if (availableSources.positive) bestSource = 'positive';
        
        setFilmLabSourceType(bestSource);
        setShowInverter(true);
    }
  }, [batchRenderCallback, img, availableSources]);

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY;
    setScale(s => {
      const next = delta > 0 ? s - 0.15 : s + 0.15;
      return Math.min(4, Math.max(0.25, +next.toFixed(2)));
    });
  }

  function startDrag(e) {
    dragging.current = true;
    const p = getClientPos(e);
    lastPos.current = p;
  }

  function onMove(e) {
    if (!dragging.current) return;
    const p = getClientPos(e);
    const dx = p.x - lastPos.current.x;
    const dy = p.y - lastPos.current.y;
    lastPos.current = p;
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  }

  function endDrag() { dragging.current = false; }

  function getClientPos(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function zoomIn() { setScale(s => Math.min(4, +(s + 0.25).toFixed(2))); }
  function zoomOut() { setScale(s => Math.max(0.25, +(s - 0.25).toFixed(2))); }
  function reset() { setScale(1); setOffset({ x: 0, y: 0 }); }

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };
// const img = images[i]; // Moved up for hook dependency
  const showConfirm = (title, message, onConfirm) => {
    setDialog({ 
      isOpen: true, 
      type: 'confirm', 
      title, 
      message, 
      onConfirm: () => {
        onConfirm();
        setDialog(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  if (!images || images.length === 0) return null;
  // img is already defined above for hook dependencies
  let rawCandidate = null;

  // Prefer new positive/negative paths with thumbs; fallback to legacy fields
  if (viewMode === 'negative') {
    if (img.negative_rel_path) rawCandidate = `/uploads/${img.negative_rel_path}`;
    else if (img.full_rel_path) rawCandidate = `/uploads/${img.full_rel_path}`; // legacy fallback
    else if (img.filename) rawCandidate = img.filename; else rawCandidate = img;
  } else {
    // Positive/main view
    if (img.positive_rel_path) rawCandidate = `/uploads/${img.positive_rel_path}`;
    else if (img.full_rel_path) rawCandidate = `/uploads/${img.full_rel_path}`; // legacy fallback
    else if (img.filename) rawCandidate = img.filename; else rawCandidate = img;
  }

  const imgUrl = buildUploadUrl(rawCandidate) + `?t=${Date.now()}`;

  /**
   * 严格源路径选择 - 不允许跨类型回退
   * 
   * 核心原则：
   * 1. positive 模式必须使用 positive_rel_path，无则返回 null
   * 2. negative/original 模式可在同类型内回退
   * 3. 绝不允许 positive 模式加载 negative 文件（这是 bug 根源）
   * 
   * @returns {{ path: string|null, valid: boolean, warning: string|null }}
   */
  const getSourcePathForFilmLab = () => {
    switch (filmLabSourceType) {
      case 'positive':
        // 【严格】正片模式必须有正片文件，不允许回退
        if (img.positive_rel_path) {
          return { path: img.positive_rel_path, valid: true, warning: null };
        }
        // 无正片文件时返回 null，UI 应阻止此操作
        console.warn('[ImageViewer] Positive mode but no positive_rel_path available for photo:', img.id);
        return { 
          path: null, 
          valid: false, 
          warning: '此照片没有正片文件，请先使用负片模式生成正片' 
        };
        
      case 'negative':
        // 负片模式：可回退到 original 或 legacy full_rel_path
        if (img.negative_rel_path) {
          return { path: img.negative_rel_path, valid: true, warning: null };
        }
        if (img.original_rel_path) {
          return { path: img.original_rel_path, valid: true, warning: '使用原始文件作为负片源' };
        }
        if (img.full_rel_path) {
          return { path: img.full_rel_path, valid: true, warning: '使用旧版文件路径' };
        }
        return { path: null, valid: false, warning: '无可用的负片/原始文件' };
        
      case 'original':
      default:
        // 原始模式：可回退到 negative 或 legacy full_rel_path
        if (img.original_rel_path) {
          return { path: img.original_rel_path, valid: true, warning: null };
        }
        if (img.negative_rel_path) {
          return { path: img.negative_rel_path, valid: true, warning: '使用负片文件作为源' };
        }
        if (img.full_rel_path) {
          return { path: img.full_rel_path, valid: true, warning: '使用旧版文件路径' };
        }
        return { path: null, valid: false, warning: '无可用的源文件' };
    }
  };

  // 获取第一个可用的源类型
  const getFirstAvailableSourceType = () => {
    if (availableSources.original) return 'original';
    if (availableSources.negative) return 'negative';
    if (availableSources.positive) return 'positive';
    return 'original'; // fallback
  };

  // 源类型选择器弹窗
  const handleFilmLabClick = () => {
    // 如果只有一种源可用，直接打开FilmLab
    const availableCount = Object.values(availableSources).filter(Boolean).length;
    if (availableCount <= 1) {
      // 【修复】设置正确的源类型，而不是使用默认值
      const sourceType = getFirstAvailableSourceType();
      setFilmLabSourceType(sourceType);
      setShowInverter(true);
      return;
    }
    // 否则显示选择器
    setShowSourceSelector(true);
  };

  const openFilmLabWithSource = (sourceType) => {
    setFilmLabSourceType(sourceType);
    setShowSourceSelector(false);
    setShowInverter(true);
  };

  if (showInverter) {
    // 使用选定的源类型（获取严格匹配的源路径）
    const sourceResult = getSourcePathForFilmLab();
    
    // 如果源类型无效（正片模式但无正片文件），显示警告并阻止
    if (!sourceResult.valid) {
      return (
        <>
          <ModalDialog 
            isOpen={true} 
            type="alert" 
            title="无法打开 FilmLab" 
            message={sourceResult.warning || '所选源类型不可用'}
            onConfirm={() => { setShowInverter(false); }}
          />
        </>
      );
    }

    // 添加时间戳防止缓存问题，并在 photoId 变化时强制重新加载
    const targetUrl = sourceResult.path 
        ? buildUploadUrl(`/uploads/${sourceResult.path}`) + `?t=${Date.now()}&photoId=${img.id}`
        : imgUrl;
    
    // 如果有警告但仍然有效，在控制台记录
    if (sourceResult.warning) {
      console.log('[ImageViewer] Source selection warning:', sourceResult.warning);
    }

    return (
      <>
        <ModalDialog 
          isOpen={dialog.isOpen} 
          type={dialog.type} 
          title={dialog.title} 
          message={dialog.message} 
          onConfirm={dialog.onConfirm}
          onCancel={dialog.onCancel}
        />
        <FilmLab 
          imageUrl={targetUrl}
          rollId={img.roll_id}
          photoId={img.id}
          sourceType={filmLabSourceType}
          onPhotoUpdate={onPhotoUpdate}
          onClose={() => { setShowInverter(false); }} 
          onFinishBatchParams={batchRenderCallback ? (params) => {
              batchRenderCallback(params);
              setShowInverter(false);
              onClose();
          } : null}
          // PhotoSwitcher 相关 props
          photos={images}
          showPhotoSwitcher={images.length > 1}
          onPhotoChange={(newPhoto) => {
            // 切换到新照片
            const newIndex = images.findIndex(p => p.id === newPhoto.id);
            if (newIndex !== -1) {
              setI(newIndex);
            }
          }}
          onSave={(blob) => { 
              // Directly save without confirmation if user clicked Save in FilmLab
              // Or keep confirmation if preferred. User asked to fix "save not working".
              // The issue might be that the confirmation dialog was hidden (fixed in previous step).
              // But let's make sure the logic is sound.
              
              // We need to pass the blob to the update function.
              // The previous code was:
              /*
              showConfirm('Save Positive', 'Overwrite existing positive with this edit?', async () => {
                  try {
                      await updatePositiveFromNegative(img.id, blob);
                      if (onPhotoUpdate) onPhotoUpdate();
                      setShowInverter(false);
                      setIsNegativeMode(false);
                  } catch (e) {
                      console.error(e);
                      showAlert('Error', 'Failed to save positive');
                  }
              });
              */
             
             // Since we fixed the z-index, the confirmation should appear. 
             // However, let's double check if `updatePositiveFromNegative` is correct.
             
              showConfirm('Save Positive', 'Overwrite existing positive with this edit?', async () => {
                  try {
                      const res = await updatePositiveFromNegative(img.id, blob);
                      if (res.error) throw new Error(res.error);
                      if (onPhotoUpdate) onPhotoUpdate();
                      setShowInverter(false);
                  } catch (e) {
                      console.error(e);
                      showAlert('Error', 'Failed to save positive: ' + (e.message || e));
                  }
              });
          }} 
        />
      </>
    );
  }

  const handleDownload = async () => {
    console.log('[DOWNLOAD] Starting download for photo ID:', img.id);
    
    try {
      // 使用统一的下载 API，支持 EXIF 写入
      const downloadUrl = getSingleDownloadUrl(img.id, 'positive', true);
      console.log('[DOWNLOAD] Using unified download URL:', downloadUrl);
      
      const response = await fetch(downloadUrl);
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      const blob = await response.blob();
      console.log('[DOWNLOAD] Received blob size:', blob.size, 'bytes');
      
      const defaultName = img.filename ? img.filename.split('/').pop() : `photo_${img.id}.jpg`;
      
      if (window.__electron) {
        // Electron: 使用系统保存对话框
        const saveRes = await window.__electron.filmLabSaveAs({ blob, defaultName });
        
        if (saveRes && saveRes.error) {
          throw new Error(saveRes.error);
        }
        
        console.log('[DOWNLOAD] ✅ Download with EXIF successful');
      } else {
        // Web: 使用链接下载
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = defaultName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (e) {
      console.error('Download failed', e);
      showAlert('Error', 'Download failed: ' + e.message);
    }
  };

  return (
    <div
      className="iv-overlay"
      style={{ right: isAIPanelOpen ? aiPanelWidth : 0 }}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
      onTouchEnd={endDrag}
      onTouchCancel={endDrag}
      ref={containerRef}
      role="dialog"
      aria-modal="true"
    >
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
      <div className="iv-topbar">
        <div className="iv-title">{img.caption || img.frame_number || `Image ${i+1} / ${images.length}`}</div>
        <div className="iv-controls">
          <button className="iv-btn" onClick={() => setShowDetails(true)} title="Edit Meta">Edit Meta</button>
          <button className="iv-btn" onClick={handleFilmLabClick} title="Film Lab (Invert/Color)">Film Lab</button>
          <button className="iv-btn" onClick={handleDownload} title="Save to Disk">Download</button>
          <button className="iv-btn" onClick={zoomOut}>−</button>
          <button className="iv-btn" onClick={reset}>Reset</button>
          <button className="iv-btn" onClick={zoomIn}>+</button>
          <button className="iv-btn iv-close" onClick={onClose}>Close</button>
        </div>
      </div>
      
      {/* 源图像类型选择器弹窗 */}
      {showSourceSelector && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1100
        }} onClick={() => setShowSourceSelector(false)}>
          <div style={{
            backgroundColor: '#2a2a2a',
            borderRadius: 12,
            padding: '24px 32px',
            minWidth: 320,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
          }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px', color: '#fff', fontSize: 18, fontWeight: 600 }}>选择编辑源</h3>
            <p style={{ margin: '0 0 20px', color: '#999', fontSize: 13 }}>选择要在 Film Lab 中编辑的图像源</p>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Original/Raw */}
              <button
                className="iv-btn"
                onClick={() => openFilmLabWithSource('original')}
                disabled={!availableSources.original && !availableSources.negative}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: '#333',
                  opacity: (!availableSources.original && !availableSources.negative) ? 0.4 : 1
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>🎞️ 原始 (Original)</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {availableSources.original ? '使用原始上传的TIFF/Raw文件' : 
                   availableSources.negative ? '使用负片扫描' : '无可用源'}
                </div>
              </button>
              
              {/* Negative */}
              <button
                className="iv-btn"
                onClick={() => openFilmLabWithSource('negative')}
                disabled={!availableSources.negative}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: '#333',
                  opacity: !availableSources.negative ? 0.4 : 1
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>📷 负片 (Negative)</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {availableSources.negative ? '使用负片扫描进行反相处理' : '无负片文件'}
                </div>
              </button>
              
              {/* Positive */}
              <button
                className="iv-btn"
                onClick={() => openFilmLabWithSource('positive')}
                disabled={!availableSources.positive}
                style={{
                  padding: '12px 16px',
                  textAlign: 'left',
                  background: '#333',
                  opacity: !availableSources.positive ? 0.4 : 1
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, color: '#fff' }}>✨ 正片 (Positive)</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  {availableSources.positive ? '微调已渲染的正片（色调/曲线调整）' : '尚未渲染正片'}
                </div>
              </button>
            </div>
            
            <button
              className="iv-btn"
              onClick={() => setShowSourceSelector(false)}
              style={{ marginTop: 16, width: '100%', padding: '10px', background: '#444' }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div
        className="iv-canvas"
        onWheel={onWheel}
        onMouseDown={startDrag}
        onMouseMove={onMove}
        onTouchStart={startDrag}
        onTouchMove={onMove}
        style={{ cursor: scale > 1 ? 'grab' : 'auto' }}
      >
        <img
          src={imgUrl}
          alt={img.caption || ''}
          className="iv-image"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: dragging.current ? 'none' : 'transform 0.12s ease-out'
          }}
          draggable={false}
        />
      </div>

      <div className="iv-footer">
        <button className="iv-btn" onClick={()=>setI(k => Math.max(0, k - 1))} disabled={i===0}>Prev</button>
        <div className="iv-small">{i+1} / {images.length}</div>
        <button className="iv-btn" onClick={()=>setI(k => Math.min(images.length-1, k + 1))} disabled={i===images.length-1}>Next</button>
      </div>

      {showDetails && (
        <PhotoDetailsSidebar
          key={`photo-details-${img.id}`}
          photo={img}
          roll={roll}
          onClose={() => setShowDetails(false)}
          onSaved={() => { setShowDetails(false); onPhotoUpdate && onPhotoUpdate(); }}
        />
      )}
    </div>
  );
}