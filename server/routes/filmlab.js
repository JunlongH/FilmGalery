const express = require('express');
const router = express.Router();
const db = require('../db');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
sharp.cache(false);
const { uploadsDir } = require('../config/paths');
const { buildPipeline } = require('../services/filmlab-service');

// --- Helpers: tone LUT and curve LUT (mirror client logic) ---
function buildToneLUT({ exposure = 0, contrast = 0, highlights = 0, shadows = 0, whites = 0, blacks = 0 }) {
  const lut = new Uint8Array(256);
  const expFactor = Math.pow(2, (Number(exposure) || 0) / 50);
  const ctr = Number(contrast) || 0;
  const contrastFactor = (259 * (ctr + 255)) / (255 * (259 - ctr));
  const blackPoint = -(Number(blacks) || 0) * 0.002;
  const whitePoint = 1 - (Number(whites) || 0) * 0.002;
  const sFactor = (Number(shadows) || 0) * 0.005;
  const hFactor = (Number(highlights) || 0) * 0.005;
  for (let i = 0; i < 256; i++) {
    let val = i / 255;
    // Exposure
    val *= expFactor;
    // Contrast around 0.5
    val = (val - 0.5) * contrastFactor + 0.5;
    // Blacks & Whites window
    if (whitePoint !== blackPoint) val = (val - blackPoint) / (whitePoint - blackPoint);
    // Shadows
    if (sFactor !== 0) val += sFactor * Math.pow(1 - val, 2) * val * 4;
    // Highlights
    if (hFactor !== 0) val += hFactor * Math.pow(val, 2) * (1 - val) * 4;
    lut[i] = Math.min(255, Math.max(0, Math.round(val * 255)));
  }
  return lut;
}

function createSpline(xs, ys) {
  const n = xs.length;
  const dys = [], dxs = [], ms = [];
  for (let i = 0; i < n - 1; i++) {
    dxs.push(xs[i + 1] - xs[i]);
    dys.push(ys[i + 1] - ys[i]);
    ms.push(dys[i] / dxs[i]);
  }
  const c1s = [ms[0]];
  for (let i = 0; i < n - 2; i++) {
    const m = ms[i], mNext = ms[i + 1];
    if (m * mNext <= 0) c1s.push(0);
    else {
      const dx = dxs[i], dxNext = dxs[i + 1];
      const common = dx + dxNext;
      c1s.push((3 * common) / ((common + dxNext) / m + (common + dx) / mNext));
    }
  }
  c1s.push(ms[ms.length - 1]);
  const c2s = [], c3s = [];
  for (let i = 0; i < n - 1; i++) {
    const c1 = c1s[i], m = ms[i], invDx = 1 / dxs[i];
    const common = c1 + c1s[i + 1] - 2 * m;
    c2s.push((m - c1 - common) * invDx);
    c3s.push(common * invDx * invDx);
  }
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const diff = x - xs[i];
    return ys[i] + c1s[i] * diff + c2s[i] * diff * diff + c3s[i] * diff * diff * diff;
  };
}

function buildCurveLUT(points) {
  const lut = new Uint8Array(256);
  const sorted = Array.isArray(points) ? [...points].sort((a, b) => a.x - b.x) : [{ x: 0, y: 0 }, { x: 255, y: 255 }];
  if (sorted.length < 2) {
    for (let i = 0; i < 256; i++) lut[i] = i;
    return lut;
  }
  const xs = sorted.map(p => p.x);
  const ys = sorted.map(p => p.y);
  const spline = createSpline(xs, ys);
  for (let i = 0; i < 256; i++) {
    if (i <= sorted[0].x) lut[i] = sorted[0].y;
    else if (i >= sorted[sorted.length - 1].x) lut[i] = sorted[sorted.length - 1].y;
    else lut[i] = Math.min(255, Math.max(0, Math.round(spline(i))));
  }
  return lut;
}

// POST /api/filmlab/preview
// Body: { photoId, params, maxWidth }
router.post('/preview', async (req, res) => {
  const { photoId, params, maxWidth } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    const relSource = row.original_rel_path || row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
    if (!relSource) return res.status(400).json({ error: 'no usable source path' });
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    // Build pipeline: rotate/resize/crop only. All color ops (invert, WB, tone, curves) applied in JS for parity with client.
    let img = await buildPipeline(abs, params || {}, { maxWidth: maxWidth || 1600, cropRect: (params && params.cropRect) || null, toneAndCurvesInJs: true });

    // Pull raw buffer
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels; // expect 3
    const out = Buffer.allocUnsafe(width * height * 3);

    // Build LUTs
    const toneLUT = buildToneLUT({
      exposure: params?.exposure || 0,
      contrast: params?.contrast || 0,
      highlights: params?.highlights || 0,
      shadows: params?.shadows || 0,
      whites: params?.whites || 0,
      blacks: params?.blacks || 0,
    });
    const curves = params?.curves || { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [{ x: 0, y: 0 }, { x: 255, y: 255 }], green: [{ x: 0, y: 0 }, { x: 255, y: 255 }], blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const lutRGB = buildCurveLUT(curves.rgb || []);
    const lutR = buildCurveLUT(curves.red || []);
    const lutG = buildCurveLUT(curves.green || []);
    const lutB = buildCurveLUT(curves.blue || []);

    // Precompute gains for WB to mirror client order (after inversion, before tone)
    const red = Number(params?.red ?? 1);
    const green = Number(params?.green ?? 1);
    const blue = Number(params?.blue ?? 1);
    const temp = Number(params?.temp ?? 0);
    const tint = Number(params?.tint ?? 0);
    const rBal = red + temp/200 + tint/200;
    const gBal = green + temp/200 - tint/200;
    const bBal = blue - temp/200;

    // Process per pixel
    for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Inversion first
      if (params?.inverted) {
        if (params?.inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else {
          r = 255 - r; g = 255 - g; b = 255 - b;
        }
      }

      // White balance gains
      r = r * rBal; g = g * gBal; b = b * bBal;
      r = Math.min(255, Math.max(0, r));
      g = Math.min(255, Math.max(0, g));
      b = Math.min(255, Math.max(0, b));

      // Tone LUT
      r = toneLUT[r];
      g = toneLUT[g];
      b = toneLUT[b];
      // Curves: RGB then channels
      r = lutRGB[r];
      g = lutRGB[g];
      b = lutRGB[b];
      r = lutR[r];
      g = lutG[g];
      b = lutB[b];

      out[j] = r;
      out[j + 1] = g;
      out[j + 2] = b;
    }

    // Encode to JPEG and send
    res.setHeader('Content-Type', 'image/jpeg');
    const buf = await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
    res.end(buf);
  } catch (e) {
    console.error('[FILMLAB] preview error', e);
    res.status(500).json({ error: e && e.message });
  }
});

// POST /api/filmlab/render
// Body: { photoId, params }
router.post('/render', async (req, res) => {
  const { photoId, params } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path, filename FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    const relSource = row.original_rel_path || row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
    if (!relSource) return res.status(400).json({ error: 'no usable source path' });
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    // Full resolution pipeline: geometry only; color ops in JS
    let img = await buildPipeline(abs, params || {}, { maxWidth: 4000, cropRect: (params && params.cropRect) || null, toneAndCurvesInJs: true });

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);

    const toneLUT = buildToneLUT({
      exposure: params?.exposure || 0,
      contrast: params?.contrast || 0,
      highlights: params?.highlights || 0,
      shadows: params?.shadows || 0,
      whites: params?.whites || 0,
      blacks: params?.blacks || 0,
    });
    const curves = params?.curves || { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [{ x: 0, y: 0 }, { x: 255, y: 255 }], green: [{ x: 0, y: 0 }, { x: 255, y: 255 }], blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const lutRGB = buildCurveLUT(curves.rgb || []);
    const lutR = buildCurveLUT(curves.red || []);
    const lutG = buildCurveLUT(curves.green || []);
    const lutB = buildCurveLUT(curves.blue || []);

    // Precompute WB gains
    {
      const red = Number(params?.red ?? 1);
      const green = Number(params?.green ?? 1);
      const blue = Number(params?.blue ?? 1);
      const temp = Number(params?.temp ?? 0);
      const tint = Number(params?.tint ?? 0);
      var rBal = red + temp/200 + tint/200;
      var gBal = green + temp/200 - tint/200;
      var bBal = blue - temp/200;
    }

    for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (params?.inverted) {
        if (params?.inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else { r = 255 - r; g = 255 - g; b = 255 - b; }
      }

      // WB gains
      r = Math.min(255, Math.max(0, r * rBal));
      g = Math.min(255, Math.max(0, g * gBal));
      b = Math.min(255, Math.max(0, b * bBal));

      r = toneLUT[r]; g = toneLUT[g]; b = toneLUT[b];
      r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
      r = lutR[r]; g = lutG[g]; b = lutB[b];
      out[j] = r; out[j + 1] = g; out[j + 2] = b;
    }

    // Save to positive file
    const rollDir = path.dirname(path.join(uploadsDir, relSource));
    const ext = path.extname(row.filename || 'image.jpg') || '.jpg';
    const base = path.basename(row.filename || 'image.jpg', ext);
    
    // Use consistent naming: if already has _pos, keep it; otherwise add _pos
    let newName;
    if (base.includes('_pos')) {
      newName = `${base}${ext}`;
    } else {
      newName = `${base}_pos${ext}`;
    }
    
    let outDir = rollDir;
    if (relSource.includes('/negative')) {
        outDir = rollDir.replace(/negative$/, 'full').replace(/negative[\\/]$/, 'full');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    }
    
    const outPath = path.join(outDir, newName);
    
    await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(outPath);
    
    const relOut = path.relative(uploadsDir, outPath).replace(/\\/g, '/');
    
    // Also update filename in database to match the actual file
    await new Promise((resolve, reject) => {
        db.run('UPDATE photos SET filename = ?, positive_rel_path = ?, full_rel_path = ? WHERE id = ?', [newName, relOut, relOut, photoId], (err) => err ? reject(err) : resolve());
    });

    res.json({ ok: true, path: relOut });
  } catch (e) {
    console.error('[FILMLAB] render error', e);
    res.status(500).json({ error: e && e.message });
  }
});

// POST /api/filmlab/export
// Body: { photoId, params }
router.post('/export', async (req, res) => {
  const { photoId, params } = req.body || {};
  if (!photoId) return res.status(400).json({ error: 'photoId required' });
  try {
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT id, roll_id, filename, original_rel_path, positive_rel_path, full_rel_path, negative_rel_path FROM photos WHERE id = ?', [photoId], (err, r) => err ? reject(err) : resolve(r));
    });
    if (!row) return res.status(404).json({ error: 'photo not found' });
    const relSource = row.original_rel_path || row.positive_rel_path || row.full_rel_path || row.negative_rel_path;
    if (!relSource) return res.status(400).json({ error: 'no usable source path' });
    const abs = path.join(uploadsDir, relSource);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'source missing on disk' });

    let img = await buildPipeline(abs, params || {}, { maxWidth: 4000, cropRect: (params && params.cropRect) || null, toneAndCurvesInJs: true });

    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const width = info.width;
    const height = info.height;
    const channels = info.channels;
    const out = Buffer.allocUnsafe(width * height * 3);

    const toneLUT = buildToneLUT({
      exposure: params?.exposure || 0,
      contrast: params?.contrast || 0,
      highlights: params?.highlights || 0,
      shadows: params?.shadows || 0,
      whites: params?.whites || 0,
      blacks: params?.blacks || 0,
    });
    const curves = params?.curves || { rgb: [{ x: 0, y: 0 }, { x: 255, y: 255 }], red: [{ x: 0, y: 0 }, { x: 255, y: 255 }], green: [{ x: 0, y: 0 }, { x: 255, y: 255 }], blue: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
    const lutRGB = buildCurveLUT(curves.rgb || []);
    const lutR = buildCurveLUT(curves.red || []);
    const lutG = buildCurveLUT(curves.green || []);
    const lutB = buildCurveLUT(curves.blue || []);

    // Precompute WB gains
    {
      const red = Number(params?.red ?? 1);
      const green = Number(params?.green ?? 1);
      const blue = Number(params?.blue ?? 1);
      const temp = Number(params?.temp ?? 0);
      const tint = Number(params?.tint ?? 0);
      var rBal2 = red + temp/200 + tint/200;
      var gBal2 = green + temp/200 - tint/200;
      var bBal2 = blue - temp/200;
    }

    for (let i = 0, j = 0; i < data.length; i += channels, j += 3) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (params?.inverted) {
        if (params?.inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else { r = 255 - r; g = 255 - g; b = 255 - b; }
      }

      r = Math.min(255, Math.max(0, r * rBal2));
      g = Math.min(255, Math.max(0, g * gBal2));
      b = Math.min(255, Math.max(0, b * bBal2));

      r = toneLUT[r]; g = toneLUT[g]; b = toneLUT[b];
      r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
      r = lutR[r]; g = lutG[g]; b = lutB[b];
      out[j] = r; out[j + 1] = g; out[j + 2] = b;
    }

    // Persist export to disk and update DB paths consistently
    // Determine output directory (prefer full/ under the same roll)
    const baseDir = path.dirname(path.join(uploadsDir, relSource));
    let outDir = baseDir;
    if (relSource.includes('/negative')) {
      outDir = baseDir.replace(/negative$/, 'full').replace(/negative[\\/]$/, 'full');
    } else if (!relSource.includes('/full')) {
      // If source is originals or other, use full directory sibling
      outDir = baseDir.replace(/originals$/, 'full').replace(/originals[\\/]$/, 'full');
    }
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Build consistent file name based on existing filename
    const ext = path.extname(row.filename || 'image.jpg') || '.jpg';
    const base = path.basename(row.filename || 'image.jpg', ext);
    const outName = base.includes('_pos') ? `${base}${ext}` : `${base}_pos${ext}`;
    const outPath = path.join(outDir, outName);

    await sharp(out, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toFile(outPath);
    const relOut = path.relative(uploadsDir, outPath).replace(/\\/g, '/');

    // Optionally generate/update thumbnail in thumb/ directory
    try {
      const rollsRoot = path.resolve(outDir, '..');
      const thumbDir = path.join(rollsRoot, 'thumb');
      if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });
      const thumbName = `${base.includes('_pos') ? base : base + '_pos'}-thumb.jpg`;
      const thumbPath = path.join(thumbDir, thumbName);
      await sharp(outPath)
        .resize({ width: 240, height: 240, fit: 'inside' })
        .jpeg({ quality: 40 })
        .toFile(thumbPath)
        .catch(() => {});
      const relThumb = path.relative(uploadsDir, thumbPath).replace(/\\/g, '/');

      // Update DB: filename, positive_rel_path, full_rel_path, positive_thumb_rel_path, thumb_rel_path
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE photos SET filename = ?, positive_rel_path = ?, full_rel_path = ?, positive_thumb_rel_path = ?, thumb_rel_path = ? WHERE id = ?',
          [outName, relOut, relOut, relThumb, relThumb, photoId],
          (err) => (err ? reject(err) : resolve())
        );
      });
    } catch (e) {
      // Fallback: update paths without thumbnail
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE photos SET filename = ?, positive_rel_path = ?, full_rel_path = ? WHERE id = ?',
          [outName, relOut, relOut, photoId],
          (err) => (err ? reject(err) : resolve())
        );
      });
    }

    res.json({ ok: true, path: relOut });
  } catch (e) {
    console.error('[FILMLAB] export error', e);
    res.status(500).json({ error: e && e.message });
  }
});

module.exports = router;
