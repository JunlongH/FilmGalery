import React, { useEffect, useRef, useState } from 'react';
import { setRollPreset, listPresets, createPreset, updatePreset, deletePreset as deletePresetApi, getFilmCurveProfiles } from '../../api';
import { smartFilmlabPreview, smartRenderPositive, smartExportPositive, processCanvasWithRenderCoreAsync } from '../../services';
import { getCurveLUT, parseCubeLUT, getMaxSafeRect, getPresetRatio, getExifOrientation } from './utils';
import FilmLabControls from './FilmLabControls';
import FilmLabCanvas from './FilmLabCanvas';
import PhotoSwitcher from './PhotoSwitcher';
import { isWebGLAvailable, processImageWebGL, disposeWebGL, _resetWebGLAvailableCache } from './FilmLabWebGL';
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
  stableSerializeParams,
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
  // P3: filmType 死状态已删除（旧 "legacy, kept for backwards compat" 但全项目无消费者）
  
  // Film Curve (independent of inversion)
  const [filmCurveEnabled, setFilmCurveEnabled] = useState(false);
  const [filmCurveProfile, setFilmCurveProfile] = useState('default'); // Profile key
  const [filmCurveProfiles, setFilmCurveProfiles] = useState([]); // All available profiles (built-in + custom)
  
  const [isPicking, setIsPickingRaw] = useState(false);
  const [isPickingBase, setIsPickingBaseRaw] = useState(false);
  const [isPickingWB, setIsPickingWBRaw] = useState(false);

  // P2-3: picker 互斥 — 三个 picker 同时最多一个激活
  // 旧实现 3 个独立 useState，toggling 时不清其他 → 可同时激活 Base+WB picker
  const setIsPicking = (v) => {
    if (v) { setIsPickingBaseRaw(false); setIsPickingWBRaw(false); }
    setIsPickingRaw(v);
  };
  const setIsPickingBase = (v) => {
    if (v) { setIsPickingRaw(false); setIsPickingWBRaw(false); }
    setIsPickingBaseRaw(v);
  };
  const setIsPickingWB = (v) => {
    if (v) { setIsPickingRaw(false); setIsPickingBaseRaw(false); }
    setIsPickingWBRaw(v);
  };
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
  // X2.0: Surface WebGL failures to the UI instead of silently swallowing.
  // `webglFailReason` is null when WebGL is healthy (or never tried).
  // `webglRetryCountRef` caps auto-retry at 3 transient failures before
  // permanently flipping `useGPU=false` to stop hammering a broken driver.
  const [webglFailReason, setWebglFailReason] = useState(null);
  const webglRetryCountRef = useRef(0);
  const WEBGL_MAX_RETRIES = 3;
  // Note: Server preview (remoteImg) has been removed in favor of client-side WebGL/CPU rendering
  // This eliminates LUT color mismatch issues and reduces network overhead

  // Compare Mode
  // compareMode: 'off' | 'original' | 'split'
  const [compareMode, setCompareMode] = useState('off');
  const [compareSlider, setCompareSlider] = useState(0.5); // 0-1 split position for 'split' mode

  // Presets (stored in backend DB, mirrored to local state)
  const [presets, setPresets] = useState([]); // [{ id?, name, params: { ... } }]
  const processRafRef = useRef(null);
  // P0-2/S.2a: async processImage 的 stale-render 控制
  const renderIdRef = useRef(0);       // 单调递增，每次 processImage 入口自增
  const abortRef = useRef(null);        // AbortController，切换照片/参数时 abort 旧渲染
  const [renderError, setRenderError] = useState(null);  // P3-58: 错误不再静默吞掉
  const [hqBusy, setHqBusy] = useState(false);
  const [gpuBusy, setGpuBusy] = useState(false);
  // Format for Save As (non-destructive local download)
  const [saveAsFormat, setSaveAsFormat] = useState('jpeg'); // 'jpeg' | 'tiff16' | 'both'
  
  // Fix for browser auto-rotation (EXIF) vs Server raw orientation mismatch
  const [rotationOffset, setRotationOffset] = useState(0);

  // Optimization: Cache WebGL output
  const processedCanvasRef = useRef(null);
  const lastWebglParamsRef = useRef(null);
  // CPU 双缓冲：offscreen work canvas，避免分块处理时用户看到从上到下逐块刷新
  const cpuWorkCanvasRef = useRef(null);
  // P0-3: 256×256 scratch canvas for histogram readback (12MB → 256KB per frame)
  const histogramScratchRef = useRef(null);
  // 追踪当前图片 effect 创建的 blob URL，用于切换照片/卸载时 revoke，避免数 MB/张的泄漏
  const currentBlobUrlRef = useRef(null);
  // P2-18: 复用直方图数组（避免每帧 4× new Array(256) = 8KB 分配）
  const histBuffersRef = useRef({
    rgb: new Array(256).fill(0),
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0),
  });

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

  // P0-2: 组件卸载时释放 WebGL 资源（program + 纹理 + buffer）
  // 旧实现从未调用 disposeWebGL，每次组件卸载泄漏 GL 资源至页面卸载
  useEffect(() => {
    return () => {
      if (processedCanvasRef.current) {
        disposeWebGL(processedCanvasRef.current);
      }
    };
  }, []);

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

  // P1-28: AI 上下文 debounce —— 每滑块变化都触发 updateOverlayContext 导致 AI 面板重渲染
  // 改为 debounce 300ms，避免拖动滑块时 AI 面板每帧重渲染
  const aiContextTimerRef = useRef(null);
  useEffect(() => {
    if (aiContextTimerRef.current) clearTimeout(aiContextTimerRef.current);
    aiContextTimerRef.current = setTimeout(() => {
      updateOverlayContext({
        entityId: photoId ? String(photoId) : undefined,
        rollId: rollId ? String(rollId) : undefined,
        filmlabParams: { exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, inverted },
      });
    }, 300);
    return () => { if (aiContextTimerRef.current) clearTimeout(aiContextTimerRef.current); };
  }, [photoId, rollId, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, saturation, inverted, updateOverlayContext]);

  const curveLUTs = React.useMemo(() => ({
    rgb: getCurveLUT(curves.rgb),
    red: getCurveLUT(curves.red),
    green: getCurveLUT(curves.green),
    blue: getCurveLUT(curves.blue),
  }), [curves]);

  const resolveFilmCurveParams = React.useCallback(() => {
    const profile = filmCurveProfiles?.find(p => p.key === filmCurveProfile);
    return {
      filmCurveEnabled,
      filmCurveGamma: profile?.gamma ?? 0.6,
      filmCurveGammaR: profile?.gammaR ?? profile?.gamma ?? 0.6,
      filmCurveGammaG: profile?.gammaG ?? profile?.gamma ?? 0.6,
      filmCurveGammaB: profile?.gammaB ?? profile?.gamma ?? 0.6,
      filmCurveDMin: profile?.dMin ?? 0.1,
      filmCurveDMax: profile?.dMax ?? 3.0,
      filmCurveToe: profile?.toe ?? 0,
      filmCurveShoulder: profile?.shoulder ?? 0,
    };
  }, [filmCurveEnabled, filmCurveProfile, filmCurveProfiles]);

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
      // P1-12: 使用 resolveFilmCurveParams() SSOT 替代 8 次 find() 调用
      // 旧实现每字段一次 find（O(n) × 8），新实现一次 find + 展开结果
      filmCurveEnabled, filmCurveProfile,
      ...resolveFilmCurveParams(),
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
      hslParams, splitToning, saturation, filmCurveEnabled, filmCurveProfile, filmCurveProfiles,
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

  // P1-18: buildRenderCoreParams SSOT — 4 处 new RenderCore({...}) 参数组装统一调用
  // 旧实现 4 处参数列表 95% 相同，handleSave/downloadClientJPEG 还漏 lut1Intensity 等
  // 新增参数需同步改 4 处的维护陷阱消除
  // X.3 (P0-8): spread resolveFilmCurveParams() so the CPU save/export path
  // receives the resolved gamma/dMin/dMax/toe/shoulder from the active profile
  // (including user-defined custom profiles not in FILM_CURVE_PROFILES).
  // Without this, RenderCore's _prepareFilmCurveContext silently returned
  // {enabled:false} for custom profiles → save/export dropped the film curve
  // while the WebGL preview correctly applied it.
  const buildRenderCoreParams = React.useCallback(() => {
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    return {
      exposure, contrast, highlights, shadows, whites, blacks,
      curves, red, green, blue, temp, tint, lut1, lut2,
      lut1Intensity: lut1?.intensity ?? 1.0,
      lut2Intensity: lut2?.intensity ?? 1.0,
      inverted: effectiveInvertedValue,
      inversionMode,
      filmCurveEnabled, filmCurveProfile,
      ...resolveFilmCurveParams(),
      // 片基校正 (Pre-Inversion) - 支持线性和对数两种模式
      baseRed, baseGreen, baseBlue,
      baseMode, baseDensityR, baseDensityG, baseDensityB,
      // 密度色阶 (Density Levels)
      densityLevelsEnabled, densityLevels,
      // HSL / Split Toning / Saturation
      hslParams, splitToning,
      saturation,
    };
  }, [
    sourceType, inverted, inversionMode,
    exposure, contrast, highlights, shadows, whites, blacks,
    curves, red, green, blue, temp, tint, lut1, lut2,
    filmCurveEnabled, filmCurveProfile, filmCurveProfiles,
    baseRed, baseGreen, baseBlue,
    baseMode, baseDensityR, baseDensityG, baseDensityB,
    densityLevelsEnabled, densityLevels,
    hslParams, splitToning, saturation,
  ]);

  // P1-14: RenderCore 实例复用 —— 避免每次渲染都 new + prepareLUTs()
  // 5 处创建点（FilmLab.jsx:1367/1674/1765/2198 + CpuRenderService.js:170）共享一个实例
  // params key 用 stableSerializeParams 深比较（P3-57：原 === 比较脆弱）
  const renderCoreRef = useRef(null);
  const renderCoreParamsKeyRef = useRef('');
  const getRenderCore = React.useCallback(() => {
    const params = buildRenderCoreParams();
    const key = stableSerializeParams(params);
    if (!renderCoreRef.current || renderCoreParamsKeyRef.current !== key) {
      renderCoreRef.current = new RenderCore(params);
      renderCoreRef.current.prepareLUTs();
      renderCoreParamsKeyRef.current = key;
    }
    return renderCoreRef.current;
  }, [buildRenderCoreParams]);

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
  }, [inverted]);

  // Keep localStorage as a lightweight cache/backup
  const persistPresets = (next) => {
    setPresets(next);
    try { localStorage.setItem('filmLabPresets', JSON.stringify(next)); } catch(e){ console.warn('Persist presets failed', e); }
  };

  const savePreset = async (name) => {
    if (!name) return;

    // P0-4: 使用 serializeAllParams SSOT（含 baseMode/baseDensity/densityLevels/rotation/cropRect）
    // 旧实现漏存半数参数，加载预设后这些参数丢失
    const snap = serializeAllParams();

    // Serialize LUTs (Float32Array -> Array) for JSON storage
    const serializeLut = (lut) => {
      if (!lut) return null;
      return {
        ...lut,
        data: lut.data ? Array.from(lut.data) : null
      };
    };

    const params = {
      ...snap,
      // LUT 数据需序列化为 JSON 可存储格式（Float32Array → Array）
      lut1: serializeLut(snap.lut1),
      lut2: serializeLut(snap.lut2)
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

  // 完整参数快照（SSOT — savePreset/captureSnapshot/currentParams 统一调用）
  // P0-4: 旧 savePreset 漏存 baseMode/baseDensity*/densityLevels/rotation/cropRect，
  //       导致加载预设后半数参数丢失。统一用 serializeAllParams 消除漂移。
  const serializeAllParams = React.useCallback(() => ({
    inverted, inversionMode,
    exposure, contrast, highlights, shadows, whites, blacks,
    temp, tint, red, green, blue,
    baseMode, baseRed, baseGreen, baseBlue,
    baseDensityR, baseDensityG, baseDensityB,
    densityLevelsEnabled, densityLevels,
    filmCurveEnabled, filmCurveProfile,
    hslParams, splitToning, saturation,
    curves, rotation, cropRect,
    lut1: lut1 ? { ...lut1 } : null,
    lut2: lut2 ? { ...lut2 } : null,
  }), [
    inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks,
    temp, tint, red, green, blue, baseMode, baseRed, baseGreen, baseBlue,
    baseDensityR, baseDensityG, baseDensityB, densityLevelsEnabled, densityLevels,
    filmCurveEnabled, filmCurveProfile, hslParams, splitToning, saturation,
    curves, rotation, cropRect, lut1, lut2,
  ]);

  const captureSnapshot = serializeAllParams;

  const applySnapshot = (snap) => {
    setInverted(sourceType === 'positive' ? false : snap.inverted);
    setInversionMode(snap.inversionMode ?? 'linear');
    setExposure(snap.exposure);
    setContrast(snap.contrast);
    setHighlights(snap.highlights || 0);
    setShadows(snap.shadows || 0);
    setWhites(snap.whites || 0);
    setBlacks(snap.blacks || 0);
    setTemp(snap.temp);
    setTint(snap.tint);
    setRed(snap.red);
    setGreen(snap.green);
    setBlue(snap.blue);
    setBaseMode(snap.baseMode || 'linear');
    setBaseRed(snap.baseRed ?? 1.0);
    setBaseGreen(snap.baseGreen ?? 1.0);
    setBaseBlue(snap.baseBlue ?? 1.0);
    setBaseDensityR(snap.baseDensityR ?? 0);
    setBaseDensityG(snap.baseDensityG ?? 0);
    setBaseDensityB(snap.baseDensityB ?? 0);
    setDensityLevelsEnabled(snap.densityLevelsEnabled ?? false);
    if (snap.densityLevels) setDensityLevels(snap.densityLevels);
    setFilmCurveEnabled(snap.filmCurveEnabled ?? false);
    setFilmCurveProfile(snap.filmCurveProfile || 'default');
    if (snap.hslParams) setHslParams(snap.hslParams);
    if (snap.splitToning) setSplitToning(snap.splitToning);
    setSaturation(snap.saturation ?? 0);
    if (snap.curves) setCurves(snap.curves);
    setRotation(snap.rotation || 0);
    setCropRect(snap.cropRect || { x: 0, y: 0, w: 1, h: 1 });
    setLut1(snap.lut1 ? { ...snap.lut1 } : null);
    setLut2(snap.lut2 ? { ...snap.lut2 } : null);
  };

  const pushToHistory = () => {
    setHistory(prev => [...prev, captureSnapshot()]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setFuture(prev => [...prev, captureSnapshot()]);
    setHistory(prev => prev.slice(0, -1));
    applySnapshot(previous);
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setHistory(prev => [...prev, captureSnapshot()]);
    setFuture(prev => prev.slice(0, -1));
    applySnapshot(next);
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

    // 切换照片时释放上一张的 blob URL
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    
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
                const res = await smartFilmlabPreview({ photoId, params: {}, maxWidth: 2000, sourceType });
                if (active && res.ok) {
                    const url = URL.createObjectURL(res.blob);
                    currentBlobUrlRef.current = url;
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

    // P1-10: 单次 fetch 替代 new Image() + fetch() 双网络请求
    // P1-11: active flag 竞态保护（同 server-decode 路径模式）
    let active = true;
    (async () => {
      try {
        const response = await fetch(imageUrl);
        if (!active) return;
        const blob = await response.blob();
        if (!active) return;

        // 从 blob 创建 same-origin URL（避免 WebGL canvas 跨域污染）
        const url = URL.createObjectURL(blob);
        if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = url;

        // 启动图像加载（非阻塞，与 EXIF 解析并行）
        const img = new Image();
        img.onload = () => { if (active) setImage(img); };
        img.onerror = () => {
          if (!active) return;
          console.error('Failed to load image from blob:', imageUrl);
          if (photoId) {
            (async () => {
              try {
                const res = await smartFilmlabPreview({ photoId, params: {}, maxWidth: 2000, sourceType });
                if (!active || !res.ok) return;
                const proxyUrl = URL.createObjectURL(res.blob);
                if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
                currentBlobUrlRef.current = proxyUrl;
                const proxyImg = new Image();
                proxyImg.onload = () => { if (active) setImage(proxyImg); };
                proxyImg.src = proxyUrl;
              } catch (err) {
                if (active) console.error('Proxy load failed:', err);
              }
            })();
          }
        };
        img.src = url;

        // 从同一 blob 解析 EXIF（不再发起第二次网络请求）
        const buffer = await blob.arrayBuffer();
        if (!active) return;

        const view = new DataView(buffer);
        const isTiffHeader = (view.byteLength >= 2) && (view.getUint16(0, false) === 0x4949 || view.getUint16(0, false) === 0x4D4D);

        const orientation = getExifOrientation(buffer);

        if (isTiffHeader) {
          setRotationOffset(0);
          return;
        }

        let offset = 0;
        if (orientation === 6) offset = -90;
        else if (orientation === 3) offset = -180;
        else if (orientation === 8) offset = -270;
        setRotationOffset(offset);
      } catch (e) {
        if (!active) return;
        // Fallback: 直接 new Image() 加载（保留旧 crossOrigin 行为，兼容缓存/特殊协议）
        console.error('Failed to fetch image, falling back to direct load:', imageUrl, e);
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = () => { if (active) setImage(img); };
        img.src = imageUrl;
      }
    })();
    return () => { active = false; };
  }, [imageUrl, photoId, sourceType]);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Trigger redraw when:
    // 1. geometry/compare mode changes
    // 2. webglParams changes (for instant local WebGL/CPU preview)
    // Note: Server preview has been removed - all rendering is now client-side
    // P0-2/S.2a: processImage is now async — rAF callback doesn't await it
    // (stale-render mechanism via renderIdRef + AbortSignal handles cancellation)
    if (processRafRef.current) cancelAnimationFrame(processRafRef.current);
    processRafRef.current = requestAnimationFrame(() => {
      processRafRef.current = null;
      processImage();
    });
    return () => { if (processRafRef.current) { cancelAnimationFrame(processRafRef.current); processRafRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rotation, orientation, isCropping, isRotating, webglParams]);

  // 卸载时释放最后的 blob URL（防止切换组件/路由后泄漏）
  useEffect(() => {
    return () => {
      if (currentBlobUrlRef.current) {
        URL.revokeObjectURL(currentBlobUrlRef.current);
        currentBlobUrlRef.current = null;
      }
    };
  }, []);

  // Render original (unprocessed) image for compare modes when geometry changes or image loads
  useEffect(() => {
    if (!image || !origCanvasRef.current) return;
    if (compareMode === 'off') return;
    renderOriginal();
    // P0-7: 补 rotationOffset 依赖（renderOriginal 内部使用 rotation+orientation+rotationOffset，
    // EXIF 解析后 setRotationOffset 时需重跑 renderOriginal，否则 compare 模式原图旋转错误）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, orientation, rotationOffset, isCropping, compareMode]);

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
    if (hasPannedRef.current) {
      hasPannedRef.current = false;
      return;
    }
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
      // P0-3: 同时保护下界和上界，防止 clickX/clickY 接近 canvas 边缘时 x+3 > canvas.width 抛 IndexSizeError
      const renderedData = renderedCtx.getImageData(
        Math.max(0, Math.min(canvas.width - 3, Math.floor(clickX - 1))),
        Math.max(0, Math.min(canvas.height - 3, Math.floor(clickY - 1))),
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
      // P0-3: 同 WB picker，保护上界防止 IndexSizeError
      const renderedData = renderedCtx.getImageData(
        Math.max(0, Math.min(canvas.width - 3, Math.floor(clickX - 1))),
        Math.max(0, Math.min(canvas.height - 3, Math.floor(clickY - 1))),
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
  // 1. WebGL Path (useGPU): GPU-accelerated processing (fast, real-time, sync)
  // 2. CPU Path: Fallback pixel-by-pixel processing (async + chunked, P0-2)
  // Note: Server preview has been removed - all rendering is now client-side
  //
  // P0-2/S.2a: async + stale-render 控制
  // - renderIdRef 单调递增，每次入口自增 → 唯一标识本次渲染
  // - abortRef.current?.abort() 取消上一次 in-flight 渲染（统一 AbortSignal 机制）
  // - 每个 await 后检查 renderIdRef.current !== myId → stale 则 return
  // - AbortError 静默；其他错误 setRenderError（P3-58）
  const processImage = async () => {
    // S.2a: stale-render 入口
    const myId = ++renderIdRef.current;
    if (abortRef.current) abortRef.current.abort();
    const myAbort = new AbortController();
    abortRef.current = myAbort;
    const signal = myAbort.signal;
    setRenderError(null);

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
               // P0-1: 复用 processedCanvasRef.current —— 避免每次缓存未命中都新建 canvas+context
               // 旧实现每次 new canvas → 新建 WebGL context（浏览器上限 ~16 个）→ GPU 内存累积
               // 复用后 processImageWebGL._cache（WeakMap by canvas）能命中旧 program/纹理
               // canvas.width/height 由 processImageWebGL 内部按输出尺寸设置（FilmLabWebGL.js:196-197）
               const webglCanvas = processedCanvasRef.current || document.createElement('canvas');
               
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
              // 优先使用 webglParams 中已解析的值（参与缓存键），未解析时回退到默认
              const filmCurveGamma = webglParams.filmCurveGamma ?? 0.6;
              const filmCurveGammaR = webglParams.filmCurveGammaR ?? filmCurveGamma;
              const filmCurveGammaG = webglParams.filmCurveGammaG ?? filmCurveGamma;
              const filmCurveGammaB = webglParams.filmCurveGammaB ?? filmCurveGamma;
              const filmCurveDMin = webglParams.filmCurveDMin ?? 0.1;
              const filmCurveDMax = webglParams.filmCurveDMax ?? 3.0;
              const filmCurveToe = webglParams.filmCurveToe ?? 0;
              const filmCurveShoulder = webglParams.filmCurveShoulder ?? 0;
              
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
                  curves: curveLUTs,
                 lut3: combinedLUT,
                 // HSL and Split Toning parameters
                 hslParams,
                 splitToning,
                 saturation
              });
              
              processedCanvasRef.current = webglCanvas;
              lastWebglParamsRef.current = webglParams;
              sourceForDraw = webglCanvas;
              useDirectDraw = true;
              webglSuccess = true;  // 重要：必须设置，否则后续的调试代码不会执行
              // X2.0: healthy render — clear any prior transient failure state.
              if (webglFailReason !== null) setWebglFailReason(null);
              webglRetryCountRef.current = 0;
          }
       } catch(e) {
          webglSuccess = false;
          useDirectDraw = false;
          // X2.0: Surface the failure to the user instead of silently falling
          // back to the 86ms+ CPU path. Cap auto-retry at WEBGL_MAX_RETRIES:
          // once exceeded, flip useGPU=false so subsequent frames skip the
          // throw-and-catch cycle (which itself costs a getContext + texImage2D).
          webglRetryCountRef.current += 1;
          const reason = (e && e.message) ? e.message : String(e);
          console.error('WebGL failed', reason);
          if (webglRetryCountRef.current > WEBGL_MAX_RETRIES) {
            // Persistent failure — stop trying WebGL this session.
            setUseGPU(false);
            webglRetryCountRef.current = 0;
          }
          setWebglFailReason(reason);
       }
    }

    if (useDirectDraw) {
        // WebGL path: canvas is already processed, rotated and cropped
        canvas.width = sourceForDraw.width;
        canvas.height = sourceForDraw.height;
        
        // Draw WebGL result to display canvas
        ctx.drawImage(sourceForDraw, 0, 0);
    } else {
        // CPU path: 双缓冲 —— 在 offscreen work canvas 上绘制+处理，完成后一次性 blit
        // 旧实现直接在显示 canvas 上分块 putImageData，用户看到从上到下逐块刷新
        const outW = Math.max(1, Math.round(rotatedW * eff.w));
        const outH = Math.max(1, Math.round(rotatedH * eff.h));

        const cropX = eff.x * rotatedW;
        const cropY = eff.y * rotatedH;

        // 在 offscreen work canvas 上绘制旋转原图（用户不可见）
        if (!cpuWorkCanvasRef.current) cpuWorkCanvasRef.current = document.createElement('canvas');
        const workCanvas = cpuWorkCanvasRef.current;
        workCanvas.width = outW;
        workCanvas.height = outH;
        const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });

        workCtx.save();
        workCtx.translate(-cropX, -cropY);
        workCtx.translate(rotatedW / 2, rotatedH / 2);
        workCtx.rotate(rad);
        workCtx.drawImage(sourceForDraw, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
        workCtx.restore();
        // workCanvas 现在有旋转原图，display canvas 仍显示上一帧（无闪烁）
    }
    
    // P0-3: Use 256×256 scratch canvas instead of full-canvas getImageData (12MB → 256KB)
    // Both WebGL and CPU paths share this approach after canvas has processed pixels
    let imageData = null;
    let data = null;

    // P2-18: 复用直方图数组（useRef 持久化，每帧 fill(0) 重置而非 new Array）
    const histBuffers = histBuffersRef.current;
    const histRGB = histBuffers.rgb;
    const histR = histBuffers.red;
    const histG = histBuffers.green;
    const histB = histBuffers.blue;
    histRGB.fill(0); histR.fill(0); histG.fill(0); histB.fill(0);
    let maxCount = 0;

    const stride = isCropping ? 6 : 2; // Kept for scan area calc compatibility
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

    // P0-3: Unified histogram via 256×256 scratch canvas (replaces full-canvas getImageData)
    // Both WebGL and CPU paths: canvas already has processed pixels at this point
    if (webglSuccess) {
        // WebGL Path: canvas already has processed pixels (drawImage from WebGL canvas)
        // No pixel processing needed — just histogram readback via scratch canvas
    } else {
        // CPU Path: async chunked processing on offscreen work canvas (双缓冲)
        // processCanvasWithRenderCoreAsync 在 workCanvas 上分块处理，用户不可见
        const workCanvas = cpuWorkCanvasRef.current;

        await processCanvasWithRenderCoreAsync(workCanvas, buildRenderCoreParams(), {
          signal,
          chunkRows: 64,
        });

        // S.2a: stale check after await —— 若已被新渲染取代，不 blit stale 结果
        if (renderIdRef.current !== myId || signal.aborted) return;

        // 一次性 blit 完整结果到显示 canvas（单帧更新，无逐块刷新）
        canvas.width = workCanvas.width;
        canvas.height = workCanvas.height;
        ctx.drawImage(workCanvas, 0, 0);
    }

    // P0-3: Shared histogram calculation via 256×256 scratch canvas
    // 旧实现：getImageData(0, 0, canvas.width, canvas.height) = 12MB 分配 + GPU→CPU 回读
    // 新实现：drawImage downscale 到 256×256 scratch → getImageData = 256KB（48× 减少）
    // 直方图精度：65536 样本 → 256 bins = ~256 样本/bin，足够 ToneCurveEditor 使用
    if (!isRotating && canvas.width > 0 && canvas.height > 0) {
        try {
          if (!histogramScratchRef.current) histogramScratchRef.current = document.createElement('canvas');
          const scratch = histogramScratchRef.current;
          const SCRATCH_SIZE = 256;
          scratch.width = SCRATCH_SIZE;
          scratch.height = SCRATCH_SIZE;
          const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
          // Draw scan area (or full canvas) to scratch, downscaling
          const sx = scanStartX, sy = scanStartY;
          const sw = Math.max(1, scanEndX - scanStartX);
          const sh = Math.max(1, scanEndY - scanStartY);
          scratchCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, SCRATCH_SIZE, SCRATCH_SIZE);
          const scratchData = scratchCtx.getImageData(0, 0, SCRATCH_SIZE, SCRATCH_SIZE).data;
          // Calculate histograms from 256×256 data (64K samples instead of 3M)
          for (let i = 0; i < scratchData.length; i += 4) {
            if (scratchData[i + 3] === 0) continue;
            const r = scratchData[i];
            const g = scratchData[i + 1];
            const b = scratchData[i + 2];
            histR[r]++; histG[g]++; histB[b]++;
            const lum = Math.round(0.299*r + 0.587*g + 0.114*b);
            histRGB[lum]++;
            maxCount = Math.max(maxCount, histR[r], histG[g], histB[b], histRGB[lum]);
          }
        } catch (readbackErr) {
          console.warn('[FilmLab] histogram readback failed:', readbackErr.message);
        }
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
      setHistograms({
        rgb: [...histRGB],
        red: [...histR],
        green: [...histG],
        blue: [...histB]
      });
    }
    } catch (processImageError) {
      // S.2c: 错误分类处理
      // AbortError: 预期行为（新渲染取消旧渲染），静默 return
      // 其他错误: setRenderError（P3-58：不再静默吞掉，UI 显示错误 + 重试按钮）
      if (signal.aborted || processImageError?.name === 'AbortError') return;
      console.error('[FilmLab] processImage error (caught, UI preserved):', processImageError);
      setRenderError(processImageError);
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
    if (!canvasRef.current) return;
    pushToHistory();
    
    // Q3 fix: compute histogram directly from the rendered canvas instead of
    // relying on the async `histograms` React state. Previously, the first
    // click read stale/empty histograms (processImage hadn't completed yet),
    // producing wrong min/max → bizarre curve stretch. Undo+redo worked
    // because by then processImage had populated the histograms. Computing
    // synchronously from the canvas eliminates the race condition.
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Use a 256×256 scratch canvas for performance (same approach as the
    // histogram in processImage — avoids 12MB getImageData on full canvas)
    if (!histogramScratchRef.current) histogramScratchRef.current = document.createElement('canvas');
    const scratch = histogramScratchRef.current;
    const SCRATCH_SIZE = 256;
    scratch.width = SCRATCH_SIZE;
    scratch.height = SCRATCH_SIZE;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    scratchCtx.drawImage(canvas, 0, 0, SCRATCH_SIZE, SCRATCH_SIZE);
    const scratchData = scratchCtx.getImageData(0, 0, SCRATCH_SIZE, SCRATCH_SIZE).data;
    
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    for (let i = 0; i < scratchData.length; i += 4) {
      histR[scratchData[i]]++;
      histG[scratchData[i + 1]]++;
      histB[scratchData[i + 2]]++;
    }
    
    const findLevels = (hist) => {
      let min = 0;
      let max = 255;
      
      // Find total count for threshold calculation
      let total = 0;
      for (let i = 0; i < 256; i++) total += hist[i];
      if (total === 0) return { min: 0, max: 255 };
      
      // 0.1% threshold — ignore the lowest and highest 0.1% of pixels
      const threshold = total * 0.001;
      let count = 0;
      
      for (let i = 0; i < 256; i++) {
        count += hist[i];
        if (count >= threshold) {
          min = i;
          break;
        }
      }
      
      count = 0;
      for (let i = 255; i >= 0; i--) {
        count += hist[i];
        if (count >= threshold) {
          max = i;
          break;
        }
      }
      
      if (max <= min) max = min + 1;
      return { min, max };
    };

    const rLevels = findLevels(histR);
    const gLevels = findLevels(histG);
    const bLevels = findLevels(histB);

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
      try {
        const parsed = parseCubeLUT(text);
        const lutObj = { name: file.name, ...parsed, intensity: 1.0 };

        pushToHistory();
        if (index === 1) setLut1(lutObj);
        else setLut2(lutObj);
      } catch (err) {
        console.error('[FilmLab] LUT 解析失败:', err.message);
        alert(`无法加载 LUT 文件：${err.message}\n请确认是有效的 .cube (3D LUT) 文件。`);
      }
    };
    reader.onerror = () => {
      console.error('[FilmLab] LUT 文件读取失败');
      alert('LUT 文件读取失败，请重试。');
    };
    reader.readAsText(file);
  };

  const generateOutputLUT = () => {
    const size = lutExportSize;
    let content = `LUT_3D_SIZE ${size}\n`;
    
    // 使用统一渲染核心
    // 使用统一的 getEffectiveInverted 函数计算有效反转状态
    const effectiveInvertedValue = getEffectiveInverted(sourceType, inverted);
    // P1-14: 复用 RenderCore 实例（params 未变时不重建 LUT）
    const core = getRenderCore();

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

  // ============================================================================
  // Save Function (Client-side processing for quick save)
  // ============================================================================
  const handleSave = async () => {
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

    // P2-54: async pixel processing (replaces sync loop that blocked main thread for seconds)
    // processCanvasWithRenderCoreAsync uses processPixelFloat (float path, higher precision)
    await processCanvasWithRenderCoreAsync(canvas, buildRenderCoreParams(), {
      signal: abortRef.current?.signal,
      chunkRows: 64,
    });
    
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
      
      // P1-19: 使用 resolveFilmCurveParams SSOT（替代手动链式查找）
      const filmCurveParams = resolveFilmCurveParams();

      const params = {
        sourceType, // 传递源类型以便服务器选择正确的源文件
        inverted: getEffectiveInverted(sourceType, inverted), // 使用统一函数计算有效反转状态
        inversionMode,
        ...filmCurveParams,
        filmCurveProfile,
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
          hslParams, splitToning, saturation
        };
        
        const res = await window.__electron.filmlabGpuProcess({ params, photoId, imageUrl });
        if (res?.ok) {
          if (onPhotoUpdate) onPhotoUpdate();
          // Unified: both GPU and CPU export results have { ok, source, stored, filePath }
          if (res.filePath && window.__electron?.showInFolder) {
            try { window.__electron.showInFolder && window.__electron.showInFolder(res.filePath); } catch(_){}
            const sourceLabel = res.source === 'local-gpu' ? 'GPU' : 'CPU';
            if (typeof window !== 'undefined') alert(`${sourceLabel} Export Saved To:\n` + res.filePath);
          }
          return; // GPU 成功，直接返回
        }
        
        // GPU 失败，尝试 CPU 回退
        console.warn('[FilmLab] GPU export failed, trying CPU fallback:', res?.error);
      } else {
      }
      
      // CPU 回退：使用 smartExportPositive（会自动选择可用的渲染方式）
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
          // Unified: both paths return { ok, source, stored }
          const source = result.source === 'local-gpu' ? 'GPU' :
                         result.source === 'local-cpu-uploaded' ? 'CPU' :
                         result.source === 'server' ? 'Server' : 'Local';
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

  const downloadClientJPEG = async () => {
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
        // P0-8: 使用 resolveFilmCurveParams SSOT（含 gammaR/G/B/toe/shoulder）
        // 旧实现只取 gamma/dMin/dMax，GPU Save As 与其他路径胶片曲线行为不一致
        const filmCurveParams = resolveFilmCurveParams();

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
          filmCurveEnabled: filmCurveParams.filmCurveEnabled,
          filmCurveGamma: filmCurveParams.filmCurveGamma,
          filmCurveGammaR: filmCurveParams.filmCurveGammaR,
          filmCurveGammaG: filmCurveParams.filmCurveGammaG,
          filmCurveGammaB: filmCurveParams.filmCurveGammaB,
          filmCurveDMin: filmCurveParams.filmCurveDMin,
          filmCurveDMax: filmCurveParams.filmCurveDMax,
          filmCurveToe: filmCurveParams.filmCurveToe,
          filmCurveShoulder: filmCurveParams.filmCurveShoulder,
           curves: curveLUTs,
          lut3: combinedLUT,
           // HSL and Split Toning parameters
           hslParams,
           splitToning,
           saturation
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
    
    // P2-55: async pixel processing (replaces sync loop that blocked main thread for seconds)
    // processCanvasWithRenderCoreAsync uses processPixelFloat (float path, higher precision)
    await processCanvasWithRenderCoreAsync(canvas, buildRenderCoreParams(), {
      signal: abortRef.current?.signal,
      chunkRows: 64,
    });
    
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
      // P0-6: 过滤输入框/文本域/contenteditable，避免预设名/搜索框输入 x 误触发 ratioSwap
      const target = e.target;
      if (target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )) {
        return;
      }
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

      {renderError && (
        <div style={{
          position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(180,30,30,0.95)', color: '#fff', padding: '8px 16px',
          borderRadius: 6, fontSize: 13, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span>渲染失败：{renderError.message || String(renderError)}</span>
          <button
            onClick={() => { setRenderError(null); processImage(); }}
            style={{ background: '#fff', color: '#b11e1e', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >重试</button>
        </div>
      )}

      {/* X2.0: WebGL failure banner — surface the silent CPU fallback. */}
      {/* Dismissable: a transient context loss shouldn't nag the user forever. */}
      {webglFailReason && (
        <div style={{
          position: 'absolute', top: renderError ? 50 : 10, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(180,110,20,0.95)', color: '#fff', padding: '6px 14px',
          borderRadius: 6, fontSize: 12, zIndex: 1000, display: 'flex', alignItems: 'center', gap: 10,
          maxWidth: '80vw',
        }}>
          <span>WebGL 不可用（{webglFailReason}），已切换到 CPU 模式（较慢）</span>
          <button
            onClick={() => {
              // Manual retry: clear failure state, reset retry counter,
              // re-probe the driver, and immediately re-render so the user
              // sees the result without having to nudge a slider.
              // v4-review: previously this reset state but didn't trigger
              // a render — the canvas stayed on the CPU image while the
              // banner disappeared, misleading the user.
              _resetWebGLAvailableCache();
              webglRetryCountRef.current = 0;
              setWebglFailReason(null);
              if (!useGPU) setUseGPU(true);
              // Defer processImage to next tick so useGPU state update
              // has flushed before the render reads it.
              setTimeout(() => processImage(), 0);
            }}
            style={{ background: '#fff', color: '#8a5a10', border: 'none', padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
          >重试 WebGL</button>
          <button
            onClick={() => setWebglFailReason(null)}
            style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', padding: '3px 9px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
          >忽略</button>
        </div>
      )}

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
        onRotateStart={() => { setIsRotating(true); }}
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
        orientation={orientation}
        rotationOffset={rotationOffset}
        onRotateStart={() => { setIsRotating(true); }}
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
