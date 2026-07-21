import React from 'react';
import SliderControl from './SliderControl';
import ToneCurveEditor from './ToneCurveEditor';
import HSLPanel from './HSLPanel';
import SplitToningPanel from './SplitToningPanel';
import LutSelectorModal from './LutSelectorModal';
import AutoCropButton from './AutoCropButton';
import { createFilmCurveProfile, updateFilmCurveProfile, deleteFilmCurveProfile } from '../../api';

// Film Curve Profile Selector Component
function FilmCurveProfileSelector({ 
  filmCurveProfile, 
  setFilmCurveProfile, 
  filmCurveProfiles, 
  setFilmCurveProfiles,
  pushToHistory 
}) {
  const [showEditor, setShowEditor] = React.useState(false);
  const [editingProfile, setEditingProfile] = React.useState(null);
  const [newName, setNewName] = React.useState('');
  const [newGamma, setNewGamma] = React.useState(1.0);
  const [newDMin, setNewDMin] = React.useState(0.1);
  const [newDMax, setNewDMax] = React.useState(2.4);

  // Group profiles by category
  const groupedProfiles = React.useMemo(() => {
    const groups = {};
    (filmCurveProfiles || []).forEach(p => {
      const cat = p.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(p);
    });
    return groups;
  }, [filmCurveProfiles]);

  const categoryLabels = {
    color_negative: 'Color Negative',
    bw_negative: 'B&W Negative',
    slide: 'Slide',
    custom: 'Custom',
    generic: 'Generic',
    other: 'Other'
  };

  const currentProfile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);

  const handleCreateProfile = async () => {
    if (!newName.trim()) return;
    try {
      const created = await createFilmCurveProfile({
        name: newName.trim(),
        gamma: parseFloat(newGamma) || 1.0,
        dMin: parseFloat(newDMin) || 0.1,
        dMax: parseFloat(newDMax) || 2.4,
        category: 'custom'
      });
      if (created && created.key) {
        setFilmCurveProfiles(prev => [...prev, created]);
        setFilmCurveProfile(created.key);
        setShowEditor(false);
        setNewName('');
        setNewGamma(1.0);
        setNewDMin(0.1);
        setNewDMax(2.4);
      }
    } catch (e) {
      console.error('Failed to create film curve profile', e);
    }
  };

  const handleUpdateProfile = async () => {
    if (!editingProfile || editingProfile.isBuiltin) return;
    try {
      await updateFilmCurveProfile(editingProfile.id, {
        name: newName.trim() || editingProfile.name,
        gamma: parseFloat(newGamma) || editingProfile.gamma,
        dMin: parseFloat(newDMin) || editingProfile.dMin,
        dMax: parseFloat(newDMax) || editingProfile.dMax,
        category: editingProfile.category
      });
      setFilmCurveProfiles(prev => prev.map(p => 
        p.id === editingProfile.id 
          ? { ...p, name: newName.trim() || p.name, gamma: parseFloat(newGamma), dMin: parseFloat(newDMin), dMax: parseFloat(newDMax) }
          : p
      ));
      setEditingProfile(null);
      setShowEditor(false);
    } catch (e) {
      console.error('Failed to update film curve profile', e);
    }
  };

  const handleDeleteProfile = async (profile) => {
    if (profile.isBuiltin) return;
    if (!window.confirm(`Delete profile "${profile.name}"?`)) return;
    try {
      await deleteFilmCurveProfile(profile.id);
      setFilmCurveProfiles(prev => prev.filter(p => p.id !== profile.id));
      if (filmCurveProfile === profile.key) {
        setFilmCurveProfile('default');
      }
    } catch (e) {
      console.error('Failed to delete film curve profile', e);
    }
  };

  const startEditProfile = (profile) => {
    setEditingProfile(profile);
    setNewName(profile.name);
    setNewGamma(profile.gamma);
    setNewDMin(profile.dMin);
    setNewDMax(profile.dMax);
    setShowEditor(true);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <select
          value={filmCurveProfile}
          onChange={e => { pushToHistory(); setFilmCurveProfile(e.target.value); }}
          style={{
            flex: 1,
            padding: '6px 8px',
            fontSize: 11,
            background: '#1a1a1a',
            border: '1px solid #444',
            borderRadius: 4,
            color: '#eee',
            cursor: 'pointer'
          }}
        >
          {Object.entries(groupedProfiles).map(([cat, profiles]) => (
            <optgroup key={cat} label={categoryLabels[cat] || cat}>
              {profiles.map(p => (
                <option key={p.key} value={p.key}>{p.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button 
          onClick={() => { setEditingProfile(null); setShowEditor(!showEditor); setNewName(''); setNewGamma(1.0); setNewDMin(0.1); setNewDMax(2.4); }}
          style={{ fontSize: 10, padding: '4px 8px', background: '#444', border: 'none', borderRadius: 3, color: '#eee', cursor: 'pointer' }}
          title="Create new profile"
        >
          +
        </button>
        {currentProfile && !currentProfile.isBuiltin && (
          <>
            <button 
              onClick={() => startEditProfile(currentProfile)}
              style={{ fontSize: 10, padding: '4px 8px', background: '#444', border: 'none', borderRadius: 3, color: '#eee', cursor: 'pointer' }}
              title="Edit profile"
            >
              ✎
            </button>
            <button 
              onClick={() => handleDeleteProfile(currentProfile)}
              style={{ fontSize: 10, padding: '4px 8px', background: '#533', border: 'none', borderRadius: 3, color: '#eee', cursor: 'pointer' }}
              title="Delete profile"
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Current Profile Info */}
      {currentProfile && (
        <div style={{ fontSize: 10, color: '#666', marginBottom: 8, display: 'flex', gap: 12 }}>
          <span>γ={currentProfile.gamma?.toFixed(2)}</span>
          <span>Dmin={currentProfile.dMin?.toFixed(2)}</span>
          <span>Dmax={currentProfile.dMax?.toFixed(2)}</span>
        </div>
      )}

      {/* Profile Editor */}
      {showEditor && (
        <div style={{ background: '#1a1a1a', padding: 10, borderRadius: 4, marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', marginBottom: 8 }}>
            {editingProfile ? 'Edit Profile' : 'New Profile'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              placeholder="Profile Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              style={{ padding: '6px 8px', fontSize: 11, background: '#222', border: '1px solid #444', borderRadius: 3, color: '#eee' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, fontSize: 10, color: '#888' }}>
                Gamma
                <input
                  type="number"
                  step="0.05"
                  min="0.5"
                  max="3.0"
                  value={newGamma}
                  onChange={e => setNewGamma(e.target.value)}
                  style={{ width: '100%', marginTop: 2, padding: '4px 6px', fontSize: 11, background: '#222', border: '1px solid #444', borderRadius: 3, color: '#eee' }}
                />
              </label>
              <label style={{ flex: 1, fontSize: 10, color: '#888' }}>
                Dmin
                <input
                  type="number"
                  step="0.01"
                  min="0.0"
                  max="0.5"
                  value={newDMin}
                  onChange={e => setNewDMin(e.target.value)}
                  style={{ width: '100%', marginTop: 2, padding: '4px 6px', fontSize: 11, background: '#222', border: '1px solid #444', borderRadius: 3, color: '#eee' }}
                />
              </label>
              <label style={{ flex: 1, fontSize: 10, color: '#888' }}>
                Dmax
                <input
                  type="number"
                  step="0.1"
                  min="1.5"
                  max="4.0"
                  value={newDMax}
                  onChange={e => setNewDMax(e.target.value)}
                  style={{ width: '100%', marginTop: 2, padding: '4px 6px', fontSize: 11, background: '#222', border: '1px solid #444', borderRadius: 3, color: '#eee' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowEditor(false); setEditingProfile(null); }}
                style={{ fontSize: 10, padding: '4px 12px', background: '#333', border: 'none', borderRadius: 3, color: '#aaa', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={editingProfile ? handleUpdateProfile : handleCreateProfile}
                style={{ fontSize: 10, padding: '4px 12px', background: '#446', border: 'none', borderRadius: 3, color: '#eee', cursor: 'pointer' }}
              >
                {editingProfile ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Density Levels Panel Component
 * 
 * Advanced panel for log-domain auto-levels adjustment.
 * Works in density domain (before inversion) for physically accurate negative processing.
 */
function DensityLevelsPanel({
  densityLevelsEnabled,
  setDensityLevelsEnabled,
  densityLevels,
  setDensityLevels,
  handleDensityAutoLevels,
  handleResetDensityLevels,
  pushToHistory
}) {
  const [expanded, setExpanded] = React.useState(false);

  // Helper to update a single channel's min or max
  const updateChannelLevel = (channel, field, value) => {
    if (pushToHistory) pushToHistory();
    setDensityLevels(prev => ({
      ...prev,
      [channel]: {
        ...prev[channel],
        [field]: parseFloat(value) || 0
      }
    }));
  };

  // Compact display of current levels
  const getLevelsSummary = () => {
    if (!densityLevelsEnabled) return 'Disabled';
    const { red, green, blue } = densityLevels;
    return `R:${red.min.toFixed(2)}-${red.max.toFixed(2)} G:${green.min.toFixed(2)}-${green.max.toFixed(2)} B:${blue.min.toFixed(2)}-${blue.max.toFixed(2)}`;
  };

  return (
    <div style={{ marginTop: 8 }}>
      {/* Collapsible Header */}
      <div 
        onClick={() => setExpanded(!expanded)}
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          cursor: 'pointer',
          padding: '4px 0',
          borderTop: '1px dashed #444'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#888' }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: '#888' }}>DENSITY LEVELS</span>
          {densityLevelsEnabled && (
            <span style={{ 
              fontSize: 9, 
              padding: '1px 4px', 
              background: '#2e7d32', 
              borderRadius: 2, 
              color: '#fff' 
            }}>ON</span>
          )}
        </div>
        {!expanded && (
          <span style={{ fontSize: 9, color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {getLevelsSummary()}
          </span>
        )}
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div style={{ 
          padding: 8, 
          background: '#1a1a1a', 
          borderRadius: 4, 
          marginTop: 4,
          border: '1px solid #333'
        }}>
          {/* Enable Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label style={{ fontSize: 10, color: '#aaa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={densityLevelsEnabled}
                onChange={(e) => {
                  if (pushToHistory) pushToHistory();
                  setDensityLevelsEnabled(e.target.checked);
                }}
                style={{ margin: 0 }}
              />
              Enable Density Levels
            </label>
          </div>

          {/* Channel Controls */}
          <div style={{ opacity: densityLevelsEnabled ? 1 : 0.5, pointerEvents: densityLevelsEnabled ? 'auto' : 'none' }}>
            {/* Red Channel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#f44336', width: 14 }}>R</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.red.min}
                onChange={(e) => updateChannelLevel('red', 'min', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
              <div style={{ flex: 1, height: 4, background: 'linear-gradient(to right, #400, #f44336)', borderRadius: 2 }} />
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.red.max}
                onChange={(e) => updateChannelLevel('red', 'max', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
            </div>

            {/* Green Channel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
              <span style={{ fontSize: 10, color: '#4caf50', width: 14 }}>G</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.green.min}
                onChange={(e) => updateChannelLevel('green', 'min', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
              <div style={{ flex: 1, height: 4, background: 'linear-gradient(to right, #040, #4caf50)', borderRadius: 2 }} />
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.green.max}
                onChange={(e) => updateChannelLevel('green', 'max', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
            </div>

            {/* Blue Channel */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              <span style={{ fontSize: 10, color: '#2196f3', width: 14 }}>B</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.blue.min}
                onChange={(e) => updateChannelLevel('blue', 'min', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
              <div style={{ flex: 1, height: 4, background: 'linear-gradient(to right, #004, #2196f3)', borderRadius: 2 }} />
              <input
                type="number"
                step="0.01"
                min="0"
                max="3"
                value={densityLevels.blue.max}
                onChange={(e) => updateChannelLevel('blue', 'max', e.target.value)}
                style={{ 
                  width: 50, 
                  fontSize: 10, 
                  padding: '2px 4px', 
                  background: '#2a2a2a', 
                  border: '1px solid #444', 
                  borderRadius: 2, 
                  color: '#eee',
                  textAlign: 'center'
                }}
              />
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                className="iv-btn"
                onClick={handleDensityAutoLevels}
                style={{ flex: 1, fontSize: 10, padding: '4px 8px' }}
                title="Analyze image and auto-detect density range"
              >
                AUTO ANALYZE
              </button>
              <button
                className="iv-btn"
                onClick={handleResetDensityLevels}
                style={{ fontSize: 10, padding: '4px 8px' }}
                title="Reset to default (0.00 - 3.00)"
              >
                RESET
              </button>
            </div>
          </div>

          {/* Help Text */}
          <div style={{ marginTop: 8, fontSize: 9, color: '#666', lineHeight: 1.4 }}>
            Density Levels works in the log domain before inversion. 
            Use AUTO ANALYZE to detect the actual density range of your negative, 
            then the system will stretch it to full range for optimal contrast.
          </div>
        </div>
      )}
    </div>
  );
}

export default function FilmLabControls({
  onFinishBatchParams,
  currentParams,
  photoId,  // 照片 ID，用于自动边缘检测
  sourceType = 'original', // 源类型: 'original' | 'negative' | 'positive'
  inverted, setInverted,
  useGPU, setUseGPU,
  inversionMode, setInversionMode,
  // P3: filmType/setFilmType 死 prop 已删除（全项目无消费者）
  filmCurveEnabled, setFilmCurveEnabled,
  filmCurveProfile, setFilmCurveProfile,
  filmCurveProfiles, setFilmCurveProfiles,
  baseMode, setBaseMode,
  isPickingBase, setIsPickingBase,
  handleAutoBase,
  // Density Levels (Log domain auto-levels)
  densityLevelsEnabled, setDensityLevelsEnabled,
  densityLevels, setDensityLevels,
  handleDensityAutoLevels,
  handleResetDensityLevels,
  isPickingWB, setIsPickingWB,
  handleAutoColor,
  handleUndo, handleRedo, handleReset,
  history, future,
  handleAutoLevels,
  isCropping, setIsCropping,
  onCropDone,
  ratioMode, setRatioMode,
  ratioSwap, setRatioSwap,
  rotation, setRotation,
  cropRect, setCropRect,  // 用于自动边缘检测
  orientation,            // EXIF orientation (Phase D: 自动裁剪坐标变换)
  rotationOffset,         // 额外偏移角（Phase D）
  onAutoEdgeDetection,    // 自动边缘检测回调
  onRotateStart,
  onRotateEnd,
  setOrientation,
  exposure, setExposure,
  contrast, setContrast,
  highlights, setHighlights,
  shadows, setShadows,
  whites, setWhites,
  blacks, setBlacks,
  temp, setTemp,
  tint, setTint,
  curves, setCurves,
  activeChannel, setActiveChannel,
  isPicking, setIsPicking,
  pickedColor,
  histograms,
  pushToHistory,
  hslParams, setHslParams,
  splitToning, setSplitToning,
  saturation, setSaturation,
  lut1, setLut1,
  lut2, setLut2,
  lutExportSize, setLutExportSize,
  generateOutputLUT,
  handleLutUpload,
  compareMode, setCompareMode,
  compareSlider, setCompareSlider,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  onApplyPresetToRoll,
  handleDownload, handleSave, onClose,
  onHighQualityExport,
  highQualityBusy,
  onGpuExport,
  gpuBusy,
  exportFormat,
  setExportFormat
}) {
  const [presetName, setPresetName] = React.useState('');
  // LUT 库选择器状态
  const [showLutSelector, setShowLutSelector] = React.useState(false);
  const [lutSelectorIndex, setLutSelectorIndex] = React.useState(1); // 1 or 2
  
  const handleSavePresetClick = () => {
    if (!presetName.trim()) {
      alert("请输入预设名称");
      return;
    }
    onSavePreset(presetName.trim());
    setPresetName('');
  };
  const isDuplicateName = presets.some(p => p.name === presetName.trim());
  
  const handleApplyWrapper = (p) => {
    setPresetName(p.name); // Auto-fill name for easier updating
    onApplyPreset(p);
  };

  const cycleCompare = (mode) => {
    // helper for toggles
    if (compareMode === mode) setCompareMode('off'); else setCompareMode(mode);
  };
  
  // 打开LUT选择器
  const openLutSelector = (index) => {
    setLutSelectorIndex(index);
    setShowLutSelector(true);
  };
  
  // 处理LUT选择
  const handleLutSelect = (lutData) => {
    pushToHistory();
    if (lutSelectorIndex === 1) {
      setLut1(lutData);
    } else {
      setLut2(lutData);
    }
    setShowLutSelector(false);
  };
  
  // 源类型标签配置
  const sourceLabels = {
    original: {label: 'ORIG', color: '#4caf50' },
    negative: { label: 'NEG', color: '#2196f3' },
    positive: { label: 'POS', color: '#ff9800' }
  };
  const currentSource = sourceLabels[sourceType] || sourceLabels.original;
  
  return (
    <div className="iv-sidebar custom-scrollbar" style={{ width: 320, background: '#1e1e1e', padding: 24, color: '#eee', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', borderLeft: '1px solid #333', boxShadow: '-5px 0 15px rgba(0,0,0,0.5)' }}>
        {/* Undo / Redo block will appear first, compare block moved just above it */}
      {/* Row 1: Title + ORIG + Close */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 600, letterSpacing: 0.5 }}>Film Lab</h3>
          <span style={{ 
            fontSize: 10, 
            padding: '2px 6px', 
            borderRadius: 4, 
            background: currentSource.color + '22',
            color: currentSource.color,
            fontWeight: 500
          }}>
            {currentSource.icon} {currentSource.label}
          </span>
        </div>
        <button className="iv-btn-icon" onClick={onClose} style={{ fontSize: 20 }}>×</button>
      </div>

      {/* Row 2: Action Buttons */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {onFinishBatchParams ? (
           <button 
             className="iv-btn iv-btn-primary" 
             onClick={() => onFinishBatchParams(currentParams)} 
             style={{ padding: '6px 12px', background: '#2196F3', borderColor: '#1976D2', fontWeight: 600, flex: '1 1 auto' }} 
           >
             ✓ FINISH PARAMETERS
           </button>
        ) : (
          <>
            <button className="iv-btn iv-btn-primary" onClick={handleSave} style={{ padding: '6px 12px', flex: '1 1 auto', minWidth: 60 }} title="保存处理结果到正片库（始终写入JPEG）">SAVE</button>
            <button className="iv-btn" onClick={onHighQualityExport} disabled={highQualityBusy} style={{ padding: '6px 12px', background: highQualityBusy ? '#555' : '#444', borderColor: highQualityBusy ? '#666' : '#555', flex: '1 1 auto', minWidth: 80 }} title="服务器基于原始高位深扫描生成高质量正片">
              {highQualityBusy ? 'EXPORTING…' : 'HQ EXPORT'}
            </button>
            {typeof window !== 'undefined' && window.__electron && (
              <button className="iv-btn" onClick={onGpuExport} disabled={gpuBusy} style={{ padding: '6px 12px', flex: '1 1 auto', minWidth: 80 }} title="Electron+WebGL GPU 导出（离线工作窗口）">
                {gpuBusy ? 'GPU…' : 'GPU EXPORT'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Save As (non-destructive) - HIDE IN BATCH MODE */}
      {!onFinishBatchParams && (
        <div style={{ display:'flex', flexDirection:'column', gap:8, background:'#252525', padding:10, borderRadius:6 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'#aaa' }}>SAVE AS</span>
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              <label style={{ fontSize:10, color:'#aaa' }}>Format</label>
              <select value={exportFormat} onChange={(e)=>setExportFormat(e.target.value)} style={{ background:'#333', color:'#eee', border:'1px solid #444', fontSize:10, borderRadius:3, padding:'2px 4px' }}>
                <option value="jpeg">JPEG</option>
                <option value="tiff16">TIFF 16-bit</option>
                <option value="both">Both</option>
              </select>
              <button className="iv-btn" onClick={handleDownload} style={{ padding: '4px 12px' }} title="下载当前处理结果（不写入正片库）">DOWNLOAD</button>
            </div>
          </div>
          <div style={{ fontSize:10, color:'#666', lineHeight:1.4 }}>“SAVE” 写入正片库（JPEG）。 “SAVE AS”/“DOWNLOAD” 为临时文件，可选择格式，不改变库。</div>
        </div>
      )}
      
      <div style={{ background: '#252525', padding: 10, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: sourceType === 'positive' ? 0.5 : 1 }}>
            <input 
              type="checkbox" 
              checked={inverted} 
              onChange={e => { pushToHistory(); setInverted(e.target.checked); }} 
              id="chk-invert"
              disabled={sourceType === 'positive'}
            />
            <label htmlFor="chk-invert" style={{ fontWeight: 500, fontSize: 13, cursor: sourceType === 'positive' ? 'not-allowed' : 'pointer' }}>Invert Negative</label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="chk-gpu"
              checked={useGPU}
              onChange={e => setUseGPU(e.target.checked)}
            />
            <label htmlFor="chk-gpu" style={{ fontSize: 12, color: '#ccc', cursor: 'pointer' }}>Use GPU (WebGL)</label>
          </div>
          {inverted && (
            <div style={{ display: 'flex', gap: 4, background: '#111', padding: 2, borderRadius: 4 }}>
              <button 
                onClick={() => { pushToHistory(); setInversionMode('linear'); }}
                style={{ 
                  fontSize: 10, padding: '2px 6px', border: 'none', borderRadius: 2, cursor: 'pointer',
                  background: inversionMode === 'linear' ? '#444' : 'transparent', color: inversionMode === 'linear' ? '#fff' : '#666'
                }}
                title="Standard linear inversion"
              >Linear</button>
              <button 
                onClick={() => { pushToHistory(); setInversionMode('log'); }}
                style={{ 
                  fontSize: 10, padding: '2px 6px', border: 'none', borderRadius: 2, cursor: 'pointer',
                  background: inversionMode === 'log' ? '#444' : 'transparent', color: inversionMode === 'log' ? '#fff' : '#666'
                }}
                title="Soft logarithmic inversion - preserves more shadow detail"
              >Soft</button>
            </div>
          )}
        </div>
        
        {/* Film Curve Section - Only available when Invert is enabled (applies to negative scan data) */}
        {inverted && (
          <div style={{ borderTop: '1px solid #333', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <input 
                type="checkbox" 
                checked={filmCurveEnabled} 
                onChange={e => { pushToHistory(); setFilmCurveEnabled(e.target.checked); }} 
                id="chk-film-curve"
              />
              <label htmlFor="chk-film-curve" style={{ fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>Film Curve</label>
              <span style={{ fontSize: 9, color: '#666' }}>(H&D Model)</span>
            </div>
            
            {filmCurveEnabled && (
              <FilmCurveProfileSelector
                filmCurveProfile={filmCurveProfile}
                setFilmCurveProfile={setFilmCurveProfile}
                filmCurveProfiles={filmCurveProfiles}
                setFilmCurveProfiles={setFilmCurveProfiles}
                pushToHistory={pushToHistory}
              />
            )}
          </div>
        )}
        
        {/* Base Correction Tools */}
        <div style={{ marginBottom: 8, borderTop: '1px solid #333', paddingTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>FILM BASE</span>
            {/* Base Mode Selector */}
            <div style={{ display: 'flex', gap: 2 }}>
              <button
                onClick={() => setBaseMode && setBaseMode('linear')}
                title="Linear: Traditional multiplicative gain correction"
                style={{
                  padding: '2px 6px',
                  fontSize: 10,
                  background: baseMode === 'linear' ? '#1565c0' : '#333',
                  border: '1px solid',
                  borderColor: baseMode === 'linear' ? '#2196f3' : '#444',
                  borderRadius: 3,
                  color: baseMode === 'linear' ? '#fff' : '#999',
                  cursor: 'pointer',
                }}
              >
                Linear
              </button>
              <button
                onClick={() => setBaseMode && setBaseMode('log')}
                title="Log: Physically accurate density-domain correction (Beer-Lambert law)"
                style={{
                  padding: '2px 6px',
                  fontSize: 10,
                  background: baseMode === 'log' ? '#1565c0' : '#333',
                  border: '1px solid',
                  borderColor: baseMode === 'log' ? '#2196f3' : '#444',
                  borderRadius: 3,
                  color: baseMode === 'log' ? '#fff' : '#999',
                  cursor: 'pointer',
                }}
              >
                Log
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button 
              className="iv-btn"
              onClick={() => {
                if (!isPickingBase) setIsCropping(false);
                setIsPickingBase(!isPickingBase);
              }}
              style={{ 
                flex: 1,
                background: isPickingBase ? '#e65100' : '#333', 
                borderColor: isPickingBase ? '#ef6c00' : '#444',
                color: isPickingBase ? '#fff' : '#eee',
                fontSize: 11
              }}
            >
              {isPickingBase ? 'PICKING...' : 'PICK (MANUAL)'}
            </button>
            <button 
              className="iv-btn"
              onClick={handleAutoBase}
              style={{ flex: 1, fontSize: 11 }}
            >
              AUTO DETECT
            </button>
          </div>

          {/* Density Levels - Advanced Panel (Collapsible) */}
          {baseMode === 'log' && (
            <DensityLevelsPanel
              densityLevelsEnabled={densityLevelsEnabled}
              setDensityLevelsEnabled={setDensityLevelsEnabled}
              densityLevels={densityLevels}
              setDensityLevels={setDensityLevels}
              handleDensityAutoLevels={handleDensityAutoLevels}
              handleResetDensityLevels={handleResetDensityLevels}
              pushToHistory={pushToHistory}
            />
          )}
        </div>

        {/* WB Tools */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', marginBottom: 4 }}>WHITE BALANCE</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button 
              className="iv-btn"
              onClick={() => {
                if (!isPickingWB) setIsCropping(false);
                setIsPickingWB(!isPickingWB);
              }}
              style={{ 
                flex: 1,
                background: isPickingWB ? '#e65100' : '#333', 
                borderColor: isPickingWB ? '#ef6c00' : '#444',
                color: isPickingWB ? '#fff' : '#eee',
                fontSize: 11
              }}
            >
              {isPickingWB ? 'PICKING...' : 'PICK (MANUAL)'}
            </button>
            <button 
              className="iv-btn"
              onClick={handleAutoColor}
              style={{ flex: 1, fontSize: 11 }}
            >
              AUTO WB
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <button className="iv-btn" onClick={handleUndo} disabled={history.length === 0} style={{ flex: 1 }}>Undo</button>
        <button className="iv-btn" onClick={handleRedo} disabled={future.length === 0} style={{ flex: 1 }}>Redo</button>
        <button className="iv-btn iv-btn-danger" onClick={handleReset} style={{ flex: 1 }}>Reset</button>
      </div>

      {/* Compare Mode Controls moved here */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#252525', padding: 10, borderRadius: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>COMPARE</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="iv-btn"
              style={{ fontSize: 10, padding: '4px 8px', background: compareMode === 'original' ? '#2e7d32' : '#333', borderColor: compareMode === 'original' ? '#1b5e20' : '#444' }}
              onClick={() => cycleCompare('original')}
            >ORIGINAL</button>
            <button
              className="iv-btn"
              style={{ fontSize: 10, padding: '4px 8px', background: compareMode === 'split' ? '#2e7d32' : '#333', borderColor: compareMode === 'split' ? '#1b5e20' : '#444' }}
              onClick={() => cycleCompare('split')}
            >SPLIT</button>
          </div>
        </div>
        {compareMode === 'split' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={compareSlider}
              onChange={(e) => setCompareSlider(Number(e.target.value))}
            />
            <div style={{ fontSize: 10, color: '#888', textAlign: 'center' }}>Split: {(compareSlider * 100).toFixed(0)}%</div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="iv-btn iv-btn-primary" onClick={handleAutoLevels} style={{ flex: 1, padding: '8px 0', fontWeight: 600, fontSize: 11 }}>AUTO LEVELS</button>
      </div>

      <div style={{ borderTop: '1px solid #333', paddingTop: 20 }}>
         <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
           <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>CROP & ROTATE</label>
           <button 
             className={`iv-btn ${isCropping ? 'iv-btn-primary' : ''}`}
             onClick={() => {
               if (isCropping) {
                 // DONE clicked: commit crop
                 onCropDone && onCropDone();
               } else {
                 // CROP clicked: enter crop mode
                 setIsCropping(true);
               }
             }}
             style={{ padding: '4px 12px', fontSize: 11 }}
           >
             {isCropping ? 'DONE' : 'CROP'}
           </button>
         </div>
         
         {isCropping && (
           <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
             {/* 自动边缘检测按钮 */}
             <AutoCropButton
               photoId={photoId}
               sourceType={sourceType}
               cropRect={cropRect}
               rotation={rotation}
               pushToHistory={pushToHistory}
              onDetectionResult={(result) => {
                // Phase D: 把检测系坐标重映射到客户端"总旋转后包围盒"坐标系
                if (result && result.cropRect) {
                  const { remapDetectedCropRect } = require('@filmgallery/shared');
                  const remapped = remapDetectedCropRect(
                    result.cropRect,
                    result.rotation || 0,
                    { orientation: orientation || 0, rotationOffset: rotationOffset || 0, currentRotation: rotation || 0 }
                  );
                  setCropRect(remapped.cropRect);
                  // rotation 为相对于 orientation+rotationOffset 的增量（替换式语义）
                  if (Math.abs(remapped.rotation) > 0.1) {
                    setRotation(remapped.rotation);
                  }
                }
                // 回调父组件
                if (onAutoEdgeDetection) {
                  onAutoEdgeDetection(result);
                }
              }}
               disabled={!photoId}
             />
             
             <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom: 8 }}>
               <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>Aspect</label>
               <select value={ratioMode} onChange={(e)=>setRatioMode(e.target.value)} style={{ background:'#333', color:'#eee', border:'1px solid #444', fontSize:12, borderRadius:4, padding:'4px 6px' }}>
                 <option value="free">Free</option>
                 <option value="original">Original</option>
                 <option value="1:1">1 : 1</option>
                 <option value="3:2">3 : 2</option>
                 <option value="4:3">4 : 3</option>
                 <option value="16:9">16 : 9</option>
               </select>
               {ratioMode !== 'free' && ratioMode !== '1:1' && ratioMode !== 'original' && (
                 <button
                   className="iv-btn"
                   onClick={() => setRatioSwap(v => !v)}
                   title="Swap aspect orientation (Lightroom: X)"
                   style={{ padding:'4px 8px', fontSize:11 }}
                 >{ratioSwap ? 'Swap: Portrait' : 'Swap: Landscape'}</button>
               )}
             </div>
             <SliderControl 
               label="ROTATION" 
               value={rotation} 
               min={-45} max={45} 
               step={0.1}
               onChange={setRotation} 
               onMouseDown={() => { pushToHistory(); onRotateStart && onRotateStart(); }}
               onMouseUp={() => { onRotateEnd && onRotateEnd(); }}
               suffix="°"
             />
           </div>
         )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="iv-btn" onClick={() => { pushToHistory(); setOrientation(r => r - 90); }} style={{ flex: 1, fontSize: 11 }}>↺ Rotate Left</button>
        <button className="iv-btn" onClick={() => { pushToHistory(); setOrientation(r => r + 90); }} style={{ flex: 1, fontSize: 11 }}>↻ Rotate Right</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SliderControl label="EXPOSURE" value={exposure} onChange={setExposure} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        <SliderControl label="CONTRAST" value={contrast} onChange={setContrast} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SliderControl label="HIGHLIGHTS" value={highlights} onChange={setHighlights} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        <SliderControl label="SHADOWS" value={shadows} onChange={setShadows} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        <SliderControl label="WHITES" value={whites} onChange={setWhites} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        <SliderControl label="BLACKS" value={blacks} onChange={setBlacks} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SliderControl label="TEMPERATURE" value={temp} onChange={setTemp} onMouseDown={pushToHistory} min={-100} max={100} step={1} displayFormatter={(v) => Number(v).toFixed(2)} />
        <SliderControl label="TINT" value={tint} onChange={setTint} onMouseDown={pushToHistory} min={-100} max={100} step={1} displayFormatter={(v) => Number(v).toFixed(2)} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SliderControl label="SATURATION" value={saturation} onChange={setSaturation} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
      </div>

      {/* Curve Editor UI */}
      <ToneCurveEditor
        curves={curves}
        setCurves={setCurves}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
        isPicking={isPicking}
        setIsPicking={setIsPicking}
        pickedColor={pickedColor}
        histograms={histograms}
        pushToHistory={pushToHistory}
      />

      {/* HSL 调整 */}
      <HSLPanel
        hslParams={hslParams}
        setHslParams={setHslParams}
        pushToHistory={pushToHistory}
      />

      {/* 分离色调 */}
      <SplitToningPanel
        splitToning={splitToning}
        setSplitToning={setSplitToning}
        pushToHistory={pushToHistory}
      />

      {/* LUTs Section */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>LUTs</label>
          <div style={{ display: 'flex', gap: 4 }}>
            <select 
              value={lutExportSize} 
              onChange={(e) => setLutExportSize(Number(e.target.value))}
              style={{ 
                background: '#333', 
                color: '#eee', 
                border: '1px solid #444', 
                fontSize: 10, 
                borderRadius: 3,
                padding: '2px 4px'
              }}
            >
              <option value={33}>33 Point</option>
              <option value={65}>65 Point</option>
            </select>
            <button className="iv-btn" onClick={generateOutputLUT} style={{ fontSize: 10, padding: '2px 8px' }}>EXPORT</button>
          </div>
        </div>

        {/* LUT 1 */}
        <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>LUT 1</span>
            {!lut1 ? (
              <button className="iv-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openLutSelector(1)}>
                LOAD
              </button>
            ) : (
              <button className="iv-btn iv-btn-danger" onClick={() => { pushToHistory(); setLut1(null); }} style={{ fontSize: 10, padding: '2px 8px' }}>REMOVE</button>
            )}
          </div>
          {lut1 && (
            <>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lut1.name}</div>
              <SliderControl 
                label="OPACITY" 
                value={lut1.intensity} 
                min={0} max={1} step={0.05} 
                onChange={(v) => setLut1(prev => ({ ...prev, intensity: v }))} 
                onMouseDown={pushToHistory}
              />
            </>
          )}
        </div>

        {/* LUT 2 */}
        <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>LUT 2</span>
            {!lut2 ? (
              <button className="iv-btn" style={{ fontSize: 10, padding: '2px 8px' }} onClick={() => openLutSelector(2)}>
                LOAD
              </button>
            ) : (
              <button className="iv-btn iv-btn-danger" onClick={() => { pushToHistory(); setLut2(null); }} style={{ fontSize: 10, padding: '2px 8px' }}>REMOVE</button>
            )}
          </div>
          {lut2 && (
            <>
              <div style={{ fontSize: 10, color: '#888', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lut2.name}</div>
              <SliderControl 
                label="OPACITY" 
                value={lut2.intensity} 
                min={0} max={1} step={0.05} 
                onChange={(v) => setLut2(prev => ({ ...prev, intensity: v }))} 
                onMouseDown={pushToHistory}
              />
            </>
          )}
        </div>
      </div>
      
      {/* LUT 选择器 Modal */}
      {showLutSelector && (
        <LutSelectorModal
          onClose={() => setShowLutSelector(false)}
          onSelect={handleLutSelect}
        />
      )}

      {/* Preset Management */}
      <div style={{ borderTop: '1px solid #333', paddingTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>PRESETS</label>
        </div>
        <div style={{ background: '#252525', padding: 10, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="Preset Name"
              style={{ flex: 1, background: '#333', border: '1px solid #444', color: '#eee', fontSize: 12, padding: '4px 6px', borderRadius: 4 }}
            />
            <button
              className="iv-btn"
              onClick={handleSavePresetClick}
              style={{ fontSize: 11, whiteSpace: 'nowrap', opacity: !presetName.trim() ? 0.7 : 1 }}
            >SAVE</button>
          </div>
          {presetName && isDuplicateName && (
            <div style={{ fontSize: 10, color: '#e0a800' }}>覆盖已有预设: {presetName}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
            {presets.length === 0 && (
              <div style={{ fontSize: 11, color: '#666', textAlign: 'center' }}>暂无预设</div>
            )}
            {presets.map(p => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1d1d1d', padding: '6px 8px', borderRadius: 4 }}>
                <div style={{ flex: 1, fontSize: 11, color: '#ddd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                <button className="iv-btn" style={{ fontSize: 10, padding: '4px 6px' }} onClick={() => handleApplyWrapper(p)}>APPLY</button>
                <button className="iv-btn" style={{ fontSize: 10, padding: '4px 6px' }} onClick={() => onApplyPresetToRoll(p)}>ROLL</button>
                <button className="iv-btn iv-btn-danger" style={{ fontSize: 10, padding: '4px 6px' }} onClick={() => onDeletePreset(p.name)}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}