'use strict';
const { ipcRenderer } = require('electron');

let gl, canvas, isWebGL2 = false;

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

const FS_GL2 = `#version 300 es
  precision highp float;
  precision highp sampler3D;
  
  in vec2 v_uv;
  out vec4 fragColor;
  
  uniform sampler2D u_tex;
  uniform sampler2D u_toneCurveTex;
  uniform sampler3D u_lut3d;
  uniform float u_hasLut3d;
  uniform float u_lut3dSize;

  uniform float u_inverted;
  uniform float u_logMode;
  uniform vec3 u_gains;
  uniform float u_exposure;
  uniform float u_contrast;

  void main(){
    vec3 c = texture(u_tex, v_uv).rgb;
    
    // Inversion
    if (u_inverted > 0.5) {
      if (u_logMode > 0.5) {
        c = vec3(1.0) - log(c * 255.0 + vec3(1.0)) / log(256.0);
      } else {
        c = vec3(1.0) - c;
      }
    }

    // WB gains
    c *= u_gains;

    // Exposure
    float expFactor = pow(2.0, u_exposure / 50.0);
    c *= expFactor;

    // Contrast
    float ctr = u_contrast;
    float factor = (259.0 * (ctr + 255.0)) / (255.0 * (259.0 - ctr));
    c = (c - 0.5) * factor + 0.5;

    c = clamp(c, 0.0, 1.0);

    // Tone Curve
    float r = texture(u_toneCurveTex, vec2(c.r, 0.5)).r;
    float g = texture(u_toneCurveTex, vec2(c.g, 0.5)).g;
    float b = texture(u_toneCurveTex, vec2(c.b, 0.5)).b;
    c = vec3(r, g, b);

    // 3D LUT
    if (u_hasLut3d > 0.5) {
       float size = u_lut3dSize;
       vec3 uvw = c * (size - 1.0) / size + 0.5 / size;
       c = texture(u_lut3d, uvw).rgb;
    }

    fragColor = vec4(c, 1.0);
  }
`;

const VS_GL1 = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main(){
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FS_GL1 = `
  precision highp float;
  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform sampler2D u_toneCurveTex;
  
  // No 3D LUT support in fallback
  uniform float u_inverted;
  uniform float u_logMode;
  uniform vec3 u_gains;
  uniform float u_exposure;
  uniform float u_contrast;

  void main(){
    vec3 c = texture2D(u_tex, v_uv).rgb;
    
    if (u_inverted > 0.5) {
      if (u_logMode > 0.5) {
        c = vec3(1.0) - log(c * 255.0 + vec3(1.0)) / log(256.0);
      } else {
        c = vec3(1.0) - c;
      }
    }

    c *= u_gains;

    float expFactor = pow(2.0, u_exposure / 50.0);
    c *= expFactor;

    float ctr = u_contrast;
    float factor = (259.0 * (ctr + 255.0)) / (255.0 * (259.0 - ctr));
    c = (c - 0.5) * factor + 0.5;

    c = clamp(c, 0.0, 1.0);

    float r = texture2D(u_toneCurveTex, vec2(c.r, 0.5)).r;
    float g = texture2D(u_toneCurveTex, vec2(c.g, 0.5)).g;
    float b = texture2D(u_toneCurveTex, vec2(c.b, 0.5)).b;
    c = vec3(r, g, b);

    gl_FragColor = vec4(c, 1.0);
  }
`;

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

      // Setup GL state
      const vsSrc = isWebGL2 ? VS_GL2 : VS_GL1;
      const fsSrc = isWebGL2 ? FS_GL2 : FS_GL1;
      const prog = createProgram(gl, vsSrc, fsSrc);
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

      // Tone Curve Texture (1D LUT)
      const toneCurveTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, toneCurveTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      
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
      const u_tex = gl.getUniformLocation(prog, 'u_tex');
      gl.uniform1i(u_tex, 0); // Texture unit 0
      
      const u_toneCurveTex = gl.getUniformLocation(prog, 'u_toneCurveTex');
      gl.uniform1i(u_toneCurveTex, 1); // Texture unit 1

      const u_lut3d = gl.getUniformLocation(prog, 'u_lut3d');
      gl.uniform1i(u_lut3d, 2); // Texture unit 2

      const u_hasLut3d = gl.getUniformLocation(prog, 'u_hasLut3d');
      gl.uniform1f(u_hasLut3d, hasLut3d ? 1.0 : 0.0);

      const u_lut3dSize = gl.getUniformLocation(prog, 'u_lut3dSize');
      gl.uniform1f(u_lut3dSize, lut3dSize);

      const inverted = params && params.inverted ? 1.0 : 0.0;
      const u_inverted = gl.getUniformLocation(prog, 'u_inverted');
      gl.uniform1f(u_inverted, inverted);
      const u_logMode = gl.getUniformLocation(prog, 'u_logMode');
      gl.uniform1f(u_logMode, (params && params.inversionMode === 'log') ? 1.0 : 0.0);
      const rBal = (params?.red ?? 1.0) + (params?.temp ?? 0)/200.0 + (params?.tint ?? 0)/200.0;
      const gBal = (params?.green ?? 1.0) + (params?.temp ?? 0)/200.0 - (params?.tint ?? 0)/200.0;
      const bBal = (params?.blue ?? 1.0) - (params?.temp ?? 0)/200.0;
      const u_gains = gl.getUniformLocation(prog, 'u_gains');
      gl.uniform3f(u_gains, rBal, gBal, bBal);
      const u_exposure = gl.getUniformLocation(prog, 'u_exposure');
      gl.uniform1f(u_exposure, (params?.exposure ?? 0));
      const u_contrast = gl.getUniformLocation(prog, 'u_contrast');
      gl.uniform1f(u_contrast, (params?.contrast ?? 0));

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
      gl.deleteProgram(prog);

      // Encode canvas to JPEG and return
      canvas.toBlob((blobOut) => {
        if (!blobOut) {
          ipcRenderer.send('filmlab-gpu:result', { jobId, ok:false, error:'toBlob_failed' });
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          const arrBuf = reader.result; // ArrayBuffer
          const buf = Buffer.from(arrBuf);
          ipcRenderer.send('filmlab-gpu:result', { jobId, ok:true, width: canvas.width, height: canvas.height, jpegBytes: buf });
        };
        reader.onerror = () => {
          ipcRenderer.send('filmlab-gpu:result', { jobId, ok:false, error:'blob_read_failed' });
        };
        reader.readAsArrayBuffer(blobOut);
      }, 'image/jpeg', 0.95);
    } catch (err) {
      ipcRenderer.send('filmlab-gpu:result', { jobId, ok:false, error: (err && err.message) || String(err) });
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
      ipcRenderer.send('filmlab-gpu:result', { jobId, ok:false, error:'decode_failed: ' + (e && e.message) });
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initGL();
  ipcRenderer.on('filmlab-gpu:run', (_e, job) => {
    try { runJob(job); } catch (err) {
      ipcRenderer.send('filmlab-gpu:result', { jobId: job && job.jobId, ok: false, error: (err && err.message) || String(err) });
    }
  });
});
