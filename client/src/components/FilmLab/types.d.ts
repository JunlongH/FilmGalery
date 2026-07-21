/**
 * FilmLab 类型定义（与运行时对齐 — 2026-07-21 重写）
 *
 * 本文件描述 client/src/components/FilmLab 与 packages/shared 的实际运行时结构。
 * 凡运行时不存在的枚举值/字段不得出现在此（避免误导，参见 04-ui-edge-detection.md）。
 *
 * @module types
 */

// ============================================================================
// 基础几何类型
// ============================================================================

/** 裁剪区域（归一化 0-1） */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface CurvePoint {
  x: number;
  y: number;
}

// ============================================================================
// 参数类型（与 packages/shared/filmLabConstants.js / filmLabExport.js 对齐）
// ============================================================================

export interface ToneParams {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
}

export interface WhiteBalanceParams {
  temp: number;
  tint: number;
  red: number;
  green: number;
  blue: number;
}

/**
 * 片基校正参数。
 * 运行时 baseMode 仅为 'linear' | 'log'（'off'/'auto' 在代码路径中不存在）。
 */
export interface BaseCorrectionParams {
  baseMode: 'linear' | 'log';
  baseRed: number;
  baseGreen: number;
  baseBlue: number;
  baseDensityR: number;
  baseDensityG: number;
  baseDensityB: number;
}

/**
 * 反转参数。
 * 运行时 inversionMode 仅 'linear' | 'log'（'filmic' 已从 normalizeInversionMode 中剔除）。
 */
export interface InversionParams {
  inverted: boolean;
  inversionMode: 'linear' | 'log';
}

/**
 * 胶片曲线参数（Q13 per-channel gamma + toe/shoulder）。
 * gammaR/G/B、toe、shoulder 可选 — 缺省时由 FILM_CURVE_PROFILES[profile] 回退。
 */
export interface FilmCurveParams {
  filmCurveEnabled: boolean;
  filmCurveProfile: string;
  filmCurveGamma?: number;
  filmCurveGammaR?: number;
  filmCurveGammaG?: number;
  filmCurveGammaB?: number;
  filmCurveDMin?: number;
  filmCurveDMax?: number;
  filmCurveToe?: number;
  filmCurveShoulder?: number;
}

/**
 * 几何变换参数。
 * orientation 运行时为 number（setOrientation 可累加 r±90，无界；显示前才模 360）。
 * ratioMode 运行时包含 'original'（FilmLabControls 下拉项）。
 */
export interface GeometryParams {
  rotation: number;
  orientation: number;
  rotationOffset: number;
  cropRect: CropRect;
  committedCrop: CropRect;
  ratioMode: 'free' | 'original' | '1:1' | '3:2' | '4:3' | '16:9' | '2:3' | '3:4';
  ratioSwap: boolean;
}

/**
 * 密度域色阶（运行时为按通道嵌套 {red:{min,max}, ...}，非扁平 minR/maxR）。
 */
export interface DensityLevelsChannel {
  min: number;
  max: number;
}

export interface DensityLevels {
  red: DensityLevelsChannel;
  green: DensityLevelsChannel;
  blue: DensityLevelsChannel;
}

export interface HSLChannelParams {
  hue: number;
  saturation: number;
  luminance: number;
}

export interface HSLParams {
  red: HSLChannelParams;
  orange: HSLChannelParams;
  yellow: HSLChannelParams;
  green: HSLChannelParams;
  cyan: HSLChannelParams;
  blue: HSLChannelParams;
  purple: HSLChannelParams;
  magenta: HSLChannelParams;
}

export interface SplitToneZone {
  hue: number;
  saturation: number;
}

export interface SplitToneParams {
  highlights: SplitToneZone;
  midtones: SplitToneZone;
  shadows: SplitToneZone;
  balance: number;
}

export interface CurvesParams {
  rgb: CurvePoint[];
  red: CurvePoint[];
  green: CurvePoint[];
  blue: CurvePoint[];
}

export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue';

// ============================================================================
// 渲染参数（client → FilmLabWebGL.processImageWebGL / RenderCore）
// ============================================================================

export interface RenderParams {
  image?: HTMLImageElement | ImageBitmap | HTMLCanvasElement;

  scale?: number;
  rotate?: number;
  cropRect?: CropRect;

  inverted?: boolean;
  inversionMode?: 'linear' | 'log';

  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;

  temp?: number;
  tint?: number;
  red?: number;
  green?: number;
  blue?: number;
  gains?: [number, number, number];

  baseMode?: 'linear' | 'log';
  baseRed?: number;
  baseGreen?: number;
  baseBlue?: number;
  baseGains?: [number, number, number];
  baseDensityR?: number;
  baseDensityG?: number;
  baseDensityB?: number;
  baseDensity?: [number, number, number];

  densityLevelsEnabled?: boolean;
  densityLevels?: DensityLevels;

  filmCurveEnabled?: boolean;
  filmCurveProfile?: string;
  filmCurveGamma?: number;
  filmCurveGammaR?: number;
  filmCurveGammaG?: number;
  filmCurveGammaB?: number;
  filmCurveDMin?: number;
  filmCurveDMax?: number;
  filmCurveToe?: number;
  filmCurveShoulder?: number;

  curves?: CurvesParams;

  hslParams?: HSLParams;

  saturation?: number;

  splitToning?: SplitToneParams;

  /** 3D LUT（客户端 lut1/lut2 对象，含 size/data/intensity） */
  lut1?: LUTObject | null;
  lut2?: LUTObject | null;
  lut1Intensity?: number;
  lut2Intensity?: number;

  /** Phase I：线性域反转（默认 false 保持当前观感；true 在线性光下做反转/片基校正） */
  linearDomainInversion?: boolean;
}

/** 客户端 LUT 对象（handleLutUpload 产物） */
export interface LUTObject {
  name: string;
  size: number;
  data: Float32Array;
  intensity: number;
  domainMin?: [number, number, number];
  domainMax?: [number, number, number];
}

// ============================================================================
// 直方图（运行时 FilmLab.jsx 内联实现：{r,g,b,rgb,maxCount}）
// ============================================================================

export interface HistogramData {
  r: number[];
  g: number[];
  b: number[];
  rgb: number[];
  maxCount: number;
}

export interface Histograms {
  r: number[];
  g: number[];
  b: number[];
  rgb: number[];
  maxCount: number;
}

// ============================================================================
// Pipeline 事件（与 useFilmLabPipeline.js 的 PipelineEvent/PipelinePriority 对齐）
// ============================================================================

export type PipelineEventType =
  | 'source_changed'
  | 'geometry_changed'
  | 'crop_changed'
  | 'rotation_changed'
  | 'inversion_changed'
  | 'base_density_changed'
  | 'color_changed'
  | 'exposure_changed'
  | 'white_balance_changed'
  | 'curves_changed'
  | 'hsl_changed'
  | 'split_tone_changed'
  | 'film_curve_changed'
  | 'lut_changed'
  | 'output_changed'
  | 'density_levels_changed';

export type PipelineListener = (data: any) => void;

// ============================================================================
// Hook 返回类型（与实际实现签名对齐）
// ============================================================================

export interface UseFilmLabStateReturn {
  exposure: number; setExposure: (v: number) => void;
  contrast: number; setContrast: (v: number) => void;
  highlights: number; setHighlights: (v: number) => void;
  shadows: number; setShadows: (v: number) => void;
  whites: number; setWhites: (v: number) => void;
  blacks: number; setBlacks: (v: number) => void;
  temp: number; setTemp: (v: number) => void;
  tint: number; setTint: (v: number) => void;
  red: number; setRed: (v: number) => void;
  green: number; setGreen: (v: number) => void;
  blue: number; setBlue: (v: number) => void;
  baseMode: 'linear' | 'log'; setBaseMode: (v: 'linear' | 'log') => void;
  baseRed: number; setBaseRed: (v: number) => void;
  baseGreen: number; setBaseGreen: (v: number) => void;
  baseBlue: number; setBaseBlue: (v: number) => void;
  baseDensityR: number; setBaseDensityR: (v: number) => void;
  baseDensityG: number; setBaseDensityG: (v: number) => void;
  baseDensityB: number; setBaseDensityB: (v: number) => void;
  inverted: boolean; setInverted: (v: boolean) => void;
  inversionMode: 'linear' | 'log'; setInversionMode: (v: 'linear' | 'log') => void;
  filmCurveEnabled: boolean; setFilmCurveEnabled: (v: boolean) => void;
  filmCurveProfile: string; setFilmCurveProfile: (v: string) => void;
  rotation: number; setRotation: (v: number) => void;
  orientation: number; setOrientation: (updater: number | ((r: number) => number)) => void;
  cropRect: CropRect; setCropRect: (v: CropRect) => void;
  committedCrop: CropRect; setCommittedCrop: (v: CropRect) => void;
  ratioMode: GeometryParams['ratioMode']; setRatioMode: (v: GeometryParams['ratioMode']) => void;
  ratioSwap: boolean; setRatioSwap: (v: boolean) => void;
  curves: CurvesParams; setCurves: (v: CurvesParams) => void;
  hslParams: HSLParams; setHslParams: (v: HSLParams) => void;
  splitToning: SplitToneParams; setSplitToning: (v: SplitToneParams) => void;
  densityLevels: DensityLevels; setDensityLevels: (v: DensityLevels) => void;
  densityLevelsEnabled: boolean; setDensityLevelsEnabled: (v: boolean) => void;
  serializeState: () => Record<string, any>;
  deserializeState: (params: Record<string, any>) => void;
  resetAllState: () => void;
  hasModifications: boolean;
}

export interface UseFilmLabPipelineReturn {
  on: (event: PipelineEventType, callback: PipelineListener) => () => void;
  off: (event: PipelineEventType, callback: PipelineListener) => void;
  emit: (event: PipelineEventType, data?: any, options?: { immediate?: boolean; cascade?: boolean }) => void;
  flush: () => void;
  emitGeometryChanged: (data?: any) => void;
  emitCropChanged: (cropRect: CropRect) => void;
  emitColorChanged: (data?: any) => void;
  emitInversionChanged: (data?: any) => void;
  emitSourceChanged: (data?: any) => void;
  getRenderOrder: string[];
  validateOrder: (operations: string[]) => boolean;
  PipelineEvent: Record<string, PipelineEventType>;
  PipelinePriority: Record<string, number>;
}

/** useHistogram 返回（与 useHistogram.js 实际导出对齐） */
export interface UseHistogramReturn {
  histograms: Histograms;
  calculateNow: () => Histograms;
  refresh: () => void;
  reset: () => void;
  isCalculating: boolean;
  lastUpdated: number;
}

export interface UseFilmLabRendererReturn {
  isRendering: boolean;
  lastRenderTime: number;
  renderError: string | null;
  canUseWebGL: boolean;
  webglAvailable: boolean;
  requestRender: (params: any, options?: { immediate?: boolean; force?: boolean }) => HTMLCanvasElement | null;
  renderNow: (params: any) => HTMLCanvasElement | null;
  clearCache: () => void;
  getRenderedCanvas: () => HTMLCanvasElement | null;
  readPixels: (x: number, y: number, width?: number, height?: number) => ImageData | null;
}

// ============================================================================
// 导出 / 预设
// ============================================================================

export interface ExportOptions {
  format: 'jpeg' | 'png' | 'tiff' | 'tiff16';
  quality?: number;
  maxSize?: number | null;
  filename?: string;
  metadata?: boolean;
}

export interface LUTExportOptions {
  format: 'cube';
  size: 17 | 33 | 65;
  title?: string;
}

export interface FilmLabPreset {
  id: string;
  name: string;
  description?: string;
  category?: string;
  author?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  params: Record<string, any>;
}

export type PartialParams<T> = { [P in keyof T]?: T[P] };
export type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };
export type ReadonlyParams<T> = { readonly [P in keyof T]: T[P] };
