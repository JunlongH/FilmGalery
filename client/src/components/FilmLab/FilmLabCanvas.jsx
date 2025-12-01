import React, { useState, useEffect } from 'react';
import { isRectValid, getPresetRatio } from './utils';

export default function FilmLabCanvas({
  canvasRef,
  origCanvasRef,
  zoom, setZoom,
  pan, setPan,
  isPanning,
  handleWheel,
  handlePanStart,
  isCropping,
  rotation, setRotation,
  onRotateStart,
  onRotateEnd,
  pushToHistory,
  handleCanvasClick,
  isPicking,
  cropRect,
  setCropRect, // New prop
  image, // New prop
  orientation, // New prop
  ratioMode, // New prop
  ratioSwap, // New prop
  compareMode,
  compareSlider,
  setCompareSlider,
  expectedWidth // New prop: expected canvas width when in crop mode
}) {
  const [dragState, setDragState] = useState(null);
  const [localCropRect, setLocalCropRect] = useState(null);
  const [isReady, setIsReady] = useState(false);

  // Poll for canvas size match to ensure overlay sync
  useEffect(() => {
    if (!isCropping) {
      setIsReady(false);
      return;
    }
    
    let rafId;
    const check = () => {
      // If expectedWidth is 0 or invalid, assume ready (fallback)
      if (!expectedWidth) {
         setIsReady(true);
         return;
      }
      if (canvasRef.current && Math.abs(canvasRef.current.width - expectedWidth) < 5) {
        setIsReady(true);
      } else {
        setIsReady(false);
        rafId = requestAnimationFrame(check);
      }
    };
    check();
    
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isCropping, expectedWidth, canvasRef]);

  // Use local rect during drag, otherwise prop rect
  const activeCropRect = localCropRect || cropRect;

  useEffect(() => {
    if (!dragState) return;

    const handleWindowMove = (e) => {
      if (!canvasRef.current || !image) return;
      
      const { startX, startY, startRect, type, handle, startAngle } = dragState;
      const rect = canvasRef.current.getBoundingClientRect();
      
      // Calculate delta in normalized coordinates (0..1)
      const dx = (e.clientX - rect.left) / rect.width - startX;
      const dy = (e.clientY - rect.top) / rect.height - startY;
      
      // Mouse position relative to center of crop box (for rotation)
      const mx = (e.clientX - rect.left) / rect.width;
      const my = (e.clientY - rect.top) / rect.height;

      if (type === 'move') {
        let { x, y, w, h } = startRect;
        x += dx;
        y += dy;
        
        // Clamp to 0..1
        x = Math.max(0, Math.min(1 - w, x));
        y = Math.max(0, Math.min(1 - h, y));
        
        const candidate = { x, y, w, h };
        // Validate
        if (isRectValid(candidate, image.width, image.height, rotation + orientation)) {
           setLocalCropRect(candidate);
        } else {
           // Binary search for closest valid rect
           let valid = startRect;
           let invalid = candidate;
           // Increase iterations for smoother edge collision (10 iterations ~0.1% precision)
           for (let i=0; i<10; i++) {
              const mid = {
                 x: (valid.x + invalid.x) / 2,
                 y: (valid.y + invalid.y) / 2,
                 w: (valid.w + invalid.w) / 2,
                 h: (valid.h + invalid.h) / 2
              };
              if (isRectValid(mid, image.width, image.height, rotation + orientation)) {
                 valid = mid;
              } else {
                 invalid = mid;
              }
           }
           setLocalCropRect(valid);
        }
      } else if (type === 'resize') {
        let { x, y, w, h } = startRect;
        
        // Apply delta based on handle
        // Note: This logic assumes unrotated crop box in normalized space.
        // But the crop box IS unrotated in normalized space (it's axis aligned to the rotated image).
        
        if (handle.includes('e')) w += dx;
        if (handle.includes('w')) { x += dx; w -= dx; }
        if (handle.includes('s')) h += dy;
        if (handle.includes('n')) { y += dy; h -= dy; }
        
        // Min size constraint
        if (w < 0.05) {
           if (handle.includes('w')) x -= (0.05 - w);
           w = 0.05;
        }
        if (h < 0.05) {
           if (handle.includes('n')) y -= (0.05 - h);
           h = 0.05;
        }

        // Aspect Ratio Constraint
        const aspect = getPresetRatio(ratioMode, image, orientation, ratioSwap);
        if (aspect) {
            const rad = ((rotation + orientation) * Math.PI) / 180;
            const sin = Math.abs(Math.sin(rad));
            const cos = Math.abs(Math.cos(rad));
            const rotW = image.width * cos + image.height * sin;
            const rotH = image.width * sin + image.height * cos;
            const boxRatio = rotW / rotH;
            const effectiveAspect = aspect / boxRatio;

            if (handle.includes('e') || handle.includes('w')) {
              h = w / effectiveAspect;
              if (handle.includes('n')) {
                 // If pulling top corner, adjust y to keep bottom fixed?
                 // Actually, if we change h, we need to adjust y if it's a top handle.
                 y = startRect.y + startRect.h - h;
              } else {
                 // Center vertically? No, usually resize anchors opposite side.
                 // If 'e' or 'w' only (side handles), we usually center the growth?
                 // Or if corner, anchor opposite corner.
                 if (!handle.includes('n') && !handle.includes('s')) {
                    // Side handle: center vertically
                    const cy = startRect.y + startRect.h / 2;
                    y = cy - h / 2;
                 }
              }
            } else if (handle.includes('n') || handle.includes('s')) {
              w = h * effectiveAspect;
              if (handle.includes('w')) {
                 x = startRect.x + startRect.w - w;
              } else {
                 if (!handle.includes('e') && !handle.includes('w')) {
                    // Top/Bottom handle: center horizontally
                    const cx = startRect.x + startRect.w / 2;
                    x = cx - w / 2;
                 }
              }
            }
        }

        const candidate = { x, y, w, h };
        if (isRectValid(candidate, image.width, image.height, rotation + orientation)) {
           setLocalCropRect(candidate);
        } else {
           // Binary search
           let valid = startRect;
           let invalid = candidate;
           // Increase iterations for smoother edge collision
           for (let i=0; i<10; i++) {
              const mid = {
                 x: (valid.x + invalid.x) / 2,
                 y: (valid.y + invalid.y) / 2,
                 w: (valid.w + invalid.w) / 2,
                 h: (valid.h + invalid.h) / 2
              };
              if (isRectValid(mid, image.width, image.height, rotation + orientation)) {
                 valid = mid;
              } else {
                 invalid = mid;
              }
           }
           setLocalCropRect(valid);
        }

      } else if (type === 'rotate') {
          const cx = startRect.x + startRect.w / 2;
          const cy = startRect.y + startRect.h / 2;
          const currentAngle = Math.atan2(my - cy, mx - cx);
          const delta = (currentAngle - startAngle) * (180 / Math.PI);
          let next = startRect.rotation + delta; // Wait, startRect doesn't have rotation. startRotation does.
          next = dragState.startRotation + delta;
          next = Math.max(-45, Math.min(45, next));
          if (Math.abs(next) < 1) next = 0;
          
          setRotation(next); // This triggers parent re-render.
          // We also need to update cropRect to preserve physical size?
          // The parent FilmLab.jsx handles this in useEffect when rotation changes?
          // Yes, FilmLab.jsx has a useEffect that updates cropRect when rotation changes.
          // So we don't need to update localCropRect here manually?
          // But if FilmLab re-renders, localCropRect might be stale or conflict?
          // If we are rotating, we are NOT updating localCropRect, we are updating rotation.
          // So localCropRect should be null?
          // Or we should let the parent handle rotation updates entirely.
      }
    };

    const handleWindowUp = () => {
      if (localCropRect) {
        setCropRect(localCropRect);
        pushToHistory();
      }
      if (dragState.type === 'rotate') {
        onRotateEnd && onRotateEnd();
      }
      setDragState(null);
      setLocalCropRect(null);
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  }, [dragState, localCropRect, canvasRef, image, rotation, orientation, ratioMode, ratioSwap, setCropRect, setRotation, pushToHistory, onRotateEnd]);

  const startCropDrag = (e, type, handle) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const startX = (e.clientX - rect.left) / rect.width;
    const startY = (e.clientY - rect.top) / rect.height;
    
    // For rotation start angle
    const cx = activeCropRect.x + activeCropRect.w / 2;
    const cy = activeCropRect.y + activeCropRect.h / 2;
    const startAngle = Math.atan2(startY - cy, startX - cx);

    setDragState({
      type,
      handle,
      startX,
      startY,
      startRect: { ...activeCropRect },
      startRotation: rotation,
      startAngle
    });
    
    if (type !== 'rotate') {
       setLocalCropRect({ ...activeCropRect });
    } else {
       onRotateStart && onRotateStart();
    }
  };

  const handleSplitDrag = (e) => {
    if (compareMode !== 'split') return;
    const wrapper = e.currentTarget.parentElement;
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.min(1, Math.max(0, x / rect.width));
    setCompareSlider(ratio);
  };

  const handleBarMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev) => handleSplitDrag(ev);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div 
      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 20, background: '#000', cursor: isPanning ? 'grabbing' : 'grab', position: 'relative' }}
      onWheel={handleWheel}
      onMouseDown={handlePanStart}
    >
      {/* Zoom Controls */}
      <div 
        style={{ position: 'absolute', bottom: 20, left: 20, display: 'flex', gap: 8, zIndex: 100 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="iv-btn" onClick={() => { setZoom(1); setPan({x:0,y:0}); }}>Fit</button>
        <button className="iv-btn" onClick={() => setZoom(z => Math.max(0.1, z / 1.2))}>-</button>
        <span style={{ background: '#333', padding: '6px 10px', borderRadius: 4, fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="iv-btn" onClick={() => setZoom(z => Math.min(10, z * 1.2))}>+</button>
      </div>

      {/* Sensitive Rotation Slider (Only when cropping) */}
      {isCropping && (
        <div 
          style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 300, zIndex: 100, background: 'rgba(0,0,0,0.6)', padding: '8px 16px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 10 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>-45°</span>
          <input 
            type="range" 
            min={-45} 
            max={45} 
            step={0.1} 
            value={rotation} 
            onChange={e => setRotation(Number(e.target.value))}
            onMouseDown={() => { pushToHistory(); onRotateStart && onRotateStart(); }}
            onMouseUp={() => onRotateEnd && onRotateEnd()}
            style={{ width: '100%', cursor: 'ew-resize' }}
          />
          <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>+45°</span>
          <div style={{ position: 'absolute', top: -25, left: '50%', transform: 'translateX(-50%)', background: '#333', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
            {rotation.toFixed(1)}°
          </div>
        </div>
      )}

      <div style={{ 
        position: 'relative', 
        display: 'inline-block', 
        boxShadow: '0 0 30px rgba(0,0,0,0.8)',
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'center',
        transition: isPanning ? 'none' : 'transform 0.1s ease-out'
      }}>
        {/* Processed Canvas */}
        <canvas 
          ref={canvasRef} 
          onClick={handleCanvasClick}
          style={{ 
            display: 'block', 
            maxWidth: '100%', 
            maxHeight: 'calc(100vh - 40px)', 
            objectFit: 'contain',
            cursor: isPicking ? 'crosshair' : 'default',
            opacity: compareMode === 'original' ? 0 : 1,
          }} 
        />

        {/* Original Canvas for compare */}
        {(compareMode === 'original' || compareMode === 'split') && (
          <div style={{
            pointerEvents: compareMode === 'split' ? 'none' : 'auto',
            position: 'absolute',
            top: 0,
            left: 0,
            width: compareMode === 'split' ? `${compareSlider * 100}%` : '100%',
            height: '100%',
            overflow: 'hidden'
          }}>
            <canvas
              ref={origCanvasRef}
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: 'calc(100vh - 40px)',
                objectFit: 'contain',
              }}
            />
          </div>
        )}

        {/* Split Bar */}
        {compareMode === 'split' && (
          <div
            onMouseDown={handleBarMouseDown}
            style={{
              position: 'absolute',
              top: 0,
              left: `${compareSlider * 100}%`,
              height: '100%',
              width: 3,
              background: 'rgba(255,255,255,0.6)',
              cursor: 'ew-resize',
              boxShadow: '0 0 4px rgba(0,0,0,0.6)'
            }}
          />
        )}
        {isReady && (
          <div 
            className="crop-overlay"
            style={{
              position: 'absolute',
              top: 0, left: 0, width: '100%', height: '100%',
              cursor: 'crosshair'
            }}
            onMouseDown={(e) => startCropDrag(e, 'new', null)}
          >
            {/* Debug readout: current crop and target ratios (temporary) */}
            <div style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.6)', color:'#fff', padding:'4px 6px', borderRadius:4, fontSize:11, pointerEvents:'none' }}>
              <span id="crop-debug" />
            </div>
            
            {/* Darken outside */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${activeCropRect.y * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
            <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${(1 - (activeCropRect.y + activeCropRect.h)) * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
            <div style={{ position: 'absolute', top: `${activeCropRect.y * 100}%`, left: 0, width: `${activeCropRect.x * 100}%`, height: `${activeCropRect.h * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
            <div style={{ position: 'absolute', top: `${activeCropRect.y * 100}%`, right: 0, width: `${(1 - (activeCropRect.x + activeCropRect.w)) * 100}%`, height: `${activeCropRect.h * 100}%`, background: 'rgba(0,0,0,0.5)' }} />

            {/* Crop Box */}
            <div 
              style={{
                position: 'absolute',
                left: `${activeCropRect.x * 100}%`,
                top: `${activeCropRect.y * 100}%`,
                width: `${activeCropRect.w * 100}%`,
                height: `${activeCropRect.h * 100}%`,
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                cursor: 'move'
              }}
              onMouseDown={(e) => startCropDrag(e, 'move', null)}
            >
              {/* Rule-of-thirds guides INSIDE the crop box */}
              <svg
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                <line x1="33.333" y1="0" x2="33.333" y2="100" stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" strokeWidth="0.5" />
                <line x1="66.666" y1="0" x2="66.666" y2="100" stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" strokeWidth="0.5" />
                <line x1="0" y1="33.333" x2="100" y2="33.333" stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" strokeWidth="0.5" />
                <line x1="0" y1="66.666" x2="100" y2="66.666" stroke="rgba(255,255,255,0.5)" strokeDasharray="4 4" strokeWidth="0.5" />
              </svg>

              {/* Handles */}
              {['nw', 'ne', 'sw', 'se'].map(h => (
                <div
                  key={h}
                  onMouseDown={(e) => startCropDrag(e, 'resize', h)}
                  style={{
                    position: 'absolute',
                    width: 10, height: 10,
                    background: '#fff',
                    border: '1px solid #000',
                    top: h.includes('n') ? -5 : undefined,
                    bottom: h.includes('s') ? -5 : undefined,
                    left: h.includes('w') ? -5 : undefined,
                    right: h.includes('e') ? -5 : undefined,
                    cursor: `${h}-resize`
                  }}
                />
              ))}
              {/* Rotation handle: centered above crop box */}
              <div
                onMouseDown={(e) => { onRotateStart && onRotateStart(); startCropDrag(e, 'rotate', null); }}
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -20,
                  transform: 'translateX(-50%)',
                  width: 12,
                  height: 12,
                  borderRadius: 12,
                  background: '#fff',
                  border: '1px solid #000',
                  cursor: 'grab',
                  boxShadow: '0 0 4px rgba(0,0,0,0.4)'
                }}
                title="Drag to rotate"
              />
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: -8,
                  transform: 'translateX(-50%)',
                  width: 2,
                  height: 8,
                  background: 'rgba(255,255,255,0.8)'
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}