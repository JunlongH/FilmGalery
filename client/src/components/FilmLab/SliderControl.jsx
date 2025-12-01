import React from 'react';

const SliderControl = ({ label, value, onChange, min, max, step=1, onMouseDown, onMouseUp, suffix='' }) => {
  const handleMinus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.max(min, Number((value - step).toFixed(2))));
  };
  const handlePlus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.min(max, Number((value + step).toFixed(2))));
  };

  return (
    <div className="control-group" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <label className="iv-control-label" style={{ width: 90, flexShrink: 0 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>{value}{suffix}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <button className="iv-btn-icon" onClick={handleMinus}>−</button>
          <input 
            type="range" 
            min={min} 
            max={max} 
            step={step}
            value={value} 
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onTouchStart={onMouseDown}
            onTouchEnd={onMouseUp}
            onChange={e => onChange(Number(e.target.value))} 
            style={{ flex: 1, margin: '0 4px' }}
          />
          <button className="iv-btn-icon" onClick={handlePlus}>+</button>
        </div>
      </div>
    </div>
  );
};

export default SliderControl;
