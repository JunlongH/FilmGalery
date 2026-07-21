// Minimal WebGL helper for FilmLab
// Provides a basic shader pipeline for inversion (linear/log), white balance (r/g/b gains), exposure and contrast.
// This is intentionally small and dependency-free. We'll extend it later for curves and 3D LUTs.

// 从共享模块导入 LUT 打包函数和着色器构建器，确保与 GPU 导出路径一致
import { packLUT3DForWebGL, buildFragmentShader, VERTEX_SHADER, SHADER_VERSION as SHARED_SHADER_VERSION } from '@filmgallery/shared';

// Debug flag - set to true during development for detailed logging
// Treeshaken by bundler in production builds via process.env.NODE_ENV guard below.
const DEBUG_WEBGL = false;
const DEBUG_LUT = false;
// const DEBUG_LUT_OUTPUT = false; // unused

// Helper: Check if HSL params are default (all zeros)
function isDefaultHSLParams(hslParams) {
  if (!hslParams) return true;
  const channels = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'];
  for (const ch of channels) {
    const data = hslParams[ch];
    if (data && (data.hue !== 0 || data.saturation !== 0 || data.luminance !== 0)) {
      return false;
    }
  }
  return true;
}

// Helper: Check if Split Tone params are default
function isDefaultSplitToneParams(splitToning) {
  if (!splitToning) return true;
  const highlightSat = splitToning.highlights?.saturation ?? 0;
  const midtoneSat = splitToning.midtones?.saturation ?? 0;
  const shadowSat = splitToning.shadows?.saturation ?? 0;
  return highlightSat === 0 && midtoneSat === 0 && shadowSat === 0;
}

function createShader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('Shader compile error: ' + msg);
  }
  return s;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('Program link error: ' + msg);
  }
  
  // Debug: 检查所有 active uniforms (仅在调试模式下)
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) {
    console.log('[FilmLabWebGL] Program created successfully. Checking active uniforms...');
    const numUniforms = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    console.log('[FilmLabWebGL] Number of active uniforms:', numUniforms);
    for (let i = 0; i < numUniforms; i++) {
      const info = gl.getActiveUniform(prog, i);
      console.log(`  - Uniform ${i}: name="${info.name}", type=${info.type}, size=${info.size}`);
    }
  }
  
  return prog;
}

// P1-53/P3-56: Cache result to avoid per-frame canvas creation.
// Priority matches processImageWebGL (webgl2 first).
let _webglAvailableCache = null;

export function isWebGLAvailable() {
  if (_webglAvailableCache !== null) return _webglAvailableCache;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2')
      || canvas.getContext('webgl')
      || canvas.getContext('experimental-webgl');
    _webglAvailableCache = !!gl;
    return _webglAvailableCache;
  } catch (e) {
    _webglAvailableCache = false;
    return false;
  }
}

export function _resetWebGLAvailableCache() {
  _webglAvailableCache = null;
}

// Process an image on the given canvas using WebGL. The canvas will be sized to image dimensions.
export function processImageWebGL(canvas, image, params = {}) {
  if (!canvas) return;
  
  // 尝试使用 webgl2 以支持更多选项
  let gl = canvas.getContext('webgl2', { 
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
    alpha: true,
    desynchronized: false,
    colorSpace: 'srgb'  // 明确指定颜色空间
  });
  
  // 回退到 webgl
  if (!gl) {
    gl = canvas.getContext('webgl', { 
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
      colorSpace: 'srgb'
    }) || canvas.getContext('experimental-webgl', {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false
    });
  }
  
  if (!gl) throw new Error('WebGL not available');
  
  // WebGL 上下文丢失检测 — 防止在上下文丢失后继续操作导致异常
  if (gl.isContextLost()) {
    console.warn('[FilmLabWebGL] WebGL context is lost, skipping render');
    throw new Error('WebGL context lost');
  }
  
  // 注册上下文丢失/恢复事件（仅注册一次）
  if (!canvas._contextLostHandlerRegistered) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // 允许上下文恢复
      console.warn('[FilmLabWebGL] WebGL context lost event fired');
      // 清除缓存，强制下次重建
      if (processImageWebGL._cache) {
        processImageWebGL._cache.delete(canvas);
      }
    });
    canvas.addEventListener('webglcontextrestored', () => {
      console.log('[FilmLabWebGL] WebGL context restored');
      // 清除缓存，强制重新编译着色器和创建纹理
      if (processImageWebGL._cache) {
        processImageWebGL._cache.delete(canvas);
      }
    });
    canvas._contextLostHandlerRegistered = true;
  }
  
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Using:', gl.getParameter(gl.VERSION));

  // Simple cache per-canvas to reuse programs and textures
  // SHADER_VERSION is checked below to invalidate cache when shader code changes
  if (!processImageWebGL._cache) processImageWebGL._cache = new WeakMap();
  
  // Get or create cache for this canvas
  let cache = processImageWebGL._cache.get(canvas);
  if (!cache) {
    cache = {};
    processImageWebGL._cache.set(canvas, cache);
    if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Created new cache for canvas');
  } else {
    if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Reusing existing cache, shaderVersion:', cache.shaderVersion);
  }
  // P2-19: Pre-allocated scratch buffers for uniform uploads — avoids per-frame GC pressure
  if (!cache._scratch3) cache._scratch3 = new Float32Array(3);
  if (!cache._scratch4) cache._scratch4 = new Float32Array(4);
  if (!cache._scratch16) cache._scratch16 = new Float32Array(16);

  // ============================================================================
  // PHASE 2 REFACTOR: Pure WebGL Geometry via UV Mapping
  // Replaces 2D Canvas pre-processing with GPU-based rotation/crop
  // This approach matches gpu-renderer.js for consistency and better performance
  // ============================================================================
  
  const srcW = image.width;
  const srcH = image.height;
  const scale = (typeof params.scale === 'number' && params.scale > 0) ? params.scale : 1;
  
  // Rotation angle (in radians)
  const rotateDeg = typeof params.rotate === 'number' ? params.rotate : 0;
  const rad = rotateDeg * Math.PI / 180;
  
  // Precompute trig values for backward rotation (Screen -> Source)
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  
  // Scaled source dimensions
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  
  // Dimensions of the rotated bounding box
  // IMPORTANT: Use floating-point for intermediate calculations to avoid cumulative rounding errors
  // during rotation. This matches CPU canvas path which uses floating-point transforms.
  // Only round at the final output canvas size stage.
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const rotW = scaledW * absCos + scaledH * absSin;  // Keep as float for UV precision
  const rotH = scaledW * absSin + scaledH * absCos;  // Keep as float for UV precision
  
  // Crop rectangle (normalized 0-1 in rotated space)
  const crop = params.cropRect || { x: 0, y: 0, w: 1, h: 1 };
  const cropX = Math.max(0, Math.min(1, crop.x || 0));
  const cropY = Math.max(0, Math.min(1, crop.y || 0));
  const cropW = Math.max(0, Math.min(1 - cropX, crop.w || 1));
  const cropH = Math.max(0, Math.min(1 - cropY, crop.h || 1));
  
  // Output canvas dimensions (Crop is relative to the Rotated Image)
  // Only apply rounding at the final output stage
  const outW = Math.max(1, Math.round(rotW * cropW));
  const outH = Math.max(1, Math.round(rotH * cropH));
  
  // Set canvas size
  canvas.width = outW;
  canvas.height = outH;
  gl.viewport(0, 0, canvas.width, canvas.height);
  
  // Helper to map UV from Rotated+Cropped Space (0..1) to Source Space (0..1)
  // This is the core of the pure WebGL geometry approach (ported from gpu-renderer.js)
  // IMPORTANT: FilmLabWebGL uses UNPACK_FLIP_Y_WEBGL=true, so texture V=0 is at BOTTOM
  // But our coordinate system assumes V=0 is at TOP (standard image coords)
  // We compensate by flipping v_rot input: use (1 - v_rot) in the calculation
  const mapUV = (u_rot, v_rot) => {
    // 1. Convert normalized crop UV to full rotated space UV
    const u_full = cropX + u_rot * cropW;
    const v_full = cropY + v_rot * cropH;
    
    // 2. Convert to pixels in Rotated Space
    const x_rot = u_full * rotW;
    const y_rot = v_full * rotH;
    
    // 3. Shift to center of rotated space
    const dx_rot = x_rot - rotW / 2;
    const dy_rot = y_rot - rotH / 2;
    
    // 4. Rotate backwards (-rad) to align with Scaled Source Space
    const dx_src = dx_rot * cos - dy_rot * sin;
    const dy_src = dx_rot * sin + dy_rot * cos;
    
    // 5. Shift back from center of Scaled Source
    const x_src = dx_src + scaledW / 2;
    const y_src = dy_src + scaledH / 2;
    
    // 6. Normalize to Source UV (0-1)
    // Note: Flip Y for UNPACK_FLIP_Y_WEBGL=true compatibility
    const u_src = x_src / scaledW;
    const v_src = 1.0 - (y_src / scaledH);  // Flip Y to compensate for UNPACK_FLIP_Y_WEBGL=true
    return [u_src, v_src];
  };
  
  // Calculate UVs for the 4 corners of the output quad
  // WebGL quad: TL(-1,1), TR(1,1), BL(-1,-1), BR(1,-1)
  // Texture UV: TL(0,0), TR(1,0), BL(0,1), BR(1,1) in standard coords
  // Store computed UVs directly in cache for use in vertex buffer setup
  cache.computedUVs = {
    uvTL: mapUV(0, 0),
    uvTR: mapUV(1, 0),
    uvBL: mapUV(0, 1),
    uvBR: mapUV(1, 1)
  };

  // Vertex shader — from shared shader library (single source of truth)
  const vsSource = VERTEX_SHADER;

  // Fragment shader — from shared shader library (single source of truth)
  // All GLSL code (HSL, Split Tone, Film Curve, Tonemap, Inversion, Base Density,
  // LUT, Curves) now comes from packages/shared/shaders/ ensuring pixel-perfect
  // consistency between client preview and GPU export paths.
  // isGL2 与 precision 按实际上下文传递：移动端 mediump 会导致 LUT 寻址/密度域精度崩塌
  // useNativeLUT3D=false：客户端使用 packed-2D LUT 路径（避免实现 texImage3D 上传），
  // 服务端 gpu-renderer 保持默认 true 以利用原生 sampler3D 性能
  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && (gl instanceof WebGL2RenderingContext);
  const fsSource = buildFragmentShader({ isGL2, precision: 'highp', useNativeLUT3D: false });

  // Shader version from shared library — auto-invalidates cache when shader code changes
  const SHADER_VERSION = SHARED_SHADER_VERSION;
  
  // Build or reuse program
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) {
    console.log('[FilmLabWebGL] SHADER_VERSION:', SHADER_VERSION, 'cache.shaderVersion:', cache.shaderVersion);
  }
  if (!cache.program || cache.shaderVersion !== SHADER_VERSION) {
    if (cache.program) {
      gl.deleteProgram(cache.program);
      console.log('[FilmLabWebGL] Recompiling shader due to version change:', cache.shaderVersion, '->', SHADER_VERSION);
    } else {
      console.log('[FilmLabWebGL] Compiling shader for the first time, version:', SHADER_VERSION);
    }
    cache.program = createProgram(gl, vsSource, fsSource);
    cache.shaderVersion = SHADER_VERSION;
    cache.locs = null; // Clear cached uniform locations
  }
  const program = cache.program;
  gl.useProgram(program);

  // Set up a full-screen quad (cache buffer)
  // ============================================================================
  // PHASE 2 REFACTOR: Dynamic UV Vertex Buffer
  // Uses computed UVs from mapUV() for rotation/crop geometry
  // ============================================================================
  
  // Get computed UVs from earlier calculation
  const computedUVs = cache.computedUVs;
  if (!computedUVs) {
    console.error('[FilmLabWebGL] Missing computedUVs - falling back to identity UVs');
  }
  
  // Build vertex buffer with dynamic UVs for geometry transforms
  // Format: [posX, posY, uvX, uvY] per vertex
  // Quad vertices: BL(-1,-1), BR(1,-1), TL(-1,1), TR(1,1)
  const bl = computedUVs ? computedUVs.uvBL : [0, 1];
  const br = computedUVs ? computedUVs.uvBR : [1, 1];
  const tl = computedUVs ? computedUVs.uvTL : [0, 0];
  const tr = computedUVs ? computedUVs.uvTR : [1, 0];
  
  // P2-20: Dirty-flag vertex buffer — only re-upload when rotation/crop changes
  const uvKey = JSON.stringify({ rotation: params.rotate, crop: params.cropRect });
  if (!cache.buffer) {
    cache.buffer = gl.createBuffer();
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, cache.buffer);
  if (cache.lastUVKey !== uvKey) {
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, bl[0], bl[1],  // BL
       1, -1, br[0], br[1],  // BR
      -1,  1, tl[0], tl[1],  // TL
       1,  1, tr[0], tr[1],  // TR
    ]), gl.DYNAMIC_DRAW);
    cache.lastUVKey = uvKey;
  }

  const posLoc = gl.getAttribLocation(program, 'a_pos');
  const uvLoc = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  // Create or reuse texture from original image
  // PHASE 2: We now upload the original image and use UV mapping for geometry
  // 重要：必须先激活 TEXTURE0 再绑定图像纹理，因为着色器期望图像在纹理单元 0
  // Image texture — P1-21: dirty flag, skip re-upload when image reference unchanged
  // （用户调参不换图时图像数据没变，每帧 texImage2D 是浪费）
  if (cache.imageTex && cache.imageRef === image) {
    // 图像未变：仅重新绑定已上传的纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cache.imageTex);
  } else {
    if (!cache.imageTex) cache.imageTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cache.imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    cache.imageRef = image;
  }

  // Uniform locations - P1-15: 复用 cache.locs（program 重建时已置 null）
  // 旧实现每帧 ~50 次 getUniformLocation 是浪费——cache 是 WeakMap 复用对象
  if (!cache.locs) {
    const locs = {};
    cache.locs = locs;

    locs.u_image = gl.getUniformLocation(program, 'u_image');
    locs.u_inverted = gl.getUniformLocation(program, 'u_inverted');
    locs.u_inversionMode = gl.getUniformLocation(program, 'u_inversionMode');
    locs.u_gains = gl.getUniformLocation(program, 'u_gains');
    locs.u_exposure = gl.getUniformLocation(program, 'u_exposure');
    locs.u_contrast = gl.getUniformLocation(program, 'u_contrast');
    locs.u_highlights = gl.getUniformLocation(program, 'u_highlights');
    locs.u_shadows = gl.getUniformLocation(program, 'u_shadows');
    locs.u_whites = gl.getUniformLocation(program, 'u_whites');
    locs.u_blacks = gl.getUniformLocation(program, 'u_blacks');
    // Film Curve uniforms (Q13: per-channel gamma + toe/shoulder)
    locs.u_filmCurveEnabled = gl.getUniformLocation(program, 'u_filmCurveEnabled');
    locs.u_filmCurveGamma = gl.getUniformLocation(program, 'u_filmCurveGamma');
    locs.u_filmCurveGammaR = gl.getUniformLocation(program, 'u_filmCurveGammaR');
    locs.u_filmCurveGammaG = gl.getUniformLocation(program, 'u_filmCurveGammaG');
    locs.u_filmCurveGammaB = gl.getUniformLocation(program, 'u_filmCurveGammaB');
    locs.u_filmCurveDMin = gl.getUniformLocation(program, 'u_filmCurveDMin');
    locs.u_filmCurveDMax = gl.getUniformLocation(program, 'u_filmCurveDMax');
    locs.u_filmCurveToe = gl.getUniformLocation(program, 'u_filmCurveToe');
    locs.u_filmCurveShoulder = gl.getUniformLocation(program, 'u_filmCurveShoulder');
    // Base Correction uniforms (Pre-Inversion)
    locs.u_baseMode = gl.getUniformLocation(program, 'u_baseMode');
    locs.u_baseGains = gl.getUniformLocation(program, 'u_baseGains');
    locs.u_baseDensity = gl.getUniformLocation(program, 'u_baseDensity');
    // Density Levels uniforms (Log domain auto-levels)
    locs.u_densityLevelsEnabled = gl.getUniformLocation(program, 'u_densityLevelsEnabled');
    locs.u_densityLevelsMin = gl.getUniformLocation(program, 'u_densityLevelsMin');
    locs.u_densityLevelsMax = gl.getUniformLocation(program, 'u_densityLevelsMax');
    locs.u_curveRGB = gl.getUniformLocation(program, 'u_curveRGB');
    locs.u_curveR = gl.getUniformLocation(program, 'u_curveR');
    locs.u_curveG = gl.getUniformLocation(program, 'u_curveG');
    locs.u_curveB = gl.getUniformLocation(program, 'u_curveB');
    locs.u_useCurves = gl.getUniformLocation(program, 'u_useCurves');
    // LUT uniforms（客户端始终使用 packed-2D 路径，无需 u_hasLut3d/u_lut3dSize/u_lut3dTex）
    locs.u_lut3d = gl.getUniformLocation(program, 'u_lut3d');
    locs.u_useLut3d = gl.getUniformLocation(program, 'u_useLut3d');
    locs.u_lutSize = gl.getUniformLocation(program, 'u_lutSize');
    locs.u_lutIntensity = gl.getUniformLocation(program, 'u_lutIntensity');
    // HSL uniforms
    locs.u_useHSL = gl.getUniformLocation(program, 'u_useHSL');
    locs.u_hslRed = gl.getUniformLocation(program, 'u_hslRed');
    locs.u_hslOrange = gl.getUniformLocation(program, 'u_hslOrange');
    locs.u_hslYellow = gl.getUniformLocation(program, 'u_hslYellow');
    locs.u_hslGreen = gl.getUniformLocation(program, 'u_hslGreen');
    locs.u_hslCyan = gl.getUniformLocation(program, 'u_hslCyan');
    locs.u_hslBlue = gl.getUniformLocation(program, 'u_hslBlue');
    locs.u_hslPurple = gl.getUniformLocation(program, 'u_hslPurple');
    locs.u_hslMagenta = gl.getUniformLocation(program, 'u_hslMagenta');
    // Saturation uniforms (Luma-Preserving, Rec.709)
    locs.u_useSaturation = gl.getUniformLocation(program, 'u_useSaturation');
    locs.u_saturation = gl.getUniformLocation(program, 'u_saturation');
    // Split Toning uniforms (u_split* prefix — matches shared shader naming)
    locs.u_useSplitTone = gl.getUniformLocation(program, 'u_useSplitTone');
    locs.u_splitHighlightHue = gl.getUniformLocation(program, 'u_splitHighlightHue');
    locs.u_splitHighlightSat = gl.getUniformLocation(program, 'u_splitHighlightSat');
    locs.u_splitMidtoneHue = gl.getUniformLocation(program, 'u_splitMidtoneHue');
    locs.u_splitMidtoneSat = gl.getUniformLocation(program, 'u_splitMidtoneSat');
    locs.u_splitShadowHue = gl.getUniformLocation(program, 'u_splitShadowHue');
    locs.u_splitShadowSat = gl.getUniformLocation(program, 'u_splitShadowSat');
    locs.u_splitBalance = gl.getUniformLocation(program, 'u_splitBalance');
    // P1-20: linearDomainInversion uniform（之前客户端从未绑定，GPU 预览忽略线性域反转）
    locs.u_linearDomainInversion = gl.getUniformLocation(program, 'u_linearDomainInversion');
  }
  const locs = cache.locs;
  
  // Debug: 打印关键 LUT uniform locations
  if (DEBUG_LUT) {
    console.log('[FilmLabWebGL] LUT uniform locations:',
      'u_lut3d=', locs.u_lut3d,
      'u_useLut3d=', locs.u_useLut3d,
      'u_lutSize=', locs.u_lutSize,
      'u_lutIntensity=', locs.u_lutIntensity);
  }

  // Bind image texture to unit 0
  gl.uniform1i(locs.u_image, 0);

  const inverted = params.inverted ? 1.0 : 0.0;
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) {
    console.log('[FilmLabWebGL] u_inverted:', inverted, 'params.inverted:', params.inverted);
    console.log('[FilmLabWebGL] locs.u_inverted:', locs.u_inverted);
    if (locs.u_inverted === null) {
      console.error('[FilmLabWebGL] ERROR: u_inverted uniform location is NULL!');
    }
  }
  gl.uniform1f(locs.u_inverted, inverted);
  
  const mode = params.inversionMode === 'log' ? 1.0 : 0.0;
  gl.uniform1f(locs.u_inversionMode, mode);

  // P1-20: linearDomainInversion — 之前客户端从未绑定，GPU 预览忽略线性域反转
  // 与 CPU processPixelFloat 对齐：在线性光下做片基校正/密度色阶/反转
  const linearDomainInversion = params.linearDomainInversion ? 1.0 : 0.0;
  if (locs.u_linearDomainInversion !== null) {
    gl.uniform1f(locs.u_linearDomainInversion, linearDomainInversion);
  }

  const gains = params.gains || [1.0, 1.0, 1.0];
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Setting u_gains:', gains);
  cache._scratch3.set(gains);
  gl.uniform3fv(locs.u_gains, cache._scratch3);

  // Pass raw exposure value — shared shader divides by 50 internally: pow(2, exposure/50)
  const exposure = typeof params.exposure === 'number' ? params.exposure : 0.0;
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Setting u_exposure:', exposure, 'from', params.exposure);
  gl.uniform1f(locs.u_exposure, exposure);

  // Pass raw contrast value — shared shader scales by *2.55 internally
  const contrast = typeof params.contrast === 'number' ? params.contrast : 0.0;
  gl.uniform1f(locs.u_contrast, contrast);

  gl.uniform1f(locs.u_highlights, params.highlights || 0.0);
  gl.uniform1f(locs.u_shadows, params.shadows || 0.0);
  gl.uniform1f(locs.u_whites, params.whites || 0.0);
  gl.uniform1f(locs.u_blacks, params.blacks || 0.0);

  // Film Curve parameters (Q13: per-channel gamma + toe/shoulder)
  const filmCurveEnabled = params.filmCurveEnabled ? 1.0 : 0.0;
  gl.uniform1f(locs.u_filmCurveEnabled, filmCurveEnabled);
  gl.uniform1f(locs.u_filmCurveGamma, params.filmCurveGamma ?? 0.6);
  gl.uniform1f(locs.u_filmCurveGammaR, params.filmCurveGammaR ?? params.filmCurveGamma ?? 0.6);
  gl.uniform1f(locs.u_filmCurveGammaG, params.filmCurveGammaG ?? params.filmCurveGamma ?? 0.6);
  gl.uniform1f(locs.u_filmCurveGammaB, params.filmCurveGammaB ?? params.filmCurveGamma ?? 0.6);
  gl.uniform1f(locs.u_filmCurveDMin, params.filmCurveDMin ?? 0.1);
  gl.uniform1f(locs.u_filmCurveDMax, params.filmCurveDMax ?? 3.0);
  gl.uniform1f(locs.u_filmCurveToe, params.filmCurveToe ?? 0);
  gl.uniform1f(locs.u_filmCurveShoulder, params.filmCurveShoulder ?? 0);

  // Base Correction (Pre-Inversion)
  // Support both linear (gains) and log (density) modes
  const baseMode = params.baseMode === 'log' ? 1.0 : 0.0;
  const baseGains = params.baseGains || [1.0, 1.0, 1.0];
  const baseDensity = params.baseDensity || [0.0, 0.0, 0.0];
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Setting base correction:', { baseMode, baseGains, baseDensity });
  gl.uniform1f(locs.u_baseMode, baseMode);
  cache._scratch3.set(baseGains);
  gl.uniform3fv(locs.u_baseGains, cache._scratch3);
  cache._scratch3.set(baseDensity);
  gl.uniform3fv(locs.u_baseDensity, cache._scratch3);

  // Density Levels (Log domain auto-levels)
  const densityLevelsEnabled = params.densityLevelsEnabled && baseMode > 0.5 ? 1.0 : 0.0;
  const densityLevels = params.densityLevels || { red: { min: 0, max: 3 }, green: { min: 0, max: 3 }, blue: { min: 0, max: 3 } };
  gl.uniform1f(locs.u_densityLevelsEnabled, densityLevelsEnabled);
  cache._scratch3.set([
    densityLevels.red?.min ?? 0,
    densityLevels.green?.min ?? 0,
    densityLevels.blue?.min ?? 0
  ]);
  gl.uniform3fv(locs.u_densityLevelsMin, cache._scratch3);
  cache._scratch3.set([
    densityLevels.red?.max ?? 3,
    densityLevels.green?.max ?? 3,
    densityLevels.blue?.max ?? 3
  ]);
  gl.uniform3fv(locs.u_densityLevelsMax, cache._scratch3);
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) console.log('[FilmLabWebGL] Setting density levels:', { densityLevelsEnabled, densityLevels });

  // Curves
  const curves = params.curves;
  if (curves) {
    // P1-16: 曲线纹理脏标记 + 预分配缓冲
    // 旧实现每帧 4 条曲线 × 256×4 字节 = 16KB new Uint8Array + 4 次 texImage2D + 16 次 texParameteri
    // 现在仅在曲线数据变化时重传，texParameteri 只在 createTexture 后调一次
    const uploadCurve = (key, arr) => {
      if (!arr) return null;
      if (!cache[key]) {
        cache[key] = gl.createTexture();
        cache[key + '_ref'] = null; // 脏标记：首次必定上传
      }
      const tex = cache[key];
      const slot = key === 'curveRGB' ? 0 : key === 'curveR' ? 1 : key === 'curveG' ? 2 : 3;
      gl.activeTexture(gl.TEXTURE1 + slot);
      gl.bindTexture(gl.TEXTURE_2D, tex);

      // 引用未变：跳过 texImage2D + texParameteri
      if (cache[key + '_ref'] !== arr) {
        // 仅在首次创建时设置 texParameteri（参数从不变化）
        if (cache[key + '_ref'] === null) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        // 复用预分配缓冲（避免每帧 16KB 临时分配）
        const bufKey = '_curveBuf';
        if (!cache[bufKey]) cache[bufKey] = new Uint8Array(256 * 4);
        const data = cache[bufKey];
        for (let i = 0; i < 256; i++) {
          const v = Math.max(0, Math.min(255, Math.round(arr[i])));
          data[i * 4] = v;
          data[i * 4 + 1] = v;
          data[i * 4 + 2] = v;
          data[i * 4 + 3] = 255;
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        cache[key + '_ref'] = arr;
      }
      return tex;
    };

    const tRGB = uploadCurve('curveRGB', curves.rgb);
    const tR = uploadCurve('curveR', curves.red);
    const tG = uploadCurve('curveG', curves.green);
    const tB = uploadCurve('curveB', curves.blue);

    // bind uniforms to texture units 1..4
    if (tRGB) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tRGB); gl.uniform1i(locs.u_curveRGB, 1); }
    if (tR)   { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tR);   gl.uniform1i(locs.u_curveR, 2); }
    if (tG)   { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tG);   gl.uniform1i(locs.u_curveG, 3); }
    if (tB)   { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, tB);   gl.uniform1i(locs.u_curveB, 4); }
    gl.uniform1f(locs.u_useCurves, 1.0);
  } else {
    gl.uniform1f(locs.u_useCurves, 0.0);
  }

  // Handle 3D LUT: expect params.lut3 = { size, data(Float32Array 0..1), intensity? }
  // 使用统一的 packLUT3DForWebGL 函数确保与 CPU 路径一致
  if (params.lut3 && params.lut3.size && params.lut3.data) {
    const size = params.lut3.size;
    const dataF = params.lut3.data;
    const intensity = params.lut3.intensity ?? 1.0;

    // P4: LUT 纹理脏标记缓存 —— 仅当 lut3 引用/size/intensity 变化时才重新打包+上传
    // （33³ LUT ≈ 143KB，旧实现每帧全量重传）
    const lutChanged = cache.lut3Ref !== dataF || cache.lut3Size !== size || cache.lut3Intensity !== intensity;

    if (lutChanged) {
      // 使用共享模块的打包函数
      const buf = packLUT3DForWebGL(dataF, size);
      const w = size;
      const h = size * size;

      // LUT 调试日志
      if (DEBUG_LUT) {
        console.log('[FilmLabWebGL] LUT Debug:');
        console.log('  - size:', size, 'texture:', w, 'x', h);
        console.log('  - intensity:', intensity);
        console.log('  - dataF length:', dataF.length, 'expected:', size*size*size*3);
        console.log('  - dataF[0..8]:', Array.from(dataF.slice(0, 9)).map(v => v.toFixed(3)));
        console.log('  - buf[0..15] (first pixel):', Array.from(buf.slice(0, 16)));
        // 验证几个关键位置
        const testIdx = size; // 第二行第一个像素
        console.log(`  - buf[${testIdx*4}..${testIdx*4+3}] (row 1, col 0):`, Array.from(buf.slice(testIdx*4, testIdx*4+4)));

        // 测试采样：用 CPU 方式验证几个关键颜色点
        // getLUT3DIndex(r, g, b, size) = r + g*size + b*size²
        const getLUT3DIndex = (r, g, b) => r + g * size + b * size * size;
        const testColors = [
          { r: 0, g: 0, b: 0, name: 'black' },
          { r: size-1, g: size-1, b: size-1, name: 'white' },
          { r: size-1, g: 0, b: 0, name: 'red' },
          { r: 0, g: size-1, b: 0, name: 'green' },
          { r: 0, g: 0, b: size-1, name: 'blue' },
          { r: Math.floor(size/2), g: Math.floor(size/2), b: Math.floor(size/2), name: 'mid-gray' }
        ];

        for (const tc of testColors) {
          const srcIdx = getLUT3DIndex(tc.r, tc.g, tc.b) * 3;
          const texRow = tc.g + tc.b * size;
          const texCol = tc.r;
          const bufIdx = (texRow * size + texCol) * 4;
          console.log(`  - ${tc.name} (r=${tc.r}, g=${tc.g}, b=${tc.b}):`,
            `srcIdx=${srcIdx}, dataF=[${dataF[srcIdx]?.toFixed(3)}, ${dataF[srcIdx+1]?.toFixed(3)}, ${dataF[srcIdx+2]?.toFixed(3)}]`,
            `bufIdx=${bufIdx}, buf=[${buf[bufIdx]}, ${buf[bufIdx+1]}, ${buf[bufIdx+2]}]`,
            `texUV=(${(texCol + 0.5) / size}, ${(texRow + 0.5) / (size * size)})`);
        }
      }

      if (!cache.lut3Tex) cache.lut3Tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, cache.lut3Tex);

      // 重要：LUT 纹理不能使用 FLIP_Y！
      // 因为采样公式 y = (g + b * size) / (size * size) 假设数据按原始顺序存储
      // 图像纹理用 FLIP_Y = true 是因为图像 Y 轴向下，但 LUT 不需要翻转
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // 使用 RGBA8 而不是 RGBA，避免 sRGB 自动转换（LUT数据应该是线性的）
      const internalFormat = gl.RGBA8 || gl.RGBA;
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);

      cache.lut3Ref = dataF;
      cache.lut3Size = size;
      cache.lut3Intensity = intensity;
    } else {
      // LUT 未变化：仅重新绑定已上传的纹理
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, cache.lut3Tex);
    }
    
    // 诊断：检查 uniform location 是否有效
    if (DEBUG_LUT) {
      console.log('  - locs.u_lut3d:', locs.u_lut3d, 'locs.u_useLut3d:', locs.u_useLut3d, 
                  'locs.u_lutSize:', locs.u_lutSize, 'locs.u_lutIntensity:', locs.u_lutIntensity);
      if (locs.u_lut3d === null) {
        console.error('[FilmLabWebGL] ERROR: u_lut3d uniform not found in shader!');
      }
    }
    
    gl.uniform1i(locs.u_lut3d, 5);
    gl.uniform1f(locs.u_useLut3d, 1.0);
    gl.uniform1f(locs.u_lutSize, size);
    gl.uniform1f(locs.u_lutIntensity, intensity);
    
    if (DEBUG_LUT) {
      console.log('  - u_useLut3d: 1, u_lutSize:', size, 'u_lutIntensity:', intensity);
    }
  } else {
    gl.uniform1f(locs.u_useLut3d, 0.0);
    gl.uniform1f(locs.u_lutIntensity, 0.0);
    if (DEBUG_LUT && params.lut3) {
      console.log('[FilmLabWebGL] LUT skipped - invalid data:', params.lut3);
    }
  }

  // HSL Adjustments
  const hslParams = params.hslParams;
  if (hslParams && !isDefaultHSLParams(hslParams)) {
    gl.uniform1f(locs.u_useHSL, 1.0);
    cache._scratch3.set([
      hslParams.red?.hue ?? 0,
      hslParams.red?.saturation ?? 0,
      hslParams.red?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslRed, cache._scratch3);
    cache._scratch3.set([
      hslParams.orange?.hue ?? 0,
      hslParams.orange?.saturation ?? 0,
      hslParams.orange?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslOrange, cache._scratch3);
    cache._scratch3.set([
      hslParams.yellow?.hue ?? 0,
      hslParams.yellow?.saturation ?? 0,
      hslParams.yellow?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslYellow, cache._scratch3);
    cache._scratch3.set([
      hslParams.green?.hue ?? 0,
      hslParams.green?.saturation ?? 0,
      hslParams.green?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslGreen, cache._scratch3);
    cache._scratch3.set([
      hslParams.cyan?.hue ?? 0,
      hslParams.cyan?.saturation ?? 0,
      hslParams.cyan?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslCyan, cache._scratch3);
    cache._scratch3.set([
      hslParams.blue?.hue ?? 0,
      hslParams.blue?.saturation ?? 0,
      hslParams.blue?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslBlue, cache._scratch3);
    cache._scratch3.set([
      hslParams.purple?.hue ?? 0,
      hslParams.purple?.saturation ?? 0,
      hslParams.purple?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslPurple, cache._scratch3);
    cache._scratch3.set([
      hslParams.magenta?.hue ?? 0,
      hslParams.magenta?.saturation ?? 0,
      hslParams.magenta?.luminance ?? 0
    ]);
    gl.uniform3fv(locs.u_hslMagenta, cache._scratch3);
  } else {
    gl.uniform1f(locs.u_useHSL, 0.0);
  }

  // Saturation (Luma-Preserving, Rec.709)
  const saturationVal = params.saturation ?? 0;
  if (saturationVal !== 0) {
    gl.uniform1f(locs.u_useSaturation, 1.0);
    gl.uniform1f(locs.u_saturation, saturationVal);
  } else {
    gl.uniform1f(locs.u_useSaturation, 0.0);
    gl.uniform1f(locs.u_saturation, 0.0);
  }

  // Split Toning
  const splitToning = params.splitToning;
  if (splitToning && !isDefaultSplitToneParams(splitToning)) {
    gl.uniform1f(locs.u_useSplitTone, 1.0);
    gl.uniform1f(locs.u_splitHighlightHue, (splitToning.highlights?.hue ?? 30) / 360.0);
    gl.uniform1f(locs.u_splitHighlightSat, (splitToning.highlights?.saturation ?? 0) / 100.0);
    gl.uniform1f(locs.u_splitMidtoneHue, (splitToning.midtones?.hue ?? 0) / 360.0);
    gl.uniform1f(locs.u_splitMidtoneSat, (splitToning.midtones?.saturation ?? 0) / 100.0);
    gl.uniform1f(locs.u_splitShadowHue, (splitToning.shadows?.hue ?? 220) / 360.0);
    gl.uniform1f(locs.u_splitShadowSat, (splitToning.shadows?.saturation ?? 0) / 100.0);
    gl.uniform1f(locs.u_splitBalance, (splitToning.balance ?? 0) / 100.0);
  } else {
    gl.uniform1f(locs.u_useSplitTone, 0.0);
  }

  // 重要：在绘制前确保所有纹理都绑定到正确的纹理单元
  // 这是必需的，因为之前的绑定操作可能改变了 WebGL 状态
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, cache.imageTex);
  if (cache.lut3Tex && params.lut3) {
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, cache.lut3Tex);
  }

  // Draw
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Debug: Sample multiple pixels to verify rendering output
  if (process.env.NODE_ENV !== 'production' && DEBUG_WEBGL) {
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    
    // Center pixel
    const centerPixels = new Uint8Array(4);
    gl.readPixels(centerX, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, centerPixels);
    
    // Top-left pixel (corner)
    const topLeftPixels = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, topLeftPixels);
    
    // Right-top corner (should show LUT debug color if enabled)
    const topRightPixels = new Uint8Array(4);
    gl.readPixels(canvas.width - 1, canvas.height - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, topRightPixels);
    
    console.log('[FilmLabWebGL] DEBUG: readPixels - Center:', Array.from(centerPixels), 
      'TopLeft:', Array.from(topLeftPixels), 
      'TopRight:', Array.from(topRightPixels));
    console.log('[FilmLabWebGL] DEBUG: Canvas size:', canvas.width, 'x', canvas.height);
    console.log('[FilmLabWebGL] DEBUG: If inverted, center should be [255,0,0,255] (red) but user sees cyan!');
  }

  // Cleanup (unbind)
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return canvas;
}

/**
 * 释放某 canvas 关联的所有 WebGL 资源（纹理/buffer/program）。
 * 在 FilmLab 组件卸载、canvas 移除或上下文丢失恢复时调用，避免 GL 内存累积。
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {boolean} 是否释放了资源
 */
export function disposeWebGL(canvas) {
  if (!canvas || !processImageWebGL._cache) return false;
  const cache = processImageWebGL._cache.get(canvas);
  if (!cache) return false;

  // 尝试获取上下文（可能已丢失，此时 delete* 是 no-op，但仍清理 JS 引用）
  let gl = null;
  try {
    gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  } catch (e) { /* context lost / unavailable */ }

  if (gl) {
    const delTex = (t) => { if (t) gl.deleteTexture(t); };
    delTex(cache.imageTex);
    delTex(cache.lut3Tex);
    // 曲线纹理以 cache.curveRGB/curveR/curveG/curveB 命名存储
    for (const k of ['curveRGB', 'curveR', 'curveG', 'curveB']) delTex(cache[k]);
    if (cache.buffer) gl.deleteBuffer(cache.buffer);
    if (cache.program) gl.deleteProgram(cache.program);
  }

  // 清空 JS 引用，允许 GC
  cache.imageTex = null;
  cache.lut3Tex = null;
  for (const k of ['curveRGB', 'curveR', 'curveG', 'curveB']) cache[k] = null;
  cache.buffer = null;
  cache.program = null;
  cache.locs = null;
  cache.lut3Ref = null;

  processImageWebGL._cache.delete(canvas);
  return true;
}

const FilmLabWebGL = {
  isWebGLAvailable,
  processImageWebGL,
  disposeWebGL,
};

export default FilmLabWebGL;
