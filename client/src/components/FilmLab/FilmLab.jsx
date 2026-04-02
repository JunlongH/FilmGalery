import React, { useEffect, useRef, useState } from 'react';
import { setRollPreset, listPresets, createPreset, updatePreset, deletePreset as deletePresetApi, getFilmCurveProfiles } from '../../api';
import { smartFilmlabPreview, smartRenderPositive, smartExportPositive } from '../../services';
import { getCurveLUT, parseCubeLUT, getMaxSafeRect, getPresetRatio, getExifOrientation } from './utils';
import FilmLabControls from './FilmLabControls';
import FilmLabCanvas from './FilmLabCanvas';
import PhotoSwitcher from './PhotoSwitcher';
import { isWebGLAvailable, processImageWebGL } from './FilmLabWebGL';
import { useAIPanel } from '../AIPanel/AIPanelContext';

// 使用统一渲染核心 (via CRACO alias)
import {
  RenderCore,
  computeWBGains,
  solveTempTintFromSample,
  buildCompositeFloatCurveLUT,
  PREVIEW_MAX_WIDTH_CLIENT,
  EXPORT_MAX_WIDTH,
  DEFAULT_HSL_PARAMS,
  DEFAULT_SPLIT_TONE_PARAMS,
  getEffectiveInverted,
  buildCombinedLUT,
  isRawFile,
  requiresServerDecode,
} from '@filmgallery/shared';

export default function FilmLab({ 
  imageUrl, 
  onClose, 
  onSave, 
  onFinishBatchParams,
  rollId, 
  photoId, 
  onPhotoUpdate,
  sourceType = 'original', // 'original' | 'negative' | 'positive' - 当前编辑的源类型
  // PhotoSwitcher 相关 props（可选）
  photos = null,           // 当前卷的所有照片
  onPhotoChange = null,    // 切换照片回调
  showPhotoSwitcher = false // 是否显示 PhotoSwitcher
}) {
  const canvasRef = useRef(null);
  const origCanvasRef = useRef(null); // Original (unprocessed) canvas for compare mode
  const [image, setImage] = useState(null);
  
  // PhotoSwitcher 状态
  const [photoSwitcherCollapsed, setPhotoSwitcherCollapsed] = useState(true);
  
  // Parameters
  const [inverted, setInverted] = useState(false); // Default to false as requested
  const [inversionMode, setInversionMode] = useState('linear'); // 'linear' | 'log'
  const [filmType, setFilmType] = useState('default'); // Film profile (legacy, kept for backwards compat)
  
  // Film Curve (independent of inversion)
  const [filmCurveEnabled, setFilmCurveEnabled] = useState(false);
  const [filmCurveProfile, setFilmCurveProfile] = useState('default'); // Profile key
  const [filmCurveProfiles, setFilmCurveProfiles] = useState([]); // All available profiles (built-in + custom)
  
  const [isPicking, setIsPicking] = useState(false);
  const [isPickingBase, setIsPickingBase] = useState(false);
  const [isPickingWB, setIsPickingWB] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);
  const [exposure, setExposure] = useState(0); // -100 to 100
  const [contrast, setContrast] = useState(0); // -100 to 100
  const [highlights, setHighlights] = useState(0); // -100 to 100
  const [shadows, setShadows] = useState(0); // -100 to 100
  const [whites, setWhites] = useState(0); // -100 to 100
  const [blacks, setBlacks] = useState(0); // -100 to 100
  const [temp, setTemp] = useState(0); // -100 to 100 (Blue <-> Yellow)
  const [tint, setTint] = useState(0); // -100 to 100 (Green <-> Magenta)
  
  // RGB Gains (for manual color balance)
  const [red, setRed] = useState(1.0);
  const [green, setGreen] = useState(1.0);
  const [blue, setBlue] = useState(1.0);

  // Film Base Correction (Pre-Inversion, independent of scene WB)
  // Linear mode (gains) - legacy, compatible with old presets
  const [baseRed, setBaseRed] = useState(1.0);
  const [baseGreen, setBaseGreen] = useState(1.0);
  const [baseBlue, setBaseBlue] = useState(1.0);
  // Mode and log domain parameters
  const [baseMode, setBaseMode] = useState('log'); // 'linear' | 'log' - default to log for better accuracy
  const [baseDensityR, setBaseDensityR] = useState(0.0);
  const [baseDensityG, setBaseDensityG] = useState(0.0);
  const [baseDensityB, setBaseDensityB] = useState(0.0);

  // Density Levels (Log domain auto-levels, independent of post-processing AutoLevels)
  const [densityLevelsEnabled, setDensityLevelsEnabled] = useState(false);
  const [densityLevels, setDensityLevels] = useState({
    red: { min: 0.0, max: 3.0 },
    green: { min: 0.0, max: 3.0 },
    blue: { min: 0.0, max: 3.0 }
  });

  // Rotation
  const [rotation, setRotation] = useState(0);
  const [orientation, setOrientation] = useState(0); // 0, 90, 180, 270
  const [isRotating, setIsRotating] = useState(false);
  const committedRotationRef = useRef(0); // the rotation used for drawing while dragging

  // Crop
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 1, h: 1 }); // Normalized 0-1
  const [committedCrop, setCommittedCrop] = useState({ x: 0, y: 0, w: 1, h: 1 }); // Applied crop (only updated on DONE)
  // Ratio presets: 'free' | 'original' | '1:1' | '3:2' | '4:3' | '16:9'
  const [ratioMode, setRatioMode] = useState('free');
  const [ratioSwap, setRatioSwap] = useState(false); // Lightroom-like X to flip orientation
  const isManualCropRef = useRef(false); // Track if user has manually adjusted crop
  const hasPannedRef = useRef(false); // Track if a pan operation occurred to prevent click events

  // Curve Points: Object with arrays for each channel
  const defaultCurve = [{x:0, y:0}, {x:255, y:255}];
  const [curves, setCurves] = useState({
    rgb: [...defaultCurve],
    red: [...defaultCurve],
    green: [...defaultCurve],
    blue: [...defaultCurve]
  });
  const [activeChannel, setActiveChannel] = useState('rgb'); // 'rgb', 'red', 'green', 'blue'

  // HSL 调整 (8 色相分区)
  const [hslParams, setHslParams] = useState({ ...DEFAULT_HSL_PARAMS });
  
  // 分离色调 (高光/阴影着色)
  const [splitToning, setSplitToning] = useState({ ...DEFAULT_SPLIT_TONE_PARAMS });

  // 全局饱和度 (Luma-Preserving, Rec.709)
  const [saturation, setSaturation] = useState(0);

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const [histograms, setHistograms] = useState({
    rgb: new Array(256).fill(0),
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0)
  });
  
  // LUTs
  const [lut1, setLut1] = useState(null); // { name, data, size, intensity: 1.0 }
  const [lut2, setLut2] = useState(null);
  const [lutExportSize, setLutExportSize] = useState(33); // 33 or 65
  const [useGPU, setUseGPU] = useState(isWebGLAvailable());
  // Note: Server preview (remoteImg) has been removed in favor of client-side WebGL/CPU rendering
  // This eliminates LUT color mismatch issues and reduces network overhead

  // Compare Mode
  // compareMode: 'off' | 'original' | 'split'
  const [compareMode, setCompareMode] = useState('off');
  const [compareSlider, setCompareSlider] = useState(0.5); // 0-1 split position for 'split' mode

  // Presets (stored in backend DB, mirrored to local state)
  const [presets, setPresets] = useState([]); // [{ id?, name, params: { ... } }]
  const processRafRef = useRef(null);
  const [hqBusy, setHqBusy] = useState(false);
  const [gpuBusy, setGpuBusy] = useState(false);
  // Format for Save As (non-destructive local download)
  const [saveAsFormat, setSaveAsFormat] = useState('jpeg'); // 'jpeg' | 'tiff16' | 'both'
  
  // Fix for browser auto-rotation (EXIF) vs Server raw orientation mismatch
  const [rotationOffset, setRotationOffset] = useState(0);

  // Optimization: Cache WebGL output
  const processedCanvasRef = useRef(null);
  const lastWebglParamsRef = useRef(null);

  // 当 sourceType 变化时，清除 WebGL 缓存以避免显示旧的渲染结果
  // 这是修复"正片模式下先显示正片然后跳到负片"问题的关键
  useEffect(() => {
    processedCanvasRef.current = null;
    lastWebglParamsRef.current = null;
    
    // 关键修复：当切换到正片模式时，强制将 inverted 状态设为 false
    // 这确保 UI 状态与有效反转状态同步，避免状态不一致导致的闪烁
    if (sourceType === 'positive') {
      setInverted(false);
    }
  }, [sourceType]);

  // AI 上下文：FilmLab 打开/关闭时 push/pop，编辑参数变化时更新
  const { isOpen: isAIPanelOpen, panelWidth: aiPanelWidth, pushOverlayContext, popOverlayContext, updateOverlayContext } = useAIPanel();
  useEffect(() => {
    pushOverlayContext({
      entityType: 'photo',
      entityId: photoId ? String(photoId) : undefined,
      rollId: rollId ? String(rollId) : undefined,
      viewMode: 'filmlab',
      filmlabParams: { exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, inverted },
    });
    return () => popOverlayContext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    updateOverlayContext({
      entityId: photoId ? String(photoId) : undefined,
      rollId: rollId ? String(rollId) : undefined,
      filmlabParams: { exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, inverted },
    });
  }, [photoId, rollId, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, inverted, updateOverlayContext]);

  const webglParams = React.useMemo(() => {
    const gains = computeWBGains({ red, green, blue, temp, tint });
    // compute preview-scale consistent with geometry (preview max width)
    const scale = image && image.width ? Math.min(1, PREVIEW_MAX_WIDTH_CLIENT / image.width) : 1;
    // 使用统一的 getEffectiveInverted 函数计算有效反转状态
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    // 片基校正 (Pre-Inversion) - 支持线性和对数两种模式
    const baseGains = [baseRed, baseGreen, baseBlue];
    const baseDensity = [baseDensityR, baseDensityG, baseDensityB];
    return {
      inverted: effectiveInvertedValue, inversionMode, gains, 
      baseMode, baseGains, baseDensity,
      // Density Levels (Log domain auto-levels)
      densityLevelsEnabled,
      densityLevels,
      exposure, contrast, highlights, shadows, whites, blacks,
      curves, lut1, lut2,
      // HSL and Split Toning params for WebGL preview (serialized for cache comparison)
      hslParams, splitToning,
      saturation,
      hslKey: JSON.stringify(hslParams),
      splitToneKey: JSON.stringify(splitToning),
      // Film Curve params
      filmCurveEnabled, filmCurveProfile,
      // Include geometry params to invalidate cache when geometry changes
      rotation, orientation, rotationOffset, isCropping,
      // Serialize committedCrop for comparison
      cropKey: `${committedCrop.x},${committedCrop.y},${committedCrop.w},${committedCrop.h}`,
      // include scale so WebGL output matches geometry.rotatedW used by overlay
      scale,
      // Include sourceType to invalidate cache when source changes
      sourceType
    };
  }, [inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks,
      temp, tint, red, green, blue, baseMode, baseRed, baseGreen, baseBlue, baseDensityR, baseDensityG, baseDensityB, 
      densityLevelsEnabled, densityLevels,
      curves, lut1, lut2,
      hslParams, splitToning, saturation, filmCurveEnabled, filmCurveProfile,
      rotation, orientation, rotationOffset, isCropping, committedCrop, image, sourceType]);

  // 当前参数（用于 PhotoSwitcher "Apply to batch" 功能）
  const currentParams = React.useMemo(() => ({
    inverted,
    inversionMode,
    filmCurveEnabled,
    filmCurveProfile,
    exposure,
    contrast,
    highlights,
    shadows,
    whites,
    blacks,
    temp,
    tint,
    red,
    green,
    blue,
    // 片基校正 (Pre-Inversion) - 支持线性和对数两种模式
    baseMode,
    baseRed,
    baseGreen,
    baseBlue,
    baseDensityR,
    baseDensityG,
    baseDensityB,
    // Density Levels (Log domain auto-levels)
    densityLevelsEnabled,
    densityLevels,
    rotation,
    orientation,
    cropRect: committedCrop,
    curves,
    hslParams,
    splitToning,
    saturation
  }), [inverted, inversionMode, filmCurveEnabled, filmCurveProfile, exposure, contrast, 
      highlights, shadows, whites, blacks, temp, tint, red, green, blue, 
      baseMode, baseRed, baseGreen, baseBlue, baseDensityR, baseDensityG, baseDensityB, 
      densityLevelsEnabled, densityLevels,
      rotation, orientation, committedCrop, curves, hslParams, splitToning, saturation]);

  // Pre-calculate geometry for canvas sizing and crop overlay sync
  const geometry = React.useMemo(() => {
    if (!image) return null;
    const maxWidth = PREVIEW_MAX_WIDTH_CLIENT;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    // Rounded output dimensions for canvas sizing (matches FilmLabWebGL.js final output)
    const rotatedW = Math.round(scaledW * cos + scaledH * sin);
    const rotatedH = Math.round(scaledW * sin + scaledH * cos);
    return { rotatedW, rotatedH, scale, rad, scaledW, scaledH };
  }, [image, rotation, orientation, rotationOffset]);

  // Load presets from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await listPresets();
        if (res && Array.isArray(res.presets)) {
          // Normalize shape: keep id, name, params
          setPresets(res.presets.map(p => ({ id: p.id, name: p.name, params: p.params })));
        }
      } catch (e) {
        console.warn('Failed to load presets from backend', e);
        // Fallback: try localStorage if backend unreachable
        try {
          const raw = localStorage.getItem('filmLabPresets');
          if (raw) setPresets(JSON.parse(raw));
        } catch (e2) {
          console.warn('Failed to load presets from localStorage', e2);
        }
      }
    })();
  }, []);

  // Load film curve profiles on mount
  useEffect(() => {
    (async () => {
      try {
        const result = await getFilmCurveProfiles();
        // API now returns array directly
        const profiles = Array.isArray(result) ? result : (result?.profiles || []);
        setFilmCurveProfiles(profiles);
      } catch (e) {
        console.warn('Failed to load film curve profiles', e);
      }
    })();
  }, []);

  // Auto-disable filmCurve when inversion is turned off
  useEffect(() => {
    if (!inverted && filmCurveEnabled) {
      setFilmCurveEnabled(false);
    }
  }, [inverted, filmCurveEnabled]);

  // Keep localStorage as a lightweight cache/backup
  const persistPresets = (next) => {
    setPresets(next);
    try { localStorage.setItem('filmLabPresets', JSON.stringify(next)); } catch(e){ console.warn('Persist presets failed', e); }
  };

  const savePreset = async (name) => {
    if (!name) return;
    
    // Serialize LUTs (Float32Array -> Array) for JSON storage
    const serializeLut = (lut) => {
      if (!lut) return null;
      return {
        ...lut,
        data: lut.data ? Array.from(lut.data) : null
      };
    };

    const params = {
      inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks,
      temp, tint, red, green, blue,
      // 片基校正增益 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      curves: JSON.parse(JSON.stringify(curves)),
      // New Features
      hslParams,
      splitToning,
      saturation,
      filmCurveEnabled,
      filmCurveProfile,
      lut1: serializeLut(lut1),
      lut2: serializeLut(lut2)
    };

    const existing = presets.find(p => p.name === name);
    try {
      if (existing && existing.id) {
        await updatePreset(existing.id, { name, category: 'filmlab', description: '', params });
        const next = presets.map(p => p.name === name ? { ...p, params } : p);
        persistPresets(next);
      } else {
        const created = await createPreset({ name, category: 'filmlab', description: '', params });
        const withId = existing && existing.id ? presets : presets.filter(p => p.name !== name);
        const next = [...withId, { id: created.id, name, params }];
        persistPresets(next);
      }
    } catch (e) {
      console.error('Failed to save preset to backend, falling back to local only', e);
      const exists = presets.some(p => p.name === name);
      let next;
      if (exists) {
        next = presets.map(p => p.name === name ? { ...p, params } : p);
      } else {
        next = [...presets, { name, params }];
      }
      persistPresets(next);
    }
  };

  const applyPreset = (preset) => {
    if (!preset) return;
    const { params } = preset;
    pushToHistory();
    // 在正片模式下，不应该应用反转设置
    setInverted(sourceType === 'positive' ? false : params.inverted);
    setInversionMode(params.inversionMode);
    setExposure(params.exposure);
    setContrast(params.contrast);
    setHighlights(params.highlights);
    setShadows(params.shadows);
    setWhites(params.whites);
    setBlacks(params.blacks);
    setTemp(params.temp);
    setTint(params.tint);
    setRed(params.red);
    setGreen(params.green);
    setBlue(params.blue);
    // 片基校正 (Pre-Inversion) - 兼容旧预设
    setBaseMode(params.baseMode ?? 'log');
    setBaseRed(params.baseRed ?? 1.0);
    setBaseGreen(params.baseGreen ?? 1.0);
    setBaseBlue(params.baseBlue ?? 1.0);
    setBaseDensityR(params.baseDensityR ?? 0.0);
    setBaseDensityG(params.baseDensityG ?? 0.0);
    setBaseDensityB(params.baseDensityB ?? 0.0);
    setCurves(JSON.parse(JSON.stringify(params.curves)));
    
    // New Params
    setHslParams(params.hslParams || DEFAULT_HSL_PARAMS);
    setSplitToning(params.splitToning || DEFAULT_SPLIT_TONE_PARAMS);
    setSaturation(params.saturation ?? 0);
    setFilmCurveEnabled(!!params.filmCurveEnabled);
    if (params.filmCurveProfile) setFilmCurveProfile(params.filmCurveProfile);

    // Default to clear LUTs if not in preset, or restore
    const restoreLut = (l) => {
      if (!l) return null;
      // If data is array (from JSON), convert to Float32Array
      if (l.data && Array.isArray(l.data)) {
        return { ...l, data: new Float32Array(l.data) };
      }
      return l;
    };
    setLut1(restoreLut(params.lut1));
    setLut2(restoreLut(params.lut2));
  };

  const deletePreset = async (name) => {
    const target = presets.find(p => p.name === name);
    if (target && target.id) {
      try {
        await deletePresetApi(target.id);
      } catch (e) {
        console.warn('Failed to delete preset in backend, still removing locally', e);
      }
    }
    persistPresets(presets.filter(p => p.name !== name));
  };

  // Placeholder for applying preset to entire roll (requires parent context)
  const applyPresetToRoll = async (preset) => {
    if (!preset) return;
    if (!rollId) {
      applyPreset(preset);
      if (typeof window !== 'undefined') alert('未提供 rollId，已仅对当前图像应用预设。');
      return;
    }
    try {
      const res = await setRollPreset(rollId, { name: preset.name, params: preset.params });
      applyPreset(preset);
      if (res && res.ok && typeof window !== 'undefined') {
        alert(`预设 "${preset.name}" 已保存到整卷（roll ${rollId}）。后续可在访问该卷时默认加载。`);
      }
    } catch (e) {
      console.error('Set roll preset failed', e);
      if (typeof window !== 'undefined') alert('保存整卷预设失败: ' + e.message);
    }
  };

  // History
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

  const pushToHistory = () => {
    setHistory(prev => [...prev, {
      inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect,
      lut1: lut1 ? { ...lut1 } : null,
      lut2: lut2 ? { ...lut2 } : null
    }]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const current = { inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect };
    
    setFuture(prev => [...prev, current]);
    setHistory(prev => prev.slice(0, -1));
    
    // 在正片模式下，不应该恢复反转设置
    setInverted(sourceType === 'positive' ? false : previous.inverted);
    setExposure(previous.exposure);
    setContrast(previous.contrast);
    setHighlights(previous.highlights || 0);
    setShadows(previous.shadows || 0);
    setWhites(previous.whites || 0);
    setBlacks(previous.blacks || 0);
    setTemp(previous.temp);
    setTint(previous.tint);
    setRed(previous.red);
    setGreen(previous.green);
    setBlue(previous.blue);
    setCurves(previous.curves);
    setRotation(previous.rotation || 0);
    setCropRect(previous.cropRect || { x: 0, y: 0, w: 1, h: 1 });
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const current = { inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect };
    
    setHistory(prev => [...prev, current]);
    setFuture(prev => prev.slice(0, -1));
    
    // 在正片模式下，不应该恢复反转设置
    setInverted(sourceType === 'positive' ? false : next.inverted);
    setExposure(next.exposure);
    setContrast(next.contrast);
    setHighlights(next.highlights || 0);
    setShadows(next.shadows || 0);
    setWhites(next.whites || 0);
    setBlacks(next.blacks || 0);
    setTemp(next.temp);
    setTint(next.tint);
    setRed(next.red);
    setGreen(next.green);
    setBlue(next.blue);
    setCurves(next.curves);
    setRotation(next.rotation || 0);
    setCropRect(next.cropRect || { x: 0, y: 0, w: 1, h: 1 });
  };

  const handleReset = () => {
    pushToHistory();
    isManualCropRef.current = false; // Reset manual crop flag
    setInverted(false); // Reset to false
    setExposure(0);
    setContrast(0);
    setHighlights(0);
    setShadows(0);
    setWhites(0);
    setBlacks(0);
    setTemp(0);
    setTint(0);
    setRed(1.0);
    setGreen(1.0);
    setBlue(1.0);
    // 重置片基校正
    setBaseMode('log');
    setBaseRed(1.0);
    setBaseGreen(1.0);
    setBaseBlue(1.0);
    setBaseDensityR(0.0);
    setBaseDensityG(0.0);
    setBaseDensityB(0.0);
    setRotation(0);
    setOrientation(0);
    setCropRect({ x: 0, y: 0, w: 1, h: 1 });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLut1(null);
    setLut2(null);
    setCurves({
      rgb: [{x:0, y:0}, {x:255, y:255}],
      red: [{x:0, y:0}, {x:255, y:255}],
      green: [{x:0, y:0}, {x:255, y:255}],
      blue: [{x:0, y:0}, {x:255, y:255}]
    });
    // 重置 HSL 和分离色调
    setHslParams({ ...DEFAULT_HSL_PARAMS });
    setSplitToning({ ...DEFAULT_SPLIT_TONE_PARAMS });
  };

  useEffect(() => {
    setImage(null);
    
    // 使用共享工具函数检测是否需要服务器解码（RAW/TIFF 文件浏览器无法直接加载）
    const needsServerDecode = requiresServerDecode(imageUrl);
    const isRawImage = isRawFile(imageUrl);
    
    if (needsServerDecode && photoId) {
        // Load proxy via API - server will decode RAW/TIFF to JPEG
        let active = true;
        (async () => {
            try {
                // Request a "flat" preview (no params) to serve as the base image
                // We use a reasonably large size for the editor base
                // 传入 sourceType 以确保加载正确的源文件
                // 对于 RAW 文件，服务器会自动解码为 TIFF 再处理
                // 使用 smartFilmlabPreview 支持混合模式
                console.log(`[FilmLab] Loading ${isRawImage ? 'RAW' : 'TIFF'} file via smart proxy...`);
                const res = await smartFilmlabPreview({ photoId, params: {}, maxWidth: 2000, sourceType });
                if (active && res.ok) {
                    const url = URL.createObjectURL(res.blob);
                    const img = new Image();
                    img.onload = () => { if (active) setImage(img); };
                    img.src = url;
                    // Proxy is stripped of EXIF, so no browser auto-rotation to compensate
                    setRotationOffset(0);
                } else if (active) {
                    console.warn(`Failed to load ${isRawImage ? 'RAW' : 'TIFF'} proxy`, res.error);
                }
            } catch (e) {
                if (active) console.error(`Failed to load ${isRawImage ? 'RAW' : 'TIFF'} proxy`, e);
            }
        })();
        return () => { active = false; };
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
    };
    img.onerror = (e) => {
      console.error('Failed to load image:', imageUrl, e);
      // 如果直接加载失败且有 photoId，尝试通过智能路由代理加载
      if (photoId) {
        console.log('Attempting to load via smart proxy...');
        (async () => {
          try {
            const res = await smartFilmlabPreview({ photoId, params: {}, maxWidth: 2000, sourceType });
            if (res.ok) {
              const url = URL.createObjectURL(res.blob);
              const proxyImg = new Image();
              proxyImg.onload = () => setImage(proxyImg);
              proxyImg.onerror = () => console.error('Proxy load also failed');
              proxyImg.src = url;
            }
          } catch (err) {
            console.error('Proxy load failed:', err);
          }
        })();
      }
    };

    // Fetch and parse EXIF to detect browser auto-rotation
    fetch(imageUrl)
      .then(res => res.arrayBuffer())
      .then(buffer => {
         // Check if TIFF (II or MM)
         const view = new DataView(buffer);
         const isTiffHeader = (view.byteLength >= 2) && (view.getUint16(0, false) === 0x4949 || view.getUint16(0, false) === 0x4D4D);

         const orientation = getExifOrientation(buffer);
         
         // If TIFF, assume browser does NOT auto-rotate (Chromium behavior).
         // So we do NOT need to compensate for browser rotation.
         if (isTiffHeader) {
             setRotationOffset(0);
             return;
         }

         // Map EXIF orientation to degrees needed to UN-rotate (or compensate)
         // Browser rotates by:
         // 6 -> 90 CW
         // 3 -> 180
         // 8 -> 270 CW (-90)
         // We want to subtract this rotation.
         let offset = 0;
         if (orientation === 6) offset = -90;
         else if (orientation === 3) offset = -180;
         else if (orientation === 8) offset = -270; // or 90
         setRotationOffset(offset);
      })
      .catch(e => console.warn('Failed to parse EXIF', e));
  }, [imageUrl, photoId, sourceType]);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Trigger redraw when:
    // 1. geometry/compare mode changes
    // 2. webglParams changes (for instant local WebGL/CPU preview)
    // Note: Server preview has been removed - all rendering is now client-side
    if (processRafRef.current) cancelAnimationFrame(processRafRef.current);
    processRafRef.current = requestAnimationFrame(() => { processImage(); });
    return () => { if (processRafRef.current) { cancelAnimationFrame(processRafRef.current); processRafRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, orientation, isCropping, isRotating, webglParams]);

  // Render original (unprocessed) image for compare modes when geometry changes or image loads
  useEffect(() => {
    if (!image || !origCanvasRef.current) return;
    if (compareMode === 'off') return;
    renderOriginal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, orientation, isCropping, compareMode]);

  // Consolidated Crop/Rotation Logic (Rewrite)
  useEffect(() => {
    if (!image) return;
    if (!isCropping) return;
    
    // Determine the natural aspect ratio of the rotated image to guide the safe rect calculation.
    // If rotated 90/270, the "safe" area should be portrait-oriented (if original was landscape).
    // We use the rotated bounding box aspect ratio as a proxy for the "visual" aspect ratio.
    const totalRot = rotation + orientation + rotationOffset;
    const rad = (totalRot * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = image.width * cos + image.height * sin;
    const rotH = image.width * sin + image.height * cos;
    const boxRatio = (rotH > 0) ? rotW / rotH : 1;

    // Pass boxRatio as the target aspect for the safe rect in "free" mode, 
    // so it doesn't try to fit a landscape safe-rect into a portrait rotated image.
    const safe = getMaxSafeRect(image.width, image.height, totalRot, boxRatio);
    const aspect = getPresetRatio(ratioMode, image, orientation, ratioSwap);
    
    setCropRect(prev => {
      // If free mode, just ensure we are inside safe area
      if (!aspect) {
         let w = Math.min(prev.w, safe.w);
         let h = Math.min(prev.h, safe.h);
         const cx = prev.x + prev.w / 2;
         const cy = prev.y + prev.h / 2;
         let x = Math.min(Math.max(cx - w / 2, safe.x), safe.x + safe.w - w);
         let y = Math.min(Math.max(cy - h / 2, safe.y), safe.y + safe.h - h);
         return { x, y, w, h };
      }

      // Ratio mode: fit exact ratio within safe area, preserving center
      // Adjust target aspect by box ratio because cropRect is in normalized coordinates
      const effectiveAspect = aspect / boxRatio;

      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      
      // Calculate max dimensions that fit in safe area with correct aspect
      // We want to fit 'effectiveAspect' into 'safe' rect.
      // safe is normalized.
      
      // Try fitting by width (constrained by safe.w)
      let w = safe.w;
      let h = w / effectiveAspect;
      
      // If height exceeds safe height, constrain by height
      if (h > safe.h) {
        h = safe.h;
        w = h * effectiveAspect;
      }
      
      // Now we have the MAXIMUM rect that fits.
      // But we might want to preserve the user's current zoom/crop size if possible?
      // If the user is just rotating, we don't want the crop to jump to full size.
      // But if the user just selected a new ratio, we probably want to maximize it?
      // The useEffect triggers on both.
      
      // Heuristic: If the previous crop was "close" to full size (or invalid aspect), reset to max.
      // If the previous crop was a small specific crop, try to maintain its area?
      
      // Let's try to maintain the 'scale' of the crop relative to the image.
      // Current scale = prev.w (normalized width).
      // We want new w to be close to prev.w, but constrained by aspect.
      
      let targetW = Math.min(prev.w, safe.w);
      let targetH = targetW / effectiveAspect;
      
      if (targetH > safe.h) {
         targetH = safe.h;
         targetW = targetH * effectiveAspect;
      }
      
      // Use the calculated target dimensions
      w = targetW;
      h = targetH;
      
      // Center and clamp
      let x = Math.min(Math.max(cx - w / 2, safe.x), safe.x + safe.w - w);
      let y = Math.min(Math.max(cy - h / 2, safe.y), safe.y + safe.h - h);
      
      return { x, y, w, h };
    });
  }, [isCropping, ratioMode, ratioSwap, rotation, orientation, rotationOffset, image]);


  const handleCanvasClick = (e) => {
    if (hasPannedRef.current) return;
    if ((!isPicking && !isPickingBase && !isPickingWB) || !image || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    // 点击位置相对于canvas的坐标（CSS坐标转canvas坐标）
    const clickX = (e.clientX - rect.left) * (canvas.width / rect.width);
    const clickY = (e.clientY - rect.top) * (canvas.height / rect.height);

    const kernel = 3; // sample 3x3 neighborhood
    
    // 创建临时canvas来采样原始图像
    // 关键：必须与显示canvas的尺寸和transform完全一致
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
    
    // 直接使用显示canvas的尺寸，确保坐标系一致
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    
    // 计算transform参数
    // 使用客户端预览宽度（服务器预览已移除）
    const maxWidth = PREVIEW_MAX_WIDTH_CLIENT;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;
    
    // 应用crop（与processImage一致）
    let eff = { x: 0, y: 0, w: 1, h: 1 };
    if (!isCropping && committedCrop) {
      const crx = Math.max(0, Math.min(1, committedCrop.x || 0));
      const cry = Math.max(0, Math.min(1, committedCrop.y || 0));
      const crw = Math.max(0, Math.min(1 - crx, committedCrop.w || 1));
      const crh = Math.max(0, Math.min(1 - cry, committedCrop.h || 1));
      eff = { x: crx, y: cry, w: crw, h: crh };
    }
    
    const cropX = eff.x * rotatedW;
    const cropY = eff.y * rotatedH;
    
    // 绘制旋转后的原始图像（与processImage CPU路径完全相同的transform）
    tempCtx.save();
    tempCtx.translate(-cropX, -cropY);
    tempCtx.translate(rotatedW / 2, rotatedH / 2);
    tempCtx.rotate(rad);
    tempCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    tempCtx.restore();
    
    // 现在clickX/clickY直接对应tempCanvas坐标
    const x = Math.max(0, Math.min(tempCanvas.width - kernel, Math.floor(clickX - kernel / 2)));
    const y = Math.max(0, Math.min(tempCanvas.height - kernel, Math.floor(clickY - kernel / 2)));
    
    const imgData = tempCtx.getImageData(x, y, kernel, kernel).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let ky = 0; ky < kernel; ky++) {
      for (let kx = 0; kx < kernel; kx++) {
        const idx = (ky * kernel + kx) * 4;
        const a = imgData[idx + 3];
        if (a === 0) continue; // 跳过透明像素
        r += imgData[idx + 0];
        g += imgData[idx + 1];
        b += imgData[idx + 2];
        count++;
      }
    }
    
    if (count === 0) {
      console.warn('[FilmLab] WB Picker: no valid pixels sampled');
      return;
    }
    
    r /= count;
    g /= count;
    b /= count;

    if (isPickingBase) {
      // Film Base Picker: 采样原始颜色，设置base校正让它变成白色
      // 使用独立的 baseRed/Green/Blue 而非标准白平衡
      const safeR = Math.max(1, r);
      const safeG = Math.max(1, g);
      const safeB = Math.max(1, b);
      
      pushToHistory();
      
      // 根据当前模式设置相应的校正值
      if (baseMode === 'log') {
        // 对数域模式：计算并存储密度值
        const minT = 0.001;
        const densityR = -Math.log10(Math.max(safeR / 255, minT));
        const densityG = -Math.log10(Math.max(safeG / 255, minT));
        const densityB = -Math.log10(Math.max(safeB / 255, minT));
        
        setBaseDensityR(densityR);
        setBaseDensityG(densityG);
        setBaseDensityB(densityB);
        // 同时更新线性增益以保持兼容性
        setBaseRed(255 / safeR);
        setBaseGreen(255 / safeG);
        setBaseBlue(255 / safeB);
      } else {
        // 线性模式：使用增益
        setBaseRed(255 / safeR);
        setBaseGreen(255 / safeG);
        setBaseBlue(255 / safeB);
        setBaseDensityR(0.0);
        setBaseDensityG(0.0);
        setBaseDensityB(0.0);
      }
      // 不再修改标准 WB 的 red/green/blue 和 temp/tint
      
      setIsPickingBase(false);
      return;
    }

    if (isPickingWB) {
      // WB Picker: The clicked point should become neutral gray
      // Sample from the RENDERED canvas (already has all effects applied)
      const renderedCtx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      const renderedData = renderedCtx.getImageData(
        Math.max(0, Math.floor(clickX - 1)),
        Math.max(0, Math.floor(clickY - 1)),
        3, 3
      ).data;
      
      // Average the 3x3 kernel from rendered canvas
      let rRendered = 0, gRendered = 0, bRendered = 0, renderedCount = 0;
      for (let i = 0; i < renderedData.length; i += 4) {
        const a = renderedData[i + 3];
        if (a < 128) continue;
        rRendered += renderedData[i];
        gRendered += renderedData[i + 1];
        bRendered += renderedData[i + 2];
        renderedCount++;
      }
      
      if (renderedCount === 0) {
        console.warn('[FilmLab] WB Picker: no valid pixels sampled from rendered canvas');
        setIsPickingWB(false);
        return;
      }
      
      rRendered /= renderedCount;
      gRendered /= renderedCount;
      bRendered /= renderedCount;
      
      console.log('[WB Picker] Sampled pixel:', { r: rRendered.toFixed(2), g: gRendered.toFixed(2), b: bRendered.toFixed(2) });
      
      // CRITICAL FIX: Compensate for current WB gains before solving.
      // The rendered canvas already has WB gains baked in (c *= u_gains in shader).
      // Without compensation, the solver sees already-corrected values and computes
      // near-zero temp/tint, effectively undoing any prior WB adjustment (Auto WB
      // or manual). We divide out the current gains to approximate the pre-WB pixel,
      // then solve for the correct absolute temp/tint.
      // NOTE: Post-WB pipeline effects (exposure, contrast, curves) introduce a small
      // approximation error, but exposure is a uniform scale (ratio-preserving) and
      // contrast/curves are typically small — this is accurate for practical use.
      const currentGains = computeWBGains({ red, green, blue, temp, tint });
      const preR = rRendered / Math.max(0.001, currentGains[0]);
      const preG = gRendered / Math.max(0.001, currentGains[1]);
      const preB = bRendered / Math.max(0.001, currentGains[2]);
      
      console.log('[WB Picker] Current gains:', currentGains.map(g => g.toFixed(4)),
        'Pre-WB estimate:', { r: preR.toFixed(2), g: preG.toFixed(2), b: preB.toFixed(2) });
      
      const solved = solveTempTintFromSample([preR, preG, preB], { red, green, blue });
      
      if (solved && Number.isFinite(solved.temp) && Number.isFinite(solved.tint)) {
        pushToHistory();
        setTemp(solved.temp);
        setTint(solved.tint);
      } else {
        console.warn('[FilmLab] WB Picker failed to solve temp/tint');
      }
      setIsPickingWB(false);
      return;
    }

    // Regular color picker - sample from the rendered canvas directly
    if (isPicking) {
      // Get pixel directly from the displayed canvas at click location
      const renderedCtx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
      const renderedData = renderedCtx.getImageData(
        Math.max(0, Math.floor(clickX - 1)),
        Math.max(0, Math.floor(clickY - 1)),
        3, 3
      ).data;
      
      // Average the 3x3 kernel from rendered canvas
      let rRendered = 0, gRendered = 0, bRendered = 0, renderedCount = 0;
      for (let i = 0; i < renderedData.length; i += 4) {
        const a = renderedData[i + 3];
        if (a < 128) continue;
        rRendered += renderedData[i];
        gRendered += renderedData[i + 1];
        bRendered += renderedData[i + 2];
        renderedCount++;
      }
      
      if (renderedCount > 0) {
        rRendered /= renderedCount;
        gRendered /= renderedCount;
        bRendered /= renderedCount;
      }
      
      setPickedColor({ r: rRendered, g: gRendered, b: bRendered });
      setIsPicking(false); // Auto-exit picker mode after pick
      return;
    }
  };

  // ============================================================================
  // Main Image Processing Function
  // ============================================================================
  // Three rendering paths:
  // 1. Server Preview (remoteImg): Use pre-rendered image from server (fastest)
  // ============================================================================
  // processImage - Unified client-side rendering
  // ============================================================================
  // Rendering paths:
  // 1. WebGL Path (useGPU): GPU-accelerated processing (fast, real-time)
  // 2. CPU Path: Fallback pixel-by-pixel processing (slower, most compatible)
  // Note: Server preview has been removed - see comment block after this function
  const processImage = () => {
    try {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 重要：指定 colorSpace 为 srgb 以匹配 WebGL 输出
    const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
    if (!ctx) return;
    // Nothing to render if base image is not ready
    if (!image) return;
    
    // ========================================================================
    // Client-side rendering (WebGL or CPU)
    // ========================================================================
    if (!geometry) return;
    const { rotatedW, rotatedH, rad, scaledW, scaledH } = geometry;

    // In crop mode, show full rotated image. Outside crop mode, preview committed crop.
    let eff = { x: 0, y: 0, w: 1, h: 1 };
    if (!isCropping && committedCrop) {
      const crx = Math.max(0, Math.min(1, committedCrop.x || 0));
      const cry = Math.max(0, Math.min(1, committedCrop.y || 0));
      const crw = Math.max(0, Math.min(1 - crx, committedCrop.w || 1));
      const crh = Math.max(0, Math.min(1 - cry, committedCrop.h || 1));
      eff = { x: crx, y: cry, w: crw, h: crh };
    }

    // Try WebGL path if GPU is enabled and available
    let sourceForDraw = image;
    let useDirectDraw = false;
    let webglSuccess = false;
    
    if (useGPU && isWebGLAvailable()) {
       try {
          // Optimization: Reuse cached WebGL canvas if parameters haven't changed
          if (processedCanvasRef.current && lastWebglParamsRef.current === webglParams) {
             sourceForDraw = processedCanvasRef.current;
             useDirectDraw = true;
             webglSuccess = true;
          } else {
              // 使用临时 canvas 进行 WebGL 渲染
              const webglCanvas = document.createElement('canvas');
              
              const { gains, lut1: wpLut1, lut2: wpLut2 } = webglParams;
              
              // 重要：使用 webglParams 中的 lut1/lut2 而不是直接使用状态变量
              // 这确保我们使用的是触发此次渲染的正确 LUT 数据
              let combinedLUT = null;
              if ((wpLut1 && wpLut1.intensity > 0) || (wpLut2 && wpLut2.intensity > 0)) {
                 // 合并两个 LUT（如果都存在）或直接使用单个 LUT
                 combinedLUT = buildCombinedLUT(wpLut1, wpLut2);
              }
              
              // Pass rotation and crop parameters to WebGL for correct geometry
              const totalRotation = rotation + orientation + rotationOffset;
              const cropRect = isCropping ? null : committedCrop;
              
              // Get Film Curve profile parameters (Q13: per-channel gamma + toe/shoulder)
              const currentFilmProfile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);
              const filmCurveGamma = currentFilmProfile?.gamma ?? 0.6;
              const filmCurveGammaR = currentFilmProfile?.gammaR ?? filmCurveGamma;
              const filmCurveGammaG = currentFilmProfile?.gammaG ?? filmCurveGamma;
              const filmCurveGammaB = currentFilmProfile?.gammaB ?? filmCurveGamma;
              const filmCurveDMin = currentFilmProfile?.dMin ?? 0.1;
              const filmCurveDMax = currentFilmProfile?.dMax ?? 3.0;
              const filmCurveToe = currentFilmProfile?.toe ?? 0;
              const filmCurveShoulder = currentFilmProfile?.shoulder ?? 0;
              
              // webglParams.inverted 已经根据 sourceType 计算过了
                processImageWebGL(webglCanvas, image, {
                  inverted: webglParams.inverted, inversionMode, gains,
                  // 片基校正 (Pre-Inversion) - 支持线性和对数模式
                  baseMode: webglParams.baseMode,
                  baseGains: webglParams.baseGains,
                  baseDensity: webglParams.baseDensity,
                  // 密度色阶 (Log domain auto-levels)
                  densityLevelsEnabled: webglParams.densityLevelsEnabled,
                  densityLevels: webglParams.densityLevels,
                  exposure, contrast, highlights, shadows, whites, blacks,
                  filmCurveEnabled, filmCurveGamma, filmCurveGammaR, filmCurveGammaG, filmCurveGammaB,
                  filmCurveDMin, filmCurveDMax, filmCurveToe, filmCurveShoulder,
                  rotate: totalRotation,
                  cropRect: cropRect,
                  // pass preview scale to ensure WebGL output uses the same downscale as CPU/geometry
                  scale: webglParams.scale,
                  curves: {
                    rgb: getCurveLUT(curves.rgb),
                    red: getCurveLUT(curves.red),
                    green: getCurveLUT(curves.green),
                    blue: getCurveLUT(curves.blue)
                 },
                 lut3: combinedLUT,
                 // HSL and Split Toning parameters
                 hslParams,
                 splitToning
              });
              
              processedCanvasRef.current = webglCanvas;
              lastWebglParamsRef.current = webglParams;
              sourceForDraw = webglCanvas;
              useDirectDraw = true;
              webglSuccess = true;  // 重要：必须设置，否则后续的调试代码不会执行
          }
       } catch(e) {
          webglSuccess = false;
          useDirectDraw = false;
          console.error("WebGL failed", e);
       }
    }

    if (useDirectDraw) {
        // WebGL path: canvas is already processed, rotated and cropped
        canvas.width = sourceForDraw.width;
        canvas.height = sourceForDraw.height;
        
        // Draw WebGL result to display canvas
        ctx.drawImage(sourceForDraw, 0, 0);
    } else {
        // CPU path: apply transforms manually
        const outW = Math.max(1, Math.round(rotatedW * eff.w));
        const outH = Math.max(1, Math.round(rotatedH * eff.h));
        canvas.width = outW;
        canvas.height = outH;

        const cropX = eff.x * rotatedW;
        const cropY = eff.y * rotatedH;

        ctx.save();
        // Shift so that crop area maps to (0,0)
        ctx.translate(-cropX, -cropY);
        ctx.translate(rotatedW / 2, rotatedH / 2);
        ctx.rotate(rad);
        ctx.drawImage(sourceForDraw, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
        ctx.restore();
    }
    
    // Optimization: Skip reading back pixels if using WebGL and rotating (histograms skipped anyway)
    let imageData = null;
    let data = null;
    
    if (!webglSuccess || !isRotating) {
        // Safety: ensure canvas has valid dimensions before getImageData (avoids IndexSizeError)
        if (canvas.width > 0 && canvas.height > 0) {
          try {
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            data = imageData.data;
          } catch (readbackErr) {
            console.warn('[FilmLab] getImageData failed:', readbackErr.message);
          }
        }
    }

    // Histogram buckets
    const histRGB = new Array(256).fill(0);
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    let maxCount = 0;

    // Downsample histogram & processing for speed: skip every other pixel in X/Y.
    const stride = isCropping ? 6 : 2; // Higher stride during cropping for smoothness
    const width = canvas.width;
    const height = canvas.height;

    // ========================================================================
    // Histogram Scan Area Calculation
    // ========================================================================
    // When cropping, the canvas shows the FULL rotated image, but the histogram
    // should only reflect the CROPPED area to give accurate feedback.
    // We calculate the scan bounds based on the current cropRect.
    // ========================================================================
    let scanStartX = 0, scanStartY = 0;
    let scanEndX = width, scanEndY = height;
    
    if (isCropping && cropRect && webglSuccess) {
        // Map normalized cropRect (0-1) to canvas pixel coordinates
        // cropRect is in "rotated image space", and canvas is showing the full rotated image
        scanStartX = Math.max(0, Math.floor(cropRect.x * width));
        scanStartY = Math.max(0, Math.floor(cropRect.y * height));
        scanEndX = Math.min(width, Math.floor((cropRect.x + cropRect.w) * width));
        scanEndY = Math.min(height, Math.floor((cropRect.y + cropRect.h) * height));
    }

    // Optimization: Split paths for WebGL vs CPU to avoid checks inside the loop
    if (webglSuccess) {
        // WebGL Path: Image is already drawn. We only need histograms.
        // If rotating, skip histograms entirely to maintain 60fps.
        if (!isRotating && data) {
             for (let y = scanStartY; y < scanEndY; y += stride) {
                for (let x = scanStartX; x < scanEndX; x += stride) {
                    const idx = (y * width + x) * 4;
                    // Skip transparent pixels
                    if (data[idx + 3] === 0) continue;

                    const r = data[idx];
                    const g = data[idx+1];
                    const b = data[idx+2];
                    
                    histR[r]++; histG[g]++; histB[b]++;
                    const lum = Math.round(0.299*r + 0.587*g + 0.114*b);
                    histRGB[lum]++;
                    maxCount = Math.max(maxCount, histR[r], histG[g], histB[b], histRGB[lum]);
                }
             }
        }
        // No need to putImageData, it's already on the canvas from drawImage(webglCanvas)
    } else {
        // CPU Path: 使用统一渲染核心
        // 使用统一的 getEffectiveInverted 函数计算有效反转状态
        const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
        const core = new RenderCore({
          exposure, contrast, highlights, shadows, whites, blacks,
          curves, red, green, blue, temp, tint, lut1, lut2,
          lut1Intensity: lut1?.intensity ?? 1.0,
          lut2Intensity: lut2?.intensity ?? 1.0,
          inverted: effectiveInvertedValue, inversionMode, filmCurveEnabled, filmCurveProfile,
          hslParams, splitToning,
          saturation,
          // 片基校正 (Pre-Inversion)
          baseRed, baseGreen, baseBlue,
          // 对数域片基校正参数
          baseMode, baseDensityR, baseDensityG, baseDensityB,
          // 密度色阶 (Density Levels)
          densityLevelsEnabled, densityLevels
        });
        core.prepareLUTs();

        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx + 3] === 0) continue;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            // 使用 RenderCore 进行一致的像素处理
            const [rC, gC, bC] = core.processPixel(r, g, b);

            // Update Histograms only for subsampled pixels
            if ((x % stride === 0) && (y % stride === 0)) {
              const rIdx = Math.round(rC);
              const gIdx = Math.round(gC);
              const bIdx = Math.round(bC);

              histR[rIdx]++;
              histG[gIdx]++;
              histB[bIdx]++;

              // Calculate luminance for RGB histogram
              const lum = Math.round(0.299 * rC + 0.587 * gC + 0.114 * bC);
              histRGB[lum]++;

              // Track max for normalization across all channels
              maxCount = Math.max(maxCount, histR[rIdx], histG[gIdx], histB[bIdx], histRGB[lum]);
            }

            // Write back processed pixel
            data[idx] = rC;
            data[idx + 1] = gC;
            data[idx + 2] = bC;
          }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Normalize histograms
    if (!isRotating && maxCount > 0) {
      for(let i=0; i<256; i++) {
        histRGB[i] /= maxCount;
        histR[i] /= maxCount;
        histG[i] /= maxCount;
        histB[i] /= maxCount;
      }
    }
    if (!isRotating) {
      setHistograms({ rgb: histRGB, red: histR, green: histG, blue: histB });
    }
    } catch (processImageError) {
      // 捕获 processImage 中的所有异常，防止传播到 React 导致整棵组件树卸载（黑屏）
      console.error('[FilmLab] processImage error (caught, UI preserved):', processImageError);
    }
  } // <-- Close processImage function

  // ============================================================================
  // Server Preview - REMOVED
  // ============================================================================
  // The server preview feature has been removed because:
  // 1. LUT parameters were not sent to server, causing color mismatches
  // 2. WebGL/CPU client-side rendering is fast enough for real-time preview
  // 3. Reduces network overhead and complexity
  // 4. Eliminates synchronization issues between server and client rendering
  //
  // If server preview needs to be re-enabled in the future:
  // - LUT data must be serialized and sent with preview requests
  // - Server must deserialize and apply LUTs via RenderCore
  // - Consider network overhead (~130KB per LUT)
  // ============================================================================

  const renderOriginal = () => {
    if (!image || !origCanvasRef.current) return;
    const canvas = origCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    // Always show full rotated image for original comparison
    canvas.width = Math.round(rotatedW);
    canvas.height = Math.round(rotatedH);
    ctx.save();
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();
  };

  const handleAutoLevels = () => {
    if (!image) return;
    pushToHistory();
    
    // Use current histograms to find min/max
    // We want to stretch the histogram to fill 0-255
    // We will update the curves to do this
    
    const findLevels = (hist) => {
      let min = 0;
      let max = 255;
      
      // Find min (0.1% threshold)
      // Histograms are normalized (0-1), so sum is ~1 (or maxCount normalized)
      // Actually my histogram logic normalizes by maxCount, not sum.
      // So values are 0-1 relative to the peak.
      // We need to be careful. Let's just look for the first non-zero bucket with some noise tolerance.
      
      // Simple approach: First value > 0.005 (0.5% of peak)
      const threshold = 0.005;
      
      for (let i = 0; i < 256; i++) {
        if (hist[i] > threshold) {
          min = i;
          break;
        }
      }
      
      for (let i = 255; i >= 0; i--) {
        if (hist[i] > threshold) {
          max = i;
          break;
        }
      }
      
      return { min, max };
    };

    const rLevels = findLevels(histograms.red);
    const gLevels = findLevels(histograms.green);
    const bLevels = findLevels(histograms.blue);

    setCurves(prev => ({
      ...prev,
      red: [{x: rLevels.min, y: 0}, {x: rLevels.max, y: 255}],
      green: [{x: gLevels.min, y: 0}, {x: gLevels.max, y: 255}],
      blue: [{x: bLevels.min, y: 0}, {x: bLevels.max, y: 255}]
    }));
  };

  const handleAutoColor = () => {
    // Sample from the RENDERED canvas (after all effects: inversion, base gains, exposure, etc.)
    // Auto WB calculates temp/tint to neutralize the average color
    if (!canvasRef.current) return;
    pushToHistory();
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Sample the already-rendered canvas
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;
    
    // Sample with stride for performance
    const stride = 4;
    for (let y = 0; y < canvas.height; y += stride) {
      for (let x = 0; x < canvas.width; x += stride) {
        const i = (y * canvas.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        
        // Skip transparent pixels
        if (a < 128) continue;
        
        // Skip near-black and near-white pixels (unreliable for WB)
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        if (lum < 10 || lum > 245) continue;
        
        rSum += r;
        gSum += g;
        bSum += b;
        count++;
      }
    }
    
    if (count === 0) {
      return;
    }

    const rAvg = rSum / count;
    const gAvg = gSum / count;
    const bAvg = bSum / count;
    
    console.log('[Auto WB] Sampled averages:', { rAvg: rAvg.toFixed(2), gAvg: gAvg.toFixed(2), bAvg: bAvg.toFixed(2), count });
    
    // CRITICAL FIX: Compensate for current WB gains before solving.
    // The rendered canvas already has WB gains applied. Without compensation,
    // calling Auto WB a second time would see already-corrected pixels and
    // compute near-zero temp/tint, undoing the first correction.
    // By dividing out current gains we recover the approximate pre-WB pixel
    // values, making Auto WB idempotent (clicking twice gives the same result).
    const currentGains = computeWBGains({ red, green, blue, temp, tint });
    const preR = rAvg / Math.max(0.001, currentGains[0]);
    const preG = gAvg / Math.max(0.001, currentGains[1]);
    const preB = bAvg / Math.max(0.001, currentGains[2]);
    
    console.log('[Auto WB] Current gains:', currentGains.map(g => g.toFixed(4)),
      'Pre-WB estimate:', { r: preR.toFixed(2), g: preG.toFixed(2), b: preB.toFixed(2) });
    
    const solved = solveTempTintFromSample([preR, preG, preB], { red, green, blue });
    
    if (solved && Number.isFinite(solved.temp) && Number.isFinite(solved.tint)) {
      setTemp(solved.temp);
      setTint(solved.tint);
    }
  };

  // Curve Editor Constants

  // Crop Interaction - Simplified


  const handleWheel = (e) => {
    // Only zoom if hovering over canvas area
    if (e.target.closest('.iv-sidebar')) return;
    
    const scaleBy = 1.1;
    const newZoom = e.deltaY < 0 ? zoom * scaleBy : zoom / scaleBy;
    setZoom(Math.min(Math.max(0.1, newZoom), 10));
  };

  const handlePanStart = (e) => {
    // Don't pan if clicking on controls or crop handles (handled by stopPropagation)
    if (e.button !== 0) return; // Only left click
    
    e.preventDefault();
    setIsPanning(true);
    hasPannedRef.current = false;
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = pan.x;
    const startPanY = pan.y;

    const handleMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasPannedRef.current = true;
      }
      
      setPan({ x: startPanX + dx, y: startPanY + dy });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // We no longer auto-resize crop on rotation; user controls size/position.

  const handleLutUpload = (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsed = parseCubeLUT(text);
      const lutObj = { name: file.name, ...parsed, intensity: 1.0 };
      
      pushToHistory();
      if (index === 1) setLut1(lutObj);
      else setLut2(lutObj);
    };
    reader.readAsText(file);
  };

  const generateOutputLUT = () => {
    const size = lutExportSize;
    let content = `LUT_3D_SIZE ${size}\n`;
    
    // 使用统一渲染核心
    // 使用统一的 getEffectiveInverted 函数计算有效反转状态
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    const core = new RenderCore({
      exposure, contrast, highlights, shadows, whites, blacks,
      curves, red, green, blue, temp, tint, lut1, lut2,
      lut1Intensity: lut1?.intensity ?? 1.0,
      lut2Intensity: lut2?.intensity ?? 1.0,
      inverted: effectiveInvertedValue, inversionMode, filmCurveEnabled, filmCurveProfile,
      hslParams, splitToning,
      saturation,
      // 片基校正 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      // 对数域片基校正参数
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      // 密度色阶 (Density Levels)
      densityLevelsEnabled, densityLevels
    });
    core.prepareLUTs();

    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          // Original normalized color -> 0-255
          const rIn = (r / (size - 1)) * 255;
          const gIn = (g / (size - 1)) * 255;
          const bIn = (b / (size - 1)) * 255;
          
          // 使用 RenderCore 进行像素处理
          const [rC, gC, bC] = core.processPixel(rIn, gIn, bIn);
          
          // Output normalized
          content += `${(rC/255).toFixed(6)} ${(gC/255).toFixed(6)} ${(bC/255).toFixed(6)}\n`;
        }
      }
    }
    
    // Download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'film-lab-export.cube';
    a.click();
  };

  /*
  const handleExportLUT = () => {
    pushToHistory();
    generateOutputLUT();
  };
  */

  // ============================================================================
  // Save Function (Client-side processing for quick save)
  // ============================================================================
  const handleSave = () => {
    if (!image) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // High-res rotate first
    // 使用 0 (无限制) 或 8000+ 的最大宽度，防止快速保存时横向图片被压缩
    // 这里使用 EXPORT_MAX_WIDTH (已更正为 8000)
    const maxSaveWidth = EXPORT_MAX_WIDTH; 
    const scale = Math.min(1, maxSaveWidth / image.width);
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;

    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = Math.round(scaledW * cos + scaledH * sin);
    const rotatedH = Math.round(scaledW * sin + scaledH * cos);

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.save();
    rotCtx.translate(rotatedW / 2, rotatedH / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    rotCtx.restore();
    
    // Crop from rotated image using committedCrop (confirmed by DONE button)
    let crx = Math.max(0, Math.min(1, committedCrop.x));
    let cry = Math.max(0, Math.min(1, committedCrop.y));
    let crw = Math.max(0, Math.min(1 - crx, committedCrop.w));
    let crh = Math.max(0, Math.min(1 - cry, committedCrop.h));
    const cropX = Math.round(crx * rotCanvas.width);
    const cropY = Math.round(cry * rotCanvas.height);
    const cropW = Math.max(1, Math.round(crw * rotCanvas.width));
    const cropH = Math.max(1, Math.round(crh * rotCanvas.height));

    canvas.width = cropW;
    canvas.height = cropH;
    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 使用统一渲染核心
    // 使用统一的 getEffectiveInverted 函数计算有效反转状态
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    const core = new RenderCore({
      exposure, contrast, highlights, shadows, whites, blacks,
      curves, red, green, blue, temp, tint, lut1, lut2,
      lut1Intensity: lut1?.intensity ?? 1.0,
      lut2Intensity: lut2?.intensity ?? 1.0,
      inverted: effectiveInvertedValue, inversionMode, filmCurveEnabled, filmCurveProfile,
      // 片基校正增益 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      // 对数域片基校正参数
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      // 密度色阶 (Density Levels)
      densityLevelsEnabled, densityLevels,
      hslParams, splitToning
    });
    core.prepareLUTs();

    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const [rC, gC, bC] = core.processPixel(r, g, b);

      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
    }

    ctx.putImageData(imageData, 0, 0);
    
    canvas.toBlob((blob) => {
      if (onSave) onSave(blob);
    }, 'image/jpeg', 1.0);
  };

  const handleHighQualityExport = async () => {
    if (!photoId || hqBusy) return;
    setHqBusy(true);
    try {
      // 将 LUT 数据转换为可序列化格式
      const serializeLut = (lut) => {
        if (!lut || !lut.data || lut.intensity <= 0) return null;
        return {
          size: lut.size,
          data: Array.from(lut.data), // Float32Array -> Array
          intensity: lut.intensity
        };
      };
      
      // Get Film Curve profile parameters (Q13: per-channel gamma + toe/shoulder — same as GPU Export)
      const currentFilmProfile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);
      const filmCurveGamma = currentFilmProfile?.gamma ?? 0.6;
      const filmCurveGammaR = currentFilmProfile?.gammaR ?? filmCurveGamma;
      const filmCurveGammaG = currentFilmProfile?.gammaG ?? filmCurveGamma;
      const filmCurveGammaB = currentFilmProfile?.gammaB ?? filmCurveGamma;
      const filmCurveDMin = currentFilmProfile?.dMin ?? 0.1;
      const filmCurveDMax = currentFilmProfile?.dMax ?? 3.0;
      const filmCurveToe = currentFilmProfile?.toe ?? 0;
      const filmCurveShoulder = currentFilmProfile?.shoulder ?? 0;
      
      const params = {
        sourceType, // 传递源类型以便服务器选择正确的源文件
        inverted: getEffectiveInverted(sourceType, inverted), // 使用统一函数计算有效反转状态
        inversionMode, filmCurveEnabled, filmCurveProfile,
        // Explicitly pass film curve parameters for RenderCore (Q13: per-channel gamma + toe/shoulder)
        filmCurveGamma, filmCurveGammaR, filmCurveGammaG, filmCurveGammaB,
        filmCurveDMin, filmCurveDMax, filmCurveToe, filmCurveShoulder,
        exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue,
        // 片基校正增益 (Pre-Inversion)
        baseRed, baseGreen, baseBlue,
        // 对数域片基校正参数
        baseMode, baseDensityR, baseDensityG, baseDensityB,
        // 密度色阶 (Density Levels)
        densityLevelsEnabled, densityLevels,
        rotation, orientation, cropRect: committedCrop, curves,
        hslParams, splitToning,
        saturation,
        lut1: serializeLut(lut1),
        lut2: serializeLut(lut2),
        lut1Intensity: lut1?.intensity ?? 1.0,
        lut2Intensity: lut2?.intensity ?? 1.0
      };
      // 使用 smartExportPositive 智能路由：服务器有算力用服务器，否则用本地 GPU
      const res = await smartExportPositive(photoId, params, { format: 'jpeg', sourceType });
      if (res && res.ok) {
        // Ask parent to refresh photo list / data
        if (onPhotoUpdate) onPhotoUpdate();
        // 如果有本地文件路径，显示给用户
        if (res.filePath && window.__electron?.showInFolder) {
          console.log('[FilmLab] Export saved to:', res.filePath);
        }
      } else if (res && res.error) {
        if (typeof window !== 'undefined') alert('Export Failed: ' + res.error);
      }
    } catch (e) {
      console.error('High quality export failed', e);
      if (typeof window !== 'undefined') alert('High Quality Export Failed: ' + (e.message || e));
    } finally {
      setHqBusy(false);
    }
  };

  const handleGpuExport = async () => {
    if (gpuBusy) return;
    setGpuBusy(true);
    try {
      // 检查 GPU 是否可用
      if (window.__electron?.filmlabGpuProcess) {
        // Phase 2.4: Build Float32 composite curve LUT (1024×1 RGBA)
        // Replaces the legacy 8-bit 256×1 path — matches CPU float precision
        const toneCurveLutFloat = buildCompositeFloatCurveLUT({
          rgb: curves.rgb,
          red: curves.red,
          green: curves.green,
          blue: curves.blue,
        });

        // Legacy 8-bit LUT (kept as fallback for GPUs without float texture support)
        const lutRGB = getCurveLUT(curves.rgb);
        const lutR = getCurveLUT(curves.red);
        const lutG = getCurveLUT(curves.green);
        const lutB = getCurveLUT(curves.blue);
        
        const toneCurveLut = new Uint8Array(256 * 4); // RGBA
        for (let i = 0; i < 256; i++) {
          let r = i, g = i, b = i;
          r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
          r = lutR[r];
          g = lutG[g];
          b = lutB[b];
          
          toneCurveLut[i * 4 + 0] = r;
          toneCurveLut[i * 4 + 1] = g;
          toneCurveLut[i * 4 + 2] = b;
          toneCurveLut[i * 4 + 3] = 255;
        }

        // Prepare 3D LUTs if any
        let lut3d = null;
        if (lut1 || lut2) {
          lut3d = buildCombinedLUT(lut1, lut2);
        }

        // Get Film Curve profile parameters (Q13: per-channel gamma + toe/shoulder)
        const currentFilmProfile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);
        const filmCurveGamma = currentFilmProfile?.gamma ?? 0.6;
        const filmCurveGammaR = currentFilmProfile?.gammaR ?? filmCurveGamma;
        const filmCurveGammaG = currentFilmProfile?.gammaG ?? filmCurveGamma;
        const filmCurveGammaB = currentFilmProfile?.gammaB ?? filmCurveGamma;
        const filmCurveDMin = currentFilmProfile?.dMin ?? 0.1;
        const filmCurveDMax = currentFilmProfile?.dMax ?? 3.0;
        const filmCurveToe = currentFilmProfile?.toe ?? 0;
        const filmCurveShoulder = currentFilmProfile?.shoulder ?? 0;

        const params = { 
          sourceType,
          inverted: getEffectiveInverted(sourceType, inverted),
          inversionMode, exposure, contrast, highlights, shadows, whites, blacks,
          temp, tint, red, green, blue,
          baseRed, baseGreen, baseBlue,
          baseMode, baseDensityR, baseDensityG, baseDensityB,
          densityLevelsEnabled, densityLevels,
          rotation, orientation,
          filmCurveEnabled, filmCurveGamma, filmCurveGammaR, filmCurveGammaG, filmCurveGammaB,
          filmCurveDMin, filmCurveDMax, filmCurveToe, filmCurveShoulder,
          cropRect: committedCrop,
          toneCurveLutFloat: Array.from(toneCurveLutFloat),
          toneCurveLut: Array.from(toneCurveLut),
          lut3d: lut3d ? { size: lut3d.size, data: Array.from(lut3d.data) } : null,
          hslParams, splitToning
        };
        
        const res = await window.__electron.filmlabGpuProcess({ params, photoId, imageUrl });
        if (res?.ok) {
          if (onPhotoUpdate) onPhotoUpdate();
          if (res.filePath) {
            try { window.__electron.showInFolder && window.__electron.showInFolder(res.filePath); } catch(_){}
            if (typeof window !== 'undefined') alert('GPU Export Saved To:\n' + res.filePath);
          }
          return; // GPU 成功，直接返回
        }
        
        // GPU 失败，尝试 CPU 回退
        console.warn('[FilmLab] GPU export failed, trying CPU fallback:', res?.error);
      } else {
        console.log('[FilmLab] GPU processor not available, using CPU fallback');
      }
      
      // CPU 回退：使用 smartExportPositive（会自动选择可用的渲染方式）
      console.log('[FilmLab] Attempting CPU export fallback');
      const cpuParams = {
        sourceType,
        inverted: getEffectiveInverted(sourceType, inverted),
        inversionMode, filmCurveEnabled, filmCurveProfile,
        exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue,
        baseRed, baseGreen, baseBlue,
        baseMode, baseDensityR, baseDensityG, baseDensityB,
        densityLevelsEnabled, densityLevels,
        rotation, orientation, cropRect: committedCrop, curves,
        hslParams, splitToning,
        saturation,
        // LUT 需要序列化
        lut1: lut1 ? { size: lut1.size, data: Array.from(lut1.data), intensity: lut1.intensity } : null,
        lut2: lut2 ? { size: lut2.size, data: Array.from(lut2.data), intensity: lut2.intensity } : null,
      };
      
      const result = await smartExportPositive(photoId, cpuParams, { format: 'jpeg', sourceType });
      
      if (result?.ok) {
        if (onPhotoUpdate) onPhotoUpdate();
        if (typeof window !== 'undefined') {
          const source = result.source || 'local';
          alert(`Export completed (${source} mode)`);
        }
      } else {
        if (typeof window !== 'undefined') alert('Export Failed: ' + (result?.error || 'Unknown error'));
      }
    } catch (e) {
      console.error('Export failed', e);
      if (typeof window !== 'undefined') alert('Export Failed: ' + (e.message || e));
    } finally {
      setGpuBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!image || !photoId) return;
    // 关键修复：使用 getEffectiveInverted 计算有效反转状态
    const effectiveInvertedForServer = getEffectiveInverted(sourceType, inverted);
    const paramsForServer = { 
      inverted: effectiveInvertedForServer, inversionMode, filmCurveEnabled, filmCurveProfile, 
      exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue,
      // 片基校正增益 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      // 对数域片基校正参数
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      rotation, orientation, cropRect: committedCrop, curves, sourceType 
    };
    // TIFF16 or BOTH use smart render endpoint for high bit depth / parity
    if (saveAsFormat === 'tiff16' || saveAsFormat === 'both') {
      try {
        // JPEG first if BOTH
        if (saveAsFormat === 'both') {
          // Download JPEG via client pipeline (fast) before TIFF
          await downloadClientJPEG();
        }
        // 使用 smartRenderPositive 智能路由
        const r = await smartRenderPositive(photoId, paramsForServer, { format: 'tiff16', sourceType });
        if (!r.ok) {
          if (typeof window !== 'undefined') alert('TIFF16 Render Failed: ' + r.error);
          return;
        }
        triggerBlobDownload(r.blob, `film-lab-render-${Date.now()}.tiff`);
        return;
      } catch (e) {
        console.error('Render-positive TIFF16 failed', e);
        if (typeof window !== 'undefined') alert('TIFF16 Render Failed: ' + (e.message || e));
        return;
      }
    }
    // JPEG path
    await downloadClientJPEG();
  };

  const triggerBlobDownload = (blob, filename) => {
    if (typeof window !== 'undefined' && window.__electron && window.__electron.filmLabSaveAs) {
      window.__electron.filmLabSaveAs({ blob, defaultName: filename }).then(res => {
        if (res && res.ok && res.filePath) {
          try { window.__electron.showInFolder && window.__electron.showInFolder(res.filePath); } catch(_){}
        } else if (res && res.canceled) {
          // user canceled: silently ignore
        } else if (res && res.error) {
          console.warn('Electron save-as failed, falling back to browser download:', res.error);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
        }
      }).catch(err => {
        console.warn('Electron save-as exception, fallback:', err && err.message);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadClientJPEG = () => {
    // If GPU path requested and available AND no external LUT blending (unsupported in WebGL yet), use WebGL for color then CPU for geometry.
    if (useGPU && isWebGLAvailable() && !lut1 && !lut2) {
      try {
        const gains = computeWBGains({ red, green, blue, temp, tint });
        const webglCanvas = document.createElement('canvas');
        // Include LUT if present (combined from lut1/lut2) even in Save As GPU path
        let combinedLUT = null;
        if ((lut1 && lut1.intensity > 0) || (lut2 && lut2.intensity > 0)) {
          const size = (lut1 && lut1.size) || (lut2 && lut2.size);
          if (size) {
            const total = size * size * size;
            const out = new Float32Array(total * 3);
            const aData = lut1 ? lut1.data : null; const aInt = lut1 ? lut1.intensity : 0;
            const bData = lut2 ? lut2.data : null; const bInt = lut2 ? lut2.intensity : 0;
            for (let i = 0, j = 0; i < total; i++, j += 3) {
              const rIdx = i % size;
              const gIdx = Math.floor(i / size) % size;
              const bIdx = Math.floor(i / (size * size));
              let r = rIdx / (size - 1);
              let g = gIdx / (size - 1);
              let b = bIdx / (size - 1);
              if (aData && aInt > 0) {
                const ar = aData[j]; const ag = aData[j+1]; const ab = aData[j+2];
                r = r * (1 - aInt) + ar * aInt;
                g = g * (1 - aInt) + ag * aInt;
                b = b * (1 - aInt) + ab * aInt;
              }
              if (bData && bInt > 0) {
                const br = bData[j]; const bg = bData[j+1]; const bb = bData[j+2];
                r = r * (1 - bInt) + br * bInt;
                g = g * (1 - bInt) + bg * bInt;
                b = b * (1 - bInt) + bb * bInt;
              }
              combinedLUT = { size, data: out };
            }
          }
        }
        // Get Film Curve profile parameters
        const currentFilmProfile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);
        const filmCurveGamma = currentFilmProfile?.gamma ?? 0.6;
        const filmCurveDMin = currentFilmProfile?.dMin ?? 0.1;
        const filmCurveDMax = currentFilmProfile?.dMax ?? 3.0;

        // 使用统一的 getEffectiveInverted 函数计算有效反转状态
        const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);

        processImageWebGL(webglCanvas, image, {
          inverted: effectiveInvertedValue,
          inversionMode,
          gains,
          // 片基校正 (Pre-Inversion) - 支持线性和对数模式
          baseMode,
          baseGains: [baseRed, baseGreen, baseBlue],
          baseDensity: [baseDensityR, baseDensityG, baseDensityB],
          // 密度色阶 (Log domain auto-levels)
          densityLevelsEnabled,
          densityLevels,
          exposure,
          contrast,
          highlights,
          shadows,
          whites,
          blacks,
          filmCurveEnabled,
          filmCurveGamma,
          filmCurveDMin,
          filmCurveDMax,
          curves: {
            rgb: getCurveLUT(curves.rgb),
            red: getCurveLUT(curves.red),
            green: getCurveLUT(curves.green),
            blue: getCurveLUT(curves.blue)
          },
          lut3: combinedLUT,
          // HSL and Split Toning parameters
          hslParams,
          splitToning
        });
        // Apply rotation + crop on CPU from GPU result
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const totalRotation = rotation + orientation + rotationOffset;
        const rad = (totalRotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const scaledW = webglCanvas.width; // already full size
        const scaledH = webglCanvas.height;
        const rotatedW = scaledW * cos + scaledH * sin;
        const rotatedH = scaledW * sin + scaledH * cos;
        let cropX = committedCrop.x * rotatedW;
        let cropY = committedCrop.y * rotatedH;
        let cropW = committedCrop.w * rotatedW;
        let cropH = committedCrop.h * rotatedH;
        // Ensure integer pixel canvas sizes to avoid half-pixel loss at edges
        cropX = Math.round(cropX);
        cropY = Math.round(cropY);
        cropW = Math.max(1, Math.round(cropW));
        cropH = Math.max(1, Math.round(cropH));
        canvas.width = cropW;
        canvas.height = cropH;
        ctx.save();
        ctx.translate(-cropX, -cropY);
        ctx.translate(rotatedW / 2, rotatedH / 2);
        ctx.rotate(rad);
        ctx.drawImage(webglCanvas, -scaledW / 2, -scaledH / 2);
        ctx.restore();
        return new Promise(resolve => {
          canvas.toBlob(b => { triggerBlobDownload(b, `film-lab-render-${Date.now()}.jpg`); resolve(); }, 'image/jpeg', 1.0);
        });
      } catch (e) {
        console.warn('GPU Save As fallback to CPU:', e.message);
      }
    }
    // CPU pipeline fallback
    
    // Reuse the logic from handleSave but trigger download instead of callback
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    const maxSaveWidth = 4000; 
    const scale = Math.min(1, maxSaveWidth / image.width);
    
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    let cropX = committedCrop.x * rotatedW;
    let cropY = committedCrop.y * rotatedH;
    let cropW = committedCrop.w * rotatedW;
    let cropH = committedCrop.h * rotatedH;

    // Ensure integer dimensions to avoid dropping edge pixels after rotation
    cropX = Math.round(cropX);
    cropY = Math.round(cropY);
    cropW = Math.max(1, Math.round(cropW));
    cropH = Math.max(1, Math.round(cropH));

    canvas.width = cropW;
    canvas.height = cropH;

    ctx.save();
    ctx.translate(-cropX, -cropY);
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 使用统一渲染核心
    // 使用统一的 getEffectiveInverted 函数计算有效反转状态
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    const core = new RenderCore({
      exposure, contrast, highlights, shadows, whites, blacks,
      curves, red, green, blue, temp, tint, lut1, lut2,
      lut1Intensity: lut1?.intensity ?? 1.0,
      lut2Intensity: lut2?.intensity ?? 1.0,
      inverted: effectiveInvertedValue, inversionMode, filmCurveEnabled, filmCurveProfile,
      // 片基校正增益 (Pre-Inversion)
      baseRed, baseGreen, baseBlue,
      // 对数域片基校正参数
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      // 密度色阶 (Density Levels)
      densityLevelsEnabled, densityLevels,
      hslParams, splitToning
    });
    core.prepareLUTs();

    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;

      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const [rC, gC, bC] = core.processPixel(r, g, b);

      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
    }

    ctx.putImageData(imageData, 0, 0);
    
    return new Promise(resolve => {
      canvas.toBlob((blob) => {
        triggerBlobDownload(blob, `film-lab-render-${Date.now()}.jpg`);
        resolve();
      }, 'image/jpeg', 1.0);
    });
  };

  const handleAutoBase = () => {
    if (!image) return;
    pushToHistory();

    // Calculate rotation and crop geometry
    const totalRotation = (rotation || 0) + (orientation || 0) + (rotationOffset || 0);
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    
    // Use a reasonable size for analysis
    const analysisSize = 256;
    const scale = Math.min(1, analysisSize / Math.max(image.width, image.height));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = Math.round(scaledW * cos + scaledH * sin);
    const rotatedH = Math.round(scaledW * sin + scaledH * cos);

    // Create rotated canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.save();
    rotCtx.translate(rotatedW / 2, rotatedH / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    rotCtx.restore();
    
    // Apply crop - use committedCrop for confirmed crop area
    const crop = committedCrop || { x: 0, y: 0, w: 1, h: 1 };
    const cropX = Math.round(crop.x * rotCanvas.width);
    const cropY = Math.round(crop.y * rotCanvas.height);
    const cropW = Math.max(1, Math.round(crop.w * rotCanvas.width));
    const cropH = Math.max(1, Math.round(crop.h * rotCanvas.height));

    // Create final cropped canvas
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Find max luminance
    let maxLum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      if (lum > maxLum) maxLum = lum;
    }

    // Average pixels within top 5% of brightness (Film Base candidates)
    const threshold = maxLum * 0.95;
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      if (lum >= threshold) {
        rSum += r;
        gSum += g;
        bSum += b;
        count++;
      }
    }

    if (count > 0) {
      const rAvg = rSum / count;
      const gAvg = gSum / count;
      const bAvg = bSum / count;

      // Apply Base Correction
      // 使用独立的 baseRed/Green/Blue 而非标准白平衡，避免被后续 Temp/Tint 调整覆盖
      const safeR = Math.max(1, rAvg);
      const safeG = Math.max(1, gAvg);
      const safeB = Math.max(1, bAvg);
      
      // 根据当前模式设置相应的校正值
      if (baseMode === 'log') {
        // 对数域模式：计算并存储密度值
        // D = -log10(T), T = value/255
        const minT = 0.001; // 避免 log(0)
        const densityR = -Math.log10(Math.max(safeR / 255, minT));
        const densityG = -Math.log10(Math.max(safeG / 255, minT));
        const densityB = -Math.log10(Math.max(safeB / 255, minT));
        
        setBaseDensityR(densityR);
        setBaseDensityG(densityG);
        setBaseDensityB(densityB);
        // 同时更新线性增益以保持兼容性
        setBaseRed(255 / safeR);
        setBaseGreen(255 / safeG);
        setBaseBlue(255 / safeB);
      } else {
        // 线性模式：使用增益 (Gain = 255 / BaseColor)
        // This maps the base color to White (255,255,255)
        setBaseRed(255 / safeR);
        setBaseGreen(255 / safeG);
        setBaseBlue(255 / safeB);
        // 清零密度值
        setBaseDensityR(0.0);
        setBaseDensityG(0.0);
        setBaseDensityB(0.0);
      }
      
      // 不再重置 Temp/Tint，片基校正与场景白平衡独立
      // 用户可以在片基校正后自由调整色温色调
    }
  };

  /**
   * 计算密度域直方图并自动检测色阶范围
   * 在 Base Correction 之后、Inversion 之前的密度域进行
   * 注意：必须考虑裁剪区域，只分析裁剪后的图像
   */
  const handleDensityAutoLevels = () => {
    if (!image) return;
    pushToHistory();

    // Calculate rotation and crop geometry
    const totalRotation = (rotation || 0) + (orientation || 0) + (rotationOffset || 0);
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    
    // Use a reasonable size for analysis
    const analysisSize = 512;
    const scale = Math.min(1, analysisSize / Math.max(image.width, image.height));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = Math.round(scaledW * cos + scaledH * sin);
    const rotatedH = Math.round(scaledW * sin + scaledH * cos);

    // Create rotated canvas
    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.save();
    rotCtx.translate(rotatedW / 2, rotatedH / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    rotCtx.restore();
    
    // Apply crop - use committedCrop for confirmed crop area
    const crop = committedCrop || { x: 0, y: 0, w: 1, h: 1 };
    const cropX = Math.round(crop.x * rotCanvas.width);
    const cropY = Math.round(crop.y * rotCanvas.height);
    const cropW = Math.max(1, Math.round(crop.w * rotCanvas.width));
    const cropH = Math.max(1, Math.round(crop.h * rotCanvas.height));

    // Create final cropped canvas
    const canvas = document.createElement('canvas');
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Compute density histogram (0.00 - 3.00, precision 0.01 = 300 bins)
    const histR = new Array(300).fill(0);
    const histG = new Array(300).fill(0);
    const histB = new Array(300).fill(0);
    const minT = 0.001;
    const log10 = Math.log(10);

    for (let i = 0; i < data.length; i += 4) {
      // Normalize to 0-1
      let r = data[i] / 255;
      let g = data[i + 1] / 255;
      let b = data[i + 2] / 255;

      // Apply base correction if in log mode (to match pipeline)
      if (baseMode === 'log' && (baseDensityR !== 0 || baseDensityG !== 0 || baseDensityB !== 0)) {
        // Convert to density
        let Dr = -Math.log(Math.max(r, minT)) / log10;
        let Dg = -Math.log(Math.max(g, minT)) / log10;
        let Db = -Math.log(Math.max(b, minT)) / log10;
        // Subtract base density
        Dr -= baseDensityR;
        Dg -= baseDensityG;
        Db -= baseDensityB;
        // Convert back to transmittance for density calculation
        r = Math.pow(10, -Dr);
        g = Math.pow(10, -Dg);
        b = Math.pow(10, -Db);
      }

      // Convert to density domain
      const Dr = -Math.log(Math.max(r, minT)) / log10;
      const Dg = -Math.log(Math.max(g, minT)) / log10;
      const Db = -Math.log(Math.max(b, minT)) / log10;

      // Quantize to histogram bins (0.00 - 3.00)
      const binR = Math.max(0, Math.min(299, Math.round(Dr * 100)));
      const binG = Math.max(0, Math.min(299, Math.round(Dg * 100)));
      const binB = Math.max(0, Math.min(299, Math.round(Db * 100)));

      histR[binR]++;
      histG[binG]++;
      histB[binB]++;
    }

    // Find density levels (0.5% threshold)
    // This detects the [Dmin, Dmax] range for each channel independently
    const findDensityRange = (hist) => {
      const total = hist.reduce((a, b) => a + b, 0);
      const threshold = 0.005; // 0.5%

      let cumulative = 0;
      let min = 0;
      for (let i = 0; i < 300; i++) {
        cumulative += hist[i];
        if (cumulative / total >= threshold) {
          min = i / 100; // Convert bin to density value
          break;
        }
      }

      cumulative = 0;
      let max = 3.0;
      for (let i = 299; i >= 0; i--) {
        cumulative += hist[i];
        if (cumulative / total >= threshold) {
          max = i / 100;
          break;
        }
      }

      // Ensure valid range (at least 0.1 density units)
      if (max <= min) {
        max = min + 0.1;
      }

      // Add small safety margin to avoid edge clipping
      min = Math.max(0, min - 0.02);
      max = Math.min(3.0, max + 0.02);

      return { min: Math.round(min * 100) / 100, max: Math.round(max * 100) / 100 };
    };

    const rLevels = findDensityRange(histR);
    const gLevels = findDensityRange(histG);
    const bLevels = findDensityRange(histB);

    setDensityLevels({
      red: rLevels,
      green: gLevels,
      blue: bLevels
    });
    setDensityLevelsEnabled(true);
  };

  /**
   * 重置密度色阶到默认值
   */
  const handleResetDensityLevels = () => {
    pushToHistory();
    setDensityLevels({
      red: { min: 0.0, max: 3.0 },
      green: { min: 0.0, max: 3.0 },
      blue: { min: 0.0, max: 3.0 }
    });
    setDensityLevelsEnabled(false);
  };

  const handleCropDone = () => {
    // Commit current cropRect to committedCrop when DONE is clicked
    pushToHistory();
    setCommittedCrop({ ...cropRect });
    // Stay non-destructive: keep swap state but exit crop mode
    setIsCropping(false);
  };

  // Lightroom-like keyboard: press 'X' to flip aspect orientation while cropping
  useEffect(() => {
    const onKey = (e) => {
      if (!isCropping) return;
      if (e.key === 'x' || e.key === 'X') {
        setRatioSwap((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCropping]);


  return (
    <div className="iv-overlay" style={{ background: 'rgba(10,10,10,0.98)', display: 'flex', flexDirection: 'row', color: '#eee', right: isAIPanelOpen ? aiPanelWidth : 0 }}>
      <style>{`
        .iv-sidebar {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .iv-control-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #888;
          font-weight: 600;
        }
        .iv-btn {
          background: #333;
          border: 1px solid #444;
          color: #eee;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
          font-weight: 500;
        }
        .iv-btn:hover {
          background: #444;
          border-color: #555;
        }
        .iv-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .iv-btn-primary {
          background: #2e7d32;
          border-color: #1b5e20;
          color: white;
        }
        .iv-btn-primary:hover {
          background: #388e3c;
        }
        .iv-btn-danger {
          background: #c62828;
          border-color: #b71c1c;
        }
        .iv-btn-danger:hover {
          background: #d32f2f;
        }
        .iv-btn-icon {
          background: transparent;
          border: none;
          color: #666;
          cursor: pointer;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1;
        }
        .iv-btn-icon:hover {
          background: #333;
          color: #fff;
        }
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]:focus {
          outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #eee;
          cursor: pointer;
          margin-top: -4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
          border: 1px solid #000;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          background: #444;
          border-radius: 2px;
        }
        input[type=checkbox] {
          accent-color: #2e7d32;
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        /* Scrollbar */
        .iv-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .iv-scroll::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        .iv-scroll::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }
        .iv-scroll::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>

      <FilmLabCanvas
        canvasRef={canvasRef}
        origCanvasRef={origCanvasRef}
        zoom={zoom} setZoom={setZoom}
        pan={pan} setPan={setPan}
        isPanning={isPanning}
        handleWheel={handleWheel}
        handlePanStart={handlePanStart}
        isCropping={isCropping}
        rotation={rotation} setRotation={setRotation}
        onRotateStart={() => { committedRotationRef.current = rotation; setIsRotating(true); }}
        onRotateEnd={() => { setIsRotating(false); }}
        pushToHistory={pushToHistory}
        handleCanvasClick={handleCanvasClick}
        isPicking={isPicking || isPickingBase || isPickingWB}
        cropRect={cropRect}
        setCropRect={setCropRect}
        image={image}
        orientation={orientation}
        rotationOffset={rotationOffset}
        ratioMode={ratioMode}
        ratioSwap={ratioSwap}
        compareMode={compareMode}
        compareSlider={compareSlider}
        setCompareSlider={setCompareSlider}
        expectedWidth={geometry ? Math.round(geometry.rotatedW) : 0}
      />

      {/* PhotoSwitcher - 照片切换器 */}
      {showPhotoSwitcher && rollId && (
        <PhotoSwitcher
          rollId={rollId}
          currentPhotoId={photoId}
          onPhotoChange={onPhotoChange}
          onApplyToBatch={(jobId, count) => {
            alert(`已启动批量应用任务\n任务 ID: ${jobId}\n处理照片: ${count} 张`);
          }}
          currentParams={currentParams}
          collapsed={photoSwitcherCollapsed}
          onToggleCollapse={() => setPhotoSwitcherCollapsed(!photoSwitcherCollapsed)}
        />
      )}

      <FilmLabControls
        photoId={photoId}
        sourceType={sourceType}
        inverted={inverted} setInverted={setInverted}
        useGPU={useGPU} setUseGPU={setUseGPU}
        inversionMode={inversionMode} setInversionMode={setInversionMode}
        filmType={filmType} setFilmType={setFilmType}
        filmCurveEnabled={filmCurveEnabled} setFilmCurveEnabled={setFilmCurveEnabled}
        filmCurveProfile={filmCurveProfile} setFilmCurveProfile={setFilmCurveProfile}
        filmCurveProfiles={filmCurveProfiles} setFilmCurveProfiles={setFilmCurveProfiles}
        baseMode={baseMode} setBaseMode={setBaseMode}
        isPickingBase={isPickingBase} setIsPickingBase={setIsPickingBase}
        handleAutoBase={handleAutoBase}
        // Density Levels (Log domain auto-levels)
        densityLevelsEnabled={densityLevelsEnabled} setDensityLevelsEnabled={setDensityLevelsEnabled}
        densityLevels={densityLevels} setDensityLevels={setDensityLevels}
        handleDensityAutoLevels={handleDensityAutoLevels}
        handleResetDensityLevels={handleResetDensityLevels}
        isPickingWB={isPickingWB} setIsPickingWB={setIsPickingWB}
        handleAutoColor={handleAutoColor}
        handleUndo={handleUndo} handleRedo={handleRedo} handleReset={handleReset}
        history={history} future={future}
        handleAutoLevels={handleAutoLevels}
        isCropping={isCropping} setIsCropping={setIsCropping}
        onCropDone={handleCropDone}
        ratioMode={ratioMode} setRatioMode={setRatioMode}
        ratioSwap={ratioSwap} setRatioSwap={setRatioSwap}
        rotation={rotation} setRotation={setRotation}
        cropRect={cropRect} setCropRect={setCropRect}
        onRotateStart={() => { committedRotationRef.current = rotation; setIsRotating(true); }}
        onRotateEnd={() => { setIsRotating(false); }}
        setOrientation={setOrientation}
        exposure={exposure} setExposure={setExposure}
        contrast={contrast} setContrast={setContrast}
        highlights={highlights} setHighlights={setHighlights}
        shadows={shadows} setShadows={setShadows}
        whites={whites} setWhites={setWhites}
        blacks={blacks} setBlacks={setBlacks}
        temp={temp} setTemp={setTemp}
        tint={tint} setTint={setTint}
        curves={curves} setCurves={setCurves}
        activeChannel={activeChannel} setActiveChannel={setActiveChannel}
        isPicking={isPicking} setIsPicking={setIsPicking}
        pickedColor={pickedColor}
        histograms={histograms}
        pushToHistory={pushToHistory}
        hslParams={hslParams} setHslParams={setHslParams}
        splitToning={splitToning} setSplitToning={setSplitToning}
        saturation={saturation} setSaturation={setSaturation}
        lut1={lut1} setLut1={setLut1}
        lut2={lut2} setLut2={setLut2}
        lutExportSize={lutExportSize} setLutExportSize={setLutExportSize}
        generateOutputLUT={generateOutputLUT}
        handleLutUpload={handleLutUpload}
        compareMode={compareMode} setCompareMode={setCompareMode}
        compareSlider={compareSlider} setCompareSlider={setCompareSlider}
        presets={presets}
        onSavePreset={savePreset}
        onApplyPreset={applyPreset}
        onDeletePreset={deletePreset}
        onApplyPresetToRoll={applyPresetToRoll}
        handleDownload={handleDownload} handleSave={handleSave} onClose={onClose}
        onHighQualityExport={handleHighQualityExport}
        highQualityBusy={hqBusy}
        onGpuExport={handleGpuExport}
        gpuBusy={gpuBusy}
        exportFormat={saveAsFormat}
        setExportFormat={setSaveAsFormat}
        
        // Batch Render Support
        onFinishBatchParams={onFinishBatchParams}
        currentParams={currentParams}
      />
    </div>
  );
}
