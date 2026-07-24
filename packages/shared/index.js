/**
 * FilmLab 共享模块入口
 * 
 * @module packages/shared
 * @description 统一导出所有 FilmLab 核心处理函数和常量
 */

// 核心处理模块
const { RenderCore } = require('./render/RenderCore');
const { renderBuffer } = require('./render/render-buffer');
const saturation = require('./filmLabSaturation');
const constants = require('./filmLabConstants');
const toneLUT = require('./filmLabToneLUT');
const curves = require('./filmLabCurves');
const whiteBalance = require('./filmLabWhiteBalance');
const inversion = require('./filmLabInversion');
const filmCurve = require('./filmLabCurve');
const hsl = require('./filmLabHSL');
const exportParams = require('./filmLabExport');
const splitTone = require('./filmLabSplitTone');
const render = require('./render');
const helpers = require('./filmLabHelpers');
const sourcePathResolver = require('./sourcePathResolver');
const rawUtils = require('./rawUtils');
const paramSerializer = require('./paramSerializer');
const autoCropCoord = require('./autoCropCoord');
const lutParser = require('./lutParser');
const renderChunked = require('./renderChunked');

// Service discovery & coordinate transforms (consumed by client/mobile/watch/server).
const coordTransform = require('./coordTransform');
const portDiscovery = require('./portDiscovery');
const serverCapabilities = require('./serverCapabilities');
const geocode = require('./geocode');
const geocoding = require('./geocoding');
const mapUtils = require('./mapUtils');

// 摄影模式（film / digital / all）
const photographyMode = require('./photographyMode');

// GLSL 着色器模块 (Phase 3)
const shaders = require('./shaders');

// 统一导出
module.exports = {
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

  // ============================================================================
  // 摄影模式（film / digital / all）
  // ============================================================================

  PHOTO_MODES: photographyMode.PHOTO_MODES,
  VALID_MODES: photographyMode.VALID_MODES,
  normalizeMode: photographyMode.normalizeMode,
  isFilmMode: photographyMode.isFilmMode,
  isDigitalMode: photographyMode.isDigitalMode,
  isAllMode: photographyMode.isAllMode,
  sourceTypeFilter: photographyMode.sourceTypeFilter,
  buildSourceTypeClause: photographyMode.buildSourceTypeClause,
};
