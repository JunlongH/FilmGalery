/**
 * FilmLab 共享模块入口
 * 
 * @module packages/shared
 * @description 统一导出所有 FilmLab 核心处理函数和常量
 */

// 核心处理模块
import { RenderCore } from './render/RenderCore.mjs';
import { renderBuffer } from './render/render-buffer.mjs';
import saturation from './filmLabSaturation.mjs';
import constants from './filmLabConstants.mjs';
import toneLUT from './filmLabToneLUT.mjs';
import curves from './filmLabCurves.mjs';
import whiteBalance from './filmLabWhiteBalance.mjs';
import inversion from './filmLabInversion.mjs';
import filmCurve from './filmLabCurve.mjs';
import hsl from './filmLabHSL.mjs';
import exportParams from './filmLabExport.mjs';
import splitTone from './filmLabSplitTone.mjs';
import render from './render.mjs';
import helpers from './filmLabHelpers.mjs';
import sourcePathResolver from './sourcePathResolver.mjs';
import rawUtils from './rawUtils.mjs';
import paramSerializer from './paramSerializer.mjs';
import autoCropCoord from './autoCropCoord.mjs';
import lutParser from './lutParser.mjs';
import renderChunked from './renderChunked.mjs';

// Service discovery & coordinate transforms (consumed by client/mobile/watch/server).
import coordTransform from './coordTransform.mjs';
import portDiscovery from './portDiscovery.mjs';
import serverCapabilities from './serverCapabilities.mjs';
import geocode from './geocode.mjs';
import geocoding from './geocoding.mjs';
import mapUtils from './mapUtils.mjs';

// GLSL 着色器模块 (Phase 3)
import shaders from './shaders.mjs';

// 统一导出
const _sharedExports = {
  // ============================================================================
  // 核心处理 (RenderCore — 统一渲染管线)
  // ============================================================================
  
  /** 统一渲染核心 (替代 legacy filmlab-core) */
  RenderCore,

  /** 将 RenderCore 应用到整个像素缓冲区（消除 N 处重复 for-loop；2C.3） */
  renderBuffer,

  /** 渲染参数稳定序列化/相等性比较（渲染脏标记，Phase C） */
  stableSerializeParams: paramSerializer.stableSerializeParams,
  renderParamsEqual: paramSerializer.renderParamsEqual,

  /** 自动裁剪坐标系重映射（Phase D） */
  remapDetectedCropRect: autoCropCoord.remapDetectedCropRect,
  nearestOrthogonal: autoCropCoord.nearestOrthogonal,

  /** 3D LUT (.cube) 解析（Phase E） */
  parseCubeLUT: lutParser.parseCubeLUT,

  /** 分块像素处理（Phase J，SSOT 循环） */
  processBlock: renderChunked.processBlock,
  processCanvasChunkedSync: renderChunked.processCanvasChunkedSync,
  
  // ============================================================================
  // 全局饱和度
  // ============================================================================
  
  /** 应用饱和度 (浮点, 0-1) */
  applySaturationFloat: saturation.applySaturationFloat,
  
  /** 应用饱和度 (8-bit, 0-255) */
  applySaturation: saturation.applySaturation,
  
  /** 检查饱和度是否为默认值 */
  isDefaultSaturation: saturation.isDefaultSaturation,
  
  // ============================================================================
  // 色调映射
  // ============================================================================
  
  /** 构建色调映射 LUT */
  buildToneLUT: toneLUT.buildToneLUT,
  
  /** 应用色调映射到单个值 */
  applyToneMapping: toneLUT.applyToneMapping,
  
  // ============================================================================
  // 曲线
  // ============================================================================
  
  /** 创建样条插值函数 */
  createSpline: curves.createSpline,
  
  /** 构建曲线 LUT */
  buildCurveLUT: curves.buildCurveLUT,
  
  /** 构建浮点曲线 LUT */
  buildCurveLUTFloat: curves.buildCurveLUTFloat,

  /** 构建 GPU 复合浮点曲线 LUT (Phase 2.4) */
  buildCompositeFloatCurveLUT: curves.buildCompositeFloatCurveLUT,

  /** 构建所有通道曲线 LUT */
  buildAllCurveLUTs: curves.buildAllCurveLUTs,
  
  /** 应用曲线到单个值 */
  applyCurve: curves.applyCurve,
  
  // ============================================================================
  // 白平衡
  // ============================================================================
  
  /** 计算白平衡增益 (科学化版本) */
  computeWBGains: whiteBalance.computeWBGains,
  
  /** 计算白平衡增益 (传统版本) */
  computeWBGainsLegacy: whiteBalance.computeWBGainsLegacy,
  
  /** 从采样颜色求解 temp/tint */
  solveTempTintFromSample: whiteBalance.solveTempTintFromSample,
  
  /** 开尔文色温转 RGB */
  kelvinToRGB: whiteBalance.kelvinToRGB,
  
  /** 滑块值转开尔文色温 */
  sliderToKelvin: whiteBalance.sliderToKelvin,
  
  // ============================================================================
  // 反转 (纯数学反转：线性/对数)
  // ============================================================================
  
  /** 线性反转 */
  invertLinear: inversion.invertLinear,
  
  /** 对数反转 */
  invertLog: inversion.invertLog,
  
  /** 应用反转 */
  applyInversion: inversion.applyInversion,
  
  /** 应用反转到 RGB */
  applyInversionRGB: inversion.applyInversionRGB,
  
  /** 构建反转 LUT */
  buildInversionLUT: inversion.buildInversionLUT,
  
  // ============================================================================
  // 片基校正 (对数域/线性域)
  // ============================================================================
  
  /** 计算片基密度 (从采样 RGB) */
  calculateBaseDensity: inversion.calculateBaseDensity,
  
  /** 应用对数域片基校正 (单通道) */
  applyLogBaseCorrection: inversion.applyLogBaseCorrection,
  
  /** 应用对数域片基校正 (RGB) */
  applyLogBaseCorrectionRGB: inversion.applyLogBaseCorrectionRGB,
  
  /** 应用线性域片基校正 (单通道) */
  applyLinearBaseCorrection: inversion.applyLinearBaseCorrection,
  
  /** 应用线性域片基校正 (RGB) */
  applyLinearBaseCorrectionRGB: inversion.applyLinearBaseCorrectionRGB,
  
  // ============================================================================
  // 胶片曲线 (Film Curve - H&D 密度模型)
  // ============================================================================
  
  /** 应用胶片曲线到单通道 */
  applyFilmCurve: filmCurve.applyFilmCurve,
  
  /** 应用胶片曲线到 RGB */
  applyFilmCurveRGB: filmCurve.applyFilmCurveRGB,
  
  /** 构建胶片曲线 LUT */
  buildFilmCurveLUT: filmCurve.buildFilmCurveLUT,
  
  /** 合并胶片配置与自定义参数 */
  mergeFilmProfiles: filmCurve.mergeFilmProfiles,
  
  /** 按分类分组胶片配置 */
  groupFilmProfilesByCategory: filmCurve.groupFilmProfilesByCategory,
  
  /** 胶片曲线配置常量 */
  FILM_CURVE_PROFILES: filmCurve.FILM_CURVE_PROFILES,
  
  // ============================================================================
  // 常量
  // ============================================================================
  
  // 尺寸常量
  PREVIEW_MAX_WIDTH_SERVER: constants.PREVIEW_MAX_WIDTH_SERVER,
  PREVIEW_MAX_WIDTH_CLIENT: constants.PREVIEW_MAX_WIDTH_CLIENT,
  EXPORT_MAX_WIDTH: constants.EXPORT_MAX_WIDTH,
  
  // 默认参数
  DEFAULT_TONE_PARAMS: constants.DEFAULT_TONE_PARAMS,
  DEFAULT_WB_PARAMS: constants.DEFAULT_WB_PARAMS,
  INVERSION_MODE_LABELS: constants.INVERSION_MODE_LABELS,
  DEFAULT_INVERSION_PARAMS: constants.DEFAULT_INVERSION_PARAMS,
  DEFAULT_CURVES: constants.DEFAULT_CURVES,
  DEFAULT_CROP_RECT: constants.DEFAULT_CROP_RECT,
  WB_GAIN_LIMITS: constants.WB_GAIN_LIMITS,
  
  // 质量设置
  JPEG_QUALITY: constants.JPEG_QUALITY,
  
  // WebGL 配置
  WEBGL_DEBOUNCE_MS: constants.WEBGL_DEBOUNCE_MS,
  DEBUG: constants.DEBUG,
  
  // 胶片配置
  FILM_PROFILES: constants.FILM_PROFILES,
  
  // 色温配置
  REFERENCE_WHITE_POINTS: constants.REFERENCE_WHITE_POINTS,
  TEMP_SLIDER_CONFIG: constants.TEMP_SLIDER_CONFIG,
  
  // ============================================================================
  // HSL 调整
  // ============================================================================
  
  /** HSL 通道定义 */
  HSL_CHANNELS: hsl.HSL_CHANNELS,
  
  /** HSL 通道顺序 */
  HSL_CHANNEL_ORDER: hsl.HSL_CHANNEL_ORDER,
  
  /** 默认 HSL 参数 */
  DEFAULT_HSL_PARAMS: hsl.DEFAULT_HSL_PARAMS,
  
  /** RGB 转 HSL */
  rgbToHsl: hsl.rgbToHsl,
  
  /** HSL 转 RGB */
  hslToRgb: hsl.hslToRgb,
  
  /** 应用 HSL 调整到单个像素 */
  applyHSL: hsl.applyHSL,
  
  /** 批量应用 HSL 到像素数组 */
  applyHSLToArray: hsl.applyHSLToArray,
  
  /** 检查 HSL 是否为默认值 */
  isDefaultHSL: hsl.isDefaultHSL,
  
  /** 合并 HSL 参数 */
  mergeHSLParams: hsl.mergeHSLParams,
  
  /** 验证 HSL 参数 */
  validateHSLParams: hsl.validateHSLParams,
  
  // ============================================================================
  // 导出参数管理
  // ============================================================================
  
  /** 默认处理参数 */
  DEFAULT_PROCESSING_PARAMS: exportParams.DEFAULT_PROCESSING_PARAMS,
  
  /** 参数版本 */
  PARAMS_VERSION: exportParams.PARAMS_VERSION,
  
  /** 构建导出参数 */
  buildExportParams: exportParams.buildExportParams,
  
  /** 验证导出参数 */
  validateExportParams: exportParams.validateExportParams,
  
  /** 迁移旧参数到新版本 */
  migrateParams: exportParams.migrateParams,
  
  /** 序列化导出参数 */
  serializeParams: exportParams.serializeParams,
  
  /** 反序列化导出参数 */
  deserializeParams: exportParams.deserializeParams,
  
  /** 比较参数差异 */
  diffParams: exportParams.diffParams,
  
  // ============================================================================
  // 分离色调
  // ============================================================================
  
  /** 默认分离色调参数 */
  DEFAULT_SPLIT_TONE_PARAMS: splitTone.DEFAULT_SPLIT_TONE_PARAMS,
  
  /** 分离色调预设 */
  SPLIT_TONE_PRESETS: splitTone.SPLIT_TONE_PRESETS,
  
  /** 亮度阈值配置 */
  LUMINANCE_CONFIG: splitTone.LUMINANCE_CONFIG,
  
  /** 应用分离色调 */
  applySplitTone: splitTone.applySplitTone,
  
  /** 批量应用分离色调 */
  applySplitToneToArray: splitTone.applySplitToneToArray,
  
  /** 检查分离色调是否为默认值 */
  isDefaultSplitTone: splitTone.isDefaultSplitTone,
  
  /** 合并分离色调参数 */
  mergeSplitToneParams: splitTone.mergeSplitToneParams,
  
  /** 验证分离色调参数 */
  validateSplitToneParams: splitTone.validateSplitToneParams,
  
  /** 计算亮度 */
  calculateLuminance: splitTone.calculateLuminance,
  
  // ============================================================================
  // 统一渲染核心
  // ============================================================================
  
  /** 统一渲染核心类 */
  RenderCore: render.RenderCore,
  
  /** 默认 Film Curve 参数 */
  DEFAULT_FILM_CURVE: render.DEFAULT_FILM_CURVE,
  
  // ============================================================================
  // 辅助函数 (WebGL/CPU 共用)
  // ============================================================================
  
  /** 计算有效的反转状态 */
  getEffectiveInverted: helpers.getEffectiveInverted,
  
  /** 检查是否为正片模式 */
  isPositiveMode: helpers.isPositiveMode,
  
  /** 检查是否应显示反转控件 */
  shouldShowInversionControls: helpers.shouldShowInversionControls,
  
  /** 计算 3D LUT 索引 */
  getLUT3DIndex: helpers.getLUT3DIndex,
  
  /** 打包 3D LUT 为 WebGL 纹理格式 */
  packLUT3DForWebGL: helpers.packLUT3DForWebGL,
  
  /** 合并两个 3D LUT */
  buildCombinedLUT: helpers.buildCombinedLUT,
  
  /** 规范化 sourceType */
  normalizeSourceType: helpers.normalizeSourceType,
  
  /** 规范化反转模式 */
  normalizeInversionMode: helpers.normalizeInversionMode,
  
  /** 获取 LUT 3D 采样的 GLSL 代码 */
  getLUT3DSamplingGLSL: helpers.getLUT3DSamplingGLSL,
  
  // ============================================================================
  // 源路径解析器 (统一管理图片文件路径选择)
  // ============================================================================
  
  /** 源类型枚举 */
  SOURCE_TYPE: sourcePathResolver.SOURCE_TYPE,
  
  /** 获取严格匹配的源文件路径 */
  getStrictSourcePath: sourcePathResolver.getStrictSourcePath,
  
  /** 验证源类型与加载文件是否匹配 */
  validateSourceMatch: sourcePathResolver.validateSourceMatch,
  
  /** 检查照片是否可以使用指定的源类型 */
  canUseSourceType: sourcePathResolver.canUseSourceType,
  
  /** 获取照片可用的所有源类型 */
  getAvailableSourceTypes: sourcePathResolver.getAvailableSourceTypes,
  
  // ============================================================================
  // RAW 文件工具
  // ============================================================================
  
  /** RAW 文件扩展名列表 */
  RAW_EXTENSIONS: rawUtils.RAW_EXTENSIONS,
  
  /** 检查是否为 RAW 文件 */
  isRawFile: rawUtils.isRawFile,
  
  /** 获取 RAW 格式信息 */
  getRawFormatInfo: rawUtils.getRawFormatInfo,
  
  /** 检测文件类型 */
  detectFileType: rawUtils.detectFileType,
  
  /** 检查浏览器是否可以直接加载 */
  isBrowserLoadable: rawUtils.isBrowserLoadable,
  
  /** 检查是否需要服务器解码 */
  requiresServerDecode: rawUtils.requiresServerDecode,
  
  // ============================================================================
  // GLSL 着色器库 (Phase 3)
  // ============================================================================
  
  /** 完整着色器模块 */
  shaders,

  /** 构建片元着色器 */
  buildFragmentShader: shaders.buildFragmentShader,

  /** 顶点着色器 */
  VERTEX_SHADER: shaders.VERTEX_SHADER,

  /** 着色器版本 */
  SHADER_VERSION: shaders.SHADER_VERSION,

  // ============================================================================
  // 服务发现与坐标转换
  // ============================================================================

  /** WGS-84 ↔ GCJ-02 坐标转换（中国火星坐标） */
  wgs84ToGcj02: coordTransform.wgs84ToGcj02,
  gcj02ToWgs84: coordTransform.gcj02ToWgs84,
  isInChina: coordTransform.isInChina,

  /** 服务发现配置与工具 */
  APP_IDENTIFIER: portDiscovery.APP_IDENTIFIER,
  DISCOVERY_ENDPOINT: portDiscovery.DISCOVERY_ENDPOINT,
  DEFAULT_PORT: portDiscovery.DEFAULT_PORT,
  PORT_SCAN_RANGE: portDiscovery.PORT_SCAN_RANGE,
  DISCOVERY_TIMEOUT: portDiscovery.DISCOVERY_TIMEOUT,
  MDNS_CONFIG: portDiscovery.MDNS_CONFIG,
  DISCOVERY_MODE: portDiscovery.DISCOVERY_MODE,
  buildDiscoverUrl: portDiscovery.buildDiscoverUrl,
  cleanIpAddress: portDiscovery.cleanIpAddress,
  extractPort: portDiscovery.extractPort,
  buildUrl: portDiscovery.buildUrl,
  isPrivateIp: portDiscovery.isPrivateIp,
  recommendDiscoveryMode: portDiscovery.recommendDiscoveryMode,

  /** 服务能力（模式、路由分类） */
  SERVER_MODES: serverCapabilities.SERVER_MODES,
  API_CATEGORIES: serverCapabilities.API_CATEGORIES,
  COMPUTE_ROUTES: serverCapabilities.COMPUTE_ROUTES,
  DATA_ROUTES: serverCapabilities.DATA_ROUTES,
  getServerMode: serverCapabilities.getServerMode,
  getCapabilities: serverCapabilities.getCapabilities,
  isComputeEnabled: serverCapabilities.isComputeEnabled,
  isComputeRoute: serverCapabilities.isComputeRoute,

  // ============================================================================
  // 反向地理编码（BigDataCloud 共享 provider）
  // ============================================================================

  /** BigDataCloud 反向地理编码（mobile/watch 共用） */
  reverseGeocodeBigDataCloud: geocode.reverseGeocodeBigDataCloud,
  normalizeBigDataCloud: geocode.normalizeBigDataCloud,
  BDC_BASE: geocode.BDC_BASE,

  // ============================================================================
  // 统一 geocoding（正向 + 逆向，provider 链）
  // ============================================================================

  /** 统一正向地理编码（地址 → 坐标） */
  searchAddress: geocoding.searchAddress,
  /** 统一逆向地理编码（坐标 → 地址），永不抛错 */
  reverseGeocode: geocoding.reverseGeocode,
  /** 国家+城市 → 坐标 */
  getCityCoordinates: geocoding.getCityCoordinates,
  // 各 provider（导出便于单测）
  searchWithAmap: geocoding.searchWithAmap,
  searchWithPhoton: geocoding.searchWithPhoton,
  searchWithNominatim: geocoding.searchWithNominatim,
  reverseWithAmap: geocoding.reverseWithAmap,
  reverseWithPhoton: geocoding.reverseWithPhoton,
  reverseWithNominatim: geocoding.reverseWithNominatim,
  reverseWithBigDataCloud: geocoding.reverseWithBigDataCloud,

  // ============================================================================
  // 地图工具（瓦片配置、聚类、校验、格式化）
  // ============================================================================

  /** 支持的 map provider 列表 */
  MAP_PROVIDERS: mapUtils.MAP_PROVIDERS,
  /** 瓦片 URL 配置（provider → style → url） */
  TILE_LAYERS: mapUtils.TILE_LAYERS,
  /** 解析瓦片 URL */
  buildTileLayerUrl: mapUtils.buildTileLayerUrl,
  /** 从 latitudeDelta 推导聚类半径 */
  clusterRadiusFromDelta: mapUtils.clusterRadiusFromDelta,
  /** O(n) 网格聚类 */
  gridCluster: mapUtils.gridCluster,
  /** lat 范围校验 (-90..90) */
  isValidLatitude: mapUtils.isValidLatitude,
  /** lng 范围校验 (-180..180) */
  isValidLongitude: mapUtils.isValidLongitude,
  /** lat/lng 成对校验（同时为 null 或同时有效） */
  isValidLatLng: mapUtils.isValidLatLng,
  /** 坐标格式化（decimal / dms） */
  formatLatLng: mapUtils.formatLatLng,
};
const _e_RenderCore = _sharedExports.RenderCore;
export { _e_RenderCore as RenderCore };
const _e_renderBuffer = _sharedExports.renderBuffer;
export { _e_renderBuffer as renderBuffer };
const _e_stableSerializeParams = _sharedExports.stableSerializeParams;
export { _e_stableSerializeParams as stableSerializeParams };
const _e_renderParamsEqual = _sharedExports.renderParamsEqual;
export { _e_renderParamsEqual as renderParamsEqual };
const _e_remapDetectedCropRect = _sharedExports.remapDetectedCropRect;
export { _e_remapDetectedCropRect as remapDetectedCropRect };
const _e_nearestOrthogonal = _sharedExports.nearestOrthogonal;
export { _e_nearestOrthogonal as nearestOrthogonal };
const _e_parseCubeLUT = _sharedExports.parseCubeLUT;
export { _e_parseCubeLUT as parseCubeLUT };
const _e_processBlock = _sharedExports.processBlock;
export { _e_processBlock as processBlock };
const _e_processCanvasChunkedSync = _sharedExports.processCanvasChunkedSync;
export { _e_processCanvasChunkedSync as processCanvasChunkedSync };
const _e_applySaturationFloat = _sharedExports.applySaturationFloat;
export { _e_applySaturationFloat as applySaturationFloat };
const _e_applySaturation = _sharedExports.applySaturation;
export { _e_applySaturation as applySaturation };
const _e_isDefaultSaturation = _sharedExports.isDefaultSaturation;
export { _e_isDefaultSaturation as isDefaultSaturation };
const _e_buildToneLUT = _sharedExports.buildToneLUT;
export { _e_buildToneLUT as buildToneLUT };
const _e_applyToneMapping = _sharedExports.applyToneMapping;
export { _e_applyToneMapping as applyToneMapping };
const _e_createSpline = _sharedExports.createSpline;
export { _e_createSpline as createSpline };
const _e_buildCurveLUT = _sharedExports.buildCurveLUT;
export { _e_buildCurveLUT as buildCurveLUT };
const _e_buildCurveLUTFloat = _sharedExports.buildCurveLUTFloat;
export { _e_buildCurveLUTFloat as buildCurveLUTFloat };
const _e_buildCompositeFloatCurveLUT = _sharedExports.buildCompositeFloatCurveLUT;
export { _e_buildCompositeFloatCurveLUT as buildCompositeFloatCurveLUT };
const _e_buildAllCurveLUTs = _sharedExports.buildAllCurveLUTs;
export { _e_buildAllCurveLUTs as buildAllCurveLUTs };
const _e_applyCurve = _sharedExports.applyCurve;
export { _e_applyCurve as applyCurve };
const _e_computeWBGains = _sharedExports.computeWBGains;
export { _e_computeWBGains as computeWBGains };
const _e_computeWBGainsLegacy = _sharedExports.computeWBGainsLegacy;
export { _e_computeWBGainsLegacy as computeWBGainsLegacy };
const _e_solveTempTintFromSample = _sharedExports.solveTempTintFromSample;
export { _e_solveTempTintFromSample as solveTempTintFromSample };
const _e_kelvinToRGB = _sharedExports.kelvinToRGB;
export { _e_kelvinToRGB as kelvinToRGB };
const _e_sliderToKelvin = _sharedExports.sliderToKelvin;
export { _e_sliderToKelvin as sliderToKelvin };
const _e_invertLinear = _sharedExports.invertLinear;
export { _e_invertLinear as invertLinear };
const _e_invertLog = _sharedExports.invertLog;
export { _e_invertLog as invertLog };
const _e_applyInversion = _sharedExports.applyInversion;
export { _e_applyInversion as applyInversion };
const _e_applyInversionRGB = _sharedExports.applyInversionRGB;
export { _e_applyInversionRGB as applyInversionRGB };
const _e_buildInversionLUT = _sharedExports.buildInversionLUT;
export { _e_buildInversionLUT as buildInversionLUT };
const _e_calculateBaseDensity = _sharedExports.calculateBaseDensity;
export { _e_calculateBaseDensity as calculateBaseDensity };
const _e_applyLogBaseCorrection = _sharedExports.applyLogBaseCorrection;
export { _e_applyLogBaseCorrection as applyLogBaseCorrection };
const _e_applyLogBaseCorrectionRGB = _sharedExports.applyLogBaseCorrectionRGB;
export { _e_applyLogBaseCorrectionRGB as applyLogBaseCorrectionRGB };
const _e_applyLinearBaseCorrection = _sharedExports.applyLinearBaseCorrection;
export { _e_applyLinearBaseCorrection as applyLinearBaseCorrection };
const _e_applyLinearBaseCorrectionRGB = _sharedExports.applyLinearBaseCorrectionRGB;
export { _e_applyLinearBaseCorrectionRGB as applyLinearBaseCorrectionRGB };
const _e_applyFilmCurve = _sharedExports.applyFilmCurve;
export { _e_applyFilmCurve as applyFilmCurve };
const _e_applyFilmCurveRGB = _sharedExports.applyFilmCurveRGB;
export { _e_applyFilmCurveRGB as applyFilmCurveRGB };
const _e_buildFilmCurveLUT = _sharedExports.buildFilmCurveLUT;
export { _e_buildFilmCurveLUT as buildFilmCurveLUT };
const _e_mergeFilmProfiles = _sharedExports.mergeFilmProfiles;
export { _e_mergeFilmProfiles as mergeFilmProfiles };
const _e_groupFilmProfilesByCategory = _sharedExports.groupFilmProfilesByCategory;
export { _e_groupFilmProfilesByCategory as groupFilmProfilesByCategory };
const _e_FILM_CURVE_PROFILES = _sharedExports.FILM_CURVE_PROFILES;
export { _e_FILM_CURVE_PROFILES as FILM_CURVE_PROFILES };
const _e_PREVIEW_MAX_WIDTH_SERVER = _sharedExports.PREVIEW_MAX_WIDTH_SERVER;
export { _e_PREVIEW_MAX_WIDTH_SERVER as PREVIEW_MAX_WIDTH_SERVER };
const _e_PREVIEW_MAX_WIDTH_CLIENT = _sharedExports.PREVIEW_MAX_WIDTH_CLIENT;
export { _e_PREVIEW_MAX_WIDTH_CLIENT as PREVIEW_MAX_WIDTH_CLIENT };
const _e_EXPORT_MAX_WIDTH = _sharedExports.EXPORT_MAX_WIDTH;
export { _e_EXPORT_MAX_WIDTH as EXPORT_MAX_WIDTH };
const _e_DEFAULT_TONE_PARAMS = _sharedExports.DEFAULT_TONE_PARAMS;
export { _e_DEFAULT_TONE_PARAMS as DEFAULT_TONE_PARAMS };
const _e_DEFAULT_WB_PARAMS = _sharedExports.DEFAULT_WB_PARAMS;
export { _e_DEFAULT_WB_PARAMS as DEFAULT_WB_PARAMS };
const _e_INVERSION_MODE_LABELS = _sharedExports.INVERSION_MODE_LABELS;
export { _e_INVERSION_MODE_LABELS as INVERSION_MODE_LABELS };
const _e_DEFAULT_INVERSION_PARAMS = _sharedExports.DEFAULT_INVERSION_PARAMS;
export { _e_DEFAULT_INVERSION_PARAMS as DEFAULT_INVERSION_PARAMS };
const _e_DEFAULT_CURVES = _sharedExports.DEFAULT_CURVES;
export { _e_DEFAULT_CURVES as DEFAULT_CURVES };
const _e_DEFAULT_CROP_RECT = _sharedExports.DEFAULT_CROP_RECT;
export { _e_DEFAULT_CROP_RECT as DEFAULT_CROP_RECT };
const _e_WB_GAIN_LIMITS = _sharedExports.WB_GAIN_LIMITS;
export { _e_WB_GAIN_LIMITS as WB_GAIN_LIMITS };
const _e_JPEG_QUALITY = _sharedExports.JPEG_QUALITY;
export { _e_JPEG_QUALITY as JPEG_QUALITY };
const _e_WEBGL_DEBOUNCE_MS = _sharedExports.WEBGL_DEBOUNCE_MS;
export { _e_WEBGL_DEBOUNCE_MS as WEBGL_DEBOUNCE_MS };
const _e_DEBUG = _sharedExports.DEBUG;
export { _e_DEBUG as DEBUG };
const _e_FILM_PROFILES = _sharedExports.FILM_PROFILES;
export { _e_FILM_PROFILES as FILM_PROFILES };
const _e_REFERENCE_WHITE_POINTS = _sharedExports.REFERENCE_WHITE_POINTS;
export { _e_REFERENCE_WHITE_POINTS as REFERENCE_WHITE_POINTS };
const _e_TEMP_SLIDER_CONFIG = _sharedExports.TEMP_SLIDER_CONFIG;
export { _e_TEMP_SLIDER_CONFIG as TEMP_SLIDER_CONFIG };
const _e_HSL_CHANNELS = _sharedExports.HSL_CHANNELS;
export { _e_HSL_CHANNELS as HSL_CHANNELS };
const _e_HSL_CHANNEL_ORDER = _sharedExports.HSL_CHANNEL_ORDER;
export { _e_HSL_CHANNEL_ORDER as HSL_CHANNEL_ORDER };
const _e_DEFAULT_HSL_PARAMS = _sharedExports.DEFAULT_HSL_PARAMS;
export { _e_DEFAULT_HSL_PARAMS as DEFAULT_HSL_PARAMS };
const _e_rgbToHsl = _sharedExports.rgbToHsl;
export { _e_rgbToHsl as rgbToHsl };
const _e_hslToRgb = _sharedExports.hslToRgb;
export { _e_hslToRgb as hslToRgb };
const _e_applyHSL = _sharedExports.applyHSL;
export { _e_applyHSL as applyHSL };
const _e_applyHSLToArray = _sharedExports.applyHSLToArray;
export { _e_applyHSLToArray as applyHSLToArray };
const _e_isDefaultHSL = _sharedExports.isDefaultHSL;
export { _e_isDefaultHSL as isDefaultHSL };
const _e_mergeHSLParams = _sharedExports.mergeHSLParams;
export { _e_mergeHSLParams as mergeHSLParams };
const _e_validateHSLParams = _sharedExports.validateHSLParams;
export { _e_validateHSLParams as validateHSLParams };
const _e_DEFAULT_PROCESSING_PARAMS = _sharedExports.DEFAULT_PROCESSING_PARAMS;
export { _e_DEFAULT_PROCESSING_PARAMS as DEFAULT_PROCESSING_PARAMS };
const _e_PARAMS_VERSION = _sharedExports.PARAMS_VERSION;
export { _e_PARAMS_VERSION as PARAMS_VERSION };
const _e_buildExportParams = _sharedExports.buildExportParams;
export { _e_buildExportParams as buildExportParams };
const _e_validateExportParams = _sharedExports.validateExportParams;
export { _e_validateExportParams as validateExportParams };
const _e_migrateParams = _sharedExports.migrateParams;
export { _e_migrateParams as migrateParams };
const _e_serializeParams = _sharedExports.serializeParams;
export { _e_serializeParams as serializeParams };
const _e_deserializeParams = _sharedExports.deserializeParams;
export { _e_deserializeParams as deserializeParams };
const _e_diffParams = _sharedExports.diffParams;
export { _e_diffParams as diffParams };
const _e_DEFAULT_SPLIT_TONE_PARAMS = _sharedExports.DEFAULT_SPLIT_TONE_PARAMS;
export { _e_DEFAULT_SPLIT_TONE_PARAMS as DEFAULT_SPLIT_TONE_PARAMS };
const _e_SPLIT_TONE_PRESETS = _sharedExports.SPLIT_TONE_PRESETS;
export { _e_SPLIT_TONE_PRESETS as SPLIT_TONE_PRESETS };
const _e_LUMINANCE_CONFIG = _sharedExports.LUMINANCE_CONFIG;
export { _e_LUMINANCE_CONFIG as LUMINANCE_CONFIG };
const _e_applySplitTone = _sharedExports.applySplitTone;
export { _e_applySplitTone as applySplitTone };
const _e_applySplitToneToArray = _sharedExports.applySplitToneToArray;
export { _e_applySplitToneToArray as applySplitToneToArray };
const _e_isDefaultSplitTone = _sharedExports.isDefaultSplitTone;
export { _e_isDefaultSplitTone as isDefaultSplitTone };
const _e_mergeSplitToneParams = _sharedExports.mergeSplitToneParams;
export { _e_mergeSplitToneParams as mergeSplitToneParams };
const _e_validateSplitToneParams = _sharedExports.validateSplitToneParams;
export { _e_validateSplitToneParams as validateSplitToneParams };
const _e_calculateLuminance = _sharedExports.calculateLuminance;
export { _e_calculateLuminance as calculateLuminance };
const _e_RenderCore = _sharedExports.RenderCore;
export { _e_RenderCore as RenderCore };
const _e_DEFAULT_FILM_CURVE = _sharedExports.DEFAULT_FILM_CURVE;
export { _e_DEFAULT_FILM_CURVE as DEFAULT_FILM_CURVE };
const _e_getEffectiveInverted = _sharedExports.getEffectiveInverted;
export { _e_getEffectiveInverted as getEffectiveInverted };
const _e_isPositiveMode = _sharedExports.isPositiveMode;
export { _e_isPositiveMode as isPositiveMode };
const _e_shouldShowInversionControls = _sharedExports.shouldShowInversionControls;
export { _e_shouldShowInversionControls as shouldShowInversionControls };
const _e_getLUT3DIndex = _sharedExports.getLUT3DIndex;
export { _e_getLUT3DIndex as getLUT3DIndex };
const _e_packLUT3DForWebGL = _sharedExports.packLUT3DForWebGL;
export { _e_packLUT3DForWebGL as packLUT3DForWebGL };
const _e_buildCombinedLUT = _sharedExports.buildCombinedLUT;
export { _e_buildCombinedLUT as buildCombinedLUT };
const _e_normalizeSourceType = _sharedExports.normalizeSourceType;
export { _e_normalizeSourceType as normalizeSourceType };
const _e_normalizeInversionMode = _sharedExports.normalizeInversionMode;
export { _e_normalizeInversionMode as normalizeInversionMode };
const _e_getLUT3DSamplingGLSL = _sharedExports.getLUT3DSamplingGLSL;
export { _e_getLUT3DSamplingGLSL as getLUT3DSamplingGLSL };
const _e_SOURCE_TYPE = _sharedExports.SOURCE_TYPE;
export { _e_SOURCE_TYPE as SOURCE_TYPE };
const _e_getStrictSourcePath = _sharedExports.getStrictSourcePath;
export { _e_getStrictSourcePath as getStrictSourcePath };
const _e_validateSourceMatch = _sharedExports.validateSourceMatch;
export { _e_validateSourceMatch as validateSourceMatch };
const _e_canUseSourceType = _sharedExports.canUseSourceType;
export { _e_canUseSourceType as canUseSourceType };
const _e_getAvailableSourceTypes = _sharedExports.getAvailableSourceTypes;
export { _e_getAvailableSourceTypes as getAvailableSourceTypes };
const _e_RAW_EXTENSIONS = _sharedExports.RAW_EXTENSIONS;
export { _e_RAW_EXTENSIONS as RAW_EXTENSIONS };
const _e_isRawFile = _sharedExports.isRawFile;
export { _e_isRawFile as isRawFile };
const _e_getRawFormatInfo = _sharedExports.getRawFormatInfo;
export { _e_getRawFormatInfo as getRawFormatInfo };
const _e_detectFileType = _sharedExports.detectFileType;
export { _e_detectFileType as detectFileType };
const _e_isBrowserLoadable = _sharedExports.isBrowserLoadable;
export { _e_isBrowserLoadable as isBrowserLoadable };
const _e_requiresServerDecode = _sharedExports.requiresServerDecode;
export { _e_requiresServerDecode as requiresServerDecode };
const _e_shaders = _sharedExports.shaders;
export { _e_shaders as shaders };
const _e_buildFragmentShader = _sharedExports.buildFragmentShader;
export { _e_buildFragmentShader as buildFragmentShader };
const _e_VERTEX_SHADER = _sharedExports.VERTEX_SHADER;
export { _e_VERTEX_SHADER as VERTEX_SHADER };
const _e_SHADER_VERSION = _sharedExports.SHADER_VERSION;
export { _e_SHADER_VERSION as SHADER_VERSION };
const _e_wgs84ToGcj02 = _sharedExports.wgs84ToGcj02;
export { _e_wgs84ToGcj02 as wgs84ToGcj02 };
const _e_gcj02ToWgs84 = _sharedExports.gcj02ToWgs84;
export { _e_gcj02ToWgs84 as gcj02ToWgs84 };
const _e_isInChina = _sharedExports.isInChina;
export { _e_isInChina as isInChina };
const _e_APP_IDENTIFIER = _sharedExports.APP_IDENTIFIER;
export { _e_APP_IDENTIFIER as APP_IDENTIFIER };
const _e_DISCOVERY_ENDPOINT = _sharedExports.DISCOVERY_ENDPOINT;
export { _e_DISCOVERY_ENDPOINT as DISCOVERY_ENDPOINT };
const _e_DEFAULT_PORT = _sharedExports.DEFAULT_PORT;
export { _e_DEFAULT_PORT as DEFAULT_PORT };
const _e_PORT_SCAN_RANGE = _sharedExports.PORT_SCAN_RANGE;
export { _e_PORT_SCAN_RANGE as PORT_SCAN_RANGE };
const _e_DISCOVERY_TIMEOUT = _sharedExports.DISCOVERY_TIMEOUT;
export { _e_DISCOVERY_TIMEOUT as DISCOVERY_TIMEOUT };
const _e_MDNS_CONFIG = _sharedExports.MDNS_CONFIG;
export { _e_MDNS_CONFIG as MDNS_CONFIG };
const _e_DISCOVERY_MODE = _sharedExports.DISCOVERY_MODE;
export { _e_DISCOVERY_MODE as DISCOVERY_MODE };
const _e_buildDiscoverUrl = _sharedExports.buildDiscoverUrl;
export { _e_buildDiscoverUrl as buildDiscoverUrl };
const _e_cleanIpAddress = _sharedExports.cleanIpAddress;
export { _e_cleanIpAddress as cleanIpAddress };
const _e_extractPort = _sharedExports.extractPort;
export { _e_extractPort as extractPort };
const _e_buildUrl = _sharedExports.buildUrl;
export { _e_buildUrl as buildUrl };
const _e_isPrivateIp = _sharedExports.isPrivateIp;
export { _e_isPrivateIp as isPrivateIp };
const _e_recommendDiscoveryMode = _sharedExports.recommendDiscoveryMode;
export { _e_recommendDiscoveryMode as recommendDiscoveryMode };
const _e_SERVER_MODES = _sharedExports.SERVER_MODES;
export { _e_SERVER_MODES as SERVER_MODES };
const _e_API_CATEGORIES = _sharedExports.API_CATEGORIES;
export { _e_API_CATEGORIES as API_CATEGORIES };
const _e_COMPUTE_ROUTES = _sharedExports.COMPUTE_ROUTES;
export { _e_COMPUTE_ROUTES as COMPUTE_ROUTES };
const _e_DATA_ROUTES = _sharedExports.DATA_ROUTES;
export { _e_DATA_ROUTES as DATA_ROUTES };
const _e_getServerMode = _sharedExports.getServerMode;
export { _e_getServerMode as getServerMode };
const _e_getCapabilities = _sharedExports.getCapabilities;
export { _e_getCapabilities as getCapabilities };
const _e_isComputeEnabled = _sharedExports.isComputeEnabled;
export { _e_isComputeEnabled as isComputeEnabled };
const _e_isComputeRoute = _sharedExports.isComputeRoute;
export { _e_isComputeRoute as isComputeRoute };
const _e_reverseGeocodeBigDataCloud = _sharedExports.reverseGeocodeBigDataCloud;
export { _e_reverseGeocodeBigDataCloud as reverseGeocodeBigDataCloud };
const _e_normalizeBigDataCloud = _sharedExports.normalizeBigDataCloud;
export { _e_normalizeBigDataCloud as normalizeBigDataCloud };
const _e_BDC_BASE = _sharedExports.BDC_BASE;
export { _e_BDC_BASE as BDC_BASE };
const _e_searchAddress = _sharedExports.searchAddress;
export { _e_searchAddress as searchAddress };
const _e_reverseGeocode = _sharedExports.reverseGeocode;
export { _e_reverseGeocode as reverseGeocode };
const _e_getCityCoordinates = _sharedExports.getCityCoordinates;
export { _e_getCityCoordinates as getCityCoordinates };
const _e_searchWithAmap = _sharedExports.searchWithAmap;
export { _e_searchWithAmap as searchWithAmap };
const _e_searchWithPhoton = _sharedExports.searchWithPhoton;
export { _e_searchWithPhoton as searchWithPhoton };
const _e_searchWithNominatim = _sharedExports.searchWithNominatim;
export { _e_searchWithNominatim as searchWithNominatim };
const _e_reverseWithAmap = _sharedExports.reverseWithAmap;
export { _e_reverseWithAmap as reverseWithAmap };
const _e_reverseWithPhoton = _sharedExports.reverseWithPhoton;
export { _e_reverseWithPhoton as reverseWithPhoton };
const _e_reverseWithNominatim = _sharedExports.reverseWithNominatim;
export { _e_reverseWithNominatim as reverseWithNominatim };
const _e_reverseWithBigDataCloud = _sharedExports.reverseWithBigDataCloud;
export { _e_reverseWithBigDataCloud as reverseWithBigDataCloud };
const _e_MAP_PROVIDERS = _sharedExports.MAP_PROVIDERS;
export { _e_MAP_PROVIDERS as MAP_PROVIDERS };
const _e_TILE_LAYERS = _sharedExports.TILE_LAYERS;
export { _e_TILE_LAYERS as TILE_LAYERS };
const _e_buildTileLayerUrl = _sharedExports.buildTileLayerUrl;
export { _e_buildTileLayerUrl as buildTileLayerUrl };
const _e_clusterRadiusFromDelta = _sharedExports.clusterRadiusFromDelta;
export { _e_clusterRadiusFromDelta as clusterRadiusFromDelta };
const _e_gridCluster = _sharedExports.gridCluster;
export { _e_gridCluster as gridCluster };
const _e_isValidLatitude = _sharedExports.isValidLatitude;
export { _e_isValidLatitude as isValidLatitude };
const _e_isValidLongitude = _sharedExports.isValidLongitude;
export { _e_isValidLongitude as isValidLongitude };
const _e_isValidLatLng = _sharedExports.isValidLatLng;
export { _e_isValidLatLng as isValidLatLng };
const _e_formatLatLng = _sharedExports.formatLatLng;
export { _e_formatLatLng as formatLatLng };
export default _sharedExports;
