import React, { useEffect, useRef, useState } from 'react';
import { computeWBGains } from './FilmLab/wb';

const SliderControl = ({ label, value, onChange, min, max, step=1, onMouseDown, suffix='' }) => {
  const handleMinus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.max(min, Number((value - step).toFixed(2))));
  };
  const handlePlus = () => {
    onMouseDown && onMouseDown();
    onChange(Math.min(max, Number((value + step).toFixed(2))));
  };

  return (
    <div className="control-group" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <label className="iv-control-label" style={{ width: 90, flexShrink: 0 }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
        <span style={{ fontSize: 11, color: '#ccc', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' }}>{value}{suffix}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <button className="iv-btn-icon" onClick={handleMinus}>−</button>
          <input 
            type="range" 
            min={min} 
            max={max} 
            step={step}
            value={value} 
            onMouseDown={onMouseDown}
            onChange={e => onChange(Number(e.target.value))} 
            style={{ flex: 1, margin: '0 4px' }}
          />
          <button className="iv-btn-icon" onClick={handlePlus}>+</button>
        </div>
      </div>
    </div>
  );
};

// Helper to parse .cube file
const parseCubeLUT = (text) => {
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
const sampleLUT = (r, g, b, lut) => {
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

export default function FilmInverter({ imageUrl, onClose, onSave }) {
  const canvasRef = useRef(null);
  const curveContainerRef = useRef(null);
  const [image, setImage] = useState(null);
  
  // Parameters
  const [inverted, setInverted] = useState(true);
  const [exposure, setExposure] = useState(0); // -100 to 100
  const [contrast, setContrast] = useState(0); // -100 to 100
  const [highlights, setHighlights] = useState(0); // -100 to 100
  const [shadows, setShadows] = useState(0); // -100 to 100
  const [whites, setWhites] = useState(0); // -100 to 100
  const [blacks, setBlacks] = useState(0); // -100 to 100
  const [temp, setTemp] = useState(0); // -100 to 100 (Blue <-> Yellow)
  const [tint, setTint] = useState(0); // -100 to 100 (Green <-> Magenta)
  
  // RGB Gains (for manual color balance)
  const [red, setRed] = useState(1.0);
  const [green, setGreen] = useState(1.0);
  const [blue, setBlue] = useState(1.0);

  // Rotation
  const [rotation, setRotation] = useState(0);
  const [orientation, setOrientation] = useState(0); // 0, 90, 180, 270

  // Crop
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 1, h: 1 }); // Normalized 0-1
  const [keepRatio, setKeepRatio] = useState(false);

  // Curve Points: Object with arrays for each channel
  const defaultCurve = [{x:0, y:0}, {x:255, y:255}];
  const [curves, setCurves] = useState({
    rgb: [...defaultCurve],
    red: [...defaultCurve],
    green: [...defaultCurve],
    blue: [...defaultCurve]
  });
  const [activeChannel, setActiveChannel] = useState('rgb'); // 'rgb', 'red', 'green', 'blue'

  // Zoom & Pan
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  const [histograms, setHistograms] = useState({
    rgb: new Array(256).fill(0),
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0)
  });
  
  // LUTs
  const [lut1, setLut1] = useState(null); // { name, data, size, intensity: 1.0 }
  const [lut2, setLut2] = useState(null);

  // History
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);
  const [draggingPointIndex, setDraggingPointIndex] = useState(null);

  const pushToHistory = () => {
    setHistory(prev => [...prev, {
      inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect,
      lut1: lut1 ? { ...lut1 } : null,
      lut2: lut2 ? { ...lut2 } : null
    }]);
    setFuture([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    const current = { inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect };
    
    setFuture(prev => [...prev, current]);
    setHistory(prev => prev.slice(0, -1));
    
    setInverted(previous.inverted);
    setExposure(previous.exposure);
    setContrast(previous.contrast);
    setHighlights(previous.highlights || 0);
    setShadows(previous.shadows || 0);
    setWhites(previous.whites || 0);
    setBlacks(previous.blacks || 0);
    setTemp(previous.temp);
    setTint(previous.tint);
    setRed(previous.red);
    setGreen(previous.green);
    setBlue(previous.blue);
    setCurves(previous.curves);
    setRotation(previous.rotation || 0);
    setCropRect(previous.cropRect || { x: 0, y: 0, w: 1, h: 1 });
  };

  const handleRedo = () => {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    const current = { inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, cropRect };
    
    setHistory(prev => [...prev, current]);
    setFuture(prev => prev.slice(0, -1));
    
    setInverted(next.inverted);
    setExposure(next.exposure);
    setContrast(next.contrast);
    setHighlights(next.highlights || 0);
    setShadows(next.shadows || 0);
    setWhites(next.whites || 0);
    setBlacks(next.blacks || 0);
    setTemp(next.temp);
    setTint(next.tint);
    setRed(next.red);
    setGreen(next.green);
    setBlue(next.blue);
    setCurves(next.curves);
    setRotation(next.rotation || 0);
    setCropRect(next.cropRect || { x: 0, y: 0, w: 1, h: 1 });
  };

  const handleReset = () => {
    pushToHistory();
    setInverted(true);
    setExposure(0);
    setContrast(0);
    setHighlights(0);
    setShadows(0);
    setWhites(0);
    setBlacks(0);
    setTemp(0);
    setTint(0);
    setRed(1.0);
    setGreen(1.0);
    setBlue(1.0);
    setRotation(0);
    setOrientation(0);
    setCropRect({ x: 0, y: 0, w: 1, h: 1 });
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLut1(null);
    setLut2(null);
    setCurves({
      rgb: [{x:0, y:0}, {x:255, y:255}],
      red: [{x:0, y:0}, {x:255, y:255}],
      green: [{x:0, y:0}, {x:255, y:255}],
      blue: [{x:0, y:0}, {x:255, y:255}]
    });
  };

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    processImage();
  }, [image, inverted, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, orientation, cropRect, isCropping, lut1, lut2]);

  const [isPicking, setIsPicking] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);

  const handleCanvasClick = (e) => {
    if (!isPicking || !image || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);

    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');

    // Replicate processImage transforms
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    const rad = (rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    // Shift coordinate system so that (x,y) becomes (0,0)
    ctx.translate(-x, -y);

    if (isCropping) {
      ctx.translate(rotatedW / 2, rotatedH / 2);
      ctx.rotate(rad);
      ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    } else {
      const cropX = cropRect.x * rotatedW;
      const cropY = cropRect.y * rotatedH;
      
      ctx.translate(-cropX, -cropY);
      ctx.translate(rotatedW / 2, rotatedH / 2);
      ctx.rotate(rad);
      ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    }

    const p = ctx.getImageData(0, 0, 1, 1).data;
    let r = p[0], g = p[1], b = p[2];

    // Apply Pre-Curve Pipeline
    if (inverted) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    const [rBal, gBal, bBal] = computeWBGains({ red, green, blue, temp, tint });
    r *= rBal;
    g *= gBal;
    b *= bBal;

    const expFactor = Math.pow(2, exposure / 50);
    r *= expFactor;
    g *= expFactor;
    b *= expFactor;

    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;

    // Tone Mapping (Highlights, Shadows, Whites, Blacks)
    // Normalize to 0-1 for easier calculation
    let rN = r / 255;
    let gN = g / 255;
    let bN = b / 255;

    const applyTone = (val) => {
      // Blacks & Whites (Linear Stretch)
      // Blacks: -100 to 100. If < 0, clip blacks. If > 0, lift blacks.
      // Whites: -100 to 100. If < 0, dim whites. If > 0, clip whites.
      // Simple approach: Map [blackPoint, whitePoint] to [0, 1]
      const blackPoint = -blacks * 0.002; // +/- 0.2
      const whitePoint = 1 - whites * 0.002; // +/- 0.2
      
      // Avoid division by zero
      if (whitePoint !== blackPoint) {
        val = (val - blackPoint) / (whitePoint - blackPoint);
      }

      // Shadows & Highlights (Curve Shaping)
      // Shadows: Boost darks (0-0.5)
      if (shadows !== 0) {
        const sFactor = shadows * 0.005; // Strength
        // Simple quadratic boost for shadows: val + s * (1-val)^2 * val
        // Or Luma mask: (1-val)^2
        val += sFactor * Math.pow(1 - val, 2) * val * 4; 
      }

      // Highlights: Recover brights (0.5-1)
      if (highlights !== 0) {
        const hFactor = highlights * 0.005;
        // Simple quadratic cut for highlights: val - h * val^2 * (1-val)
        // Or Luma mask: val^2
        // Note: highlights slider usually recovers (negative value dims highlights)
        // If highlights > 0, we want to push highlights up? No, usually "Highlights" slider recovers detail (negative) or boosts (positive).
        // Let's assume standard behavior: +Highlights boosts brights, -Highlights recovers (dims) brights.
        val += hFactor * Math.pow(val, 2) * (1 - val) * 4;
      }
      
      return val;
    };

    rN = applyTone(rN);
    gN = applyTone(gN);
    bN = applyTone(bN);

    r = rN * 255;
    g = gN * 255;
    b = bN * 255;

    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));

    setPickedColor({ r, g, b });
    setIsPicking(false); // Auto-exit picker mode after pick
  };

  // Monotone Cubic Spline Interpolation
  const createSpline = (xs, ys) => {
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
  const getCurveLUT = (points) => {
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

  // Generate Tone Mapping LUT (Exposure, Contrast, H/S/B/W)
  const getToneLUT = () => {
    const lut = new Uint8Array(256);
    const expFactor = Math.pow(2, exposure / 50);
    const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    
    const blackPoint = -blacks * 0.002; 
    const whitePoint = 1 - whites * 0.002;
    const sFactor = shadows * 0.005;
    const hFactor = highlights * 0.005;

    for (let i = 0; i < 256; i++) {
      let val = i / 255;

      // 1. Exposure
      val *= expFactor;

      // 2. Contrast
      val = (val - 0.5) * contrastFactor + 0.5;

      // 3. Blacks & Whites
      if (whitePoint !== blackPoint) {
        val = (val - blackPoint) / (whitePoint - blackPoint);
      }

      // 4. Shadows
      if (shadows !== 0) {
        val += sFactor * Math.pow(1 - val, 2) * val * 4;
      }

      // 5. Highlights
      if (highlights !== 0) {
        val += hFactor * Math.pow(val, 2) * (1 - val) * 4;
      }

      lut[i] = Math.min(255, Math.max(0, Math.round(val * 255)));
    }
    return lut;
  };

  const processImage = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Resize canvas to match image (or limit size for performance)
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    
    // Calculate rotated dimensions
    const totalRotation = rotation + orientation;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    if (isCropping) {
      // Show full rotated image for cropping
      canvas.width = rotatedW;
      canvas.height = rotatedH;
      
      ctx.save();
      ctx.translate(rotatedW / 2, rotatedH / 2);
      ctx.rotate(rad);
      ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
      ctx.restore();
    } else {
      // Show cropped image
      const cropX = cropRect.x * rotatedW;
      const cropY = cropRect.y * rotatedH;
      const cropW = cropRect.w * rotatedW;
      const cropH = cropRect.h * rotatedH;

      // Ensure valid dimensions
      canvas.width = Math.max(1, cropW);
      canvas.height = Math.max(1, cropH);

      ctx.save();
      // Translate so that (cropX, cropY) is at (0,0)
      ctx.translate(-cropX, -cropY);
      // Standard rotation draw
      ctx.translate(rotatedW / 2, rotatedH / 2);
      ctx.rotate(rad);
      ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
      ctx.restore();
    }
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Pre-calculate lookup tables
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    // Temp/Tint adjustments (clamped gains)
    const [rBal, gBal, bBal] = computeWBGains({ red, green, blue, temp, tint });

    // Histogram buckets
    const histRGB = new Array(256).fill(0);
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    let maxCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      // Skip transparent pixels (from rotation)
      if (data[i+3] === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // 1. Invert (if enabled)
      if (inverted) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }

      // 2. Color Balance (White Balance)
      r *= rBal;
      g *= gBal;
      b *= bBal;

      // Clamp before LUT
      let rC = Math.min(255, Math.max(0, r));
      let gC = Math.min(255, Math.max(0, g));
      let bC = Math.min(255, Math.max(0, b));

      // 3. Tone Mapping (Exposure, Contrast, H/S/B/W) via LUT
      rC = toneLUT[Math.floor(rC)];
      gC = toneLUT[Math.floor(gC)];
      bC = toneLUT[Math.floor(bC)];
      
      // 4. Curves (Apply RGB LUT first, then Channel LUTs)
      rC = lutRGB[rC];
      gC = lutRGB[gC];
      bC = lutRGB[bC];

      rC = lutR[rC];
      gC = lutG[gC];
      bC = lutB[bC];

      // 5. Loaded LUTs
      if (lut1) {
        const [lr, lg, lb] = sampleLUT(rC/255, gC/255, bC/255, lut1);
        rC = rC * (1 - lut1.intensity) + lr * 255 * lut1.intensity;
        gC = gC * (1 - lut1.intensity) + lg * 255 * lut1.intensity;
        bC = bC * (1 - lut1.intensity) + lb * 255 * lut1.intensity;
      }
      if (lut2) {
        const [lr, lg, lb] = sampleLUT(rC/255, gC/255, bC/255, lut2);
        rC = rC * (1 - lut2.intensity) + lr * 255 * lut2.intensity;
        gC = gC * (1 - lut2.intensity) + lg * 255 * lut2.intensity;
        bC = bC * (1 - lut2.intensity) + lb * 255 * lut2.intensity;
      }

      // Clamp after LUTs
      rC = Math.min(255, Math.max(0, rC));
      gC = Math.min(255, Math.max(0, gC));
      bC = Math.min(255, Math.max(0, bC));

      // Update Histograms
      histR[Math.round(rC)]++;
      histG[Math.round(gC)]++;
      histB[Math.round(bC)]++;
      
      // Calculate luminance for RGB histogram
      const lum = Math.round(0.299 * rC + 0.587 * gC + 0.114 * bC);
      histRGB[lum]++;
      
      // Track max for normalization (using RGB histogram max)
      if (histRGB[lum] > maxCount) maxCount = histRGB[lum];

      // Final Clamp
      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
    }

    // Normalize histograms
    if (maxCount > 0) {
      for(let i=0; i<256; i++) {
        histRGB[i] /= maxCount;
        histR[i] /= maxCount;
        histG[i] /= maxCount;
        histB[i] /= maxCount;
      }
    }
    setHistograms({ rgb: histRGB, red: histR, green: histG, blue: histB });

    ctx.putImageData(imageData, 0, 0);
  };

  const handleAutoColor = () => {
    if (!image || !canvasRef.current) return;
    pushToHistory();
    // Simple Grey World: Find average color and offset to neutral grey
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;
    
    // Sample every 10th pixel for speed
    for (let i = 0; i < data.length; i += 40) {
      let r = data[i];
      let g = data[i+1];
      let b = data[i+2];
      
      if (inverted) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
      
      rSum += r;
      gSum += g;
      bSum += b;
      count++;
    }
    
    const rAvg = rSum / count;
    const gAvg = gSum / count;
    const bAvg = bSum / count;
    
    // Target is average of averages (Grey)
    const avg = (rAvg + gAvg + bAvg) / 3;
    
    setRed(avg / rAvg);
    setGreen(avg / gAvg);
    setBlue(avg / bAvg);
    setTemp(0);
    setTint(0);
  };

  // Curve Editor Constants
  const curveWidth = 260;
  const curveHeight = 150;

  useEffect(() => {
    if (draggingPointIndex === null) return;

    const handleMouseMove = (e) => {
      if (!curveContainerRef.current) return;
      const rect = curveContainerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Invert Y because canvas 0 is top
      const valY = 255 - (y / curveHeight) * 255;
      const valX = (x / curveWidth) * 255;

      setCurves(prevCurves => {
        const currentPoints = prevCurves[activeChannel];
        const newPoints = [...currentPoints];
        const index = draggingPointIndex;
        
        // Constrain X to be between neighbors (unless endpoint)
        let minX = 0, maxX = 255;
        if (index > 0) minX = newPoints[index-1].x + 1;
        if (index < newPoints.length - 1) maxX = newPoints[index+1].x - 1;
        
        // Endpoints have fixed X
        if (index === 0) {
          newPoints[index] = { x: 0, y: Math.min(255, Math.max(0, valY)) };
        } else if (index === newPoints.length - 1) {
          newPoints[index] = { x: 255, y: Math.min(255, Math.max(0, valY)) };
        } else {
          // Middle points can move in X and Y
          newPoints[index] = { 
            x: Math.min(maxX, Math.max(minX, valX)), 
            y: Math.min(255, Math.max(0, valY)) 
          };
        }
        return { ...prevCurves, [activeChannel]: newPoints };
      });
    };

    const handleMouseUp = () => {
      setDraggingPointIndex(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingPointIndex, activeChannel]);

  const handleAddPoint = (e) => {
    // Only add if clicking on background (not dragging a point)
    if (e.target !== curveContainerRef.current && e.target.tagName !== 'svg') return; 
    
    pushToHistory();

    const rect = curveContainerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / curveWidth * 255;
    const y = 255 - (e.clientY - rect.top) / curveHeight * 255;
    
    const newPoint = { x, y };
    const currentPoints = curves[activeChannel];
    const newPoints = [...currentPoints, newPoint].sort((a, b) => a.x - b.x);
    setCurves(prev => ({ ...prev, [activeChannel]: newPoints }));
  };

  const handleRemovePoint = (index, e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const currentPoints = curves[activeChannel];
    // Don't remove endpoints
    if (index === 0 || index === currentPoints.length - 1) return;
    
    pushToHistory();

    const newPoints = currentPoints.filter((_, i) => i !== index);
    setCurves(prev => ({ ...prev, [activeChannel]: newPoints }));
  };

  // Generate path string using spline
  const getCurvePath = () => {
    const currentPoints = curves[activeChannel];
    const sortedPoints = [...currentPoints].sort((a, b) => a.x - b.x);
    let d = '';
    if (sortedPoints.length >= 2) {
      const xs = sortedPoints.map(p => p.x);
      const ys = sortedPoints.map(p => p.y);
      const spline = createSpline(xs, ys);
      
      d = `M 0 ${curveHeight - (spline(0) / 255) * curveHeight}`;
      for (let i = 1; i <= curveWidth; i++) {
        const xVal = (i / curveWidth) * 255;
        const yVal = spline(xVal);
        const y = curveHeight - (yVal / 255) * curveHeight;
        d += ` L ${i} ${y}`;
      }
    } else {
      d = `M 0 ${curveHeight} L ${curveWidth} 0`;
    }
    return d;
  };

  // Generate Histogram Path
  const getHistogramPath = () => {
    const currentHist = histograms[activeChannel];
    let histD = `M 0 ${curveHeight}`;
    for (let i = 0; i < 256; i++) {
      const h = currentHist[i] * curveHeight; // Normalized 0-1
      const x = (i / 255) * curveWidth;
      const y = curveHeight - h;
      histD += ` L ${x} ${y}`;
    }
    histD += ` L ${curveWidth} ${curveHeight} Z`;
    return histD;
  };

  const getCurveColor = () => {
    switch(activeChannel) {
      case 'red': return '#ff4444';
      case 'green': return '#44ff44';
      case 'blue': return '#4444ff';
      default: return '#eee';
    }
  };

  const getHistogramColor = () => {
    switch(activeChannel) {
      case 'red': return 'rgba(255, 68, 68, 0.3)';
      case 'green': return 'rgba(68, 255, 68, 0.3)';
      case 'blue': return 'rgba(68, 68, 255, 0.3)';
      default: return 'rgba(200, 200, 200, 0.3)';
    }
  };

  // Crop Interaction
  const [cropDragAction, setCropDragAction] = useState(null);

  useEffect(() => {
    if (!cropDragAction) return;

    const handleWindowMove = (e) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      // Current mouse pos in normalized coords
      const mx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const my = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      
      setCropRect(prev => {
        let { x, y, w, h } = prev;
        const { type, handle, startRect, startMx, startMy } = cropDragAction;
        const dx = mx - startMx;
        const dy = my - startMy;

        if (type === 'move') {
          x = Math.max(0, Math.min(1 - w, startRect.x + dx));
          y = Math.max(0, Math.min(1 - h, startRect.y + dy));
        } else if (type === 'resize') {
          if (handle.includes('e')) w = Math.max(0.05, startRect.w + dx);
          if (handle.includes('s')) h = Math.max(0.05, startRect.h + dy);
          if (handle.includes('w')) {
            const newW = Math.max(0.05, startRect.w - dx);
            x = startRect.x + (startRect.w - newW);
            w = newW;
          }
          if (handle.includes('n')) {
            const newH = Math.max(0.05, startRect.h - dy);
            y = startRect.y + (startRect.h - newH);
            h = newH;
          }
        }
        
        if (keepRatio && type === 'resize' && image) {
           // Calculate rotated dimensions to determine correct aspect ratio in normalized space
           const rad = (rotation * Math.PI) / 180;
           const sin = Math.abs(Math.sin(rad));
           const cos = Math.abs(Math.cos(rad));
           const rotW = image.width * cos + image.height * sin;
           const rotH = image.width * sin + image.height * cos;
           
           // Determine target ratio (flip if rotated sideways)
           let targetRatio = image.width / image.height;
           const isRotatedSideways = (Math.abs(rotation) % 180) > 45 && (Math.abs(rotation) % 180) < 135;
           if (isRotatedSideways) {
             targetRatio = 1 / targetRatio;
           }

           // Calculate the factor to convert normalized width to normalized height
           // h_norm = w_norm * (rotW / (rotH * targetRatio))
           const ratioFactor = rotW / (rotH * targetRatio);

           // Drive Height from Width for all corner handles
           h = w * ratioFactor;

           // If dragging North, we need to adjust Y because H changed to maintain bottom anchor
           if (handle.includes('n')) {
              y = (startRect.y + startRect.h) - h;
           }
        }

        return { x, y, w, h };
      });
    };

    const handleWindowUp = () => {
      setCropDragAction(null);
      pushToHistory();
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  }, [cropDragAction, keepRatio, image, rotation]);

  // Pan Interaction
  useEffect(() => {
    if (!isPanning) return;

    const handleWindowMove = (e) => {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    };

    const handleWindowUp = () => {
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleWindowMove);
    window.addEventListener('mouseup', handleWindowUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMove);
      window.removeEventListener('mouseup', handleWindowUp);
    };
  }, [isPanning, panStart]);

  const startCropDrag = (e, type, handle) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    
    setCropDragAction({
      type,
      handle,
      startRect: { ...cropRect },
      startMx: mx,
      startMy: my
    });
  };

  const handleWheel = (e) => {
    // Only zoom if hovering over canvas area
    if (e.target.closest('.iv-sidebar')) return;
    
    const scaleBy = 1.1;
    const newZoom = e.deltaY < 0 ? zoom * scaleBy : zoom / scaleBy;
    setZoom(Math.min(Math.max(0.1, newZoom), 10));
  };

  const handlePanStart = (e) => {
    // Don't pan if clicking on controls or crop handles (handled by stopPropagation)
    if (e.button !== 0) return; // Only left click
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const prevRotationRef = useRef(rotation);

  // Auto-crop on rotation
  useEffect(() => {
    if (!image) return;

    const oldRot = prevRotationRef.current;
    const newRot = rotation;
    prevRotationRef.current = rotation;

    // Helper to get bounding box dimensions
    const getBB = (deg) => {
      const isSideways = (Math.abs(orientation) % 180) === 90;
      const effectiveW = isSideways ? image.height : image.width;
      const effectiveH = isSideways ? image.width : image.height;

      const rad = (deg * Math.PI) / 180;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      return {
        w: effectiveW * cos + effectiveH * sin,
        h: effectiveW * sin + effectiveH * cos
      };
    };

    const oldBB = getBB(oldRot);
    const newBB = getBB(newRot);

    // Calculate max inscribed rectangle for NEW rotation (Safe Zone)
    const isSideways = (Math.abs(orientation) % 180) === 90;
    const W = isSideways ? image.height : image.width;
    const H = isSideways ? image.width : image.height;
    
    const Wbb = newBB.w;
    const Hbb = newBB.h;

    const h1 = (W * H) / Wbb;
    const h2 = (H * H) / Hbb;
    const h_crop = Math.min(h1, h2);
    const w_crop = h_crop * (W / H); // Max inscribed width in pixels

    setCropRect(prev => {
      // 1. Current crop size in pixels (based on OLD bounding box)
      const currentW_px = prev.w * oldBB.w;
      const currentH_px = prev.h * oldBB.h;

      // 2. Current center offset from image center in pixels
      // We want to preserve the crop's position relative to the center of rotation
      const centerX_px = (prev.x + prev.w / 2 - 0.5) * oldBB.w;
      const centerY_px = (prev.y + prev.h / 2 - 0.5) * oldBB.h;

      // 3. Determine scaling factor to fit in max inscribed
      // We only shrink if necessary. We don't grow.
      const scaleW = w_crop / currentW_px;
      const scaleH = h_crop / currentH_px;
      const scale = Math.min(1, scaleW, scaleH);
      
      const newW_px = currentW_px * scale;
      const newH_px = currentH_px * scale;
      
      const newNormW = newW_px / newBB.w;
      const newNormH = newH_px / newBB.h;
      
      // 4. Calculate new center in normalized coords (preserving pixel offset from center)
      const newCenterX = 0.5 + (centerX_px / newBB.w);
      const newCenterY = 0.5 + (centerY_px / newBB.h);

      // 5. Calculate new Top-Left
      let newX = newCenterX - newNormW / 2;
      let newY = newCenterY - newNormH / 2;

      // 6. Clamp to bounds [0, 1] to ensure we don't go outside the canvas
      newX = Math.max(0, Math.min(1 - newNormW, newX));
      newY = Math.max(0, Math.min(1 - newNormH, newY));
      
      return {
        x: newX,
        y: newY,
        w: newNormW,
        h: newNormH
      };
    });

  }, [rotation, image, orientation]);

  const handleLutUpload = (e, index) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const parsed = parseCubeLUT(text);
      const lutObj = { name: file.name, ...parsed, intensity: 1.0 };
      
      pushToHistory();
      if (index === 1) setLut1(lutObj);
      else setLut2(lutObj);
    };
    reader.readAsText(file);
  };

  const generateOutputLUT = () => {
    const size = 33;
    let content = `LUT_3D_SIZE ${size}\n`;
    
    // Get current 1D LUTs
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    const [rBal, gBal, bBal] = computeWBGains({ red, green, blue, temp, tint });

    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          // Original normalized color
          let rN = r / (size - 1);
          let gN = g / (size - 1);
          let bN = b / (size - 1);
          
          // Convert to 0-255
          let rC = rN * 255;
          let gC = gN * 255;
          let bC = bN * 255;
          
          // 1. Invert
          if (inverted) {
            rC = 255 - rC;
            gC = 255 - gC;
            bC = 255 - bC;
          }
          
          // 2. WB
          rC *= rBal;
          gC *= gBal;
          bC *= bBal;
          
          // Clamp
          rC = Math.min(255, Math.max(0, rC));
          gC = Math.min(255, Math.max(0, gC));
          bC = Math.min(255, Math.max(0, bC));
          
          // 3. Tone LUT
          rC = toneLUT[Math.floor(rC)];
          gC = toneLUT[Math.floor(gC)];
          bC = toneLUT[Math.floor(bC)];
          
          // 4. Curves
          rC = lutRGB[rC];
          gC = lutRGB[gC];
          bC = lutRGB[bC];

          rC = lutR[rC];
          gC = lutG[gC];
          bC = lutB[bC];
          
          // 5. Loaded LUTs
          if (lut1) {
             const [lr, lg, lb] = sampleLUT(rC/255, gC/255, bC/255, lut1);
             rC = rC * (1 - lut1.intensity) + lr * 255 * lut1.intensity;
             gC = gC * (1 - lut1.intensity) + lg * 255 * lut1.intensity;
             bC = bC * (1 - lut1.intensity) + lb * 255 * lut1.intensity;
          }
          if (lut2) {
             const [lr, lg, lb] = sampleLUT(rC/255, gC/255, bC/255, lut2);
             rC = rC * (1 - lut2.intensity) + lr * 255 * lut2.intensity;
             gC = gC * (1 - lut2.intensity) + lg * 255 * lut2.intensity;
             bC = bC * (1 - lut2.intensity) + lb * 255 * lut2.intensity;
          }
          
          // Output normalized
          content += `${(rC/255).toFixed(6)} ${(gC/255).toFixed(6)} ${(bC/255).toFixed(6)}\n`;
        }
      }
    }
    
    // Download
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'film-lab-export.cube';
    a.click();
  };

  const handleExportLUT = () => {
    pushToHistory();
    generateOutputLUT();
  };

  return (
    <div className="iv-overlay" style={{ background: 'rgba(10,10,10,0.98)', display: 'flex', flexDirection: 'row', color: '#eee' }}>
      <style>{`
        .iv-sidebar {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        .iv-control-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #888;
          font-weight: 600;
        }
        .iv-btn {
          background: #333;
          border: 1px solid #444;
          color: #eee;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
          font-weight: 500;
        }
        .iv-btn:hover {
          background: #444;
          border-color: #555;
        }
        .iv-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .iv-btn-primary {
          background: #2e7d32;
          border-color: #1b5e20;
          color: white;
        }
        .iv-btn-primary:hover {
          background: #388e3c;
        }
        .iv-btn-danger {
          background: #c62828;
          border-color: #b71c1c;
        }
        .iv-btn-danger:hover {
          background: #d32f2f;
        }
        .iv-btn-icon {
          background: transparent;
          border: none;
          color: #666;
          cursor: pointer;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          font-size: 14px;
          line-height: 1;
        }
        .iv-btn-icon:hover {
          background: #333;
          color: #fff;
        }
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]:focus {
          outline: none;
        }
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 12px;
          width: 12px;
          border-radius: 50%;
          background: #eee;
          cursor: pointer;
          margin-top: -4px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.5);
          border: 1px solid #000;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          background: #444;
          border-radius: 2px;
        }
        input[type=checkbox] {
          accent-color: #2e7d32;
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
        /* Scrollbar */
        .iv-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .iv-scroll::-webkit-scrollbar-track {
          background: #1a1a1a;
        }
        .iv-scroll::-webkit-scrollbar-thumb {
          background: #444;
          border-radius: 3px;
        }
        .iv-scroll::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
      `}</style>

      {/* Main Canvas Area */}
      <div 
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 20, background: '#000', cursor: isPanning ? 'grabbing' : 'grab', position: 'relative' }}
        onWheel={handleWheel}
        onMouseDown={handlePanStart}
      >
        {/* Zoom Controls */}
        <div style={{ position: 'absolute', bottom: 20, left: 20, display: 'flex', gap: 8, zIndex: 100 }}>
          <button className="iv-btn" onClick={() => { setZoom(1); setPan({x:0,y:0}); }}>Fit</button>
          <button className="iv-btn" onClick={() => setZoom(z => Math.max(0.1, z / 1.2))}>-</button>
          <span style={{ background: '#333', padding: '6px 10px', borderRadius: 4, fontSize: 12, minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
          <button className="iv-btn" onClick={() => setZoom(z => Math.min(10, z * 1.2))}>+</button>
        </div>

        {/* Sensitive Rotation Slider (Only when cropping) */}
        {isCropping && (
          <div style={{ position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 300, zIndex: 100, background: 'rgba(0,0,0,0.6)', padding: '8px 16px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>-45°</span>
            <input 
              type="range" 
              min={-45} 
              max={45} 
              step={0.1} 
              value={rotation} 
              onChange={e => setRotation(Number(e.target.value))}
              onMouseDown={pushToHistory}
              style={{ width: '100%', cursor: 'ew-resize' }}
            />
            <span style={{ fontSize: 10, color: '#aaa', whiteSpace: 'nowrap' }}>+45°</span>
            <div style={{ position: 'absolute', top: -25, left: '50%', transform: 'translateX(-50%)', background: '#333', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
              {rotation.toFixed(1)}°
            </div>
          </div>
        )}

        <div style={{ 
          position: 'relative', 
          display: 'inline-block', 
          boxShadow: '0 0 30px rgba(0,0,0,0.8)',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center',
          transition: isPanning ? 'none' : 'transform 0.1s ease-out'
        }}>
          <canvas 
            ref={canvasRef} 
            onClick={handleCanvasClick}
            style={{ 
              display: 'block', 
              maxWidth: '100%', 
              maxHeight: 'calc(100vh - 40px)', 
              objectFit: 'contain',
              cursor: isPicking ? 'crosshair' : 'default'
            }} 
          />
          {isCropping && (
            <div 
              className="crop-overlay"
              style={{
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                cursor: 'crosshair'
              }}
              onMouseDown={(e) => startCropDrag(e, 'new', null)}
            >
              {/* Darken outside */}
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: `${cropRect.y * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${(1 - (cropRect.y + cropRect.h)) * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
              <div style={{ position: 'absolute', top: `${cropRect.y * 100}%`, left: 0, width: `${cropRect.x * 100}%`, height: `${cropRect.h * 100}%`, background: 'rgba(0,0,0,0.5)' }} />
              <div style={{ position: 'absolute', top: `${cropRect.y * 100}%`, right: 0, width: `${(1 - (cropRect.x + cropRect.w)) * 100}%`, height: `${cropRect.h * 100}%`, background: 'rgba(0,0,0,0.5)' }} />

              {/* Crop Box */}
              <div 
                style={{
                  position: 'absolute',
                  left: `${cropRect.x * 100}%`,
                  top: `${cropRect.y * 100}%`,
                  width: `${cropRect.w * 100}%`,
                  height: `${cropRect.h * 100}%`,
                  border: '1px solid rgba(255,255,255,0.8)',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                  cursor: 'move'
                }}
                onMouseDown={(e) => startCropDrag(e, 'move', null)}
              >
                {/* Handles */}
                {['nw', 'ne', 'sw', 'se'].map(h => (
                  <div
                    key={h}
                    onMouseDown={(e) => startCropDrag(e, 'resize', h)}
                    style={{
                      position: 'absolute',
                      width: 10, height: 10,
                      background: '#fff',
                      border: '1px solid #000',
                      top: h.includes('n') ? -5 : undefined,
                      bottom: h.includes('s') ? -5 : undefined,
                      left: h.includes('w') ? -5 : undefined,
                      right: h.includes('e') ? -5 : undefined,
                      cursor: `${h}-resize`
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Controls Sidebar */}
      <div className="iv-sidebar iv-scroll" style={{ width: 320, background: '#1e1e1e', padding: 24, color: '#eee', display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto', borderLeft: '1px solid #333', boxShadow: '-5px 0 15px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: '#fff', fontSize: 18, fontWeight: 600, letterSpacing: 0.5 }}>Film Lab</h3>
          <button className="iv-btn-icon" onClick={onClose} style={{ fontSize: 20 }}>×</button>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#252525', padding: 10, borderRadius: 6 }}>
          <input 
            type="checkbox" 
            checked={inverted} 
            onChange={e => { pushToHistory(); setInverted(e.target.checked); }} 
            id="chk-invert"
          />
          <label htmlFor="chk-invert" style={{ fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>Invert Negative</label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="iv-btn" onClick={handleUndo} disabled={history.length === 0} style={{ flex: 1 }}>Undo</button>
          <button className="iv-btn" onClick={handleRedo} disabled={future.length === 0} style={{ flex: 1 }}>Redo</button>
          <button className="iv-btn iv-btn-danger" onClick={handleReset} style={{ flex: 1 }}>Reset</button>
        </div>

        <button className="iv-btn iv-btn-primary" onClick={handleAutoColor} style={{ padding: '10px 0', fontWeight: 600 }}>Auto Color Balance</button>

        <div style={{ borderTop: '1px solid #333', paddingTop: 20 }}>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
             <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>CROP & ROTATE</label>
             <button 
               className={`iv-btn ${isCropping ? 'iv-btn-primary' : ''}`}
               onClick={() => setIsCropping(!isCropping)}
               style={{ padding: '4px 12px', fontSize: 11 }}
             >
               {isCropping ? 'DONE' : 'CROP'}
             </button>
           </div>
           
           {isCropping && (
             <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', marginBottom: 8 }}>
                 <input type="checkbox" checked={keepRatio} onChange={e => setKeepRatio(e.target.checked)} />
                 Keep Original Ratio
               </label>
               <SliderControl 
                 label="ROTATION" 
                 value={rotation} 
                 min={-45} max={45} 
                 step={0.1}
                 onChange={setRotation} 
                 onMouseDown={pushToHistory}
                 suffix="°"
               />
             </div>
           )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="iv-btn" onClick={() => { pushToHistory(); setOrientation(r => r - 90); }} style={{ flex: 1, fontSize: 11 }}>↺ Rotate Left</button>
          <button className="iv-btn" onClick={() => { pushToHistory(); setOrientation(r => r + 90); }} style={{ flex: 1, fontSize: 11 }}>↻ Rotate Right</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SliderControl label="EXPOSURE" value={exposure} onChange={setExposure} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
          <SliderControl label="CONTRAST" value={contrast} onChange={setContrast} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SliderControl label="HIGHLIGHTS" value={highlights} onChange={setHighlights} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
          <SliderControl label="SHADOWS" value={shadows} onChange={setShadows} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
          <SliderControl label="WHITES" value={whites} onChange={setWhites} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
          <SliderControl label="BLACKS" value={blacks} onChange={setBlacks} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SliderControl label="TEMPERATURE" value={temp} onChange={setTemp} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
          <SliderControl label="TINT" value={tint} onChange={setTint} onMouseDown={pushToHistory} min={-100} max={100} step={1} />
        </div>

        {/* Curve Editor UI */}
        <div style={{ background: '#111', padding: 12, borderRadius: 6, border: '1px solid #333' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label className="iv-control-label">TONE CURVE</label>
            <button 
               className="iv-btn"
               onClick={() => setIsPicking(!isPicking)}
               style={{ 
                 background: isPicking ? '#2e7d32' : 'transparent', 
                 border: isPicking ? '1px solid #1b5e20' : '1px solid #444',
                 color: isPicking ? '#fff' : '#888', 
                 fontSize: 10, 
                 padding: '2px 8px', 
                 borderRadius: 3,
               }}
             >
               {isPicking ? 'PICKING...' : 'PICK POINT'}
             </button>
          </div>
          
          {/* Channel Tabs */}
          <div style={{ display: 'flex', marginBottom: 12, gap: 4, background: '#222', padding: 2, borderRadius: 4 }}>
            {['rgb', 'red', 'green', 'blue'].map(ch => (
              <button
                key={ch}
                onClick={() => setActiveChannel(ch)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  fontSize: 10,
                  fontWeight: 600,
                  background: activeChannel === ch ? '#444' : 'transparent',
                  color: ch === 'rgb' ? '#fff' : ch === 'red' ? '#ff8888' : ch === 'green' ? '#88ff88' : '#8888ff',
                  border: 'none',
                  borderRadius: 2,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {ch.toUpperCase()}
              </button>
            ))}
          </div>

          <div 
            ref={curveContainerRef}
            style={{ position: 'relative', width: '100%', height: 150, border: '1px solid #333', background: '#000', cursor: 'crosshair', borderRadius: 2 }}
            onMouseDown={handleAddPoint}
          >
            {/* Histogram Background */}
            <svg width="100%" height="100%" viewBox={`0 0 ${curveWidth} ${curveHeight}`} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              <path d={getHistogramPath()} fill={getHistogramColor()} stroke="none" />
            </svg>

            {/* Grid lines */}
            <div style={{ position: 'absolute', top: '25%', left: 0, right: 0, height: 1, background: '#222', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: '#222', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', top: '75%', left: 0, right: 0, height: 1, background: '#222', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '25%', top: 0, bottom: 0, width: 1, background: '#222', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: '#222', pointerEvents: 'none' }} />
            <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: 1, background: '#222', pointerEvents: 'none' }} />

            {/* Picked Color Indicator */}
            {pickedColor && (
              <svg width="100%" height="100%" viewBox={`0 0 ${curveWidth} ${curveHeight}`} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
                {activeChannel === 'rgb' ? (
                  <>
                    <line x1={pickedColor.r / 255 * curveWidth} y1={0} x2={pickedColor.r / 255 * curveWidth} y2={curveHeight} stroke="#ff4444" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
                    <line x1={pickedColor.g / 255 * curveWidth} y1={0} x2={pickedColor.g / 255 * curveWidth} y2={curveHeight} stroke="#44ff44" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
                    <line x1={pickedColor.b / 255 * curveWidth} y1={0} x2={pickedColor.b / 255 * curveWidth} y2={curveHeight} stroke="#4444ff" strokeWidth="1" strokeDasharray="3,3" opacity="0.7" />
                  </>
                ) : (
                  <line 
                    x1={pickedColor[activeChannel === 'red' ? 'r' : activeChannel === 'green' ? 'g' : 'b'] / 255 * curveWidth} 
                    y1={0} 
                    x2={pickedColor[activeChannel === 'red' ? 'r' : activeChannel === 'green' ? 'g' : 'b'] / 255 * curveWidth} 
                    y2={curveHeight} 
                    stroke={activeChannel === 'red' ? '#ff4444' : activeChannel === 'green' ? '#44ff44' : '#4444ff'} 
                    strokeWidth="1" 
                    strokeDasharray="3,3" 
                  />
                )}
              </svg>
            )}

            <svg width="100%" height="100%" viewBox={`0 0 ${curveWidth} ${curveHeight}`} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              <path d={getCurvePath()} stroke={getCurveColor()} strokeWidth="2" fill="none" />
            </svg>
            
            {/* Control Points */}
            {curves[activeChannel].map((p, i) => (
              <div
                key={i}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault(); // Prevent text selection
                  pushToHistory(); // Save state before dragging
                  setDraggingPointIndex(i);
                }}
                onContextMenu={(e) => handleRemovePoint(i, e)}
                title={i === 0 || i === curves[activeChannel].length - 1 ? "Endpoint" : "Right-click to remove"}
                style={{
                  position: 'absolute',
                  left: (p.x / 255) * 100 + '%',
                  top: (1 - p.y / 255) * 100 + '%',
                  width: 10,
                  height: 10,
                  marginLeft: -5,
                  marginTop: -5,
                  borderRadius: '50%',
                  background: '#fff',
                  border: `2px solid ${getCurveColor()}`,
                  cursor: 'move',
                  zIndex: 10,
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                }}
              />
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#555', marginTop: 6, textAlign: 'center' }}>
            Left-click to add/move • Right-click to remove
          </div>
        </div>

        {/* LUTs Section */}
        <div style={{ borderTop: '1px solid #333', paddingTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <label className="iv-control-label" style={{ fontSize: 12, color: '#eee' }}>LUTs</label>
            <button className="iv-btn" onClick={generateOutputLUT} style={{ fontSize: 10, padding: '2px 8px' }}>EXPORT LUT</button>
          </div>

          {/* LUT 1 */}
          <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>LUT 1</span>
              {!lut1 ? (
                <label className="iv-btn" style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                  LOAD
                  <input type="file" accept=".cube" style={{ display: 'none' }} onChange={(e) => handleLutUpload(e, 1)} />
                </label>
              ) : (
                <button className="iv-btn iv-btn-danger" onClick={() => { pushToHistory(); setLut1(null); }} style={{ fontSize: 10, padding: '2px 8px' }}>REMOVE</button>
              )}
            </div>
            {lut1 && (
              <>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lut1.name}</div>
                <SliderControl 
                  label="OPACITY" 
                  value={lut1.intensity} 
                  min={0} max={1} step={0.05} 
                  onChange={(v) => setLut1(prev => ({ ...prev, intensity: v }))} 
                  onMouseDown={pushToHistory}
                />
              </>
            )}
          </div>

          {/* LUT 2 */}
          <div style={{ marginBottom: 12, background: '#252525', padding: 8, borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa' }}>LUT 2</span>
              {!lut2 ? (
                <label className="iv-btn" style={{ fontSize: 10, padding: '2px 8px', cursor: 'pointer' }}>
                  LOAD
                  <input type="file" accept=".cube" style={{ display: 'none' }} onChange={(e) => handleLutUpload(e, 2)} />
                </label>
              ) : (
                <button className="iv-btn iv-btn-danger" onClick={() => { pushToHistory(); setLut2(null); }} style={{ fontSize: 10, padding: '2px 8px' }}>REMOVE</button>
              )}
            </div>
            {lut2 && (
              <>
                <div style={{ fontSize: 10, color: '#888', marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lut2.name}</div>
                <SliderControl 
                  label="OPACITY" 
                  value={lut2.intensity} 
                  min={0} max={1} step={0.05} 
                  onChange={(v) => setLut2(prev => ({ ...prev, intensity: v }))} 
                  onMouseDown={pushToHistory}
                />
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 20, borderTop: '1px solid #333', display: 'flex', gap: 10 }}>
          <button className="iv-btn" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button className="iv-btn iv-btn-primary" onClick={() => alert('Save not implemented yet')} style={{ flex: 1 }}>Save Copy</button>
        </div>
      </div>
      
      <style>{`
        .control-group { display: flex; flexDirection: column; gap: 4px; }
        .control-group label { font-size: 12px; color: #aaa; }
        .control-group input[type=range] { width: 100%; cursor: pointer; }
        .btn-icon {
          background: #444;
          color: #fff;
          border: none;
          width: 24px;
          height: 24px;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          line-height: 1;
        }
        .btn-icon:hover {
          background: #555;
        }
      `}</style>
    </div>
  );
}
