// Monotone Cubic Spline Interpolation
export const createSpline = (xs, ys) => {
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
    if (m * mNext <= 0) {
      c1s.push(0);
    } else {
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
    // Find segment
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    
    const diff = x - xs[i];
    return ys[i] + c1s[i] * diff + c2s[i] * diff * diff + c3s[i] * diff * diff * diff;
  };
};

// Spline Interpolation for Curve LUT
export const getCurveLUT = (points) => {
  const lut = new Uint8Array(256);
  // Ensure points are sorted
  const sortedPoints = [...points].sort((a, b) => a.x - b.x);
  
  if (sortedPoints.length < 2) {
    for(let i=0; i<256; i++) lut[i] = i;
    return lut;
  }

  const xs = sortedPoints.map(p => p.x);
  const ys = sortedPoints.map(p => p.y);
  const spline = createSpline(xs, ys);

  for (let i = 0; i < 256; i++) {
    if (i <= sortedPoints[0].x) {
      lut[i] = sortedPoints[0].y;
    } else if (i >= sortedPoints[sortedPoints.length - 1].x) {
      lut[i] = sortedPoints[sortedPoints.length - 1].y;
    } else {
      const val = spline(i);
      lut[i] = Math.min(255, Math.max(0, Math.round(val)));
    }
  }
  
  return lut;
};

// Helper to parse .cube file
export const parseCubeLUT = (text) => {
  const lines = text.split('\n');
  let size = 33; // Default
  const data = [];
  
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    
    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1]);
      continue;
    }
    
    // Data lines
    const parts = line.split(/\s+/).map(parseFloat);
    if (parts.length >= 3 && !isNaN(parts[0])) {
      data.push(parts[0], parts[1], parts[2]);
    }
  }
  
  return { size, data: new Float32Array(data) };
};

// Helper for trilinear interpolation
export const sampleLUT = (r, g, b, lut) => {
  const { size, data } = lut;
  // r, g, b are 0-1
  const maxIndex = size - 1;
  
  const rPos = r * maxIndex;
  const gPos = g * maxIndex;
  const bPos = b * maxIndex;
  
  const r0 = Math.floor(rPos);
  const g0 = Math.floor(gPos);
  const b0 = Math.floor(bPos);
  
  const r1 = Math.min(maxIndex, r0 + 1);
  const g1 = Math.min(maxIndex, g0 + 1);
  const b1 = Math.min(maxIndex, b0 + 1);
  
  const fr = rPos - r0;
  const fg = gPos - g0;
  const fb = bPos - b0;
  
  // Helper to get index in flat array
  // Standard .cube order is usually: for B { for G { for R { ... } } }
  // index = r + g*size + b*size*size
  const getIdx = (ri, gi, bi) => (ri + gi * size + bi * size * size) * 3;
  
  // We need 8 samples
  const idx000 = getIdx(r0, g0, b0);
  const idx100 = getIdx(r1, g0, b0);
  const idx010 = getIdx(r0, g1, b0);
  const idx110 = getIdx(r1, g1, b0);
  const idx001 = getIdx(r0, g0, b1);
  const idx101 = getIdx(r1, g0, b1);
  const idx011 = getIdx(r0, g1, b1);
  const idx111 = getIdx(r1, g1, b1);
  
  const interp = (v000, v100, v010, v110, v001, v101, v011, v111) => {
    const c00 = v000 * (1 - fr) + v100 * fr;
    const c10 = v010 * (1 - fr) + v110 * fr;
    const c01 = v001 * (1 - fr) + v101 * fr;
    const c11 = v011 * (1 - fr) + v111 * fr;
    
    const c0 = c00 * (1 - fg) + c10 * fg;
    const c1 = c01 * (1 - fg) + c11 * fg;
    
    return c0 * (1 - fb) + c1 * fb;
  };
  
  const rOut = interp(data[idx000], data[idx100], data[idx010], data[idx110], data[idx001], data[idx101], data[idx011], data[idx111]);
  const gOut = interp(data[idx000+1], data[idx100+1], data[idx010+1], data[idx110+1], data[idx001+1], data[idx101+1], data[idx011+1], data[idx111+1]);
  const bOut = interp(data[idx000+2], data[idx100+2], data[idx010+2], data[idx110+2], data[idx001+2], data[idx101+2], data[idx011+2], data[idx111+2]);
  
  return [rOut, gOut, bOut];
};

// Calculate the maximum inscribed rectangle (no black corners) after rotation
// Returns normalized coordinates [0,1] relative to the rotated bounding box
// Returns the largest possible rect for the given aspect ratio (or original image aspect if null)
export function getMaxSafeRect(imgW, imgH, angleDeg, aspect = null) {
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.abs(Math.sin(rad));
  const cos = Math.abs(Math.cos(rad));
  
  // Rotated bounding box dimensions
  const rotW = imgW * cos + imgH * sin;
  const rotH = imgW * sin + imgH * cos;
  
  // For zero rotation (or 90/180/270), safe rect = full image
  if (sin < 0.001 || cos < 0.001) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  
  // If aspect is not provided, use the image's original aspect ratio as a safe default
  // This ensures the returned rect is always fully inside the image
  const r = aspect || (imgW / imgH);
  
  // Calculate max width/height for the given aspect ratio r = w/h
  // Constraints:
  // w*cos + h*sin <= imgW
  // w*sin + h*cos <= imgH
  // Substitute w = h*r:
  // h * (r*cos + sin) <= imgW
  // h * (r*sin + cos) <= imgH
  
  const h1 = imgW / (r * cos + sin);
  const h2 = imgH / (r * sin + cos);
  const h = Math.min(h1, h2);
  const w = h * r;
  
  // Center the safe rect in the rotated bounding box
  const x = (rotW - w) / 2;
  const y = (rotH - h) / 2;
  
  return {
    x: x / rotW,
    y: y / rotH,
    w: w / rotW,
    h: h / rotH
  };
}

// Fit a rectangle to a target aspect ratio within a container rect (all normalized 0..1)
// targetRatio = width / height (e.g., 3:2 = 1.5, meaning width is 1.5x height)
// This enforces the EXACT ratio without auto-flipping based on container
export function fitRectToAspectWithin(container, targetRatio) {
  if (!targetRatio || targetRatio <= 0) return { ...container };
  const { x: cx, y: cy, w: cw, h: ch } = container;
  
  // Calculate what dimensions would be needed for target ratio
  let w, h;
  
  // Try fitting by width first
  w = cw;
  h = w / targetRatio;  // height = width / ratio
  
  if (h > ch) {
    // Height doesn't fit, so fit by height instead
    h = ch;
    w = h * targetRatio;  // width = height * ratio
  }
  
  // Center the fitted rect in container
  const nx = cx + (cw - w) / 2;
  const ny = cy + (ch - h) / 2;
  return { x: nx, y: ny, w, h };
}

// Resolve target aspect ratio by preset name.
// Returns width/height ratio (e.g. 3:2 -> 1.5).
// For 'original', respect EXIF orientation (90°/270° swap w/h),
// but ignore fine rotation slider (Lightroom-like behavior).
export function getPresetRatio(ratioMode, image, orientationDeg, swap=false) {
  if (!image) return null;
  switch (ratioMode) {
    case 'free':
      return null;
    case 'original': {
      // Original: use physical image ratio only; ignore EXIF/orientation and swap
      // Use naturalWidth/Height to avoid potential browser layout/EXIF adjustments on width/height
      const w = image.naturalWidth || image.width;
      const h = image.naturalHeight || image.height;
      // If orientation is 90 or 270, swap width and height
      const isRotated90 = Math.abs(orientationDeg % 180) === 90;
      return isRotated90 ? h / w : w / h;
    }
    case '1:1':
      return 1; // 1:1 is symmetrical, swap has no effect
    default: {
      // Parse "3:2" etc.
      const parts = ratioMode.split(':');
      if (parts.length === 2) {
        const w = parseFloat(parts[0]);
        const h = parseFloat(parts[1]);
        if (swap) return h / w;
        return w / h;
      }
      return null;
    }
  }
}

// Helper to check if a normalized rect is within the rotated image bounds
export function isRectValid(rect, imgW, imgH, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  const absSin = Math.abs(sin);
  const absCos = Math.abs(cos);
  
  // Dimensions of the bounding box of the rotated image
  const rotW = imgW * absCos + imgH * absSin;
  const rotH = imgW * absSin + imgH * absCos;
  
  // Image extents relative to center
  // Relax boundary check by a tiny amount to prevent floating point locking, but keep it tight
  const halfW = imgW / 2 + 0.01; 
  const halfH = imgH / 2 + 0.01;

  // Check a single point (nx, ny are 0..1)
  const checkPoint = (nx, ny) => {
    // Map to centered pixel coordinates
    const px = nx * rotW - rotW / 2;
    const py = ny * rotH - rotH / 2;
    
    // Rotate back to image space
    // (px, py) is rotated by angle. We want unrotated.
    // unrot = Rot(-angle) * p
    const ux = px * cos + py * sin;
    const uy = -px * sin + py * cos;
    
    return Math.abs(ux) <= halfW && Math.abs(uy) <= halfH;
  };

  return checkPoint(rect.x, rect.y) &&
         checkPoint(rect.x + rect.w, rect.y) &&
         checkPoint(rect.x, rect.y + rect.h) &&
         checkPoint(rect.x + rect.w, rect.y + rect.h);
}

// Parse EXIF Orientation from ArrayBuffer (Supports JPEG and TIFF)
export function getExifOrientation(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 2) return -1;

  // Check for JPEG
  if (view.getUint16(0, false) === 0xFFD8) {
    const length = view.byteLength;
    let offset = 2;
    while (offset < length) {
      if (view.byteLength < offset + 2) return -1;
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) {
        if (view.byteLength < offset + 14) return -1;
        if (view.getUint32(offset + 2, false) !== 0x45786966) return -1;
        const little = view.getUint16(offset + 8, false) === 0x4949;
        offset += 8;
        const firstIFDOffset = view.getUint32(offset + 4, little);
        if (firstIFDOffset < 8) return -1;
        
        const tagsStart = offset + firstIFDOffset;
        if (view.byteLength < tagsStart + 2) return -1;
        const tags = view.getUint16(tagsStart, little);
        
        for (let i = 0; i < tags; i++) {
          const entryOffset = tagsStart + 2 + (i * 12);
          if (view.byteLength < entryOffset + 12) return -1;
          if (view.getUint16(entryOffset, little) === 0x0112) {
            return view.getUint16(entryOffset + 8, little);
          }
        }
      } else if ((marker & 0xFF00) !== 0xFF00) break;
      else {
        if (view.byteLength < offset + 2) return -1;
        offset += view.getUint16(offset, false);
      }
    }
  }
  // Check for TIFF
  else {
    const marker = view.getUint16(0, false);
    if (marker === 0x4949 || marker === 0x4D4D) {
      const little = marker === 0x4949;
      if (view.byteLength < 8) return -1;
      if (view.getUint16(2, little) !== 0x002A) return -1;
      const firstIFDOffset = view.getUint32(4, little);
      if (firstIFDOffset < 8) return -1;

      let offset = firstIFDOffset;
      if (view.byteLength < offset + 2) return -1;
      const tags = view.getUint16(offset, little);

      for (let i = 0; i < tags; i++) {
        const entryOffset = offset + 2 + (i * 12);
        if (view.byteLength < entryOffset + 12) return -1;
        const tag = view.getUint16(entryOffset, little);
        if (tag === 0x0112) { // Orientation
          return view.getUint16(entryOffset + 8, little);
        }
      }
    }
  }
  return -1;
}
