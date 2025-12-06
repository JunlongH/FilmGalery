import React from 'react';
import SliderControl from './SliderControl';
import ToneCurveEditor from './ToneCurveEditor';

export default function FilmLabControls({
  inverted, setInverted,
  useGPU, setUseGPU,
  inversionMode, setInversionMode,
  isPickingBase, setIsPickingBase,
  handleAutoBase,
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
  const handleSavePresetClick = () => {
    if (!presetName.trim()) return;
    onSavePreset(presetName.trim());
    setPresetName('');
  };
  const isDuplicateName = presets.some(p => p.name === presetName.trim());
  const cycleCompare = (mode) => {
    // helper for toggles
    if (compareMode === mode) setCompareMode('off'); else setCompareMode(mode);
  };
  return (
    <div className="iv-sidebar iv-scroll" style={{ width: 320, background: '#1e1e1e', padding: 24, color: '#eee', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', borderLeft: '1px solid #333', boxShadow: '-5px 0 15px rgba(0,0,0,0.5)' }}>
        {/* Undo / Redo block will appear first, compare block moved just above it */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 600, letterSpacing: 0.5 }}>Film Lab</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="iv-btn iv-btn-primary" onClick={handleSave} style={{ padding: '4px 12px' }} title="保存处理结果到正片库（始终写入JPEG）">SAVE</button>
          <button className="iv-btn" onClick={onHighQualityExport} disabled={highQualityBusy} style={{ padding: '4px 12px', background: highQualityBusy ? '#555' : '#444', borderColor: highQualityBusy ? '#666' : '#555' }} title="服务器基于原始高位深扫描生成高质量正片">
            {highQualityBusy ? 'EXPORTING…' : 'HQ EXPORT'}
          </button>
          {typeof window !== 'undefined' && window.__electron && (
            <button className="iv-btn" onClick={onGpuExport} disabled={gpuBusy} style={{ padding: '4px 12px' }} title="Electron+WebGL GPU 导出（离线工作窗口）">
              {gpuBusy ? 'GPU…' : 'GPU EXPORT'}
            </button>
          )}
          <button className="iv-btn-icon" onClick={onClose} style={{ fontSize: 20 }}>×</button>
        </div>
      </div>

      {/* Save As (non-destructive) */}
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
      
      <div style={{ background: '#252525', padding: 10, borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input 
              type="checkbox" 
              checked={inverted} 
              onChange={e => { pushToHistory(); setInverted(e.target.checked); }} 
              id="chk-invert"
            />
            <label htmlFor="chk-invert" style={{ fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>Invert Negative</label>
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
              >LIN</button>
              <button 
                onClick={() => { pushToHistory(); setInversionMode('log'); }}
                style={{ 
                  fontSize: 10, padding: '2px 6px', border: 'none', borderRadius: 2, cursor: 'pointer',
                  background: inversionMode === 'log' ? '#444' : 'transparent', color: inversionMode === 'log' ? '#fff' : '#666'
                }}
              >LOG</button>
            </div>
          )}
        </div>
        
        {/* Base Correction Tools */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', marginBottom: 4 }}>FILM BASE</div>
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
              <label className="iv-btn" style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                LOAD
                <input type="file" accept=".cube" style={{ display: 'none' }} onChange={(e) => handleLutUpload(e, 1)} />
              </label>
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
              <label className="iv-btn" style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                LOAD
                <input type="file" accept=".cube" style={{ display: 'none' }} onChange={(e) => handleLutUpload(e, 2)} />
              </label>
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
              disabled={!presetName.trim()}
              onClick={handleSavePresetClick}
              style={{ fontSize: 11, whiteSpace: 'nowrap' }}
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
                <button className="iv-btn" style={{ fontSize: 10, padding: '4px 6px' }} onClick={() => onApplyPreset(p)}>APPLY</button>
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