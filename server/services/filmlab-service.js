const sharp = require('sharp');
sharp.cache(false);

const { computeWBGains } = require('../../packages/shared');
const rawDecoder = require('./raw-decoder');

function decodeBmp(buffer) {
  if (buffer.length < 54 || buffer[0] !== 0x42 || buffer[1] !== 0x4D) {
    throw new Error('Not a valid BMP file');
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bpp = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);

  if (compression !== 0) {
    throw new Error(`Unsupported BMP compression: ${compression} (only BI_RGB/uncompressed supported)`);
  }
  if (bpp !== 24 && bpp !== 32) {
    throw new Error(`Unsupported BMP depth: ${bpp}-bit (only 24/32-bit supported)`);
  }

  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  const channels = 3;
  const out = Buffer.allocUnsafe(width * height * channels);

  for (let row = 0; row < height; row++) {
    const srcRow = topDown ? row : (height - 1 - row);
    const srcOffset = pixelOffset + srcRow * rowSize;
    const dstOffset = row * width * channels;

    for (let col = 0; col < width; col++) {
      const si = srcOffset + col * (bpp / 8);
      const di = dstOffset + col * channels;
      out[di]     = buffer[si + 2];
      out[di + 1] = buffer[si + 1];
      out[di + 2] = buffer[si];
    }
  }

  return { data: out, width, height, channels };
}

/**
 * 获取图像输入源
 * 如果是 RAW 文件，先解码为 TIFF buffer；否则直接使用文件路径
 * 
 * @param {string} inputPath - 输入文件路径
 * @returns {Promise<{input: string|Buffer, isRaw: boolean}>}
 */
async function getImageInput(inputPath) {
  const isRaw = rawDecoder.isRawFile(inputPath);

  if (isRaw) {
    const available = await rawDecoder.isAvailable();
    if (!available) {
      console.warn('[FilmLab] RAW decoder not available, Sharp will try to handle directly');
      return { input: inputPath, isRaw: true };
    }

    try {
      console.log(`[FilmLab] Decoding RAW file: ${inputPath}`);
      const tiffBuffer = await rawDecoder.decode(inputPath, { outputFormat: 'tiff' });
      console.log(`[FilmLab] RAW decoded to TIFF buffer: ${(tiffBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      return { input: tiffBuffer, isRaw: true };
    } catch (err) {
      console.error('[FilmLab] RAW decode failed:', err.message);
      return { input: inputPath, isRaw: true };
    }
  }

  // For non-RAW files, probe Sharp first. If Sharp can't read it, try
  // LibRaw (TIFF variants) then pure-JS BMP decoder as final fallback.
  try {
    await sharp(inputPath).metadata();
  } catch (probeErr) {
    console.warn(`[FilmLab] Sharp cannot read "${inputPath}" (${probeErr.message}), trying fallbacks...`);

    // Attempt 1: LibRaw
    const available = await rawDecoder.isAvailable();
    if (available) {
      try {
        const tiffBuffer = await rawDecoder.decode(inputPath, { outputFormat: 'tiff' });
        console.log(`[FilmLab] Decoded via RAW decoder: ${(tiffBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        return { input: tiffBuffer, isRaw: false };
      } catch (decodeErr) {
        console.warn('[FilmLab] RAW decoder failed:', decodeErr.message);
      }
    }

    // Attempt 2: pure-JS BMP decoder
    try {
      const fs = require('fs');
      const fileBuffer = fs.readFileSync(inputPath);
      const { data, width, height, channels } = decodeBmp(fileBuffer);
      const rawInput = { raw: { width, height, channels } };
      const pngBuffer = await sharp(data, rawInput).png().toBuffer();
      console.log(`[FilmLab] BMP decoded via JS: ${width}x${height} → PNG ${(pngBuffer.length / 1024 / 1024).toFixed(2)} MB`);
      return { input: pngBuffer, isRaw: false };
    } catch (bmpErr) {
      console.error('[FilmLab] BMP decode also failed:', bmpErr.message);
    }
  }

  return { input: inputPath, isRaw: false };
}

// Build a sharp pipeline from params. Options:
// { rotation, orientation, cropRect: {x,y,w,h} normalized relative to rotated image, maxWidth, toneAndCurvesInJs }
// Returns a configured sharp instance (not yet written to file)
async function buildPipeline(inputPath, params = {}, options = {}) {
  const {
    inverted = false,
    inversionMode = 'linear',
    exposure = 0,
    contrast = 0,
    temp = 0,
    tint = 0,
    red = 1.0,
    green = 1.0,
    blue = 1.0,
    rotation = 0,
    orientation = 0,
  } = params;

  const { maxWidth = null, cropRect = null, toneAndCurvesInJs = false, skipColorOps = false } = options;

  // 获取图像输入（支持 RAW 文件自动解码）
  const { input } = await getImageInput(inputPath);

  const base = sharp(input, { failOn: 'none' });
  const meta = await base.metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;

  const totalRotation = (((rotation || 0) + (orientation || 0)) % 360 + 360) % 360;
  const rad = (totalRotation * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  const rotatedW = Math.round(srcW * cos + srcH * sin);
  const rotatedH = Math.round(srcW * sin + srcH * cos);

  const scale = (maxWidth && Number.isFinite(maxWidth) && maxWidth > 0) ? Math.min(1, maxWidth / Math.max(1, rotatedW)) : 1;
  const targetW = Math.max(1, Math.round(rotatedW * scale));
  const targetH = Math.max(1, Math.round(rotatedH * scale));

  let img = sharp(input, { failOn: 'none' });

  if (totalRotation !== 0) img = img.rotate(totalRotation);

  if (scale !== 1) {
    img = img.resize({ width: targetW, fit: 'inside', withoutEnlargement: true });
  }

  if (cropRect && typeof cropRect === 'object') {
    const cx = Number.isFinite(cropRect.x) ? cropRect.x : 0;
    const cy = Number.isFinite(cropRect.y) ? cropRect.y : 0;
    const cw = Number.isFinite(cropRect.w) ? cropRect.w : 1;
    const ch = Number.isFinite(cropRect.h) ? cropRect.h : 1;
    const left = Math.max(0, Math.min(targetW - 1, Math.round(cx * targetW)));
    const top = Math.max(0, Math.min(targetH - 1, Math.round(cy * targetH)));
    const width = Math.max(1, Math.min(targetW - left, Math.round(cw * targetW)));
    const height = Math.max(1, Math.min(targetH - top, Math.round(ch * targetH)));
    img = img.extract({ left, top, width, height });
  }

  // Skip ALL color operations if requested (caller will handle in JS for consistency)
  if (skipColorOps) {
    return img;
  }

  // Always apply Inversion + WB in Sharp (more efficient)
  // Inversion first (to match client ordering)
  // NOTE: Log inversion requires pixel-level math (255 * (1 - log(x+1)/log(256)))
  // Sharp doesn't support this natively, so when inversionMode='log' and toneAndCurvesInJs=true,
  // defer inversion AND WB to JS (since WB must come after inversion).
  // Also defer if Film Curve is enabled (Film Curve must be applied BEFORE inversion)
  const filmCurveEnabled = !!params.filmCurveEnabled;
  const deferInversionToJs = inverted && (inversionMode === 'log' || filmCurveEnabled) && toneAndCurvesInJs;
  if (inverted && !deferInversionToJs) {
    // Linear inversion only - log and film curve cases are deferred to JS
    img = img.negate();
  }

  // White balance via per-channel gains (clamped)
  // Skip if log inversion is deferred (WB must come after inversion, so also defer WB)
  if (!deferInversionToJs) {
    const [rBal, gBal, bBal] = computeWBGains({ red, green, blue, temp, tint });
    img = img.linear([rBal, gBal, bBal], [0, 0, 0]);
  }

  // Defer Tone/Curves to JS when requested (they need complex LUT processing)
  if (!toneAndCurvesInJs) {
    // Exposure as brightness factor
    const expFactor = Math.pow(2, (Number(exposure) || 0) / 50);
    if (expFactor !== 1) img = img.modulate({ brightness: expFactor });

    // Contrast around mid-gray
    const ctr = Number(contrast) || 0;
    if (ctr !== 0) {
      const f = (259 * (ctr + 255)) / (255 * (259 - ctr));
      const b = 128 - f * 128;
      img = img.linear([f, f, f], [b, b, b]);
    }
  }

  return img;
}

module.exports = { buildPipeline, getImageInput };
