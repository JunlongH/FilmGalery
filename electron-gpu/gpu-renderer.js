'use strict';
// NOTE: This file is the source for gpu-renderer.bundle.js (built by build.js).
// It runs in a SANDBOXED renderer (nodeIntegration:false, contextIsolation:true,
// sandbox:true) — Node APIs are NOT available. IPC goes through window.__gpu,
// which is exposed by gpu-preload.js via contextBridge. The 'electron' module
// and Node's Buffer are stubbed/externalized by esbuild at build time.
//
// When loaded directly (e.g. in tests), a shim may be required. In production,
// gpu.html loads gpu-renderer.bundle.js (which has shared modules baked in).

let gl, canvas, isWebGL2 = false;
let _hasFloatTexture = false;   // Phase 2.4: float texture support
let _hasFloatLinear  = false;   // Phase 2.4: float texture linear filtering

// ============================================================================
// White Balance: use shared Kelvin model (single source of truth)
// Replaces legacy linear model — now matches CPU/server rendering exactly
// ============================================================================
const { computeWBGains } = require('../packages/shared/filmLabWhiteBalance');
const { buildFragmentShader } = require('./glsl-shared');

// ============================================================================
// Shader Program Cache (Q19: avoid recompiling every frame)
// ============================================================================
let _cachedProgGL2 = null;
let _cachedProgGL1 = null;

/**
 * Return a cached compiled program, or compile & cache on first use.
 * Shader source is constant — no need to recompile per frame.
 */
function getOrCreateProgram(gl, isGL2) {
  if (isGL2) {
    if (!_cachedProgGL2) _cachedProgGL2 = createProgram(gl, VS_GL2, FS_GL2);
    return _cachedProgGL2;
  } else {
    if (!_cachedProgGL1) _cachedProgGL1 = createProgram(gl, VS_GL1, FS_GL1);
    return _cachedProgGL1;
  }
}

function invalidateProgramCache() {
  if (_cachedProgGL2 && gl) { try { gl.deleteProgram(_cachedProgGL2); } catch(_){} }
  if (_cachedProgGL1 && gl) { try { gl.deleteProgram(_cachedProgGL1); } catch(_){} }
  _cachedProgGL2 = null;
  _cachedProgGL1 = null;
}

function initGL() {
  canvas = document.getElementById('glc');
  const attribs = { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, antialias: false };
  gl = canvas.getContext('webgl2', attribs);
  isWebGL2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', attribs);
  if (!gl) {
    console.error('WebGL not available');
    return false;
  }

  // Phase 2.4: Enable float texture extensions
  if (isWebGL2) {
    // WebGL2 natively supports RGBA32F textures;
    // need EXT_color_buffer_float for render-to-float, but for sampling only it's built-in.
    _hasFloatTexture = true;
    _hasFloatLinear  = true; // GL2 guarantees float linear filtering for R32F/RGBA32F
  } else {
    // WebGL1: request OES_texture_float + OES_texture_float_linear
    const extF  = gl.getExtension('OES_texture_float');
    const extFL = gl.getExtension('OES_texture_float_linear');
    _hasFloatTexture = !!extF;
    _hasFloatLinear  = !!extFL;
  }

  return true;
}

function createShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile failed: ' + log);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  // Shaders are no longer needed after linking
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('Program link failed: ' + log);
  }
  return prog;
}

const VS_GL2 = `#version 300 es
  in vec2 a_pos;
  in vec2 a_uv;
  out vec2 v_uv;
  void main(){
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// ============================================================================
// Fragment Shaders — composed from shared GLSL modules (Q15)
// ============================================================================
const FS_GL2 = buildFragmentShader(true);

const VS_GL1 = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main(){
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FS_GL1 = buildFragmentShader(false);

function runJob(job) {
  if (!gl) throw new Error('WebGL not initialized');
  const { jobId, params, image } = job;
  if (!image || !image.bytes) throw new Error('No image bytes');

  // Helper to run the GL pipeline once we have a source (bmp or raw pixels)
  const runPipeline = (source, width, height, isRaw = false) => {
    try {
      // Calculate Geometry (Crop & Rotation)
      // We implement a general rotation/crop logic that works for any angle (0, 90, 180, 270 or arbitrary)
      // This fixes the "undefined" error when rotation is not exactly a multiple of 90, and handles aspect ratio correctly.
      
      const crop = params && params.cropRect ? params.cropRect : { x: 0, y: 0, w: 1, h: 1 };
      const rotation = ((params && params.rotation) || 0) + ((params && params.orientation) || 0);
      const rad = (rotation * Math.PI) / 180;
      
      // Precompute trig for backward rotation (Screen -> Source)
      const cos = Math.cos(-rad);
      const sin = Math.sin(-rad);

      // Dimensions of the rotated image (bounding box of rotated source)
      const absCos = Math.abs(Math.cos(rad));
      const absSin = Math.abs(Math.sin(rad));
      const rotW = width * absCos + height * absSin;
      const rotH = width * absSin + height * absCos;

      // Output canvas dimensions (Crop is relative to the Rotated Image)
      canvas.width = Math.max(1, Math.round(rotW * crop.w));
      canvas.height = Math.max(1, Math.round(rotH * crop.h));

      // Setup GL state — use cached shader program (Q19: avoid recompile per frame)
      const prog = getOrCreateProgram(gl, isWebGL2);
      gl.useProgram(prog);

      // Helper to map UV from Rotated Space (0..1) to Source Space (0..1)
      const mapUV = (u_rot, v_rot) => {
        // 1. Convert to pixels in Rotated Space
        const x_rot = u_rot * rotW;
        const y_rot = v_rot * rotH;
        
        // 2. Shift to center
        const dx_rot = x_rot - rotW / 2;
        const dy_rot = y_rot - rotH / 2;
        
        // 3. Rotate backwards (-rad) to align with Source Space
        const dx_src = dx_rot * cos - dy_rot * sin;
        const dy_src = dx_rot * sin + dy_rot * cos;
        
        // 4. Shift back from center of Source
        const x_src = dx_src + width / 2;
        const y_src = dy_src + height / 2;
        
        // 5. Normalize to Source UV
        return [x_src / width, y_src / height];
      };

      // Calculate UVs for the 4 corners of the Crop Rectangle
      // Crop Rect in Rotated Space:
      // TL: (crop.x, crop.y)
      // TR: (crop.x + crop.w, crop.y)
      // BL: (crop.x, crop.y + crop.h)
      // BR: (crop.x + crop.w, crop.y + crop.h)
      
      const uvTL = mapUV(crop.x, crop.y);
      const uvTR = mapUV(crop.x + crop.w, crop.y);
      const uvBL = mapUV(crop.x, crop.y + crop.h);
      const uvBR = mapUV(crop.x + crop.w, crop.y + crop.h);

      const quad = new Float32Array([
        //  pos      uv
        -1, -1,   uvBL[0], uvBL[1], // BL
         1, -1,   uvBR[0], uvBR[1], // BR
        -1,  1,   uvTL[0], uvTL[1], // TL
         1,  1,   uvTR[0], uvTR[1], // TR
      ]);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

      const a_pos = gl.getAttribLocation(prog, 'a_pos');
      const a_uv  = gl.getAttribLocation(prog, 'a_uv');
      gl.enableVertexAttribArray(a_pos);
      gl.enableVertexAttribArray(a_uv);
      gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 16, 0);
      gl.vertexAttribPointer(a_uv,  2, gl.FLOAT, false, 16, 8);

      // Texture
      gl.activeTexture(gl.TEXTURE0); // Ensure we are modifying unit 0
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Flip Y so exported GPU image matches normal top-left origin (preview uses flip=true)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      
      if (isRaw) {
        // source is Uint8Array of RGBA pixels
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } else {
        // source is ImageBitmap
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }

      // Tone Curve Texture (1D LUT) — Phase 2.4: prefer Float32 1024×1 RGBA
      const toneCurveTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, toneCurveTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      // Choose float or 8-bit path based on data + GPU capability
      const hasFloatLut = params && params.toneCurveLutFloat && params.toneCurveLutFloat.length > 0;
      const useFloat = hasFloatLut && _hasFloatTexture;

      if (useFloat) {
        // Phase 2.4: Float32 RGBA texture (1024×1)
        const floatArr = new Float32Array(params.toneCurveLutFloat);
        const resolution = floatArr.length / 4;

        // Filtering: prefer LINEAR if extension available, fallback to NEAREST
        const filterMode = _hasFloatLinear ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMode);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMode);

        if (isWebGL2) {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, resolution, 1, 0, gl.RGBA, gl.FLOAT, floatArr);
        } else {
          // WebGL1 + OES_texture_float
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resolution, 1, 0, gl.RGBA, gl.FLOAT, floatArr);
        }
      } else {
        // Legacy 8-bit path (RGBA UNSIGNED_BYTE 256×1)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        let toneCurveData;
        if (params && params.toneCurveLut && params.toneCurveLut.length === 256 * 4) {
          toneCurveData = new Uint8Array(params.toneCurveLut);
        } else {
          // Default identity LUT
          toneCurveData = new Uint8Array(256 * 4);
          for(let i=0; i<256; i++) {
            toneCurveData[i*4+0] = i;
            toneCurveData[i*4+1] = i;
            toneCurveData[i*4+2] = i;
            toneCurveData[i*4+3] = 255;
          }
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, toneCurveData);
      }

      // 3D LUT Texture
      let hasLut3d = false;
      let lut3dSize = 0;
      let lut3dTex = null;
      if (isWebGL2 && params && params.lut3d && params.lut3d.data && params.lut3d.size) {
        lut3dTex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_3D, lut3dTex);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        
        const size = params.lut3d.size;
        const data = new Float32Array(params.lut3d.data);
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB, size, size, size, 0, gl.RGB, gl.FLOAT, data);
        hasLut3d = true;
        lut3dSize = size;
      }

      // Uniforms
      gl.useProgram(prog); // Ensure program is active
      const u_image = gl.getUniformLocation(prog, 'u_image');
      gl.uniform1i(u_image, 0); // Texture unit 0
      
      const u_toneCurveTex = gl.getUniformLocation(prog, 'u_toneCurveTex');
      gl.uniform1i(u_toneCurveTex, 1); // Texture unit 1

      const u_lut3dTex = gl.getUniformLocation(prog, 'u_lut3dTex');
      gl.uniform1i(u_lut3dTex, 2); // Texture unit 2

      const u_hasLut3d = gl.getUniformLocation(prog, 'u_hasLut3d');
      gl.uniform1f(u_hasLut3d, hasLut3d ? 1.0 : 0.0);

      const u_lut3dSize = gl.getUniformLocation(prog, 'u_lut3dSize');
      gl.uniform1f(u_lut3dSize, lut3dSize);

      const inverted = params && params.inverted ? 1.0 : 0.0;
      const u_inverted = gl.getUniformLocation(prog, 'u_inverted');
      gl.uniform1f(u_inverted, inverted);
      const u_inversionMode = gl.getUniformLocation(prog, 'u_inversionMode');
      gl.uniform1f(u_inversionMode, (params && params.inversionMode === 'log') ? 1.0 : 0.0);
      
      // Compute WB gains using the correct formula (matches server/client)
      const [rBal, gBal, bBal] = computeWBGains({
        red: params?.red ?? 1.0,
        green: params?.green ?? 1.0,
        blue: params?.blue ?? 1.0,
        temp: params?.temp ?? 0,
        tint: params?.tint ?? 0
      });
      const u_gains = gl.getUniformLocation(prog, 'u_gains');
      gl.uniform3f(u_gains, rBal, gBal, bBal);
      const u_exposure = gl.getUniformLocation(prog, 'u_exposure');
      gl.uniform1f(u_exposure, (params?.exposure ?? 0));
      const u_contrast = gl.getUniformLocation(prog, 'u_contrast');
      gl.uniform1f(u_contrast, (params?.contrast ?? 0));
      const u_highlights = gl.getUniformLocation(prog, 'u_highlights');
      gl.uniform1f(u_highlights, (params?.highlights ?? 0));
      const u_shadows = gl.getUniformLocation(prog, 'u_shadows');
      gl.uniform1f(u_shadows, (params?.shadows ?? 0));
      const u_whites = gl.getUniformLocation(prog, 'u_whites');
      gl.uniform1f(u_whites, (params?.whites ?? 0));
      const u_blacks = gl.getUniformLocation(prog, 'u_blacks');
      gl.uniform1f(u_blacks, (params?.blacks ?? 0));

      // Film Curve uniforms (Q13: per-channel gamma + toe/shoulder)
      const u_filmCurveEnabled = gl.getUniformLocation(prog, 'u_filmCurveEnabled');
      gl.uniform1f(u_filmCurveEnabled, (params?.filmCurveEnabled) ? 1.0 : 0.0);
      const u_filmCurveGamma = gl.getUniformLocation(prog, 'u_filmCurveGamma');
      gl.uniform1f(u_filmCurveGamma, (params?.filmCurveGamma ?? 0.6));
      const u_filmCurveGammaR = gl.getUniformLocation(prog, 'u_filmCurveGammaR');
      gl.uniform1f(u_filmCurveGammaR, (params?.filmCurveGammaR ?? params?.filmCurveGamma ?? 0.6));
      const u_filmCurveGammaG = gl.getUniformLocation(prog, 'u_filmCurveGammaG');
      gl.uniform1f(u_filmCurveGammaG, (params?.filmCurveGammaG ?? params?.filmCurveGamma ?? 0.6));
      const u_filmCurveGammaB = gl.getUniformLocation(prog, 'u_filmCurveGammaB');
      gl.uniform1f(u_filmCurveGammaB, (params?.filmCurveGammaB ?? params?.filmCurveGamma ?? 0.6));
      const u_filmCurveDMin = gl.getUniformLocation(prog, 'u_filmCurveDMin');
      gl.uniform1f(u_filmCurveDMin, (params?.filmCurveDMin ?? 0.1));
      const u_filmCurveDMax = gl.getUniformLocation(prog, 'u_filmCurveDMax');
      gl.uniform1f(u_filmCurveDMax, (params?.filmCurveDMax ?? 3.0));
      const u_filmCurveToe = gl.getUniformLocation(prog, 'u_filmCurveToe');
      gl.uniform1f(u_filmCurveToe, (params?.filmCurveToe ?? 0));
      const u_filmCurveShoulder = gl.getUniformLocation(prog, 'u_filmCurveShoulder');
      gl.uniform1f(u_filmCurveShoulder, (params?.filmCurveShoulder ?? 0));

      // Base Correction (Pre-Inversion)
      // Support both linear (gains) and log (density) modes
      const baseMode = params?.baseMode === 'log' ? 1.0 : 0.0;
      const baseGains = [params?.baseRed ?? 1.0, params?.baseGreen ?? 1.0, params?.baseBlue ?? 1.0];
      const baseDensity = [params?.baseDensityR ?? 0.0, params?.baseDensityG ?? 0.0, params?.baseDensityB ?? 0.0];
      
      const u_baseMode = gl.getUniformLocation(prog, 'u_baseMode');
      gl.uniform1f(u_baseMode, baseMode);
      const u_baseGains = gl.getUniformLocation(prog, 'u_baseGains');
      gl.uniform3fv(u_baseGains, new Float32Array(baseGains));
      const u_baseDensity = gl.getUniformLocation(prog, 'u_baseDensity');
      gl.uniform3fv(u_baseDensity, new Float32Array(baseDensity));

      // Density Levels (Log domain auto-levels)
      const densityLevelsEnabled = (params?.densityLevelsEnabled && baseMode > 0.5) ? 1.0 : 0.0;
      const densityLevels = params?.densityLevels || { red: { min: 0, max: 3 }, green: { min: 0, max: 3 }, blue: { min: 0, max: 3 } };
      const u_densityLevelsEnabled = gl.getUniformLocation(prog, 'u_densityLevelsEnabled');
      gl.uniform1f(u_densityLevelsEnabled, densityLevelsEnabled);
      const u_densityLevelsMin = gl.getUniformLocation(prog, 'u_densityLevelsMin');
      gl.uniform3fv(u_densityLevelsMin, new Float32Array([
        densityLevels.red?.min ?? 0,
        densityLevels.green?.min ?? 0,
        densityLevels.blue?.min ?? 0
      ]));
      const u_densityLevelsMax = gl.getUniformLocation(prog, 'u_densityLevelsMax');
      gl.uniform3fv(u_densityLevelsMax, new Float32Array([
        densityLevels.red?.max ?? 3,
        densityLevels.green?.max ?? 3,
        densityLevels.blue?.max ?? 3
      ]));

      // HSL Uniforms
      const hslParams = params?.hslParams || {};
      const getHSL = (ch) => {
        const data = hslParams[ch] || {};
        return [data.hue ?? 0, data.saturation ?? 0, data.luminance ?? 0];
      };
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslRed'), new Float32Array(getHSL('red')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslOrange'), new Float32Array(getHSL('orange')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslYellow'), new Float32Array(getHSL('yellow')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslGreen'), new Float32Array(getHSL('green')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslCyan'), new Float32Array(getHSL('cyan')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslBlue'), new Float32Array(getHSL('blue')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslPurple'), new Float32Array(getHSL('purple')));
      gl.uniform3fv(gl.getUniformLocation(prog, 'u_hslMagenta'), new Float32Array(getHSL('magenta')));

      // Curves, HSL, SplitTone enable flags (shared shader requires these)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_useCurves'), 1.0); // Always pass curves (identity if none)
      gl.uniform1f(gl.getUniformLocation(prog, 'u_useHSL'), 1.0); // Always enabled, no-op if params are 0
      gl.uniform1f(gl.getUniformLocation(prog, 'u_useSplitTone'), 1.0); // Always enabled, no-op if sat=0
      gl.uniform1f(gl.getUniformLocation(prog, 'u_lutIntensity'), params?.lut3dIntensity ?? 1.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_lutSize'), lut3dSize);

      // Split Toning Uniforms
      const splitToning = params?.splitToning || {};
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitHighlightHue'), (splitToning.highlights?.hue ?? 0) / 360.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitHighlightSat'), (splitToning.highlights?.saturation ?? 0) / 100.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitMidtoneHue'), (splitToning.midtones?.hue ?? 0) / 360.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitMidtoneSat'), (splitToning.midtones?.saturation ?? 0) / 100.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitShadowHue'), (splitToning.shadows?.hue ?? 0) / 360.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitShadowSat'), (splitToning.shadows?.saturation ?? 0) / 100.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_splitBalance'), (splitToning.balance ?? 0) / 100.0);

      // Draw
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0,0,0,1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Wait for GPU to finish before reading pixels
      gl.finish();

      // Cleanup GL resources to prevent leaks
      gl.deleteTexture(tex);
      gl.deleteTexture(toneCurveTex);
      if (lut3dTex) gl.deleteTexture(lut3dTex);
      gl.deleteBuffer(vbo);
      // Note: shader program is cached (Q19) — do NOT delete it here

      // Encode canvas to JPEG and return
      canvas.toBlob((blobOut) => {
        if (!blobOut) {
          window.__gpu.sendResult({ jobId, ok:false, error:'toBlob_failed' });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const arrBuf = reader.result; // ArrayBuffer
          // Uint8Array is structured-clone-safe across contextBridge (zero-copy),
          // unlike Node's Buffer subclass.
          const bytes = new Uint8Array(arrBuf);
          window.__gpu.sendResult({ jobId, ok:true, width: canvas.width, height: canvas.height, jpegBytes: bytes });
        };
        reader.onerror = () => {
          window.__gpu.sendResult({ jobId, ok:false, error:'blob_read_failed' });
        };
        reader.readAsArrayBuffer(blobOut);
      }, 'image/jpeg', params?.jpegQuality ?? 0.95);
    } catch (err) {
      window.__gpu.sendResult({ jobId, ok:false, error: (err && err.message) || String(err) });
    } finally {
      if (!isRaw && source && source.close) source.close();
    }
  };

  // Check if raw pixels
  if (image.format === 'rgba' && image.width && image.height) {
    // Direct raw pixel path
    const pixels = new Uint8Array(image.bytes);
    runPipeline(pixels, image.width, image.height, true);
  } else {
    // Standard blob path
    const blob = new Blob([image.bytes], { type: image.mime || 'image/jpeg' });
    createImageBitmap(blob).then((bmp) => {
      runPipeline(bmp, bmp.width, bmp.height, false);
    }).catch((e) => {
      window.__gpu.sendResult({ jobId, ok:false, error:'decode_failed: ' + (e && e.message) });
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initGL();
  window.__gpu.onRun((job) => {
    try { runJob(job); } catch (err) {
      window.__gpu.sendResult({ jobId: job && job.jobId, ok: false, error: (err && err.message) || String(err) });
    }
  });
});
