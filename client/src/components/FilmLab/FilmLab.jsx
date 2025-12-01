import React, { useEffect, useRef, useState } from 'react';
import { setRollPreset, listPresets, createPreset, updatePreset, deletePreset as deletePresetApi, filmlabPreview, renderPositive, exportPositive } from '../../api';
import { getCurveLUT, parseCubeLUT, sampleLUT, getMaxSafeRect, getPresetRatio, getExifOrientation } from './utils';
import FilmLabControls from './FilmLabControls';
import FilmLabCanvas from './FilmLabCanvas';
import { isWebGLAvailable, processImageWebGL } from './FilmLabWebGL';

// Calculate the maximum inscribed rectangle (no black corners) after rotation






const buildCombinedLUT = (a, b) => {
  const base = a || b;
  if (!base) return null;
  const size = base.size;
  const total = size * size * size;
  const out = new Float32Array(total * 3);
  const aData = a ? a.data : null; const aInt = a ? a.intensity : 0;
  const bData = b ? b.data : null; const bInt = b ? b.intensity : 0;
  for (let i = 0, j = 0; i < total; i++, j += 3) {
    // Original color before LUT (identity grid)
    // Reconstruct original normalized RGB from index
    const rIdx = i % size;
    const gIdx = Math.floor(i / size) % size;
    const bIdx = Math.floor(i / (size * size));
    const r0 = rIdx / (size - 1);
    const g0 = gIdx / (size - 1);
    const b0 = bIdx / (size - 1);
    let r = r0, g = g0, b_ = b0;
    if (aData && aInt > 0) {
      const ar = aData[j]; const ag = aData[j+1]; const ab = aData[j+2];
      r = r * (1 - aInt) + ar * aInt;
      g = g * (1 - aInt) + ag * aInt;
      b_ = b_ * (1 - aInt) + ab * aInt;
    }
    if (bData && bInt > 0) {
      const br = bData[j]; const bg = bData[j+1]; const bb = bData[j+2];
      r = r * (1 - bInt) + br * bInt;
      g = g * (1 - bInt) + bg * bInt;
      b_ = b_ * (1 - bInt) + bb * bInt;
    }
    out[j] = r; out[j+1] = g; out[j+2] = b_;
  }
  return { size, data: out };
};

export default function FilmLab({ imageUrl, onClose, onSave, rollId, photoId, onPhotoUpdate }) {
  const canvasRef = useRef(null);
  const origCanvasRef = useRef(null); // Original (unprocessed) canvas for compare mode
  const [image, setImage] = useState(null);
  
  // Parameters
  const [inverted, setInverted] = useState(false); // Default to false as requested
  const [inversionMode, setInversionMode] = useState('linear'); // 'linear' | 'log'
  const [isPicking, setIsPicking] = useState(false);
  const [isPickingBase, setIsPickingBase] = useState(false);
  const [isPickingWB, setIsPickingWB] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);
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
  const [isRotating, setIsRotating] = useState(false);
  const committedRotationRef = useRef(0); // the rotation used for drawing while dragging

  // Crop
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState({ x: 0, y: 0, w: 1, h: 1 }); // Normalized 0-1
  const [committedCrop, setCommittedCrop] = useState({ x: 0, y: 0, w: 1, h: 1 }); // Applied crop (only updated on DONE)
  // Ratio presets: 'free' | 'original' | '1:1' | '3:2' | '4:3' | '16:9'
  const [ratioMode, setRatioMode] = useState('free');
  const [ratioSwap, setRatioSwap] = useState(false); // Lightroom-like X to flip orientation
  const isManualCropRef = useRef(false); // Track if user has manually adjusted crop
  const hasPannedRef = useRef(false); // Track if a pan operation occurred to prevent click events

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

  const [histograms, setHistograms] = useState({
    rgb: new Array(256).fill(0),
    red: new Array(256).fill(0),
    green: new Array(256).fill(0),
    blue: new Array(256).fill(0)
  });
  
  // LUTs
  const [lut1, setLut1] = useState(null); // { name, data, size, intensity: 1.0 }
  const [lut2, setLut2] = useState(null);
  const [lutExportSize, setLutExportSize] = useState(33); // 33 or 65
  const [useGPU, setUseGPU] = useState(isWebGLAvailable());
  const [remoteImg, setRemoteImg] = useState(null);
  const remoteUrlRef = useRef(null);

  // Compare Mode
  // compareMode: 'off' | 'original' | 'split'
  const [compareMode, setCompareMode] = useState('off');
  const [compareSlider, setCompareSlider] = useState(0.5); // 0-1 split position for 'split' mode

  // Presets (stored in backend DB, mirrored to local state)
  const [presets, setPresets] = useState([]); // [{ id?, name, params: { ... } }]
  const processRafRef = useRef(null);
  const [hqBusy, setHqBusy] = useState(false);
  const [gpuBusy, setGpuBusy] = useState(false);
  // Format for Save As (non-destructive local download)
  const [saveAsFormat, setSaveAsFormat] = useState('jpeg'); // 'jpeg' | 'tiff16' | 'both'
  
  // Fix for browser auto-rotation (EXIF) vs Server raw orientation mismatch
  const [rotationOffset, setRotationOffset] = useState(0);

  // Optimization: Cache WebGL output
  const processedCanvasRef = useRef(null);
  const lastWebglParamsRef = useRef(null);

  const webglParams = React.useMemo(() => {
      const rBal = red + (temp / 200) + (tint / 200);
      const gBal = green + (temp / 200) - (tint / 200);
      const bBal = blue - (temp / 200);
      const gains = [rBal, gBal, bBal];
      return {
          inverted, inversionMode, gains, exposure, contrast, highlights, shadows, whites, blacks,
          curves, lut1, lut2
      };
  }, [inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, lut1, lut2]);

  // Pre-calculate geometry for canvas sizing and crop overlay sync
  const geometry = React.useMemo(() => {
    if (!image) return null;
    const maxWidth = 1000;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation + rotationOffset;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;
    return { rotatedW, rotatedH, scale, rad, scaledW, scaledH };
  }, [image, rotation, orientation, rotationOffset]);

  // Load presets from backend on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await listPresets();
        if (res && Array.isArray(res.presets)) {
          // Normalize shape: keep id, name, params
          setPresets(res.presets.map(p => ({ id: p.id, name: p.name, params: p.params })));
        }
      } catch (e) {
        console.warn('Failed to load presets from backend', e);
        // Fallback: try localStorage if backend unreachable
        try {
          const raw = localStorage.getItem('filmLabPresets');
          if (raw) setPresets(JSON.parse(raw));
        } catch (e2) {
          console.warn('Failed to load presets from localStorage', e2);
        }
      }
    })();
  }, []);

  // Keep localStorage as a lightweight cache/backup
  const persistPresets = (next) => {
    setPresets(next);
    try { localStorage.setItem('filmLabPresets', JSON.stringify(next)); } catch(e){ console.warn('Persist presets failed', e); }
  };

  const savePreset = async (name) => {
    if (!name) return;
    const params = {
      inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks,
      temp, tint, red, green, blue, curves: JSON.parse(JSON.stringify(curves))
    };

    const existing = presets.find(p => p.name === name);
    try {
      if (existing && existing.id) {
        await updatePreset(existing.id, { name, category: 'filmlab', description: '', params });
        const next = presets.map(p => p.name === name ? { ...p, params } : p);
        persistPresets(next);
      } else {
        const created = await createPreset({ name, category: 'filmlab', description: '', params });
        const withId = existing && existing.id ? presets : presets.filter(p => p.name !== name);
        const next = [...withId, { id: created.id, name, params }];
        persistPresets(next);
      }
    } catch (e) {
      console.error('Failed to save preset to backend, falling back to local only', e);
      const exists = presets.some(p => p.name === name);
      let next;
      if (exists) {
        next = presets.map(p => p.name === name ? { ...p, params } : p);
      } else {
        next = [...presets, { name, params }];
      }
      persistPresets(next);
    }
  };

  // Cleanup object URL on unmount
  useEffect(() => () => { if (remoteUrlRef.current) { URL.revokeObjectURL(remoteUrlRef.current); remoteUrlRef.current = null; } }, []);

  const applyPreset = (preset) => {
    if (!preset) return;
    const { params } = preset;
    pushToHistory();
    setInverted(params.inverted);
    setInversionMode(params.inversionMode);
    setExposure(params.exposure);
    setContrast(params.contrast);
    setHighlights(params.highlights);
    setShadows(params.shadows);
    setWhites(params.whites);
    setBlacks(params.blacks);
    setTemp(params.temp);
    setTint(params.tint);
    setRed(params.red);
    setGreen(params.green);
    setBlue(params.blue);
    setCurves(JSON.parse(JSON.stringify(params.curves)));
  };

  const deletePreset = async (name) => {
    const target = presets.find(p => p.name === name);
    if (target && target.id) {
      try {
        await deletePresetApi(target.id);
      } catch (e) {
        console.warn('Failed to delete preset in backend, still removing locally', e);
      }
    }
    persistPresets(presets.filter(p => p.name !== name));
  };

  // Placeholder for applying preset to entire roll (requires parent context)
  const applyPresetToRoll = async (preset) => {
    if (!preset) return;
    if (!rollId) {
      applyPreset(preset);
      if (typeof window !== 'undefined') alert('未提供 rollId，已仅对当前图像应用预设。');
      return;
    }
    try {
      const res = await setRollPreset(rollId, { name: preset.name, params: preset.params });
      applyPreset(preset);
      if (res && res.ok && typeof window !== 'undefined') {
        alert(`预设 "${preset.name}" 已保存到整卷（roll ${rollId}）。后续可在访问该卷时默认加载。`);
      }
    } catch (e) {
      console.error('Set roll preset failed', e);
      if (typeof window !== 'undefined') alert('保存整卷预设失败: ' + e.message);
    }
  };

  // History
  const [history, setHistory] = useState([]);
  const [future, setFuture] = useState([]);

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
    isManualCropRef.current = false; // Reset manual crop flag
    setInverted(false); // Reset to false
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
    setImage(null);
    
    // Check if URL is likely a TIFF (unsupported by browser Image)
    // We check extension or if the URL implies a TIFF source
    const isTiff = imageUrl.toLowerCase().match(/\.tiff?$/) || imageUrl.toLowerCase().includes('format=tiff');
    
    if (isTiff && photoId) {
        // Load proxy via API
        let active = true;
        (async () => {
            try {
                // Request a "flat" preview (no params) to serve as the base image
                // We use a reasonably large size for the editor base
                const res = await filmlabPreview({ photoId, params: {}, maxWidth: 2000 });
                if (active && res.ok) {
                    const url = URL.createObjectURL(res.blob);
                    const img = new Image();
                    img.onload = () => { if (active) setImage(img); };
                    img.src = url;
                    // Proxy is stripped of EXIF, so no browser auto-rotation to compensate
                    setRotationOffset(0);
                } else if (active) {
                    console.warn('Failed to load TIFF proxy', res.error);
                }
            } catch (e) {
                if (active) console.error('Failed to load TIFF proxy', e);
            }
        })();
        return () => { active = false; };
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
    };

    // Fetch and parse EXIF to detect browser auto-rotation
    fetch(imageUrl)
      .then(res => res.arrayBuffer())
      .then(buffer => {
         // Check if TIFF (II or MM)
         const view = new DataView(buffer);
         const isTiffHeader = (view.byteLength >= 2) && (view.getUint16(0, false) === 0x4949 || view.getUint16(0, false) === 0x4D4D);

         const orientation = getExifOrientation(buffer);
         
         // If TIFF, assume browser does NOT auto-rotate (Chromium behavior).
         // So we do NOT need to compensate for browser rotation.
         if (isTiffHeader) {
             setRotationOffset(0);
             return;
         }

         // Map EXIF orientation to degrees needed to UN-rotate (or compensate)
         // Browser rotates by:
         // 6 -> 90 CW
         // 3 -> 180
         // 8 -> 270 CW (-90)
         // We want to subtract this rotation.
         let offset = 0;
         if (orientation === 6) offset = -90;
         else if (orientation === 3) offset = -180;
         else if (orientation === 8) offset = -270; // or 90
         setRotationOffset(offset);
      })
      .catch(e => console.warn('Failed to parse EXIF', e));
  }, [imageUrl, photoId]);

  useEffect(() => {
    if (!canvasRef.current) return;
    // Prefer remote preview pipeline
    if (processRafRef.current) cancelAnimationFrame(processRafRef.current);
    processRafRef.current = requestAnimationFrame(() => { processImage(); });
    return () => { if (processRafRef.current) { cancelAnimationFrame(processRafRef.current); processRafRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteImg, inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, curves, rotation, orientation, isCropping, isRotating, lut1, lut2]);

  // Render original (unprocessed) image for compare modes when geometry changes or image loads
  useEffect(() => {
    if (!image || !origCanvasRef.current) return;
    if (compareMode === 'off') return;
    renderOriginal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, rotation, orientation, isCropping, compareMode]);

  // Consolidated Crop/Rotation Logic (Rewrite)
  useEffect(() => {
    if (!image) return;
    if (!isCropping) return;
    
    // Determine the natural aspect ratio of the rotated image to guide the safe rect calculation.
    // If rotated 90/270, the "safe" area should be portrait-oriented (if original was landscape).
    // We use the rotated bounding box aspect ratio as a proxy for the "visual" aspect ratio.
    const totalRot = rotation + orientation;
    const rad = (totalRot * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const rotW = image.width * cos + image.height * sin;
    const rotH = image.width * sin + image.height * cos;
    const boxRatio = (rotH > 0) ? rotW / rotH : 1;

    // Pass boxRatio as the target aspect for the safe rect in "free" mode, 
    // so it doesn't try to fit a landscape safe-rect into a portrait rotated image.
    const safe = getMaxSafeRect(image.width, image.height, totalRot, boxRatio);
    const aspect = getPresetRatio(ratioMode, image, orientation, ratioSwap);
    
    setCropRect(prev => {
      // If free mode, just ensure we are inside safe area
      if (!aspect) {
         let w = Math.min(prev.w, safe.w);
         let h = Math.min(prev.h, safe.h);
         const cx = prev.x + prev.w / 2;
         const cy = prev.y + prev.h / 2;
         let x = Math.min(Math.max(cx - w / 2, safe.x), safe.x + safe.w - w);
         let y = Math.min(Math.max(cy - h / 2, safe.y), safe.y + safe.h - h);
         return { x, y, w, h };
      }

      // Ratio mode: fit exact ratio within safe area, preserving center
      // Adjust target aspect by box ratio because cropRect is in normalized coordinates
      const effectiveAspect = aspect / boxRatio;

      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      
      // Calculate max dimensions that fit in safe area with correct aspect
      // We want to fit 'effectiveAspect' into 'safe' rect.
      // safe is normalized.
      
      // Try fitting by width (constrained by safe.w)
      let w = safe.w;
      let h = w / effectiveAspect;
      
      // If height exceeds safe height, constrain by height
      if (h > safe.h) {
        h = safe.h;
        w = h * effectiveAspect;
      }
      
      // Now we have the MAXIMUM rect that fits.
      // But we might want to preserve the user's current zoom/crop size if possible?
      // If the user is just rotating, we don't want the crop to jump to full size.
      // But if the user just selected a new ratio, we probably want to maximize it?
      // The useEffect triggers on both.
      
      // Heuristic: If the previous crop was "close" to full size (or invalid aspect), reset to max.
      // If the previous crop was a small specific crop, try to maintain its area?
      
      // Let's try to maintain the 'scale' of the crop relative to the image.
      // Current scale = prev.w (normalized width).
      // We want new w to be close to prev.w, but constrained by aspect.
      
      let targetW = Math.min(prev.w, safe.w);
      let targetH = targetW / effectiveAspect;
      
      if (targetH > safe.h) {
         targetH = safe.h;
         targetW = targetH * effectiveAspect;
      }
      
      // Use the calculated target dimensions
      w = targetW;
      h = targetH;
      
      // Center and clamp
      let x = Math.min(Math.max(cx - w / 2, safe.x), safe.x + safe.w - w);
      let y = Math.min(Math.max(cy - h / 2, safe.y), safe.y + safe.h - h);
      
      return { x, y, w, h };
    });
  }, [isCropping, ratioMode, ratioSwap, rotation, orientation, image]);


  const handleCanvasClick = (e) => {
    if (hasPannedRef.current) return;
    if ((!isPicking && !isPickingBase && !isPickingWB) || !image || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvasRef.current.width / rect.width);
    const y = (e.clientY - rect.top) * (canvasRef.current.height / rect.height);

    const kernel = 7; // sample N x N neighborhood for robust WB
    const canvas = document.createElement('canvas');
    canvas.width = kernel;
    canvas.height = kernel;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Replicate processImage transforms
    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation;
    const rad = (totalRotation * Math.PI) / 180;
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
      const cr = committedCrop || { x:0, y:0, w:1, h:1 };
      const cropX = cr.x * rotatedW;
      const cropY = cr.y * rotatedH;
      
      ctx.translate(-cropX, -cropY);
      ctx.translate(rotatedW / 2, rotatedH / 2);
      ctx.rotate(rad);
      ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    }

    const imgData = ctx.getImageData(0, 0, kernel, kernel).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let ky = 0; ky < kernel; ky++) {
      for (let kx = 0; kx < kernel; kx++) {
        const idx = (ky * kernel + kx) * 4;
        const a = imgData[idx + 3];
        if (a === 0) continue;
        r += imgData[idx + 0];
        g += imgData[idx + 1];
        b += imgData[idx + 2];
        count++;
      }
    }
    if (count > 0) { r /= count; g /= count; b /= count; } else { r = g = b = 0; }

    if (isPickingBase) {
      // Film Base Sampler Logic
      // We want this color (r,g,b) to become White (255,255,255) in the negative space
      // So that when inverted, it becomes Black (0,0,0)
      // Gain = Target / Source
      // We use a safety clamp to avoid division by zero or extreme gains
      const safeR = Math.max(1, r);
      const safeG = Math.max(1, g);
      const safeB = Math.max(1, b);
      
      pushToHistory();
      setRed(255 / safeR);
      setGreen(255 / safeG);
      setBlue(255 / safeB);
      // Reset Temp/Tint as we are doing manual WB
      setTemp(0);
      setTint(0);
      
      setIsPickingBase(false);
      return;
    }

    if (isPickingWB) {
      // White Balance Picker Logic (after inversion, before curves/LUT)
      // Goal: make sampled color neutral grey by adjusting per-channel gains.
      // More stable than deriving temp/tint; avoids overshoot.

      // Apply inversion first (pre-curves pipeline)
      let rInv = r, gInv = g, bInv = b;
      if (inverted) {
        if (inversionMode === 'log') {
          rInv = 255 * (1 - Math.log(rInv + 1) / Math.log(256));
          gInv = 255 * (1 - Math.log(gInv + 1) / Math.log(256));
          bInv = 255 * (1 - Math.log(bInv + 1) / Math.log(256));
        } else {
          rInv = 255 - rInv;
          gInv = 255 - gInv;
          bInv = 255 - bInv;
        }
      }

      // Robust WB Calculation
      // 1. Clamp values to avoid division by zero or extreme gains on dark pixels
      // We use a small epsilon (e.g. 2.0/255) to prevent instability
      const safeR = Math.max(2.0, rInv);
      const safeG = Math.max(2.0, gInv);
      const safeB = Math.max(2.0, bInv);

      // 2. Calculate raw gains needed to neutralize color
      // We want safeR * kR = safeG * kG = safeB * kB = Constant
      let kR = 1 / safeR;
      let kG = 1 / safeG;
      let kB = 1 / safeB;
      
      // 3. Normalize gains so the average gain is 1.0 (preserves luminance)
      const avgGain = (kR + kG + kB) / 3;
      if (avgGain > 0) {
          kR /= avgGain;
          kG /= avgGain;
          kB /= avgGain;
      } else {
          kR = kG = kB = 1;
      }

      // 4. Calculate Temp/Tint to achieve these gains relative to current base
      // rBal = red + (temp/200) + (tint/200) = kR
      // gBal = green + (temp/200) - (tint/200) = kG
      // bBal = blue - (temp/200) = kB
      
      // From Blue: temp = (blue - kB) * 200
      const newTemp = (blue - kB) * 200;
      
      // From Red: tint = (kR - red - (newTemp/200)) * 200
      const newTint = (kR - red - (newTemp / 200)) * 200;
      
      // Adjust Green base to match exactly
      const newGreen = kG - (newTemp / 200) + (newTint / 200);

      pushToHistory();
      setTemp(Number(newTemp.toFixed(2)));
      setTint(Number(newTint.toFixed(2)));
      setGreen(newGreen);

      setIsPickingWB(false);
      return;
    }

    // Apply Pre-Curve Pipeline
    if (inverted) {
      if (inversionMode === 'log') {
        r = 255 * (1 - Math.log(r + 1) / Math.log(256));
        g = 255 * (1 - Math.log(g + 1) / Math.log(256));
        b = 255 * (1 - Math.log(b + 1) / Math.log(256));
      } else {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
    }

    const rBal = red + (temp / 200) + (tint / 200);
    const gBal = green + (temp / 200) - (tint / 200);
    const bBal = blue - (temp / 200);
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Nothing to render if neither preview nor base image is ready
    if (!remoteImg && !image) return;
    // If we have a server-rendered preview, just paint it and compute histogram
    // BUT: If we are cropping, we need the full raw image to draw the crop UI over, 
    // and the remoteImg might be cropped. So ignore remoteImg while cropping.
    if (remoteImg && !isCropping) {
      canvas.width = remoteImg.naturalWidth || remoteImg.width;
      canvas.height = remoteImg.naturalHeight || remoteImg.height;
      ctx.drawImage(remoteImg, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const histRGB = new Array(256).fill(0), histR = new Array(256).fill(0), histG = new Array(256).fill(0), histB = new Array(256).fill(0);
      let maxCount = 0;
      const stride = 2; const width = canvas.width; const height = canvas.height;
      for (let y = 0; y < height; y+=1) {
        for (let x = 0; x < width; x+=1) {
          if ((x % stride) || (y % stride)) continue;
          const idx = (y * width + x) * 4;
          const r = data[idx], g = data[idx+1], b = data[idx+2];
          histR[r]++; histG[g]++; histB[b]++;
          const lum = Math.round(0.299*r + 0.587*g + 0.114*b);
          histRGB[lum]++;
          maxCount = Math.max(maxCount, histR[r], histG[g], histB[b], histRGB[lum]);
        }
      }
      if (maxCount > 0) {
        for (let i=0;i<256;i++){ histRGB[i]/=maxCount; histR[i]/=maxCount; histG[i]/=maxCount; histB[i]/=maxCount; }
      }
      setHistograms({ rgb: histRGB, red: histR, green: histG, blue: histB });
      return;
    }
    // If GPU requested and available, try WebGL fast path (basic pipeline).
    // We still run the CPU path afterwards to keep histograms in sync.
    let webglSuccess = false;
    if (image && useGPU && isWebGLAvailable()) {
      try {
        const rBal = red + (temp / 200) + (tint / 200);
        const gBal = green + (temp / 200) - (tint / 200);
        const bBal = blue - (temp / 200);
        const gains = [rBal, gBal, bBal];

        // Build combined 3D LUT (if present) for GPU path (skip when intensities are zero)
        let combinedLUT = null;
        if ((lut1 && lut1.intensity > 0) || (lut2 && lut2.intensity > 0)) {
          combinedLUT = buildCombinedLUT(lut1, lut2);
        }
        
        // Create a separate WebGL canvas (cannot mix 2D and WebGL contexts)
        const webglCanvas = document.createElement('canvas');
        processImageWebGL(webglCanvas, image, {
          inverted,
          inversionMode,
          gains,
          exposure,
          contrast,
          highlights,
          shadows,
          whites,
          blacks,
          curves: {
            rgb: getCurveLUT(curves.rgb),
            red: getCurveLUT(curves.red),
            green: getCurveLUT(curves.green),
            blue: getCurveLUT(curves.blue)
          },
          lut3: combinedLUT
        });
        
        // Copy WebGL result to main 2D canvas first for visual speed,
        // but DO NOT return so CPU path can compute histograms.
        canvas.width = webglCanvas.width;
        canvas.height = webglCanvas.height;
        ctx.drawImage(webglCanvas, 0, 0);
        webglSuccess = true;
      } catch (err) {
        console.warn('WebGL processing failed, falling back to CPU pipeline', err);
      }
    }
    
    // Resize canvas to match image (or limit size for performance)
    // Downscale a bit and use histogram subsampling to improve realtime FPS.
    if (!image) return; // guard CPU path when image not loaded
    
    // If WebGL succeeded, we don't need to redraw the image on CPU.
    // But we DO need to compute histograms.
    // And we need to handle the rotation/crop transform for the canvas if WebGL didn't do it?
    // Wait, processImageWebGL returns the processed image (unrotated, uncropped).
    // The code below handles rotation and crop drawing.
    // If WebGL was used, 'canvas' now contains the processed image.
    // But the code below overwrites 'canvas' with 'ctx.drawImage(image...)' and then processes pixels.
    
    // We need to separate:
    // 1. Image Processing (Color/Tone) -> Result Image
    // 2. Display Transform (Rotate/Crop) -> Canvas
    
    // Current flow is mixed.
    // Let's refactor slightly for performance.
    
    if (!geometry) return;
    const { rotatedW, rotatedH, rad, scaledW, scaledH } = geometry;

    // In crop mode, show full rotated image. Outside crop mode, preview committed crop.
    let eff = { x: 0, y: 0, w: 1, h: 1 };
    if (!isCropping && committedCrop) {
      const crx = Math.max(0, Math.min(1, committedCrop.x || 0));
      const cry = Math.max(0, Math.min(1, committedCrop.y || 0));
      const crw = Math.max(0, Math.min(1 - crx, committedCrop.w || 1));
      const crh = Math.max(0, Math.min(1 - cry, committedCrop.h || 1));
      eff = { x: crx, y: cry, w: crw, h: crh };
    }

    const outW = Math.max(1, Math.round(rotatedW * eff.w));
    const outH = Math.max(1, Math.round(rotatedH * eff.h));
    canvas.width = outW;
    canvas.height = outH;

    const cropX = eff.x * rotatedW;
    const cropY = eff.y * rotatedH;

    ctx.save();
    // Shift so that crop area maps to (0,0)
    ctx.translate(-cropX, -cropY);
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    
    // Draw the source image. 
    // If WebGL was successful, we should draw the WebGL result instead of raw image?
    // But processImageWebGL returns unrotated image.
    // If we use WebGL result, we need to keep it somewhere.
    // The 'webglCanvas' above is local.
    // Re-running WebGL every frame is fast enough? Yes, usually.
    
    // Optimization:
    // If WebGL success:
    //   Draw WebGL canvas (processed) -> Main Canvas (transformed)
    //   Skip CPU pixel processing loop (just read pixels for histogram)
    // If CPU:
    //   Draw Raw Image -> Main Canvas (transformed)
    //   Run CPU pixel processing loop (modify pixels in place)
    
    let sourceForDraw = image;
    if (webglSuccess) {
       try {
          // Optimization: Reuse cached WebGL canvas if parameters haven't changed
          if (processedCanvasRef.current && lastWebglParamsRef.current === webglParams) {
             sourceForDraw = processedCanvasRef.current;
          } else {
              const webglCanvas = document.createElement('canvas');
              const { gains } = webglParams;
              
              let combinedLUT = null;
              if ((lut1 && lut1.intensity > 0) || (lut2 && lut2.intensity > 0)) {
                 combinedLUT = buildCombinedLUT(lut1, lut2);
              }
              
              processImageWebGL(webglCanvas, image, {
                 inverted, inversionMode, gains, exposure, contrast, highlights, shadows, whites, blacks,
                 curves: {
                    rgb: getCurveLUT(curves.rgb),
                    red: getCurveLUT(curves.red),
                    green: getCurveLUT(curves.green),
                    blue: getCurveLUT(curves.blue)
                 },
                 lut3: combinedLUT
              });
              
              processedCanvasRef.current = webglCanvas;
              lastWebglParamsRef.current = webglParams;
              sourceForDraw = webglCanvas;
          }
       } catch(e) {
          webglSuccess = false;
          console.error("WebGL failed", e);
       }
    }

    ctx.drawImage(sourceForDraw, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();
    
    // Optimization: Skip reading back pixels if using WebGL and rotating (histograms skipped anyway)
    let imageData = null;
    let data = null;
    
    if (!webglSuccess || !isRotating) {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        data = imageData.data;
    }

    // Pre-calculate lookup tables
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    // Temp/Tint adjustments
    const rBal = red + (temp / 200) + (tint / 200);
    const gBal = green + (temp / 200) - (tint / 200);
    const bBal = blue - (temp / 200);

    // Histogram buckets
    const histRGB = new Array(256).fill(0);
    const histR = new Array(256).fill(0);
    const histG = new Array(256).fill(0);
    const histB = new Array(256).fill(0);
    let maxCount = 0;

    // Downsample histogram & processing for speed: skip every other pixel in X/Y.
    const stride = isCropping ? 6 : 2; // Higher stride during cropping for smoothness
    const width = canvas.width;
    const height = canvas.height;

    // Optimization: Split paths for WebGL vs CPU to avoid checks inside the loop
    if (webglSuccess) {
        // WebGL Path: Image is already drawn. We only need histograms.
        // If rotating, skip histograms entirely to maintain 60fps.
        if (!isRotating && data) {
             for (let y = 0; y < height; y += stride) {
                for (let x = 0; x < width; x += stride) {
                    const idx = (y * width + x) * 4;
                    // Skip transparent pixels
                    if (data[idx + 3] === 0) continue;

                    const r = data[idx];
                    const g = data[idx+1];
                    const b = data[idx+2];
                    
                    histR[r]++; histG[g]++; histB[b]++;
                    const lum = Math.round(0.299*r + 0.587*g + 0.114*b);
                    histRGB[lum]++;
                    maxCount = Math.max(maxCount, histR[r], histG[g], histB[b], histRGB[lum]);
                }
             }
        }
        // No need to putImageData, it's already on the canvas from drawImage(webglCanvas)
    } else {
        // CPU Path: Must process every pixel
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            if (data[idx + 3] === 0) continue;

            let r = data[idx];
            let g = data[idx + 1];
            let b = data[idx + 2];

            // 1. Invert (if enabled)
            if (inverted) {
              if (inversionMode === 'log') {
                r = 255 * (1 - Math.log(r + 1) / Math.log(256));
                g = 255 * (1 - Math.log(g + 1) / Math.log(256));
                b = 255 * (1 - Math.log(b + 1) / Math.log(256));
              } else {
                r = 255 - r;
                g = 255 - g;
                b = 255 - b;
              }
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

            // Update Histograms only for subsampled pixels
            if ((x % stride === 0) && (y % stride === 0)) {
              const rIdx = Math.round(rC);
              const gIdx = Math.round(gC);
              const bIdx = Math.round(bC);

              histR[rIdx]++;
              histG[gIdx]++;
              histB[bIdx]++;

              // Calculate luminance for RGB histogram
              const lum = Math.round(0.299 * rC + 0.587 * gC + 0.114 * bC);
              histRGB[lum]++;

              // Track max for normalization across all channels
              maxCount = Math.max(maxCount, histR[rIdx], histG[gIdx], histB[bIdx], histRGB[lum]);
            }

            // Final Clamp and write back full-resolution pixel
            data[idx] = rC;
            data[idx + 1] = gC;
            data[idx + 2] = bC;
          }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Normalize histograms
    if (!isRotating && maxCount > 0) {
      for(let i=0; i<256; i++) {
        histRGB[i] /= maxCount;
        histR[i] /= maxCount;
        histG[i] /= maxCount;
        histB[i] /= maxCount;
      }
    }
    if (!isRotating) {
      setHistograms({ rgb: histRGB, red: histR, green: histG, blue: histB });
    }
  } // <-- Close processImage function

  // Request remote preview from backend high-precision pipeline (debounced)
  const previewTimerRef = useRef(null);
  useEffect(() => {
    if (!photoId) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(async () => {
      try {
        // Always send committedCrop for preview. During crop mode, server keeps showing last commit.
        const params = { inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, rotation, orientation, cropRect: committedCrop, curves };
        const res = await filmlabPreview({ photoId, params, maxWidth: 1400 });
        if (!res || !res.ok) { return; }
        // Create object URL and load image for canvas draw
        if (remoteUrlRef.current) URL.revokeObjectURL(remoteUrlRef.current);
        const url = URL.createObjectURL(res.blob);
        remoteUrlRef.current = url;
        const img = new Image();
        img.onload = () => { setRemoteImg(img); };
        img.src = url;
      } catch (e) { }
    }, 180);
    return () => { if (previewTimerRef.current) { clearTimeout(previewTimerRef.current); previewTimerRef.current = null; } };
  }, [photoId, inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, rotation, orientation, committedCrop, curves]);

  const renderOriginal = () => {
    if (!image || !origCanvasRef.current) return;
    const canvas = origCanvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const maxWidth = 1200;
    const scale = Math.min(1, maxWidth / image.width);
    const totalRotation = rotation + orientation;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    // Always show full rotated image for original comparison
    canvas.width = Math.round(rotatedW);
    canvas.height = Math.round(rotatedH);
    ctx.save();
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();
  };

  const handleAutoLevels = () => {
    if (!image) return;
    pushToHistory();
    
    // Use current histograms to find min/max
    // We want to stretch the histogram to fill 0-255
    // We will update the curves to do this
    
    const findLevels = (hist) => {
      let min = 0;
      let max = 255;
      
      // Find min (0.1% threshold)
      // Histograms are normalized (0-1), so sum is ~1 (or maxCount normalized)
      // Actually my histogram logic normalizes by maxCount, not sum.
      // So values are 0-1 relative to the peak.
      // We need to be careful. Let's just look for the first non-zero bucket with some noise tolerance.
      
      // Simple approach: First value > 0.005 (0.5% of peak)
      const threshold = 0.005;
      
      for (let i = 0; i < 256; i++) {
        if (hist[i] > threshold) {
          min = i;
          break;
        }
      }
      
      for (let i = 255; i >= 0; i--) {
        if (hist[i] > threshold) {
          max = i;
          break;
        }
      }
      
      return { min, max };
    };

    const rLevels = findLevels(histograms.red);
    const gLevels = findLevels(histograms.green);
    const bLevels = findLevels(histograms.blue);

    setCurves(prev => ({
      ...prev,
      red: [{x: rLevels.min, y: 0}, {x: rLevels.max, y: 255}],
      green: [{x: gLevels.min, y: 0}, {x: gLevels.max, y: 255}],
      blue: [{x: bLevels.min, y: 0}, {x: bLevels.max, y: 255}]
    }));
  };

  const handleAutoColor = () => {
    if (!image) return;
    pushToHistory();
    
    // Create temp canvas to read raw pixels (downscaled for speed)
    const canvas = document.createElement('canvas');
    const size = 256;
    const scale = Math.min(1, size / image.width);
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;
    
    // Sample pixels
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i+1];
      let b = data[i+2];
      
      if (inverted) {
        if (inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
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
    
    // Calculate required gains to reach neutral grey
    const kR = rAvg > 0 ? avg / rAvg : 1;
    const kB = bAvg > 0 ? avg / bAvg : 1;

    // Reverse engineer Temp/Tint from gains
    // kB = 1 - T/200 => T = (1 - kB) * 200
    const newTemp = (1 - kB) * 200;
    
    // kR = 1 + (T + t)/200 => t = (kR - 1)*200 - T
    const newTint = (kR - 1) * 200 - newTemp;

    setTemp(Math.max(-100, Math.min(100, newTemp)));
    setTint(Math.max(-100, Math.min(100, newTint)));
    setRed(1);
    setGreen(1);
    setBlue(1);
  };

  // Curve Editor Constants

  // Crop Interaction - Simplified


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
    
    e.preventDefault();
    setIsPanning(true);
    hasPannedRef.current = false;
    
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = pan.x;
    const startPanY = pan.y;

    const handleMouseMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        hasPannedRef.current = true;
      }
      
      setPan({ x: startPanX + dx, y: startPanY + dy });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // We no longer auto-resize crop on rotation; user controls size/position.

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
    const size = lutExportSize;
    let content = `LUT_3D_SIZE ${size}\n`;
    
    // Get current 1D LUTs
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    const rBal = red + (temp / 200) + (tint / 200);
    const gBal = green + (temp / 200) - (tint / 200);
    const bBal = blue - (temp / 200);

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
            if (inversionMode === 'log') {
              rC = 255 * (1 - Math.log(rC + 1) / Math.log(256));
              gC = 255 * (1 - Math.log(gC + 1) / Math.log(256));
              bC = 255 * (1 - Math.log(bC + 1) / Math.log(256));
            } else {
              rC = 255 - rC;
              gC = 255 - gC;
              bC = 255 - bC;
            }
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

  /*
  const handleExportLUT = () => {
    pushToHistory();
    generateOutputLUT();
  };
  */

  const handleSave = () => {
    if (!image) return;
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // High-res rotate first
    const maxSaveWidth = 4000;
    const scale = Math.min(1, maxSaveWidth / image.width);
    const totalRotation = rotation + orientation;
    const rad = (totalRotation * Math.PI) / 180;

    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    const rotatedW = Math.round(scaledW * cos + scaledH * sin);
    const rotatedH = Math.round(scaledW * sin + scaledH * cos);

    const rotCanvas = document.createElement('canvas');
    rotCanvas.width = rotatedW;
    rotCanvas.height = rotatedH;
    const rotCtx = rotCanvas.getContext('2d');
    rotCtx.save();
    rotCtx.translate(rotatedW / 2, rotatedH / 2);
    rotCtx.rotate(rad);
    rotCtx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    rotCtx.restore();
    
    // Crop from rotated image using committedCrop (confirmed by DONE button)
    let crx = Math.max(0, Math.min(1, committedCrop.x));
    let cry = Math.max(0, Math.min(1, committedCrop.y));
    let crw = Math.max(0, Math.min(1 - crx, committedCrop.w));
    let crh = Math.max(0, Math.min(1 - cry, committedCrop.h));
    const cropX = Math.round(crx * rotCanvas.width);
    const cropY = Math.round(cry * rotCanvas.height);
    const cropW = Math.max(1, Math.round(crw * rotCanvas.width));
    const cropH = Math.max(1, Math.round(crh * rotCanvas.height));

    canvas.width = cropW;
    canvas.height = cropH;
    ctx.drawImage(rotCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Pre-calculate lookup tables
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    const rBal = red + (temp / 200) + (tint / 200);
    const gBal = green + (temp / 200) - (tint / 200);
    const bBal = blue - (temp / 200);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (inverted) {
        if (inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
      }

      r *= rBal;
      g *= gBal;
      b *= bBal;

      let rC = Math.min(255, Math.max(0, r));
      let gC = Math.min(255, Math.max(0, g));
      let bC = Math.min(255, Math.max(0, b));

      rC = toneLUT[Math.floor(rC)];
      gC = toneLUT[Math.floor(gC)];
      bC = toneLUT[Math.floor(bC)];
      
      rC = lutRGB[rC];
      gC = lutRGB[gC];
      bC = lutRGB[bC];

      rC = lutR[rC];
      gC = lutG[gC];
      bC = lutB[bC];

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

      rC = Math.min(255, Math.max(0, rC));
      gC = Math.min(255, Math.max(0, gC));
      bC = Math.min(255, Math.max(0, bC));

      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
    }

    ctx.putImageData(imageData, 0, 0);
    
    canvas.toBlob((blob) => {
      if (onSave) onSave(blob);
    }, 'image/jpeg', 1.0);
  };

  const handleHighQualityExport = async () => {
    if (!photoId || hqBusy) return;
    setHqBusy(true);
    try {
      const params = {
        inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, rotation, orientation, cropRect: committedCrop, curves
      };
      const res = await exportPositive(photoId, params, { format: 'jpeg' }); // Always store JPEG into library
      if (res && res.ok) {
        // Ask parent to refresh photo list / data
        if (onPhotoUpdate) onPhotoUpdate();
      } else if (res && res.error) {
        if (typeof window !== 'undefined') alert('导出失败: ' + res.error);
      }
    } catch (e) {
      console.error('High quality export failed', e);
      if (typeof window !== 'undefined') alert('高质量导出失败: ' + (e.message || e));
    } finally {
      setHqBusy(false);
    }
  };

  const handleGpuExport = async () => {
    if (!window.__electron || gpuBusy) return;
    setGpuBusy(true);
    try {
      // Generate 1D LUT for Tone + Curves
      const toneLUT = getToneLUT();
      const lutRGB = getCurveLUT(curves.rgb);
      const lutR = getCurveLUT(curves.red);
      const lutG = getCurveLUT(curves.green);
      const lutB = getCurveLUT(curves.blue);
      
      // Combine into a single 256x3 array [r,g,b, r,g,b...] for the GPU to sample
      // The GPU will use this to map the linear(ish) color to the final tone/curve mapped color
      const toneCurveLut = new Uint8Array(256 * 4); // RGBA
      for (let i = 0; i < 256; i++) {
        let r = i, g = i, b = i;
        // Apply Tone
        r = toneLUT[r]; g = toneLUT[g]; b = toneLUT[b];
        // Apply RGB Curve
        r = lutRGB[r]; g = lutRGB[g]; b = lutRGB[b];
        // Apply Channel Curves
        r = lutR[r];
        g = lutG[g];
        b = lutB[b];
        
        toneCurveLut[i * 4 + 0] = r;
        toneCurveLut[i * 4 + 1] = g;
        toneCurveLut[i * 4 + 2] = b;
        toneCurveLut[i * 4 + 3] = 255;
      }

      // Prepare 3D LUTs if any
      // We can pass them as raw data. The GPU worker will need to handle them.
      // For now, let's just pass the first active LUT if any, or maybe combine them?
      // Combining 3D LUTs in JS is expensive.
      // Let's pass them individually if possible, or just the first one for now as a start.
      // Or, if we want full parity, we should combine them in JS if they are small (33^3 is small).
      // The `buildCombinedLUT` function exists in this file! Let's use it.
      let lut3d = null;
      if (lut1 || lut2) {
        lut3d = buildCombinedLUT(lut1, lut2); // returns { data: Float32Array, size: number }
      }

      const params = { 
        inverted, inversionMode, exposure, contrast, temp, tint, red, green, blue, rotation, orientation,
        cropRect: committedCrop,
        toneCurveLut: Array.from(toneCurveLut), // Pass as array
        lut3d: lut3d ? { size: lut3d.size, data: Array.from(lut3d.data) } : null
      };
      
      const res = await window.__electron.filmlabGpuProcess({ params, photoId, imageUrl });
      if (!res || !res.ok) {
        const msg = (res && (res.error || res.message)) || 'unknown_error';
        if (typeof window !== 'undefined') alert('GPU 导出失败: ' + msg);
      } else {
        if (onPhotoUpdate) onPhotoUpdate();
        // Reveal saved file and inform user where it went
        if (res.filePath) {
          try { window.__electron.showInFolder && window.__electron.showInFolder(res.filePath); } catch(_){}
          if (typeof window !== 'undefined') alert('GPU 导出已保存到:\n' + res.filePath);
        }
      }
    } catch (e) {
      console.error('GPU export failed', e);
      if (typeof window !== 'undefined') alert('GPU 导出失败: ' + (e.message || e));
    } finally {
      setGpuBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!image || !photoId) return;
    const paramsForServer = { inverted, inversionMode, exposure, contrast, highlights, shadows, whites, blacks, temp, tint, red, green, blue, rotation, orientation, cropRect: committedCrop, curves };
    // TIFF16 or BOTH use server render-positive endpoint for high bit depth / parity
    if (saveAsFormat === 'tiff16' || saveAsFormat === 'both') {
      try {
        // JPEG first if BOTH
        if (saveAsFormat === 'both') {
          // Download JPEG via client pipeline (fast) before TIFF
          await downloadClientJPEG();
        }
        const r = await renderPositive(photoId, paramsForServer, { format: 'tiff16' });
        if (!r.ok) {
          if (typeof window !== 'undefined') alert('TIFF16 渲染失败: ' + r.error);
          return;
        }
        triggerBlobDownload(r.blob, `film-lab-render-${Date.now()}.tiff`);
        return;
      } catch (e) {
        console.error('Render-positive TIFF16 failed', e);
        if (typeof window !== 'undefined') alert('TIFF16 渲染失败: ' + (e.message || e));
        return;
      }
    }
    // JPEG path
    await downloadClientJPEG();
  };

  const triggerBlobDownload = (blob, filename) => {
    if (typeof window !== 'undefined' && window.__electron && window.__electron.filmLabSaveAs) {
      window.__electron.filmLabSaveAs({ blob, defaultName: filename }).then(res => {
        if (res && res.ok && res.filePath) {
          try { window.__electron.showInFolder && window.__electron.showInFolder(res.filePath); } catch(_){}
        } else if (res && res.canceled) {
          // user canceled: silently ignore
        } else if (res && res.error) {
          console.warn('Electron save-as failed, falling back to browser download:', res.error);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
        }
      }).catch(err => {
        console.warn('Electron save-as exception, fallback:', err && err.message);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      });
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadClientJPEG = () => {
    // If GPU path requested and available AND no external LUT blending (unsupported in WebGL yet), use WebGL for color then CPU for geometry.
    if (useGPU && isWebGLAvailable() && !lut1 && !lut2) {
      try {
        const gains = [
          red + (temp / 200) + (tint / 200),
          green + (temp / 200) - (tint / 200),
          blue - (temp / 200)
        ];
        const webglCanvas = document.createElement('canvas');
        // Include LUT if present (combined from lut1/lut2) even in Save As GPU path
        let combinedLUT = null;
        if ((lut1 && lut1.intensity > 0) || (lut2 && lut2.intensity > 0)) {
          const size = (lut1 && lut1.size) || (lut2 && lut2.size);
          if (size) {
            const total = size * size * size;
            const out = new Float32Array(total * 3);
            const aData = lut1 ? lut1.data : null; const aInt = lut1 ? lut1.intensity : 0;
            const bData = lut2 ? lut2.data : null; const bInt = lut2 ? lut2.intensity : 0;
            for (let i = 0, j = 0; i < total; i++, j += 3) {
              const rIdx = i % size;
              const gIdx = Math.floor(i / size) % size;
              const bIdx = Math.floor(i / (size * size));
              let r = rIdx / (size - 1);
              let g = gIdx / (size - 1);
              let b = bIdx / (size - 1);
              if (aData && aInt > 0) {
                const ar = aData[j]; const ag = aData[j+1]; const ab = aData[j+2];
                r = r * (1 - aInt) + ar * aInt;
                g = g * (1 - aInt) + ag * aInt;
                b = b * (1 - aInt) + ab * aInt;
              }
              if (bData && bInt > 0) {
                const br = bData[j]; const bg = bData[j+1]; const bb = bData[j+2];
                r = r * (1 - bInt) + br * bInt;
                g = g * (1 - bInt) + bg * bInt;
                b = b * (1 - bInt) + bb * bInt;
              }
              combinedLUT = { size, data: out };
            }
          }
        }
        processImageWebGL(webglCanvas, image, {
          inverted,
          inversionMode,
          gains,
          exposure,
          contrast,
          highlights,
          shadows,
          whites,
          blacks,
          curves: {
            rgb: getCurveLUT(curves.rgb),
            red: getCurveLUT(curves.red),
            green: getCurveLUT(curves.green),
            blue: getCurveLUT(curves.blue)
          },
          lut3: combinedLUT
        });
        // Apply rotation + crop on CPU from GPU result
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const totalRotation = rotation + orientation;
        const rad = (totalRotation * Math.PI) / 180;
        const sin = Math.abs(Math.sin(rad));
        const cos = Math.abs(Math.cos(rad));
        const scaledW = webglCanvas.width; // already full size
        const scaledH = webglCanvas.height;
        const rotatedW = scaledW * cos + scaledH * sin;
        const rotatedH = scaledW * sin + scaledH * cos;
        let cropX = committedCrop.x * rotatedW;
        let cropY = committedCrop.y * rotatedH;
        let cropW = committedCrop.w * rotatedW;
        let cropH = committedCrop.h * rotatedH;
        // Ensure integer pixel canvas sizes to avoid half-pixel loss at edges
        cropX = Math.round(cropX);
        cropY = Math.round(cropY);
        cropW = Math.max(1, Math.round(cropW));
        cropH = Math.max(1, Math.round(cropH));
        canvas.width = cropW;
        canvas.height = cropH;
        ctx.save();
        ctx.translate(-cropX, -cropY);
        ctx.translate(rotatedW / 2, rotatedH / 2);
        ctx.rotate(rad);
        ctx.drawImage(webglCanvas, -scaledW / 2, -scaledH / 2);
        ctx.restore();
        return new Promise(resolve => {
          canvas.toBlob(b => { triggerBlobDownload(b, `film-lab-render-${Date.now()}.jpg`); resolve(); }, 'image/jpeg', 1.0);
        });
      } catch (e) {
        console.warn('GPU Save As fallback to CPU:', e.message);
      }
    }
    // CPU pipeline fallback
    
    // Reuse the logic from handleSave but trigger download instead of callback
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    const maxSaveWidth = 4000; 
    const scale = Math.min(1, maxSaveWidth / image.width);
    
    const totalRotation = rotation + orientation;
    const rad = (totalRotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(rad));
    const cos = Math.abs(Math.cos(rad));
    const scaledW = image.width * scale;
    const scaledH = image.height * scale;
    
    const rotatedW = scaledW * cos + scaledH * sin;
    const rotatedH = scaledW * sin + scaledH * cos;

    let cropX = committedCrop.x * rotatedW;
    let cropY = committedCrop.y * rotatedH;
    let cropW = committedCrop.w * rotatedW;
    let cropH = committedCrop.h * rotatedH;

    // Ensure integer dimensions to avoid dropping edge pixels after rotation
    cropX = Math.round(cropX);
    cropY = Math.round(cropY);
    cropW = Math.max(1, Math.round(cropW));
    cropH = Math.max(1, Math.round(cropH));

    canvas.width = cropW;
    canvas.height = cropH;

    ctx.save();
    ctx.translate(-cropX, -cropY);
    ctx.translate(rotatedW / 2, rotatedH / 2);
    ctx.rotate(rad);
    ctx.drawImage(image, -scaledW / 2, -scaledH / 2, scaledW, scaledH);
    ctx.restore();
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Pre-calculate lookup tables
    const toneLUT = getToneLUT();
    const lutRGB = getCurveLUT(curves.rgb);
    const lutR = getCurveLUT(curves.red);
    const lutG = getCurveLUT(curves.green);
    const lutB = getCurveLUT(curves.blue);
    
    const rBal = red + (temp / 200) + (tint / 200);
    const gBal = green + (temp / 200) - (tint / 200);
    const bBal = blue - (temp / 200);

    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;

      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      if (inverted) {
        if (inversionMode === 'log') {
          r = 255 * (1 - Math.log(r + 1) / Math.log(256));
          g = 255 * (1 - Math.log(g + 1) / Math.log(256));
          b = 255 * (1 - Math.log(b + 1) / Math.log(256));
        } else {
          r = 255 - r;
          g = 255 - g;
          b = 255 - b;
        }
      }

      r *= rBal;
      g *= gBal;
      b *= bBal;

      let rC = Math.min(255, Math.max(0, r));
      let gC = Math.min(255, Math.max(0, g));
      let bC = Math.min(255, Math.max(0, b));

      rC = toneLUT[Math.floor(rC)];
      gC = toneLUT[Math.floor(gC)];
      bC = toneLUT[Math.floor(bC)];
      
      rC = lutRGB[rC];
      gC = lutRGB[gC];
      bC = lutRGB[bC];

      rC = lutR[rC];
      gC = lutG[gC];
      bC = lutB[bC];

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

      rC = Math.min(255, Math.max(0, rC));
      gC = Math.min(255, Math.max(0, gC));
      bC = Math.min(255, Math.max(0, bC));

      data[i] = rC;
      data[i + 1] = gC;
      data[i + 2] = bC;
    }

    ctx.putImageData(imageData, 0, 0);
    
    return new Promise(resolve => {
      canvas.toBlob((blob) => {
        triggerBlobDownload(blob, `film-lab-render-${Date.now()}.jpg`);
        resolve();
      }, 'image/jpeg', 1.0);
    });
  };

  const handleAutoBase = () => {
    if (!image) return;
    pushToHistory();

    // Create temp canvas to read raw pixels
    const canvas = document.createElement('canvas');
    const size = 256;
    const scale = Math.min(1, size / image.width);
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Find max luminance
    let maxLum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const lum = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
      if (lum > maxLum) maxLum = lum;
    }

    // Average pixels within top 5% of brightness (Film Base candidates)
    const threshold = maxLum * 0.95;
    let rSum = 0, gSum = 0, bSum = 0;
    let count = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;

      if (lum >= threshold) {
        rSum += r;
        gSum += g;
        bSum += b;
        count++;
      }
    }

    if (count > 0) {
      const rAvg = rSum / count;
      const gAvg = gSum / count;
      const bAvg = bSum / count;

      // Apply Base Correction (Gain = 255 / BaseColor)
      // This maps the base color to White (255,255,255)
      const safeR = Math.max(1, rAvg);
      const safeG = Math.max(1, gAvg);
      const safeB = Math.max(1, bAvg);
      
      setRed(255 / safeR);
      setGreen(255 / safeG);
      setBlue(255 / safeB);
      
      // Reset Temp/Tint as this is a base calibration
      setTemp(0);
      setTint(0);
    }
  };

  const handleCropDone = () => {
    // Commit current cropRect to committedCrop when DONE is clicked
    pushToHistory();
    setCommittedCrop({ ...cropRect });
    // Stay non-destructive: keep swap state but exit crop mode
    setIsCropping(false);
  };

  // Lightroom-like keyboard: press 'X' to flip aspect orientation while cropping
  useEffect(() => {
    const onKey = (e) => {
      if (!isCropping) return;
      if (e.key === 'x' || e.key === 'X') {
        setRatioSwap((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isCropping]);


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

      <FilmLabCanvas
        canvasRef={canvasRef}
        origCanvasRef={origCanvasRef}
        zoom={zoom} setZoom={setZoom}
        pan={pan} setPan={setPan}
        isPanning={isPanning}
        handleWheel={handleWheel}
        handlePanStart={handlePanStart}
        isCropping={isCropping}
        rotation={rotation} setRotation={setRotation}
        onRotateStart={() => { committedRotationRef.current = rotation; setIsRotating(true); }}
        onRotateEnd={() => { setIsRotating(false); }}
        pushToHistory={pushToHistory}
        handleCanvasClick={handleCanvasClick}
        isPicking={isPicking || isPickingBase || isPickingWB}
        cropRect={cropRect}
        setCropRect={setCropRect}
        image={image}
        orientation={orientation}
        ratioMode={ratioMode}
        ratioSwap={ratioSwap}
        compareMode={compareMode}
        compareSlider={compareSlider}
        setCompareSlider={setCompareSlider}
        expectedWidth={geometry ? Math.round(geometry.rotatedW) : 0}
      />

      <FilmLabControls
        inverted={inverted} setInverted={setInverted}
        useGPU={useGPU} setUseGPU={setUseGPU}
        inversionMode={inversionMode} setInversionMode={setInversionMode}
        isPickingBase={isPickingBase} setIsPickingBase={setIsPickingBase}
        handleAutoBase={handleAutoBase}
        isPickingWB={isPickingWB} setIsPickingWB={setIsPickingWB}
        handleAutoColor={handleAutoColor}
        handleUndo={handleUndo} handleRedo={handleRedo} handleReset={handleReset}
        history={history} future={future}
        handleAutoLevels={handleAutoLevels}
        isCropping={isCropping} setIsCropping={setIsCropping}
        onCropDone={handleCropDone}
        ratioMode={ratioMode} setRatioMode={setRatioMode}
        ratioSwap={ratioSwap} setRatioSwap={setRatioSwap}
        rotation={rotation} setRotation={setRotation}
        onRotateStart={() => { committedRotationRef.current = rotation; setIsRotating(true); }}
        onRotateEnd={() => { setIsRotating(false); }}
        setOrientation={setOrientation}
        exposure={exposure} setExposure={setExposure}
        contrast={contrast} setContrast={setContrast}
        highlights={highlights} setHighlights={setHighlights}
        shadows={shadows} setShadows={setShadows}
        whites={whites} setWhites={setWhites}
        blacks={blacks} setBlacks={setBlacks}
        temp={temp} setTemp={setTemp}
        tint={tint} setTint={setTint}
        curves={curves} setCurves={setCurves}
        activeChannel={activeChannel} setActiveChannel={setActiveChannel}
        isPicking={isPicking} setIsPicking={setIsPicking}
        pickedColor={pickedColor}
        histograms={histograms}
        pushToHistory={pushToHistory}
        lut1={lut1} setLut1={setLut1}
        lut2={lut2} setLut2={setLut2}
        lutExportSize={lutExportSize} setLutExportSize={setLutExportSize}
        generateOutputLUT={generateOutputLUT}
        handleLutUpload={handleLutUpload}
        compareMode={compareMode} setCompareMode={setCompareMode}
        compareSlider={compareSlider} setCompareSlider={setCompareSlider}
        presets={presets}
        onSavePreset={savePreset}
        onApplyPreset={applyPreset}
        onDeletePreset={deletePreset}
        onApplyPresetToRoll={applyPresetToRoll}
        handleDownload={handleDownload} handleSave={handleSave} onClose={onClose}
        onHighQualityExport={handleHighQualityExport}
        highQualityBusy={hqBusy}
        onGpuExport={handleGpuExport}
        gpuBusy={gpuBusy}
        exportFormat={saveAsFormat}
        setExportFormat={setSaveAsFormat}
      />
    </div>
  );
}
