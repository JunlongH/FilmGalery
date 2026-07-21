/**
 * 分离色调面板组件
 * 
 * @component SplitToningPanel
 * @description 高光/阴影分区着色调整界面
 */

import React, { useState, useMemo, useCallback } from 'react';
import { 
  DEFAULT_SPLIT_TONE_PARAMS, 
  SPLIT_TONE_PRESETS 
} from '@filmgallery/shared';

/**
 * 色相选择器 - 圆形色轮
 */
const HueWheel = React.memo(function HueWheel({ hue, onChange, size = 60 }) {
  const handleClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const x = e.clientX - rect.left - cx;
    const y = e.clientY - rect.top - cy;
    let angle = Math.atan2(y, x) * (180 / Math.PI) + 90;
    if (angle < 0) angle += 360;
    onChange(Math.round(angle));
  };
  
  // 色相指示器位置
  const rad = ((hue - 90) * Math.PI) / 180;
  const r = size / 2 - 6;
  const indicatorX = size / 2 + Math.cos(rad) * r;
  const indicatorY = size / 2 + Math.sin(rad) * r;
  
  return (
    <div 
      onClick={handleClick}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `conic-gradient(from 0deg, 
          hsl(0, 100%, 50%), 
          hsl(60, 100%, 50%), 
          hsl(120, 100%, 50%), 
          hsl(180, 100%, 50%), 
          hsl(240, 100%, 50%), 
          hsl(300, 100%, 50%), 
          hsl(360, 100%, 50%)
        )`,
        position: 'relative',
        cursor: 'crosshair',
        boxShadow: 'inset 0 0 0 2px rgba(0,0,0,0.3)',
      }}
    >
      {/* 中心遮罩 */}
      <div style={{
        position: 'absolute',
        top: '25%',
        left: '25%',
        width: '50%',
        height: '50%',
        borderRadius: '50%',
        background: '#1a1a1a',
      }} />
      {/* 色相指示器 */}
      <div style={{
        position: 'absolute',
        left: indicatorX - 4,
        top: indicatorY - 4,
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: `hsl(${hue}, 100%, 50%)`,
        border: '2px solid white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
      }} />
    </div>
  );
});

/**
 * 色相/饱和度控制组
 */
const ToneControl = React.memo(function ToneControl({ 
  label, 
  hue, 
  saturation, 
  onHueChange, 
  onSaturationChange,
  onMouseDown,
  color = '#fff'
}) {
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'flex-start',
      gap: 12,
      padding: '8px 0'
    }}>
      {/* 标签和色轮 */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ 
          fontSize: 11, 
          fontWeight: 600, 
          color,
          marginBottom: 4 
        }}>
          {label}
        </div>
        <HueWheel 
          hue={hue} 
          onChange={onHueChange} 
          size={56} 
        />
      </div>
      
      {/* 滑块区 */}
      <div style={{ flex: 1 }}>
        {/* 色相滑块 */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#888',
            marginBottom: 2
          }}>
            <span>Hue</span>
            <span style={{ fontFamily: 'monospace' }}>{hue}°</span>
          </div>
          <input
            type="range"
            min={0}
            max={360}
            value={hue}
            onChange={(e) => onHueChange(Number(e.target.value))}
            onMouseDown={onMouseDown}
            style={{ 
              width: '100%',
              background: `linear-gradient(to right, 
                hsl(0, 100%, 50%), 
                hsl(60, 100%, 50%), 
                hsl(120, 100%, 50%), 
                hsl(180, 100%, 50%), 
                hsl(240, 100%, 50%), 
                hsl(300, 100%, 50%), 
                hsl(360, 100%, 50%)
              )`,
              height: 8,
              borderRadius: 4,
            }}
          />
        </div>
        
        {/* 饱和度滑块 */}
        <div>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#888',
            marginBottom: 2
          }}>
            <span>Saturation</span>
            <span style={{ fontFamily: 'monospace' }}>{saturation}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={saturation}
            onChange={(e) => onSaturationChange(Number(e.target.value))}
            onMouseDown={onMouseDown}
            style={{ 
              width: '100%',
              background: `linear-gradient(to right, 
                hsl(${hue}, 0%, 50%), 
                hsl(${hue}, 100%, 50%)
              )`,
              height: 8,
              borderRadius: 4,
            }}
          />
        </div>
      </div>
    </div>
  );
});

/**
 * 分离色调面板主组件
 */
export default function SplitToningPanel({
  splitToning,
  setSplitToning,
  pushToHistory,
  collapsed = false
}) {
  const [showPresets, setShowPresets] = useState(false);
  
  // 当前参数
  const params = useMemo(() => ({
    highlights: splitToning?.highlights || DEFAULT_SPLIT_TONE_PARAMS.highlights,
    midtones: splitToning?.midtones || DEFAULT_SPLIT_TONE_PARAMS.midtones,
    shadows: splitToning?.shadows || DEFAULT_SPLIT_TONE_PARAMS.shadows,
    balance: splitToning?.balance ?? DEFAULT_SPLIT_TONE_PARAMS.balance,
  }), [splitToning]);
  
  // 更新参数
  const updateParams = (updates) => {
    setSplitToning(prev => ({
      ...prev,
      ...updates
    }));
  };
  
  // 更新高光参数
  const updateHighlights = (key, value) => {
    updateParams({
      highlights: {
        ...params.highlights,
        [key]: value
      }
    });
  };
  
  // 更新中间调参数
  const updateMidtones = (key, value) => {
    updateParams({
      midtones: {
        ...params.midtones,
        [key]: value
      }
    });
  };
  
  // 更新阴影参数
  const updateShadows = (key, value) => {
    updateParams({
      shadows: {
        ...params.shadows,
        [key]: value
      }
    });
  };
  
  const handleHighlightsHue = useCallback((v) => updateHighlights('hue', v), [updateHighlights]);
  const handleHighlightsSaturation = useCallback((v) => updateHighlights('saturation', v), [updateHighlights]);
  const handleMidtonesHue = useCallback((v) => updateMidtones('hue', v), [updateMidtones]);
  const handleMidtonesSaturation = useCallback((v) => updateMidtones('saturation', v), [updateMidtones]);
  const handleShadowsHue = useCallback((v) => updateShadows('hue', v), [updateShadows]);
  const handleShadowsSaturation = useCallback((v) => updateShadows('saturation', v), [updateShadows]);
  
  // 应用预设
  const applyPreset = (presetKey) => {
    pushToHistory && pushToHistory();
    const preset = SPLIT_TONE_PRESETS[presetKey];
    if (preset) {
      setSplitToning({
        highlights: { ...preset.highlights },
        midtones: preset.midtones ? { ...preset.midtones } : { hue: 0, saturation: 0 },
        shadows: { ...preset.shadows },
        balance: preset.balance,
      });
    }
    setShowPresets(false);
  };
  
  // 重置
  const handleReset = () => {
    pushToHistory && pushToHistory();
    setSplitToning({ ...DEFAULT_SPLIT_TONE_PARAMS });
  };
  
  // 检查是否有修改
  const hasChanges = 
    params.highlights.saturation !== 0 || 
    params.midtones.saturation !== 0 ||
    params.shadows.saturation !== 0;

  if (collapsed) {
    return null;
  }

  return (
    <div style={{ 
      padding: '8px 12px',
      background: '#1a1a1a',
      borderRadius: 4,
      marginBottom: 12
    }}>
      {/* 标题栏 */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 8,
        paddingBottom: 6,
        borderBottom: '1px solid #333'
      }}>
        <span style={{ 
          fontSize: 12, 
          fontWeight: 600, 
          color: '#fff',
          letterSpacing: 0.5
        }}>
          Split Toning
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* 预设按钮 */}
          <button
            className="iv-btn-icon"
            onClick={() => setShowPresets(!showPresets)}
            title="Presets"
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            ★
          </button>
          {/* 重置按钮 */}
          {hasChanges && (
            <button
              className="iv-btn-icon"
              onClick={handleReset}
              title="Reset"
              style={{ fontSize: 10, padding: '2px 6px', color: '#f88' }}
            >
              ↺
            </button>
          )}
        </div>
      </div>
      
      {/* 预设面板 */}
      {showPresets && (
        <div style={{ 
          background: '#252525', 
          padding: 8, 
          borderRadius: 4,
          marginBottom: 8
        }}>
          <div style={{ 
            fontSize: 10, 
            color: '#888', 
            marginBottom: 6 
          }}>
            Select a split toning preset:
          </div>
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: 4 
          }}>
            {Object.entries(SPLIT_TONE_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => applyPreset(key)}
                style={{
                  padding: '4px 8px',
                  background: '#333',
                  border: '1px solid #444',
                  borderRadius: 3,
                  color: '#ccc',
                  fontSize: 10,
                  cursor: 'pointer',
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* 高光控制 */}
      <ToneControl
        label="Highlights"
        hue={params.highlights.hue}
        saturation={params.highlights.saturation}
        onHueChange={handleHighlightsHue}
        onSaturationChange={handleHighlightsSaturation}
        onMouseDown={pushToHistory}
        color="#ffcc00"
      />
      
      {/* 分隔线 */}
      <div style={{ 
        height: 1, 
        background: '#333', 
        margin: '4px 0' 
      }} />
      
      {/* 中间调控制 */}
      <ToneControl
        label="Midtones"
        hue={params.midtones.hue}
        saturation={params.midtones.saturation}
        onHueChange={handleMidtonesHue}
        onSaturationChange={handleMidtonesSaturation}
        onMouseDown={pushToHistory}
        color="#88dd88"
      />
      
      {/* 分隔线 */}
      <div style={{ 
        height: 1, 
        background: '#333', 
        margin: '4px 0' 
      }} />
      
      {/* 阴影控制 */}
      <ToneControl
        label="Shadows"
        hue={params.shadows.hue}
        saturation={params.shadows.saturation}
        onHueChange={handleShadowsHue}
        onSaturationChange={handleShadowsSaturation}
        onMouseDown={pushToHistory}
        color="#6688ff"
      />
      
      {/* 平衡滑块 */}
      <div style={{ 
        marginTop: 8,
        padding: '8px 0',
        borderTop: '1px solid #333'
      }}>
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between',
          fontSize: 10,
          color: '#888',
          marginBottom: 4
        }}>
          <span>Shadows ← Balance → Highlights</span>
          <span style={{ fontFamily: 'monospace' }}>{params.balance}</span>
        </div>
        <input
          type="range"
          min={-100}
          max={100}
          value={params.balance}
          onChange={(e) => updateParams({ balance: Number(e.target.value) })}
          onMouseDown={pushToHistory}
          style={{ 
            width: '100%',
            background: 'linear-gradient(to right, #6688ff, #444 50%, #ffcc00)',
            height: 8,
            borderRadius: 4,
          }}
        />
      </div>
      
      {/* 提示 */}
      <div style={{ 
        fontSize: 9, 
        color: '#666', 
        marginTop: 6,
        lineHeight: 1.4
      }}>
        高光着色影响亮部，阴影着色影响暗部。平衡控制过渡区域。
      </div>
    </div>
  );
}
