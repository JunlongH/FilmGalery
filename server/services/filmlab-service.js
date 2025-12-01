const sharp = require('sharp');
sharp.cache(false);

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

  const { maxWidth = null, cropRect = null, toneAndCurvesInJs = false } = options;

  const base = sharp(inputPath, { failOn: 'none' });
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

  let img = sharp(inputPath, { failOn: 'none' });

  if (totalRotation !== 0) img = img.rotate(totalRotation);

  if (scale !== 1) {
    img = img.resize({ width: targetW, fit: 'inside', withoutEnlargement: true });
  }

  if (cropRect && typeof cropRect === 'object') {
    const left = Math.max(0, Math.min(targetW - 1, Math.round((cropRect.x || 0) * targetW)));
    const top = Math.max(0, Math.min(targetH - 1, Math.round((cropRect.y || 0) * targetH)));
    const width = Math.max(1, Math.min(targetW - left, Math.round((cropRect.w || 1) * targetW)));
    const height = Math.max(1, Math.min(targetH - top, Math.round((cropRect.h || 1) * targetH)));
    img = img.extract({ left, top, width, height });
  }

  // Defer color ops (invert, gains, exposure/contrast) to JS when requested
  if (!toneAndCurvesInJs) {
    // Inversion first (to match client ordering better)
    if (inverted) {
      if (inversionMode === 'log') img = img.negate().gamma(0.85); // legacy approximation
      else img = img.negate();
    }

    // White balance via per-channel gains
    const rBal = (Number(red) || 1) + (Number(temp) || 0)/200 + (Number(tint) || 0)/200;
    const gBal = (Number(green) || 1) + (Number(temp) || 0)/200 - (Number(tint) || 0)/200;
    const bBal = (Number(blue) || 1) - (Number(temp) || 0)/200;
    img = img.linear([rBal, gBal, bBal], [0,0,0]);
  }

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

module.exports = { buildPipeline };
