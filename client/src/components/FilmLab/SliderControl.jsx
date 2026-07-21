import React, { useCallback, useEffect, useRef } from 'react';

// P1-24: 全局共享拖拽状态 — 单一 mouseup/touchend 监听器
// 旧实现每实例注册 window mouseup/touchend，15+ 个 SliderControl = 30+ 全局监听器
// 现在所有实例共享单一监听器，仅 activeDrag 中的回调被调用
const dragState = {
  active: null, // { onUp: Function } | null
};

if (typeof window !== 'undefined') {
  const handleGlobalEnd = () => {
    if (dragState.active) {
      const { onUp } = dragState.active;
      dragState.active = null;
      if (onUp) onUp();
    }
  };
  window.addEventListener('mouseup', handleGlobalEnd);
  window.addEventListener('touchend', handleGlobalEnd);
}

const SliderControl = ({ label, value, onChange, min, max, step=1, onMouseDown, onMouseUp, suffix='', displayFormatter }) => {
  const isDraggingRef = useRef(false);

  const handleMinus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.max(min, Number((value - step).toFixed(2))));
    // Important: Call onMouseUp after the change for +/- button clicks
    onMouseUp && onMouseUp();
  };
  const handlePlus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.min(max, Number((value + step).toFixed(2))));
    // Important: Call onMouseUp after the change for +/- button clicks
    onMouseUp && onMouseUp();
  };

  // Handle mouse down - start tracking
  const handleMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    // P1-24: 注册到全局共享拖拽状态（而非每实例 addEventListener）
    dragState.active = { onUp: onMouseUp };
    onMouseDown && onMouseDown();
  }, [onMouseUp, onMouseDown]);

  // P1-24: 组件卸载时如仍在拖拽，清理全局状态
  useEffect(() => {
    return () => {
      if (isDraggingRef.current && dragState.active) {
        dragState.active = null;
      }
      isDraggingRef.current = false;
    };
  }, []);

  return (
    <div className="control-group" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <label className="iv-control-label" style={{ width: 90, flexShrink: 0 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>{displayFormatter ? displayFormatter(value) : value}{suffix}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <button className="iv-btn-icon" onClick={handleMinus}>−</button>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onMouseDown={handleMouseDown}
            onTouchStart={handleMouseDown}
            onChange={e => onChange(Number(e.target.value))}
            style={{ flex: 1, margin: '0 4px' }}
          />
          <button className="iv-btn-icon" onClick={handlePlus}>+</button>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SliderControl);
