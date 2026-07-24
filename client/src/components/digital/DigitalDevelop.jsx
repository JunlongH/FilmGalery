import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@heroui/react';
import { Save, RotateCcw, X, Crop, RotateCw } from 'lucide-react';
import { developPreview, developSave, getDevelopParams } from '../../api';
import SliderControl from '../FilmLab/SliderControl';

const DEFAULT_PARAMS = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0,
  rotation: 0, crop: { x: 0, y: 0, w: 1, h: 1 },
};

const CONTROLS = [
  { key: 'exposure', label: 'Exposure', min: -100, max: 100 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
];

export default function DigitalDevelop({ photoId, imageUrl, onClose, onSaved }) {
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [previewUrl, setPreviewUrl] = useState(imageUrl);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const debounceRef = useRef(null);
  const imgRef = useRef(null);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Load saved params on mount
  useEffect(() => {
    let cancelled = false;
    getDevelopParams(photoId)
      .then(data => {
        if (!cancelled && data?.params) {
          setParams({ ...DEFAULT_PARAMS, ...data.params });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [photoId]);

  // Debounced preview
  const triggerPreview = useCallback((newParams) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await developPreview({ photoId, params: newParams });
        if (res.previewUrl) setPreviewUrl(res.previewUrl);
      } catch (err) {
        console.error('[DigitalDevelop] Preview failed:', err);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, [photoId]);

  const updateParam = useCallback((key, value) => {
    const newParams = { ...params, [key]: value };
    setParams(newParams);
    triggerPreview(newParams);
  }, [params, triggerPreview]);

  function handleReset() {
    setParams(DEFAULT_PARAMS);
    triggerPreview(DEFAULT_PARAMS);
  }

  function handleRotate() {
    const newRotation = (params.rotation + 90) % 360;
    const newParams = { ...params, rotation: newRotation };
    setParams(newParams);
    triggerPreview(newParams);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await developSave({ photoId, params });
      onSaved?.();
      onClose?.();
    } catch (err) {
      console.error('[DigitalDevelop] Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-zinc-950 text-white">
      {/* Canvas area */}
      <div className="flex-1 flex items-center justify-center relative overflow-hidden">
        <img
          ref={imgRef}
          src={previewUrl}
          alt="preview"
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `rotate(${params.rotation}deg)`,
            transition: 'transform 0.2s',
          }}
        />
        {loading && (
          <div className="absolute top-4 right-4 px-3 py-1.5 rounded-lg bg-black/60 text-sm">
            Rendering...
          </div>
        )}
        {/* Crop overlay */}
        {showCrop && (
          <div
            className="absolute border-2 border-white/70 pointer-events-none"
            style={{
              left: `${params.crop.x * 100}%`,
              top: `${params.crop.y * 100}%`,
              width: `${params.crop.w * 100}%`,
              height: `${params.crop.h * 100}%`,
            }}
          />
        )}
      </div>

      {/* Controls panel */}
      <div className="w-72 flex flex-col bg-zinc-900 border-l border-zinc-800">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h3 className="font-semibold text-sm">Digital Develop</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {CONTROLS.map(({ key, label, min, max }) => (
            <SliderControl
              key={key}
              label={label}
              value={params[key]}
              min={min}
              max={max}
              onChange={(v) => updateParam(key, v)}
            />
          ))}

          {/* Crop / Rotate */}
          <div className="pt-3 mt-3 border-t border-zinc-800 space-y-2">
            <button
              onClick={() => setShowCrop(!showCrop)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm w-full ${showCrop ? 'bg-primary text-white' : 'bg-zinc-800 text-zinc-300'}`}
            >
              <Crop className="w-4 h-4" /> Crop
            </button>
            {showCrop && (
              <div className="grid grid-cols-2 gap-2 px-1">
                <SliderControl label="X" value={params.crop.x} min={0} max={1} step={0.01} onChange={(v) => updateParam('crop', { ...params.crop, x: v })} />
                <SliderControl label="Y" value={params.crop.y} min={0} max={1} step={0.01} onChange={(v) => updateParam('crop', { ...params.crop, y: v })} />
                <SliderControl label="W" value={params.crop.w} min={0.1} max={1} step={0.01} onChange={(v) => updateParam('crop', { ...params.crop, w: v })} />
                <SliderControl label="H" value={params.crop.h} min={0.1} max={1} step={0.01} onChange={(v) => updateParam('crop', { ...params.crop, h: v })} />
              </div>
            )}
            <button
              onClick={handleRotate}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm w-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            >
              <RotateCw className="w-4 h-4" /> Rotate 90°
            </button>
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800">
          <Button variant="light" size="sm" onPress={handleReset}>
            <RotateCcw className="w-4 h-4" /> Reset
          </Button>
          <Button color="primary" size="sm" isLoading={saving} onPress={handleSave}>
            <Save className="w-4 h-4" /> Save
          </Button>
        </div>
      </div>
    </div>
  );
}
