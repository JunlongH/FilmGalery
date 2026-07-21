/**
 * AutoCropButton Component
 * 
 * 自动边缘检测按钮，集成到 FilmLab 裁剪工具栏
 * 
 * @module client/src/components/FilmLab/AutoCropButton
 */

import React, { useState, useCallback } from 'react';
import { detectEdges } from '../../api';

/**
 * 自动裁剪按钮组件
 * 
 * @param {Object} props
 * @param {number} props.photoId - 照片 ID
 * @param {string} props.sourceType - 源类型 ('original' | 'negative' | 'positive')
 * @param {Function} props.onDetectionResult - 检测结果回调 (result) => void
 * @param {Function} props.pushToHistory - 推送历史记录
 * @param {Object} props.cropRect - 当前裁剪区域
 * @param {number} props.rotation - 当前旋转角度
 * @param {boolean} props.disabled - 是否禁用
 */
const AutoCropButton = React.memo(function AutoCropButton({
  photoId,
  sourceType = 'original',
  onDetectionResult,
  pushToHistory,
  cropRect,
  rotation,
  disabled = false
}) {
  const [isDetecting, setIsDetecting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sensitivity, setSensitivity] = useState(50);
  const [filmFormat, setFilmFormat] = useState('auto');
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  // 检测是否已有手动裁剪
  const hasManualCrop = cropRect && (
    cropRect.x !== 0 || 
    cropRect.y !== 0 || 
    cropRect.w !== 1 || 
    cropRect.h !== 1
  );

  // 执行边缘检测
  const handleDetect = useCallback(async () => {
    if (!photoId || isDetecting) return;

    setIsDetecting(true);
    setError(null);

    try {
      const result = await detectEdges(photoId, {
        sensitivity,
        filmFormat,
        sourceType
      });

      if (result.success && result.result) {
        setLastResult(result.result);
        
        // 如果结果有效，回调给父组件
        if (result.result.isValid) {
          // 检查是否是"无边框"情况
          const isNoBorder = result.result.confidence < 0.2 && 
            result.result.cropRect.w > 0.98 && 
            result.result.cropRect.h > 0.98;
          
          if (isNoBorder) {
            setError('⚠️ No film borders detected. Image appears to be already cropped or has no borders.');
          }
          
          // 推送历史记录，以便可以撤销
          if (pushToHistory) {
            pushToHistory();
          }
          
          if (onDetectionResult) {
            onDetectionResult(result.result);
          }
        } else {
          setError('Low detection confidence, please adjust sensitivity or crop manually');
        }
      } else {
        setError(result.error || 'Edge detection failed');
      }
    } catch (err) {
      setError(err.message || 'Edge detection failed');
    } finally {
      setIsDetecting(false);
    }
  }, [photoId, sensitivity, filmFormat, sourceType, pushToHistory, onDetectionResult, isDetecting]);

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className={`iv-btn ${isDetecting ? 'iv-btn-primary' : ''}`}
          onClick={handleDetect}
          disabled={disabled || isDetecting}
          style={{ 
            flex: 1, 
            padding: '6px 12px', 
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6
          }}
          title="Auto detect edges for cropping"
        >
          {isDetecting ? (
            <>
              <span className="spinner" style={{ width: 12, height: 12 }} />
              Detecting...
            </>
          ) : (
            <>
              🔍 Auto Detect Edges
            </>
          )}
        </button>
        
        <button
          className="iv-btn"
          onClick={() => setShowSettings(!showSettings)}
          style={{ padding: '6px 8px', fontSize: 11 }}
          title="Detection Settings"
        >
          ⚙
        </button>
      </div>

      {/* 警告：已有手动裁剪 */}
      {hasManualCrop && !isDetecting && (
        <div style={{ 
          marginTop: 6, 
          padding: '4px 8px', 
          background: '#4a3520', 
          borderRadius: 4,
          fontSize: 10,
          color: '#ffa500'
        }}>
          ⚠ Manual crop area exists, auto detection will override
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div style={{ 
          marginTop: 6, 
          padding: '4px 8px', 
          background: '#402020', 
          borderRadius: 4,
          fontSize: 10,
          color: '#ff6b6b'
        }}>
          {error}
        </div>
      )}

      {/* 检测结果信息 */}
      {lastResult && lastResult.isValid && !error && (
        <div style={{ 
          marginTop: 6, 
          padding: '4px 8px', 
          background: '#203520', 
          borderRadius: 4,
          fontSize: 10,
          color: '#90ee90'
        }}>
          ✓ Detection complete (Confidence: {(lastResult.confidence * 100).toFixed(0)}%)
          {lastResult.rotation !== 0 && (
            <span style={{ marginLeft: 8 }}>
              Rotation: {lastResult.rotation.toFixed(1)}°
            </span>
          )}
        </div>
      )}

      {/* 设置面板 */}
      {showSettings && (
        <div style={{ 
          marginTop: 8, 
          padding: 8, 
          background: '#252525', 
          borderRadius: 4,
          border: '1px solid #333'
        }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 10, color: '#999', marginBottom: 4 }}>
              Sensitivity: {sensitivity}
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={sensitivity}
              onChange={(e) => setSensitivity(parseInt(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#666' }}>
              <span>Low (Fewer edges)</span>
              <span>High (More edges)</span>
            </div>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 10, color: '#999', marginBottom: 4 }}>
              Film Format
            </label>
            <select
              value={filmFormat}
              onChange={(e) => setFilmFormat(e.target.value)}
              style={{ 
                width: '100%', 
                background: '#333', 
                color: '#eee', 
                border: '1px solid #444', 
                borderRadius: 4,
                padding: '4px 6px',
                fontSize: 11
              }}
            >
              <option value="auto">Auto detect</option>
              <option value="35mm">35mm (3:2)</option>
              <option value="120">120 Medium Format</option>
              <option value="4x5">4x5 Large Format</option>
            </select>
          </div>

          {/* 调试信息 */}
          {lastResult && lastResult.debugInfo && (
            <div style={{ 
              marginTop: 8, 
              padding: 4, 
              background: '#1a1a1a', 
              borderRadius: 2,
              fontSize: 9,
              color: '#666',
              fontFamily: 'monospace'
            }}>
              Processing Time: {lastResult.debugInfo.totalTimeMs}ms<br/>
              Edge Pixels: {lastResult.debugInfo.edgePixelCount}<br/>
              Lines Detected: {lastResult.debugInfo.linesDetected}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default AutoCropButton;
