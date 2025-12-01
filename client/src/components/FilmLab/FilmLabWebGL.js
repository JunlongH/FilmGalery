// Minimal WebGL helper for FilmLab
// Provides a basic shader pipeline for inversion (linear/log), white balance (r/g/b gains), exposure and contrast.
// This is intentionally small and dependency-free. We'll extend it later for curves and 3D LUTs.

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
  return prog;
}

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (e) {
    return false;
  }
}

// Process an image on the given canvas using WebGL. The canvas will be sized to image dimensions.
export function processImageWebGL(canvas, image, params = {}) {
  if (!canvas) return;
  const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL not available');

  // Simple cache per-canvas to reuse programs and textures
  if (!processImageWebGL._cache) processImageWebGL._cache = new WeakMap();
  let cache = processImageWebGL._cache.get(canvas);
  if (!cache) {
    cache = {};
    processImageWebGL._cache.set(canvas, cache);
  }

  // Rotate-then-crop pre-processing via 2D canvas for geometry parity with CPU/export
  let srcImage = image;
  const rotateDeg = typeof params.rotate === 'number' ? params.rotate : 0;
  const rad = rotateDeg * Math.PI / 180;
  const s = Math.abs(Math.sin(rad));
  const c = Math.abs(Math.cos(rad));
  const rotW = Math.round(image.width * c + image.height * s);
  const rotH = Math.round(image.width * s + image.height * c);
  const r2d = document.createElement('canvas');
  r2d.width = rotW;
  r2d.height = rotH;
  const rg = r2d.getContext('2d');
  rg.translate(rotW / 2, rotH / 2);
  rg.rotate(rad);
  rg.drawImage(srcImage, -image.width / 2, -image.height / 2);
  srcImage = r2d;

  // Clamp cropRect and crop in rotated space
  let outW = rotW;
  let outH = rotH;
  const crop = params.cropRect;
  if (crop && typeof crop.x === 'number') {
    let crx = Math.max(0, Math.min(1, crop.x));
    let cry = Math.max(0, Math.min(1, crop.y));
    let crw = Math.max(0, Math.min(1 - crx, crop.w || crop.width / outW));
    let crh = Math.max(0, Math.min(1 - cry, crop.h || crop.height / outH));
    const cx = Math.round(crx * outW);
    const cy = Math.round(cry * outH);
    const cw = Math.max(1, Math.round(crw * outW));
    const ch = Math.max(1, Math.round(crh * outH));
    const c2d = document.createElement('canvas');
    c2d.width = cw;
    c2d.height = ch;
    const g2 = c2d.getContext('2d');
    g2.drawImage(srcImage, cx, cy, cw, ch, 0, 0, cw, ch);
    srcImage = c2d;
    outW = cw;
    outH = ch;
  }

  // Set canvas size to processed image size (rotated-then-cropped)
  canvas.width = outW;
  canvas.height = outH;
  gl.viewport(0, 0, canvas.width, canvas.height);

  // Vertex shader (shared)
  const vsSource = `
    attribute vec2 a_pos;
    attribute vec2 a_uv;
    varying vec2 v_uv;
    void main() {
      v_uv = a_uv;
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  // Fragment shader with optional curve and 3D LUT support
  const fsSource = `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform int u_inverted; // 0 = no inversion, 1 = invert
    uniform int u_inversionMode; // 0 linear, 1 log
    uniform vec3 u_gains; // r,g,b gains
    uniform float u_exposure;
    uniform float u_contrast; // -1..1
    uniform float u_highlights; // -100..100
    uniform float u_shadows; // -100..100
    uniform float u_whites; // -100..100
    uniform float u_blacks; // -100..100

    // Curve LUTs (1D textures height=1)
    uniform sampler2D u_curveRGB;
    uniform sampler2D u_curveR;
    uniform sampler2D u_curveG;
    uniform sampler2D u_curveB;
    uniform int u_useCurves; // 0/1

    // 3D LUT packed into 2D: width = size, height = size*size
    uniform sampler2D u_lut3d;
    uniform int u_useLut3d;
    uniform int u_lutSize;

    float sampleCurve(sampler2D t, float v) {
      return texture2D(t, vec2(v, 0.5)).r;
    }

    vec3 sampleLUT3D(vec3 c) {
      int size = u_lutSize;
      float sz = float(size);
      // Map to [0..size-1]
      float rf = c.r * (sz - 1.0);
      float gf = c.g * (sz - 1.0);
      float bf = c.b * (sz - 1.0);

      float r0 = floor(rf);
      float g0 = floor(gf);
      float b0 = floor(bf);
      float r1 = min(sz - 1.0, r0 + 1.0);
      float g1 = min(sz - 1.0, g0 + 1.0);
      float b1 = min(sz - 1.0, b0 + 1.0);

      vec3 c000;
      vec3 c100;
      vec3 c010;
      vec3 c110;
      vec3 c001;
      vec3 c101;
      vec3 c011;
      vec3 c111;

      // helper to sample packed LUT: x = r / size, y = (g + b*size) / (size*size)
      vec2 uv;
      uv.x = (r0 + 0.5) / sz;
      uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
      c000 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r1 + 0.5) / sz;
      uv.y = (g0 + b0 * sz + 0.5) / (sz * sz);
      c100 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r0 + 0.5) / sz;
      uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
      c010 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r1 + 0.5) / sz;
      uv.y = (g1 + b0 * sz + 0.5) / (sz * sz);
      c110 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r0 + 0.5) / sz;
      uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
      c001 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r1 + 0.5) / sz;
      uv.y = (g0 + b1 * sz + 0.5) / (sz * sz);
      c101 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r0 + 0.5) / sz;
      uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
      c011 = texture2D(u_lut3d, uv).rgb;

      uv.x = (r1 + 0.5) / sz;
      uv.y = (g1 + b1 * sz + 0.5) / (sz * sz);
      c111 = texture2D(u_lut3d, uv).rgb;

      float fr = rf - r0;
      float fg = gf - g0;
      float fb = bf - b0;

      vec3 c00 = mix(c000, c100, fr);
      vec3 c10 = mix(c010, c110, fr);
      vec3 c01 = mix(c001, c101, fr);
      vec3 c11 = mix(c011, c111, fr);

      vec3 c0 = mix(c00, c10, fg);
      vec3 c1 = mix(c01, c11, fg);

      return mix(c0, c1, fb);
    }

    // Helper: apply contrast (-1..1)
    float applyContrast(float v, float c) {
      float f = (259.0 * (c * 255.0 + 255.0)) / (255.0 * (259.0 - c * 255.0));
      return clamp(f * (v - 0.5) + 0.5, 0.0, 1.0);
    }

    float applyTone(float val, float h, float s, float w, float b) {
      // Blacks & Whites
      float blackPoint = -b * 0.002;
      float whitePoint = 1.0 - w * 0.002;
      if (whitePoint != blackPoint) {
        val = (val - blackPoint) / (whitePoint - blackPoint);
      }

      // Shadows
      if (s != 0.0) {
        float sFactor = s * 0.005;
        val += sFactor * pow(1.0 - val, 2.0) * val * 4.0;
      }

      // Highlights
      if (h != 0.0) {
        float hFactor = h * 0.005;
        val += hFactor * pow(val, 2.0) * (1.0 - val) * 4.0;
      }
      return val;
    }

    void main() {
      vec4 tex = texture2D(u_image, v_uv);
      vec3 col = tex.rgb;

      // Invert if enabled
      if (u_inverted == 1) {
        vec3 c255 = col * 255.0;
        if (u_inversionMode == 1) {
          c255.r = 255.0 * (1.0 - log(c255.r + 1.0) / log(256.0));
          c255.g = 255.0 * (1.0 - log(c255.g + 1.0) / log(256.0));
          c255.b = 255.0 * (1.0 - log(c255.b + 1.0) / log(256.0));
        } else {
          c255 = 255.0 - c255;
        }
        col = c255 / 255.0;
      }
      
      vec3 c = col;

      // Apply gains (White Balance)
      c = c * u_gains;

      // Tone Mapping: Exposure
      c = c * pow(2.0, u_exposure);

      // Tone Mapping: Contrast
      c.r = applyContrast(c.r, u_contrast);
      c.g = applyContrast(c.g, u_contrast);
      c.b = applyContrast(c.b, u_contrast);

      // Tone Mapping: H/S/B/W
      c.r = applyTone(c.r, u_highlights, u_shadows, u_whites, u_blacks);
      c.g = applyTone(c.g, u_highlights, u_shadows, u_whites, u_blacks);
      c.b = applyTone(c.b, u_highlights, u_shadows, u_whites, u_blacks);

      // Apply curves if enabled (match CPU order: RGB curve first, then channel curves)
      if (u_useCurves == 1) {
        // First apply RGB combined curve
        c.r = sampleCurve(u_curveRGB, c.r);
        c.g = sampleCurve(u_curveRGB, c.g);
        c.b = sampleCurve(u_curveRGB, c.b);
        // Then apply individual channel curves
        c.r = sampleCurve(u_curveR, c.r);
        c.g = sampleCurve(u_curveG, c.g);
        c.b = sampleCurve(u_curveB, c.b);
      }

      // Apply 3D LUT if enabled
      if (u_useLut3d == 1) {
        c = sampleLUT3D(c);
      }

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `;

  // Build or reuse program
  if (!cache.program) {
    cache.program = createProgram(gl, vsSource, fsSource);
  }
  const program = cache.program;
  gl.useProgram(program);

  // Set up a full-screen quad (cache buffer)
  if (!cache.buffer) {
    const verts = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1
    ]);
    cache.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  } else {
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.buffer);
  }

  const posLoc = gl.getAttribLocation(program, 'a_pos');
  const uvLoc = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uvLoc);
  gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

  // Create or reuse texture from image
  if (!cache.imageTex) cache.imageTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, cache.imageTex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcImage);

  // Uniform locations
  const locs = cache.locs || {};
  if (!cache.locs) {
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
    locs.u_curveRGB = gl.getUniformLocation(program, 'u_curveRGB');
    locs.u_curveR = gl.getUniformLocation(program, 'u_curveR');
    locs.u_curveG = gl.getUniformLocation(program, 'u_curveG');
    locs.u_curveB = gl.getUniformLocation(program, 'u_curveB');
    locs.u_useCurves = gl.getUniformLocation(program, 'u_useCurves');
    locs.u_lut3d = gl.getUniformLocation(program, 'u_lut3d');
    locs.u_useLut3d = gl.getUniformLocation(program, 'u_useLut3d');
    locs.u_lutSize = gl.getUniformLocation(program, 'u_lutSize');
  }

  // Bind image texture to unit 0
  gl.uniform1i(locs.u_image, 0);

  const inverted = params.inverted ? 1 : 0;
  gl.uniform1i(locs.u_inverted, inverted);
  
  const mode = params.inversionMode === 'log' ? 1 : 0;
  gl.uniform1i(locs.u_inversionMode, mode);

  const gains = params.gains || [1.0, 1.0, 1.0];
  gl.uniform3fv(locs.u_gains, new Float32Array(gains));

  const exposure = typeof params.exposure === 'number' ? params.exposure / 50.0 : 0.0;
  gl.uniform1f(locs.u_exposure, exposure);

  const contrast = typeof params.contrast === 'number' ? params.contrast / 100.0 : 0.0;
  gl.uniform1f(locs.u_contrast, contrast);

  gl.uniform1f(locs.u_highlights, params.highlights || 0.0);
  gl.uniform1f(locs.u_shadows, params.shadows || 0.0);
  gl.uniform1f(locs.u_whites, params.whites || 0.0);
  gl.uniform1f(locs.u_blacks, params.blacks || 0.0);

  // Curves
  const curves = params.curves;
  if (curves) {
    // helper to upload 1D curve as 256x1 RGBA texture
    const uploadCurve = (key, arr) => {
      if (!arr) return null;
      if (!cache[key]) cache[key] = gl.createTexture();
      const tex = cache[key];
      gl.activeTexture(gl.TEXTURE1 + (key === 'curveRGB' ? 0 : key === 'curveR' ? 1 : key === 'curveG' ? 2 : 3));
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // build RGBA buffer
      const data = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) {
        const v = Math.max(0, Math.min(255, Math.round(arr[i])));
        data[i*4] = v;
        data[i*4+1] = v;
        data[i*4+2] = v;
        data[i*4+3] = 255;
      }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return tex;
    };

    const tRGB = uploadCurve('curveRGB', curves.rgb);
    const tR = uploadCurve('curveR', curves.red);
    const tG = uploadCurve('curveG', curves.green);
    const tB = uploadCurve('curveGB', curves.blue) || uploadCurve('curveB', curves.blue);

    // bind uniforms to texture units 1..4
    if (tRGB) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tRGB); gl.uniform1i(locs.u_curveRGB, 1); }
    if (tR)   { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, tR);   gl.uniform1i(locs.u_curveR, 2); }
    if (tG)   { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, tG);   gl.uniform1i(locs.u_curveG, 3); }
    if (tB)   { gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, tB);   gl.uniform1i(locs.u_curveB, 4); }
    gl.uniform1i(locs.u_useCurves, 1);
  } else {
    gl.uniform1i(locs.u_useCurves, 0);
  }

  // Handle 3D LUT: expect params.lut3 = { size, data(Float32Array 0..1) }
  if (params.lut3 && params.lut3.size && params.lut3.data) {
    const size = params.lut3.size;
    const dataF = params.lut3.data;
    // pack into width=size, height=size*size RGBA unsigned bytes
    const w = size;
    const h = size * size;
    const buf = new Uint8Array(w * h * 4);
    // iterate b (slice), g, r
    let ptr = 0;
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const idx = (r + g*size + b*size*size) * 3; // input is RGB floats
          const vr = Math.max(0, Math.min(1, dataF[idx]));
          const vg = Math.max(0, Math.min(1, dataF[idx+1]));
          const vb = Math.max(0, Math.min(1, dataF[idx+2]));
          buf[ptr++] = Math.round(vr * 255);
          buf[ptr++] = Math.round(vg * 255);
          buf[ptr++] = Math.round(vb * 255);
          buf[ptr++] = 255;
        }
      }
    }

    if (!cache.lut3Tex) cache.lut3Tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, cache.lut3Tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.uniform1i(locs.u_lut3d, 5);
    gl.uniform1i(locs.u_useLut3d, 1);
    gl.uniform1i(locs.u_lutSize, size);
  } else {
    gl.uniform1i(locs.u_useLut3d, 0);
  }

  // Draw
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Cleanup (unbind)
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);

  return canvas;
}

export default {
  isWebGLAvailable,
  processImageWebGL
};
