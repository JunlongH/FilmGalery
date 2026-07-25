import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@heroui/react';
import { Save, RotateCcw, X, Crop, RotateCw, Download, Eye, ChevronDown, ChevronRight, BookmarkPlus } from 'lucide-react';
import { developPreview, developSave, developExport, getDevelopParams, listPresets, createPreset } from '../../api';
import { DEFAULT_CURVES, DEFAULT_HSL_PARAMS, DEFAULT_SPLIT_TONE_PARAMS } from '@filmgallery/shared';
import SliderControl from '../FilmLab/SliderControl';
import HSLPanel from '../FilmLab/HSLPanel';
import ToneCurveEditor from '../FilmLab/ToneCurveEditor';
import SplitToningPanel from '../FilmLab/SplitToningPanel';
import LutSelectorModal from '../FilmLab/LutSelectorModal';

function createDefaultParams() {
  return {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    temp: 0, tint: 0, saturation: 0,
    curves: { ...DEFAULT_CURVES },
    hslParams: { ...DEFAULT_HSL_PARAMS },
    splitToning: { ...DEFAULT_SPLIT_TONE_PARAMS },
    lut1: null,
    rotation: 0,
    crop: { x: 0, y: 0, w: 1, h: 1 },
  };
}

function sanitizeParams(raw) {
  const base = createDefaultParams();
  const merged = { ...base, ...(raw || {}) };
  if (merged.temp == null && merged.temperature != null) merged.temp = merged.temperature;
  delete merged.temperature;
  if (merged.crop == null || (merged.crop.x === 0 && merged.crop.y === 0 && merged.crop.w === 1 && merged.crop.h === 1)) {
    if (merged.cropRect && typeof merged.cropRect === 'object') merged.crop = merged.cropRect;
  }
  merged.crop = { ...base.crop, ...(merged.crop || {}) };
  merged.curves = { ...DEFAULT_CURVES, ...(merged.curves || {}) };
  merged.hslParams = { ...DEFAULT_HSL_PARAMS, ...(merged.hslParams || {}) };
  const st = merged.splitToning || {};
  merged.splitToning = {
    highlights: { ...DEFAULT_SPLIT_TONE_PARAMS.highlights, ...(st.highlights || {}) },
    midtones: { ...DEFAULT_SPLIT_TONE_PARAMS.midtones, ...(st.midtones || {}) },
    shadows: { ...DEFAULT_SPLIT_TONE_PARAMS.shadows, ...(st.shadows || {}) },
    balance: st.balance ?? DEFAULT_SPLIT_TONE_PARAMS.balance,
  };
  if (merged.lut1) {
    const d = merged.lut1.data;
    if (!merged.lut1.size || !d || (!Array.isArray(d) && !(d instanceof Float32Array))) merged.lut1 = null;
  }
  if (typeof merged.rotation !== 'number') merged.rotation = 0;
  return merged;
}

const BASIC_CONTROLS = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'saturation', label: 'Saturation' },
];

const WB_CONTROLS = [
  { key: 'temp', label: 'Temperature' },
  { key: 'tint', label: 'Tint' },
];

const ASPECT_PRESETS = [
  { key: 'free', label: 'Free', value: null },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
];

const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
// Handles render inside the crop-rect div, so positions are relative to the
// crop rect itself (percent of crop width/height), not the image.
const HANDLE_POS = {
  nw: [0, 0], n: [50, 0], ne: [100, 0],
  e: [100, 50], se: [100, 100], s: [50, 100],
  sw: [0, 100], w: [0, 50],
};
const MIN_CROP = 0.02;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const noop = () => {};

function Section({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-zinc-800 rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 bg-zinc-800/60 hover:bg-zinc-800 text-xs font-semibold text-zinc-200"
      >
        <span>{title}</span>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>
      {open && <div className="px-2 py-2">{children}</div>}
    </div>
  );
}

export default function DigitalDevelop({ photoId, imageUrl, onClose, onSaved }) {
  const [params, setParams] = useState(createDefaultParams);
  const [previewUrl, setPreviewUrl] = useState(imageUrl);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [cropMode, setCropMode] = useState(false);
  const [aspect, setAspect] = useState('free');
  const [imgRect, setImgRect] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [showLutSelector, setShowLutSelector] = useState(false);
  const [activeChannel, setActiveChannel] = useState('rgb');
  const [presets, setPresets] = useState([]);
  const debounceRef = useRef(null);
  const imgRef = useRef(null);
  const containerRef = useRef(null);
  const blobUrlRef = useRef(null);
  const previewGenRef = useRef(0);
  const abortRef = useRef(null);
  const paramsRef = useRef(params);
  const cropModeRef = useRef(false);
  const dragCleanupRef = useRef(null);

  // Cleanup debounce timer, object URL, in-flight request, and any active
  // crop-drag window listeners on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      if (abortRef.current) abortRef.current.abort();
      if (dragCleanupRef.current) dragCleanupRef.current();
    };
  }, []);

  // Load saved params on mount
  useEffect(() => {
    let cancelled = false;
    getDevelopParams(photoId)
      .then(data => {
        if (!cancelled && data?.params) {
          const next = sanitizeParams(data.params);
          paramsRef.current = next;
          setParams(next);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [photoId]);

  // Load digital presets on mount
  useEffect(() => {
    let cancelled = false;
    listPresets('digital')
      .then(d => { if (!cancelled) setPresets(d?.presets || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Release press-and-hold compare on any mouse up
  useEffect(() => {
    const up = () => setShowOriginal(false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  // Debounced preview. While the crop tool is active the server renders the
  // full rotated frame (crop stripped) so the overlay has a stable coordinate
  // space; the crop is only baked into the render when crop mode is off.
  const triggerPreview = useCallback((newParams) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setError(null);
    debounceRef.current = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const gen = ++previewGenRef.current;
      setLoading(true);
      try {
        const effective = cropModeRef.current ? { ...newParams, crop: null } : newParams;
        const blob = await developPreview(photoId, effective, { signal: controller.signal });
        if (gen !== previewGenRef.current) return;
        const url = URL.createObjectURL(blob);
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = url;
        setPreviewUrl(url);
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (gen !== previewGenRef.current) return;
        console.error('[DigitalDevelop] Preview failed:', err);
        setError(err.message || 'Preview failed');
      } finally {
        if (gen === previewGenRef.current) setLoading(false);
      }
    }, 300);
  }, [photoId]);

  const updateParam = useCallback((key, value) => {
    const nextVal = typeof value === 'function' ? value(paramsRef.current[key]) : value;
    const newParams = { ...paramsRef.current, [key]: nextVal };
    paramsRef.current = newParams;
    setParams(newParams);
    triggerPreview(newParams);
  }, [triggerPreview]);

  // Local crop update during overlay drags — moves the overlay only, no
  // server round-trip (crop mode already shows the full frame).
  const setCropLocal = useCallback((crop) => {
    const next = { ...paramsRef.current, crop };
    paramsRef.current = next;
    setParams(next);
  }, []);

  // Displayed-image rect inside the container (object-contain letterboxing)
  const updateImgRect = useCallback(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !img.naturalWidth || !img.naturalHeight) {
      setImgRect(null);
      return;
    }
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    if (!cw || !ch) return;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    setImgRect({ left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h });
  }, []);

  useEffect(() => {
    window.addEventListener('resize', updateImgRect);
    return () => window.removeEventListener('resize', updateImgRect);
  }, [updateImgRect]);

  // ── Crop overlay drag (plain mouse events, normalized 0-1 coords) ─────────
  const beginCropDrag = useCallback((e, handle) => {
    if (!imgRect || !containerRef.current || !imgRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const containerBox = containerRef.current.getBoundingClientRect();
    const box = imgRect;
    const toNorm = (ev) => ({
      x: clamp01((ev.clientX - containerBox.left - box.left) / box.width),
      y: clamp01((ev.clientY - containerBox.top - box.top) / box.height),
    });
    const start = toNorm(e);
    const orig = { ...paramsRef.current.crop };
    const inside = start.x >= orig.x && start.x <= orig.x + orig.w && start.y >= orig.y && start.y <= orig.y + orig.h;
    const mode = handle ? { type: 'resize', handle } : (inside ? { type: 'move' } : { type: 'create' });
    const aspectValue = ASPECT_PRESETS.find(a => a.key === aspect)?.value ?? null;
    const nw = imgRef.current.naturalWidth;
    const nh = imgRef.current.naturalHeight;
    // h = w * k keeps pixel aspect (w*frameW)/(h*frameH) = aspectValue
    const k = aspectValue && nw && nh ? nw / (aspectValue * nh) : null;

    const onMove = (ev) => {
      const cur = toNorm(ev);
      let crop;
      if (mode.type === 'move') {
        crop = {
          x: Math.min(1 - orig.w, Math.max(0, orig.x + cur.x - start.x)),
          y: Math.min(1 - orig.h, Math.max(0, orig.y + cur.y - start.y)),
          w: orig.w,
          h: orig.h,
        };
      } else if (mode.type === 'create') {
        let w = Math.abs(cur.x - start.x);
        let h = k ? w * k : Math.abs(cur.y - start.y);
        if (w > 1) { w = 1; if (k) h = w * k; }
        if (h > 1) { h = 1; if (k) w = h / k; }
        const x = cur.x >= start.x ? start.x : start.x - w;
        const y = k
          ? (cur.y >= start.y ? start.y : start.y - h)
          : Math.min(start.y, cur.y);
        crop = { x, y, w, h };
      } else {
        const hd = mode.handle;
        const ax = hd.includes('w') ? orig.x + orig.w : (hd.includes('e') ? orig.x : null);
        const ay = hd.includes('n') ? orig.y + orig.h : (hd.includes('s') ? orig.y : null);
        if (ax !== null && ay !== null) {
          let w = Math.abs(cur.x - ax);
          let h = k ? w * k : Math.abs(cur.y - ay);
          crop = {
            x: Math.min(ax, cur.x),
            y: k ? (hd.includes('n') ? ay - h : ay) : Math.min(ay, cur.y),
            w,
            h,
          };
        } else if (ax !== null) {
          let w = Math.abs(cur.x - ax);
          let h = k ? w * k : orig.h;
          const cy = orig.y + orig.h / 2;
          crop = { x: Math.min(ax, cur.x), y: k ? cy - h / 2 : orig.y, w, h };
        } else {
          let h = Math.abs(cur.y - ay);
          let w = k ? h / k : orig.w;
          const cx = orig.x + orig.w / 2;
          crop = { x: k ? cx - w / 2 : orig.x, y: Math.min(ay, cur.y), w, h };
        }
      }
      crop.x = clamp01(crop.x);
      crop.y = clamp01(crop.y);
      crop.w = Math.min(Math.max(crop.w, MIN_CROP), 1 - crop.x);
      crop.h = Math.min(Math.max(crop.h, MIN_CROP), 1 - crop.y);
      if (k) {
        if (crop.w * k <= crop.h) crop.h = crop.w * k;
        else crop.w = crop.h / k;
      }
      setCropLocal(crop);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  }, [imgRect, aspect, setCropLocal]);

  function handleAspectPreset(key) {
    setAspect(key);
    const preset = ASPECT_PRESETS.find(a => a.key === key);
    if (!preset?.value) return;
    const img = imgRef.current;
    if (!img?.naturalWidth || !img?.naturalHeight) return;
    const k = img.naturalWidth / (preset.value * img.naturalHeight);
    const cur = paramsRef.current.crop;
    const cx = cur.x + cur.w / 2;
    const cy = cur.y + cur.h / 2;
    let w = cur.w;
    let h = w * k;
    if (h > 1) { h = 1; w = h / k; }
    if (w > 1) { w = 1; h = w * k; }
    setCropLocal({
      x: Math.min(1 - w, Math.max(0, cx - w / 2)),
      y: Math.min(1 - h, Math.max(0, cy - h / 2)),
      w,
      h,
    });
  }

  function toggleCropMode() {
    const next = !cropModeRef.current;
    cropModeRef.current = next;
    setCropMode(next);
    triggerPreview(paramsRef.current);
  }

  function handleClearCrop() {
    updateParam('crop', { x: 0, y: 0, w: 1, h: 1 });
  }

  function handleReset() {
    const next = createDefaultParams();
    paramsRef.current = next;
    setParams(next);
    setAspect('free');
    cropModeRef.current = false;
    setCropMode(false);
    triggerPreview(next);
  }

  function handleRotate() {
    updateParam('rotation', (paramsRef.current.rotation + 90) % 360);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await developSave(photoId, paramsRef.current);
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error('[DigitalDevelop] Save failed:', err);
      setError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const blob = await developExport(photoId, paramsRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `photo_${photoId}_export.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) {
      console.error('[DigitalDevelop] Export failed:', err);
      setError(err.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  async function handleSavePreset() {
    const name = window.prompt('Save preset — enter a preset name');
    if (!name || !name.trim()) return;
    setError(null);
    try {
      await createPreset({ name: name.trim(), category: 'digital', description: '', params: paramsRef.current });
      const d = await listPresets('digital');
      setPresets(d?.presets || []);
    } catch (err) {
      console.error('[DigitalDevelop] Save preset failed:', err);
      setError(err.message || 'Save preset failed');
    }
  }

  function handleApplyPreset(id) {
    const preset = presets.find(p => String(p.id) === String(id));
    if (!preset) return;
    const next = sanitizeParams(preset.params);
    paramsRef.current = next;
    setParams(next);
    triggerPreview(next);
  }

  function handleLutSelect(lutData) {
    setShowLutSelector(false);
    if (lutData && lutData.data instanceof Float32Array) {
      updateParam('lut1', { ...lutData, data: Array.from(lutData.data) });
    } else {
      updateParam('lut1', lutData || null);
    }
  }

  const crop = params.crop;
  const displayUrl = showOriginal ? imageUrl : previewUrl;

  const handlePos = (h) => {
    const [left, top] = HANDLE_POS[h];
    return { left: `${left}%`, top: `${top}%` };
  };

  return (
    <div className="fixed inset-0 z-50 flex bg-zinc-950 text-white">
      {/* Canvas area */}
      <div ref={containerRef} className="flex-1 flex items-center justify-center relative overflow-hidden">
        <img
          ref={imgRef}
          src={displayUrl}
          alt="preview"
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          onLoad={updateImgRect}
          onMouseDown={() => { if (!cropModeRef.current) setShowOriginal(true); }}
        />
        {loading && (
          <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 text-sm">
            Rendering…
          </div>
        )}
        {/* Press-and-hold compare button */}
        <button
          title="Hold to compare"
          onMouseDown={() => setShowOriginal(true)}
          onMouseUp={() => setShowOriginal(false)}
          onMouseLeave={() => setShowOriginal(false)}
          className={`absolute top-4 left-4 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm ${showOriginal ? 'bg-primary text-white' : 'bg-black/60 text-zinc-300 hover:bg-black/80'}`}
        >
          <Eye className="w-4 h-4" /> {showOriginal ? 'Original' : 'Compare'}
        </button>
        {/* Crop overlay — coords are normalized in the current rendered
            (post-rotation) frame, matching server cropRect semantics */}
        {cropMode && !showOriginal && imgRect && (
          <div
            className="absolute"
            style={{ left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height, cursor: 'crosshair' }}
            onMouseDown={(e) => beginCropDrag(e, null)}
          >
            <div
              className="absolute border-2 border-white/80"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.w * 100}%`,
                height: `${crop.h * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                cursor: 'move',
              }}
            >
              {/* Rule-of-thirds grid */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
              </div>
              {CROP_HANDLES.map(h => (
                <div
                  key={h}
                  onMouseDown={(e) => beginCropDrag(e, h)}
                  className="absolute w-3 h-3 bg-white border border-zinc-700 rounded-sm"
                  style={{ ...handlePos(h), transform: 'translate(-50%, -50%)', cursor: HANDLE_CURSORS[h] }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Controls panel */}
      <div className="w-80 flex flex-col bg-zinc-900 border-l border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="font-semibold text-sm">Digital Develop</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {error && (
          <div className="mx-4 mt-3 px-3 py-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            {error}
          </div>
        )}

        {/* Presets */}
        <div className="flex items-center gap-2 px-4 pt-3">
          <select
            value=""
            onChange={(e) => { if (e.target.value) handleApplyPreset(e.target.value); }}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-300 text-xs border border-zinc-700"
          >
            <option value="">Apply preset…</option>
            {presets.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <button
            onClick={handleSavePreset}
            title="Save as preset"
            className="flex items-center gap-1 px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs whitespace-nowrap"
          >
            <BookmarkPlus className="w-3.5 h-3.5" /> Save as preset
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          <Section title="Basic" defaultOpen>
            {BASIC_CONTROLS.map(({ key, label }) => (
              <SliderControl
                key={key}
                label={label}
                value={params[key]}
                min={-100}
                max={100}
                onChange={(v) => updateParam(key, v)}
              />
            ))}
          </Section>

          <Section title="White balance">
            {WB_CONTROLS.map(({ key, label }) => (
              <SliderControl
                key={key}
                label={label}
                value={params[key]}
                min={-100}
                max={100}
                onChange={(v) => updateParam(key, v)}
              />
            ))}
          </Section>

          <Section title="HSL">
            <HSLPanel
              hslParams={params.hslParams}
              setHslParams={(v) => updateParam('hslParams', v)}
              pushToHistory={noop}
            />
          </Section>

          <Section title="Curve">
            <ToneCurveEditor
              curves={params.curves}
              setCurves={(v) => updateParam('curves', v)}
              activeChannel={activeChannel}
              setActiveChannel={setActiveChannel}
              isPicking={false}
              setIsPicking={noop}
              pickedColor={null}
              histograms={null}
              pushToHistory={noop}
            />
          </Section>

          <Section title="Split tone">
            <SplitToningPanel
              splitToning={params.splitToning}
              setSplitToning={(v) => updateParam('splitToning', v)}
              pushToHistory={noop}
            />
          </Section>

          <Section title="LUT">
            <div className="bg-zinc-800/50 rounded-md p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-semibold text-zinc-400">LUT 1</span>
                {!params.lut1 ? (
                  <button
                    onClick={() => setShowLutSelector(true)}
                    className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300"
                  >
                    Load
                  </button>
                ) : (
                  <button
                    onClick={() => updateParam('lut1', null)}
                    className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-[10px] text-red-300"
                  >
                    Remove
                  </button>
                )}
              </div>
              {params.lut1 && (
                <>
                  <div className="text-[10px] text-zinc-500 mb-1 truncate">{params.lut1.name}</div>
                  <SliderControl
                    label="Opacity"
                    value={params.lut1.intensity ?? 1}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => updateParam('lut1', { ...params.lut1, intensity: v })}
                  />
                </>
              )}
            </div>
          </Section>

          <Section title="Crop & rotate" defaultOpen>
            <div className="space-y-2">
              <button
                onClick={toggleCropMode}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm w-full ${cropMode ? 'bg-primary text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
              >
                <Crop className="w-4 h-4" /> {cropMode ? 'Done' : 'Crop'}
              </button>
              {cropMode && (
                <>
                  <div className="flex flex-wrap gap-1">
                    {ASPECT_PRESETS.map(a => (
                      <button
                        key={a.key}
                        onClick={() => handleAspectPreset(a.key)}
                        className={`px-2 py-1 rounded text-[11px] ${aspect === a.key ? 'bg-primary text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleClearCrop}
                    className="px-3 py-1.5 rounded-md text-xs w-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  >
                    Clear crop
                  </button>
                  <div className="text-[10px] text-zinc-500 font-mono px-1">
                    X {(crop.x * 100).toFixed(1)}% · Y {(crop.y * 100).toFixed(1)}% · W {(crop.w * 100).toFixed(1)}% · H {(crop.h * 100).toFixed(1)}%
                  </div>
                </>
              )}
              <button
                onClick={handleRotate}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm w-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              >
                <RotateCw className="w-4 h-4" /> Rotate 90° ({params.rotation}°)
              </button>
            </div>
          </Section>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800">
          <Button variant="light" size="sm" onPress={handleReset}>
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
          <Button variant="flat" size="sm" isLoading={exporting} onPress={handleExport}>
            <Download className="w-4 h-4" /> Export
          </Button>
          <Button color="primary" size="sm" isLoading={saving} onPress={handleSave}>
            <Save className="w-4 h-4" /> Save
          </Button>
        </div>
      </div>

      {showLutSelector && (
        <LutSelectorModal
          onClose={() => setShowLutSelector(false)}
          onSelect={handleLutSelect}
          currentLutName={params.lut1?.name}
        />
      )}
    </div>
  );
}
