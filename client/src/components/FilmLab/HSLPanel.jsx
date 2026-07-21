/**
 * HSL 调整面板组件
 * 
 * @component HSLPanel
 * @description 8 色相分区的 HSL (色相/饱和度/明度) 调整界面
 */

import React, { useState, useCallback } from 'react';
import { HSL_CHANNEL_ORDER, DEFAULT_HSL_PARAMS } from '@filmgallery/shared';

// 通道颜色配置 (用于 UI 显示)
const CHANNEL_COLORS = {
  red:     { bg: '#ff4444', text: '#fff' },
  orange:  { bg: '#ff8800', text: '#fff' },
  yellow:  { bg: '#ffdd00', text: '#333' },
  green:   { bg: '#44bb44', text: '#fff' },
  cyan:    { bg: '#00cccc', text: '#fff' },
  blue:    { bg: '#4488ff', text: '#fff' },
  purple:  { bg: '#9944ff', text: '#fff' },
  magenta: { bg: '#ff44aa', text: '#fff' },
};

// 通道名称翻译
const CHANNEL_NAMES = {
  red:     'Red',
  orange:  'Orange',
  yellow:  'Yellow',
  green:   'Green',
  cyan:    'Cyan',
  blue:    'Blue',
  purple:  'Purple',
  magenta: 'Magenta',
};

/**
 * 单通道滑块组
 */
const ChannelSliders = React.memo(function ChannelSliders({ channel, params, onChange, onMouseDown, showLabel = true }) {
  const color = CHANNEL_COLORS[channel];
  const name = CHANNEL_NAMES[channel];
  const channelParams = params?.[channel] || { hue: 0, saturation: 0, luminance: 0 };
  
  const handleChange = (key, value) => {
    onChange(channel, { ...channelParams, [key]: value });
  };
  
  const handleHueChange = useCallback((v) => handleChange('hue', v), [handleChange]);
  const handleSaturationChange = useCallback((v) => handleChange('saturation', v), [handleChange]);
  const handleLuminanceChange = useCallback((v) => handleChange('luminance', v), [handleChange]);
  
  return (
    <div style={{ marginBottom: showLabel ? 8 : 0 }}>
      {/* 通道标签 */}
      {showLabel && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: 8,
          marginBottom: 4,
          padding: '2px 6px',
          background: color.bg,
          borderRadius: 3,
          width: 'fit-content'
        }}>
          <span style={{ 
            fontSize: 11, 
            fontWeight: 600, 
            color: color.text,
            textTransform: 'uppercase',
            letterSpacing: 0.5
          }}>
            {name}
          </span>
        </div>
      )}
      
      {/* 三个滑块 */}
      <div style={{ paddingLeft: showLabel ? 4 : 0 }}>
        <HSLSlider
          label="Hue"
          value={channelParams.hue}
          min={-180}
          max={180}
          onChange={handleHueChange}
          onMouseDown={onMouseDown}
          suffix="°"
        />
        <HSLSlider
          label="Saturation"
          value={channelParams.saturation}
          min={-100}
          max={100}
          onChange={handleSaturationChange}
          onMouseDown={onMouseDown}
        />
        <HSLSlider
          label="Luminance"
          value={channelParams.luminance}
          min={-100}
          max={100}
          onChange={handleLuminanceChange}
          onMouseDown={onMouseDown}
        />
      </div>
    </div>
  );
});

/**
 * 紧凑型 HSL 滑块
 */
const HSLSlider = React.memo(function HSLSlider({ label, value, min, max, onChange, onMouseDown, suffix = '' }) {
  return (
    <div style={{ 
      display: 'flex', 
      alignItems: 'center', 
      gap: 8,
      marginBottom: 4,
      fontSize: 11
    }}>
      <span style={{ width: 48, color: '#aaa' }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onMouseDown={onMouseDown}
        style={{ flex: 1, height: 12 }}
      />
      <span style={{ 
        width: 36, 
        textAlign: 'right', 
        color: '#ccc',
        fontFamily: 'monospace',
        fontSize: 10
      }}>
        {value}{suffix}
      </span>
    </div>
  );
});

/**
 * HSL 调整面板主组件
 */
export default function HSLPanel({ 
  hslParams, 
  setHslParams, 
  pushToHistory,
  collapsed = false 
}) {
  const [expandedChannel, setExpandedChannel] = useState(null);
  const [viewMode, setViewMode] = useState('compact'); // 'compact' | 'expanded' | 'grid'
  
  // 处理通道参数变化
  const handleChannelChange = (channel, newParams) => {
    setHslParams(prev => ({
      ...prev,
      [channel]: newParams
    }));
  };
  
  // 重置所有 HSL 参数
  const handleReset = () => {
    pushToHistory && pushToHistory();
    setHslParams({ ...DEFAULT_HSL_PARAMS });
  };
  
  // 重置单个通道
  const handleResetChannel = (channel) => {
    pushToHistory && pushToHistory();
    setHslParams(prev => ({
      ...prev,
      [channel]: { hue: 0, saturation: 0, luminance: 0 }
    }));
  };
  
  // 检查是否有修改
  const hasChanges = HSL_CHANNEL_ORDER.some(ch => {
    const p = hslParams?.[ch];
    return p && (p.hue !== 0 || p.saturation !== 0 || p.luminance !== 0);
  });

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
          HSL Adjustment
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {/* 视图模式切换 */}
          <button
            className="iv-btn-icon"
            onClick={() => setViewMode(viewMode === 'compact' ? 'expanded' : 'compact')}
            title={viewMode === 'compact' ? 'Expand All' : 'Compact Mode'}
            style={{ fontSize: 10, padding: '2px 6px' }}
          >
            {viewMode === 'compact' ? '⊞' : '⊟'}
          </button>
          {/* 重置按钮 */}
          {hasChanges && (
            <button
              className="iv-btn-icon"
              onClick={handleReset}
              title="Reset All HSL"
              style={{ fontSize: 10, padding: '2px 6px', color: '#f88' }}
            >
              ↺
            </button>
          )}
        </div>
      </div>
      
      {/* 通道网格 (紧凑模式) */}
      {viewMode === 'compact' && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 4,
          marginBottom: 8
        }}>
          {HSL_CHANNEL_ORDER.map(channel => {
            const color = CHANNEL_COLORS[channel];
            const p = hslParams?.[channel] || { hue: 0, saturation: 0, luminance: 0 };
            const isActive = p.hue !== 0 || p.saturation !== 0 || p.luminance !== 0;
            const isExpanded = expandedChannel === channel;
            
            return (
              <button
                key={channel}
                onClick={() => setExpandedChannel(isExpanded ? null : channel)}
                style={{
                  padding: '4px 6px',
                  background: isExpanded ? color.bg : (isActive ? `${color.bg}40` : '#333'),
                  border: `1px solid ${isActive ? color.bg : '#444'}`,
                  borderRadius: 3,
                  color: isExpanded ? color.text : (isActive ? color.bg : '#888'),
                  fontSize: 10,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                {CHANNEL_NAMES[channel]}
              </button>
            );
          })}
        </div>
      )}
      
      {/* 展开的通道编辑器 (紧凑模式下) */}
      {viewMode === 'compact' && expandedChannel && (
        <div style={{ 
          background: '#252525', 
          padding: 8, 
          borderRadius: 4,
          marginBottom: 4
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: 6
          }}>
            <div style={{ 
              padding: '2px 6px',
              background: CHANNEL_COLORS[expandedChannel].bg,
              borderRadius: 3,
            }}>
              <span style={{ 
                fontSize: 11, 
                fontWeight: 600, 
                color: CHANNEL_COLORS[expandedChannel].text,
                textTransform: 'uppercase',
                letterSpacing: 0.5
              }}>
                {CHANNEL_NAMES[expandedChannel]}
              </span>
            </div>
            <button
              className="iv-btn-icon"
              onClick={() => handleResetChannel(expandedChannel)}
              style={{ fontSize: 9, padding: '1px 4px' }}
            >
              ↺
            </button>
          </div>
          <ChannelSliders
            channel={expandedChannel}
            params={hslParams}
            onChange={handleChannelChange}
            onMouseDown={pushToHistory}
            showLabel={false}
          />
        </div>
      )}
      
      {/* 所有通道展开模式 */}
      {viewMode === 'expanded' && (
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {HSL_CHANNEL_ORDER.map(channel => (
            <div key={channel} style={{ 
              background: '#252525', 
              padding: 8, 
              borderRadius: 4,
              marginBottom: 6
            }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center',
                marginBottom: 4
              }}>
                <div style={{ 
                  padding: '2px 6px',
                  background: CHANNEL_COLORS[channel].bg,
                  borderRadius: 3,
                }}>
                  <span style={{ 
                    fontSize: 11, 
                    fontWeight: 600, 
                    color: CHANNEL_COLORS[channel].text,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5
                  }}>
                    {CHANNEL_NAMES[channel]}
                  </span>
                </div>
                <button
                  className="iv-btn-icon"
                  onClick={() => handleResetChannel(channel)}
                  style={{ fontSize: 9, padding: '1px 4px' }}
                >
                  ↺
                </button>
              </div>
              <ChannelSliders
                channel={channel}
                params={hslParams}
                onChange={handleChannelChange}
                onMouseDown={pushToHistory}
                showLabel={false}
              />
            </div>
          ))}
        </div>
      )}
      
      {/* 快速调整提示 */}
      <div style={{ 
        fontSize: 9, 
        color: '#666', 
        marginTop: 6,
        lineHeight: 1.4
      }}>
        点击颜色块展开调整。色相偏移范围 ±180°，饱和度/明度 ±100。
      </div>
    </div>
  );
}
