import React, { useEffect, useRef, useState } from 'react';
import { buildUploadUrl, updatePositiveFromNegative } from '../api';
import FilmLab from './FilmLab/FilmLab';
import ModalDialog from './ModalDialog';
import PhotoDetailsSidebar from './PhotoDetailsSidebar.jsx';

export default function ImageViewer({ images = [], index = 0, onClose, onPhotoUpdate, viewMode = 'positive', roll }) {
  const [i, setI] = useState(index);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showInverter, setShowInverter] = useState(false);
  const [isNegativeMode, setIsNegativeMode] = useState(false);
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const containerRef = useRef();
  const [showDetails, setShowDetails] = useState(false);

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

  useEffect(() => {
    // reset offset when image index changes
    setOffset({ x: 0, y: 0 });
    setScale(1);
  }, [i]);

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
  const img = images[i];
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

  if (showInverter) {
    // For FilmLab, we always want to edit the ORIGINAL source (Negative or Raw Scan), 
    // not the already-processed Positive JPG.
    // Priority: Original (TIFF/Raw) > Negative > Full/Positive
    let sourcePath = img.original_rel_path || img.negative_rel_path;
    
    // Fallback to full path if no separate source exists
    if (!sourcePath) sourcePath = img.full_rel_path || img.positive_rel_path;

    // If explicitly in negative mode, prefer negative path
    if (isNegativeMode && img.negative_rel_path) {
        sourcePath = img.negative_rel_path;
    }

    const targetUrl = sourcePath 
        ? buildUploadUrl(`/uploads/${sourcePath}`) 
        : imgUrl;

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
          onPhotoUpdate={onPhotoUpdate}
          onClose={() => { setShowInverter(false); setIsNegativeMode(false); }} 
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
                      setIsNegativeMode(false);
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
    try {
      const response = await fetch(imgUrl);
      const blob = await response.blob();
      
      if (window.__electron) {
        // Use Electron "Save As" dialog
        const defaultName = img.filename ? img.filename.split('/').pop() : `image_${i+1}.jpg`;
        const res = await window.__electron.filmLabSaveAs({ blob, defaultName });
        if (res && res.error) {
           showAlert('Error', 'Save failed: ' + res.error);
        }
      } else {
        // Fallback for web
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = img.filename ? img.filename.split('/').pop() : `image_${i+1}.jpg`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Download failed', e);
      showAlert('Error', 'Download failed');
    }
  };

  return (
    <div
      className="iv-overlay"
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
          <button className="iv-btn" onClick={() => { setIsNegativeMode(true); setShowInverter(true); }} title="Film Lab (Invert/Color)">Film Lab</button>
          <button className="iv-btn" onClick={handleDownload} title="Save to Disk">Download</button>
          <button className="iv-btn" onClick={zoomOut}>−</button>
          <button className="iv-btn" onClick={reset}>Reset</button>
          <button className="iv-btn" onClick={zoomIn}>+</button>
          <button className="iv-btn iv-close" onClick={onClose}>Close</button>
        </div>
      </div>

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
          photo={img}
          roll={roll}
          onClose={() => setShowDetails(false)}
          onSaved={() => { setShowDetails(false); onPhotoUpdate && onPhotoUpdate(); }}
        />
      )}
    </div>
  );
}