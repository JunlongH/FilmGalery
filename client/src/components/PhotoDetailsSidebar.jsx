import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import LocationInput from './LocationInput.jsx';
import GeoSearchInput from './GeoSearchInput.jsx';
import { getMetadataOptions, getApiBase, getTags, getAlbumsForPhoto } from '../api';
import { getCacheStrategy } from '../lib';
import EquipmentSelector from './EquipmentSelector';
import { lazyModal } from './common/lazyModal';
import { reverseGeocode } from '../utils/geocoding';
import { isValidLatitude, isValidLongitude } from '@filmgallery/shared/mapUtils';
import '../styles/forms.css';
import '../styles/sidebar.css';

// Lazy-load LocationPickerModal (Leaflet is heavy — don't include in initial bundle).
const LocationPickerModal = lazyModal(() => import('./map/LocationPickerModal.jsx'));

// Field definitions for modular saving
const FIELD_GROUPS = {
  caption: ['caption'],
  tags: ['tags'],
  time: ['date_taken', 'time_taken'],
  equipment: ['camera', 'lens', 'camera_equip_id', 'lens_equip_id', 'photographer'],
  params: ['aperture', 'shutter_speed', 'iso', 'focal_length'],
  location: ['location_id', 'country', 'city', 'detail_location', 'latitude', 'longitude'],
  scanning: ['scanner_equip_id', 'scan_resolution', 'scan_software', 'scan_lab', 'scan_date', 'scan_cost', 'scan_notes'],
  // Note: digital source fields (source_make, etc.) are read-only display, not in FIELD_GROUPS
};

const ALL_FIELDS = Object.values(FIELD_GROUPS).flat();

export default function PhotoDetailsSidebar({ photo, photos, roll, onClose, onSaved }) {
  const isBatch = Array.isArray(photos) && photos.length > 1;
  const base = photo || (isBatch ? photos[0] : null);
  const navigate = useNavigate();
  const isDigital = base?.source_type === 'digital';

  const { data: photoAlbums = [] } = useQuery({
    queryKey: ['photo-albums', base?.id],
    queryFn: () => getAlbumsForPhoto(base.id),
    enabled: !isBatch && isDigital && !!base?.id,
    ...getCacheStrategy('photoAlbums'),
  });
  
  // Dirty fields tracking
  const [dirtyFields, setDirtyFields] = useState(new Set());

  // Use refs to avoid object-reference-trap: base and roll objects change reference
  // on every React Query background refetch, which would wipe unsaved edits
  const baseRef = useRef(base);
  baseRef.current = base;
  const rollRef = useRef(roll);
  rollRef.current = roll;

  // Form States
  const [dateTaken, setDateTaken] = useState(base?.date_taken || '');
  const [timeTaken, setTimeTaken] = useState(base?.time_taken || '');
  
  const [camera, setCamera] = useState(base?.camera || roll?.camera || '');
  const [lens, setLens] = useState(base?.lens || roll?.lens || '');
  const [cameraEquipId, setCameraEquipId] = useState(base?.camera_equip_id || roll?.camera_equip_id || null);
  const [lensEquipId, setLensEquipId] = useState(base?.lens_equip_id || roll?.lens_equip_id || null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [photographer, setPhotographer] = useState(base?.photographer || roll?.photographer || '');
  
  const [aperture, setAperture] = useState(base?.aperture != null ? base.aperture : '');
  const [shutterSpeed, setShutterSpeed] = useState(base?.shutter_speed || '');
  const [iso, setIso] = useState(base?.iso != null ? base.iso : '');
  const [focalLength, setFocalLength] = useState(base?.focal_length != null ? base.focal_length : '');
  
  const [detailLocation, setDetailLocation] = useState(base?.detail_location || '');
  const [location, setLocation] = useState({
    location_id: base?.location_id || null,
    country_name: base?.country_name || null,
    city_name: base?.city_name || null,
    latitude: base?.latitude,
    longitude: base?.longitude,
  });
  // Available coordinates from LocationInput (for manual fill)
  const [availableCoords, setAvailableCoords] = useState(null);
  // Location picker modal visibility
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  
  const [scannerEquipId, setScannerEquipId] = useState(base?.scanner_equip_id || roll?.scanner_equip_id || null);
  const [scanResolution, setScanResolution] = useState(base?.scan_resolution || roll?.scan_resolution || '');
  const [scanSoftware, setScanSoftware] = useState(base?.scan_software || roll?.scan_software || '');
  const [scanLab, setScanLab] = useState(base?.scan_lab || roll?.scan_lab || '');
  const [scanDate, setScanDate] = useState(base?.scan_date || roll?.scan_date || '');
  const [scanCost, setScanCost] = useState(base?.scan_cost || roll?.scan_cost || '');
  const [scanNotes, setScanNotes] = useState(base?.scan_notes || roll?.scan_notes || '');
  
  // Caption & Tags
  const [caption, setCaption] = useState(base?.caption || '');
  const [currentTags, setCurrentTags] = useState(base?.tags ? base.tags.map(t => t.name || t) : []);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState([]);

  const [options, setOptions] = useState({ cameras: [], lenses: [], photographers: [] });

  // Load metadata options for autocomplete
  useEffect(() => {
    getMetadataOptions()
      .then(opts => setOptions(opts || { cameras: [], lenses: [], photographers: [] }))
      .catch(err => console.error('Failed to load metadata options', err));
    // Load all tags for suggestions
    getTags()
      .then(tags => setAllTags(tags || []))
      .catch(err => console.error('Failed to load tags', err));
  }, []);

  // Update states when photo changes (for navigation between photos)
  useEffect(() => {
    const currentBase = baseRef.current;
    const currentRoll = rollRef.current;
    if (!currentBase) return;
    // Reset dirty fields when switching base photo
    setDirtyFields(new Set());

    setDateTaken(currentBase.date_taken || '');
    setTimeTaken(currentBase.time_taken || '');
    setCamera(currentBase.camera || currentRoll?.camera || '');
    setLens(currentBase.lens || currentRoll?.lens || '');
    setCameraEquipId(currentBase.camera_equip_id || currentRoll?.camera_equip_id || null);
    setLensEquipId(currentBase.lens_equip_id || currentRoll?.lens_equip_id || null);
    setPhotographer(currentBase.photographer || currentRoll?.photographer || '');
    setAperture(currentBase.aperture != null ? currentBase.aperture : '');
    setShutterSpeed(currentBase.shutter_speed || '');
    setIso(currentBase.iso != null ? currentBase.iso : '');
    setFocalLength(currentBase.focal_length != null ? currentBase.focal_length : '');
    setDetailLocation(currentBase.detail_location || '');
    setLocation({
      location_id: currentBase.location_id || null,
      country_name: currentBase.country_name || null,
      city_name: currentBase.city_name || null,
      latitude: currentBase.latitude,
      longitude: currentBase.longitude,
    });
    setScannerEquipId(currentBase.scanner_equip_id || currentRoll?.scanner_equip_id || null);
    setScanResolution(currentBase.scan_resolution || currentRoll?.scan_resolution || '');
    setScanSoftware(currentBase.scan_software || currentRoll?.scan_software || '');
    setScanLab(currentBase.scan_lab || currentRoll?.scan_lab || '');
    setScanDate(currentBase.scan_date || currentRoll?.scan_date || '');
    setScanCost(currentBase.scan_cost || currentRoll?.scan_cost || '');
    setScanNotes(currentBase.scan_notes || currentRoll?.scan_notes || '');
    // Caption & Tags
    setCaption(currentBase.caption || '');
    setCurrentTags(currentBase.tags ? currentBase.tags.map(t => t.name || t) : []);
    setTagInput('');
  }, [base?.id, roll?.id]);

  // Dirty marking helper
  const markDirty = (fields) => {
    const fieldArray = Array.isArray(fields) ? fields : [fields];
    setDirtyFields(prev => {
      const next = new Set(prev);
      fieldArray.forEach(f => next.add(f));
      return next;
    });
  };

  const isSectionDirty = (sectionName) => {
    const sectionFields = FIELD_GROUPS[sectionName];
    return sectionFields ? sectionFields.some(f => dirtyFields.has(f)) : false;
  };

  const hasAnyDirty = dirtyFields.size > 0;

  // --- Location picker handlers ---
  const currentLocationValue = location.latitude && location.longitude ? {
    latitude: location.latitude,
    longitude: location.longitude,
    country: location.country_name || '',
    city: location.city_name || '',
    detail_location: detailLocation || '',
  } : null;

  const handlePickConfirm = (value) => {
    setLocation(prev => ({
      ...prev,
      latitude: value.latitude,
      longitude: value.longitude,
      country_name: value.country || prev.country_name,
      city_name: value.city || prev.city_name,
    }));
    if (value.detail_location) setDetailLocation(value.detail_location);
    markDirty(['latitude', 'longitude', 'country', 'city', 'detail_location']);
    setShowLocationPicker(false);
  };

  const handleReverseGeocode = async () => {
    if (!location.latitude || !location.longitude) return;
    const result = await reverseGeocode(location.latitude, location.longitude);
    if (result.displayName) {
      setDetailLocation(result.displayName);
      markDirty('detail_location');
    }
    if (result.country) {
      setLocation(prev => ({ ...prev, country_name: result.country }));
      markDirty('country');
    }
    if (result.city) {
      setLocation(prev => ({ ...prev, city_name: result.city }));
      markDirty('city');
    }
  };

  // ±0.0001 nudge (≈11 m, matching the deprecated PhotoMetaEditModal step).
  const nudgeCoordinate = (field, delta) => {
    setLocation(prev => {
      const current = prev[field];
      if (current == null) return prev;
      const next = Number((current + delta).toFixed(6));
      return { ...prev, [field]: next };
    });
    markDirty(field);
  };

  const latInvalid = location.latitude != null && !isValidLatitude(location.latitude);
  const lngInvalid = location.longitude != null && !isValidLongitude(location.longitude);

  // Retrieve current value for a field key
  const getFieldValue = (field) => {
    switch (field) {
      case 'caption': return caption || null;
      case 'tags': return currentTags;
      case 'date_taken': return dateTaken || null;
      case 'time_taken': return timeTaken || null;
      case 'location_id': return location.location_id || null;
      case 'country': return location.country_name || null;
      case 'city': return location.city_name || null;
      case 'detail_location': return detailLocation || null;
      case 'latitude': return location.latitude ?? null;
      case 'longitude': return location.longitude ?? null;
      case 'camera': return camera || null;
      case 'lens': return lens || null;
      case 'camera_equip_id': return cameraEquipId || null;
      case 'lens_equip_id': return lensEquipId || null;
      case 'photographer': return photographer || null;
      case 'aperture': return aperture !== '' ? parseFloat(aperture) : null;
      case 'shutter_speed': return shutterSpeed || null;
      case 'iso': return iso !== '' ? parseInt(iso) : null;
      case 'focal_length': return focalLength !== '' ? parseFloat(focalLength) : null;
      case 'scanner_equip_id': return scannerEquipId || null;
      case 'scan_resolution': return scanResolution || null;
      case 'scan_software': return scanSoftware || null;
      case 'scan_lab': return scanLab || null;
      case 'scan_date': return scanDate || null;
      case 'scan_cost': return scanCost || null;
      case 'scan_notes': return scanNotes || null;
      default: return null;
    }
  };

  async function handleSave(targetSection = null) {
    const payload = {};
    
    // Determine which fields to save
    const candidateFields = targetSection 
      ? FIELD_GROUPS[targetSection] 
      : ALL_FIELDS;

    // Only include dirty fields
    candidateFields.forEach(field => {
      if (dirtyFields.has(field)) {
        payload[field] = getFieldValue(field);
      }
    });

    if (Object.keys(payload).length === 0) {
      return; // Nothing to save
    }

    try {
      const targets = isBatch ? photos : [photo];
      const apiBase = getApiBase();
      let failed = 0;
      for (const p of targets) {
        const res = await fetch(`${apiBase}/api/photos/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r => (r.ok ? null : new Error(`HTTP ${r.status}`))).catch(err => err);
        if (res) failed++;
      }
      if (failed > 0) {
        throw new Error(`${failed}/${targets.length} 张照片保存失败`);
      }

      // Cleanup saved fields from dirty state
      setDirtyFields(prev => {
        const next = new Set(prev);
        Object.keys(payload).forEach(f => next.delete(f));
        return next;
      });

      // Notify parent
      if (!targetSection) {
        // Global save
        onSaved && onSaved(payload);
        onClose && onClose();
      } else {
        // Section save - keep open but maybe show feedback in future
        onSaved && onSaved(payload); 
      }
    } catch (e) {
      console.error('Batch/Single save failed', e);
      // Don't close on error
    }
  }

  // focus trap
  const panelRef = React.useRef(null);
  useEffect(()=>{
    const first = panelRef.current?.querySelector('input,select,textarea,button');
    first && first.focus();
    function onKey(e){ if(e.key==='Escape') onClose && onClose(); }
    window.addEventListener('keydown', onKey);
    return ()=> window.removeEventListener('keydown', onKey);
  },[onClose]);

  const [closing, setClosing] = useState(false);
  const handleClose = () => { setClosing(true); setTimeout(()=> onClose && onClose(), 200); };

  const SectionHeader = ({ title, sectionKey }) => (
    <div className="fg-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
      <div className="fg-section-label">{title}</div>
      <button 
        type="button" 
        className="fg-btn-mini" 
        style={{ 
          fontSize: '0.75rem', 
          padding: '2px 8px', 
          opacity: isSectionDirty(sectionKey) ? 1 : 0.5,
          cursor: isSectionDirty(sectionKey) ? 'pointer' : 'default',
          border: '1px solid currentColor',
          borderRadius: 4,
          background: 'transparent'
        }}
        disabled={!isSectionDirty(sectionKey)}
        onClick={() => handleSave(sectionKey)}
      >
        Save
      </button>
    </div>
  );

  return (
    <div
      role="presentation"
      onClick={() => { if (!showLocationPicker) handleClose(); }}
      style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.25)', zIndex:10019 }}
    >
    <aside
      ref={panelRef}
      className={`fg-sidepanel ${closing ? 'fade-slide-exit-active' : 'fade-slide-enter-active'}`}
      role="dialog"
      aria-modal="true"
      aria-label={isBatch ? 'Batch edit photos' : 'Photo details'}
      onClick={(e)=> e.stopPropagation()}
    >
      <header className="fg-sidepanel-header">
        <h3 className="fg-sidepanel-title">{isBatch ? `Batch Editing (${photos.length})` : 'Photo Details'}</h3>
        <button className="fg-sidepanel-close" onClick={handleClose} aria-label="Close sidebar">×</button>
      </header>

      {/* --- ALBUMS SECTION (digital only) --- */}
      {!isBatch && isDigital && photoAlbums.length > 0 && (
      <section className="fg-sidepanel-section">
        <div className="fg-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="fg-section-label">所在相册</div>
        </div>
        <div className="fg-separator" />
        <div className="fg-field" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {photoAlbums.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => { onClose && onClose(); navigate(`/albums/${a.id}`); }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                background: 'var(--fg-info-bg, #e0f2fe)',
                color: 'var(--fg-info-text, #075985)',
                fontSize: '0.85rem'
              }}
            >
              {a.title}（{a.photo_count ?? 0}）
            </button>
          ))}
        </div>
      </section>
      )}

      {/* --- TIME SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Time" sectionKey="time" />
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Date Taken</label>
            <input 
              className="fg-input" 
              type="date" 
              lang="en" 
              value={dateTaken} 
              onChange={e=>{ setDateTaken(e.target.value); markDirty('date_taken'); }} 
              min={roll?.start_date || ''} 
              max={roll?.end_date || ''} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Time Taken</label>
            <input 
              className="fg-input" 
              type="time" 
              value={timeTaken} 
              onChange={e=>{ setTimeTaken(e.target.value); markDirty('time_taken'); }} 
            />
          </div>
        </div>
      </section>

       {/* --- EQUIPMENT SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Equipment & Photographer" sectionKey="equipment" />
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Camera</label>
            <EquipmentSelector 
              type="camera" 
              mode={photo?.source_type === 'digital' ? 'digital' : 'film'}
              value={cameraEquipId} 
              onChange={(id, item) => {
                setCameraEquipId(id);
                setSelectedCamera(item);
                setCamera(item ? `${item.brand} ${item.model}` : '');
                
                const dirtyList = ['camera_equip_id', 'camera'];
                // If camera has fixed lens, clear lens selection
                if (item?.has_fixed_lens) {
                  setLensEquipId(null);
                  setLens(item.fixed_lens_focal_length ? `${item.fixed_lens_focal_length}mm f/${item.fixed_lens_max_aperture || '?'}` : 'Fixed');
                  dirtyList.push('lens_equip_id', 'lens');
                }
                markDirty(dirtyList);
              }}
              placeholder={roll?.camera ? `Default: ${roll.camera}` : 'Select camera...'}
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Lens</label>
            {selectedCamera?.has_fixed_lens ? (
              <div className="fg-input" style={{ background: '#f5f5f5', cursor: 'not-allowed', color: '#666', display: 'flex', alignItems: 'center' }}>
                Fixed: {selectedCamera.fixed_lens_focal_length ? `${selectedCamera.fixed_lens_focal_length}mm` : 'Built-in'} 
                {selectedCamera.fixed_lens_max_aperture ? ` f/${selectedCamera.fixed_lens_max_aperture}` : ''}
              </div>
            ) : (
              <EquipmentSelector 
                type="lens" 
                mode={photo?.source_type === 'digital' ? 'digital' : 'film'}
                value={lensEquipId} 
                cameraId={cameraEquipId} 
                onChange={(id, item) => {
                  setLensEquipId(id);
                  setLens(item ? `${item.brand} ${item.model}` : '');
                  markDirty(['lens_equip_id', 'lens']);
                }}
                placeholder={roll?.lens ? `Default: ${roll.lens}` : 'Select lens...'}
              />
            )}
          </div>
        </div>
        <div className="fg-sidepanel-groupGrid cols-1" style={{ marginTop: 8 }}>
          <div className="fg-field">
            <label className="fg-label">Photographer</label>
            <input 
              className="fg-input" 
              type="text" 
              list="photographer-options"
              placeholder={roll?.photographer ? `Default: ${roll.photographer}` : 'e.g. Xiaoming'} 
              value={photographer} 
              onChange={e=>{ setPhotographer(e.target.value); markDirty('photographer'); }} 
            />
            <datalist id="photographer-options">
              {(options.photographers || []).map((p, i) => <option key={i} value={p} />)}
            </datalist>
          </div>
        </div>
      </section>

      {/* --- PARAMS SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Shooting Parameters" sectionKey="params" />
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-4">
          <div className="fg-field">
            <label className="fg-label">Aperture</label>
            <input 
              className="fg-input" 
              type="number" 
              step="0.1"
              min="0.5"
              max="64"
              placeholder="e.g. 2.8" 
              value={aperture} 
              onChange={e=>{ setAperture(e.target.value); markDirty('aperture'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Shutter</label>
            <input 
              className="fg-input" 
              type="text" 
              placeholder="e.g. 1/125" 
              value={shutterSpeed} 
              onChange={e=>{ setShutterSpeed(e.target.value); markDirty('shutter_speed'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">ISO</label>
            <input 
              className="fg-input" 
              type="number" 
              min="6"
              max="25600"
              placeholder="e.g. 400" 
              value={iso} 
              onChange={e=>{ setIso(e.target.value); markDirty('iso'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Focal (mm)</label>
            <input 
              className="fg-input" 
              type="number" 
              step="1"
              min="1"
              max="2000"
              placeholder="e.g. 50" 
              value={focalLength} 
              onChange={e=>{ setFocalLength(e.target.value); markDirty('focal_length'); }} 
            />
          </div>
        </div>
      </section>

      {/* --- LOCATION SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Location" sectionKey="location" />
        <div className="fg-separator" />
        <div className="fg-field">
          <label className="fg-label">Country / City</label>
          <LocationInput 
            value={location} 
            onChange={(loc) => {
              if (!loc) {
                // Only clear location info, KEEP coordinates
                setLocation(prev => ({
                  ...prev,
                  location_id: null,
                  country_name: null,
                  city_name: null
                  // latitude and longitude are preserved
                }));
                markDirty(['location_id', 'country', 'city']);
                return;
              }
              setLocation(prev => ({
                ...prev,
                location_id: loc.location_id || null,
                country_name: loc.country_name || null,
                city_name: loc.city_name || null
                // latitude and longitude are preserved
              }));
              markDirty(['location_id', 'country', 'city']);
            }}
            onCoordinatesAvailable={setAvailableCoords}
          />
        </div>
        {/* Fill coordinates button */}
        {availableCoords && (
          <div className="fg-field">
            <button 
              type="button" 
              className="fg-btn fg-btn-secondary" 
              onClick={() => {
                setLocation(l => ({
                  ...l,
                  latitude: availableCoords.lat,
                  longitude: availableCoords.lng
                }));
                markDirty(['latitude', 'longitude']);
                setAvailableCoords(null);
              }}
              style={{ width: '100%' }}
            >
              📍 Fill Coordinates ({availableCoords.lat.toFixed(4)}, {availableCoords.lng.toFixed(4)})
            </button>
          </div>
        )}
        {/* Pick on map + reverse geocode buttons */}
        <div className="fg-field" style={{ display: 'flex', gap: 4 }}>
          <button
            type="button"
            className="fg-btn fg-btn-secondary"
            onClick={() => setShowLocationPicker(true)}
            style={{ flex: 1 }}
          >
            📍 在地图上选择
          </button>
          <button
            type="button"
            className="fg-btn fg-btn-secondary"
            onClick={handleReverseGeocode}
            disabled={!location.latitude || !location.longitude}
            title="反查地址"
            style={{ flex: 1 }}
          >
            🔄 反查地址
          </button>
        </div>
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Latitude</label>
            <div className="fg-input-group">
              <button
                type="button"
                className="fg-btn fg-btn-sm fg-btn-nudge"
                onClick={() => nudgeCoordinate('latitude', -0.0001)}
                disabled={location.latitude == null}
                title="−0.0001"
              >
                −
              </button>
              <input
                className={`fg-input ${latInvalid ? 'fg-input-error' : ''}`}
                type="number"
                step="0.0001"
                value={location.latitude || ''}
                onChange={e=>{
                  setLocation(l=>({ ...l, latitude: parseFloat(e.target.value) }));
                  markDirty('latitude');
                }}
              />
              <button
                type="button"
                className="fg-btn fg-btn-sm fg-btn-nudge"
                onClick={() => nudgeCoordinate('latitude', +0.0001)}
                disabled={location.latitude == null}
                title="+0.0001"
              >
                +
              </button>
            </div>
          </div>
          <div className="fg-field">
            <label className="fg-label">Longitude</label>
            <div className="fg-input-group">
              <button
                type="button"
                className="fg-btn fg-btn-sm fg-btn-nudge"
                onClick={() => nudgeCoordinate('longitude', -0.0001)}
                disabled={location.longitude == null}
                title="−0.0001"
              >
                −
              </button>
              <input
                className={`fg-input ${lngInvalid ? 'fg-input-error' : ''}`}
                type="number"
                step="0.0001"
                value={location.longitude || ''}
                onChange={e=>{
                  setLocation(l=>({ ...l, longitude: parseFloat(e.target.value) }));
                  markDirty('longitude');
                }}
              />
              <button
                type="button"
                className="fg-btn fg-btn-sm fg-btn-nudge"
                onClick={() => nudgeCoordinate('longitude', +0.0001)}
                disabled={location.longitude == null}
                title="+0.0001"
              >
                +
              </button>
            </div>
          </div>
        </div>
        <div className="fg-field">
          <label className="fg-label">Detail Location</label>
          <GeoSearchInput
            value={detailLocation}
            onChange={(val) => {
               setDetailLocation(val);
               markDirty('detail_location');
            }}
            onSelect={(result) => {
              // 更新经纬度
              setLocation(l => ({
                ...l,
                latitude: result.latitude,
                longitude: result.longitude
              }));
              // 更新 detail location 文本
              if (result.detail) {
                setDetailLocation(result.detail);
              }
              // Mark everything dirty
              markDirty(['detail_location', 'latitude', 'longitude']);
            }}
            placeholder="Search address or type detail..."
          />
        </div>
      </section>

      {/* --- SCANNING SECTION (film only) --- */}
      {base?.source_type !== 'digital' && (
      <section className="fg-sidepanel-section">
        <SectionHeader title="Scanning Info" sectionKey="scanning" />
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Scanner</label>
            <EquipmentSelector 
              type="scanner" 
              value={scannerEquipId} 
              onChange={(id) => {
                setScannerEquipId(id);
                markDirty('scanner_equip_id');
              }}
              placeholder="Select scanner..."
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Lab</label>
            <input 
              className="fg-input" 
              placeholder="e.g. Film Lab, Home scan" 
              value={scanLab} 
              onChange={e=>{ setScanLab(e.target.value); markDirty('scan_lab'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Date</label>
            <input 
              className="fg-input" 
              type="date" 
              value={scanDate} 
              onChange={e=>{ setScanDate(e.target.value); markDirty('scan_date'); }} 
              lang="en-US" 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Resolution (DPI)</label>
            <input 
              className="fg-input" 
              type="number" 
              placeholder="e.g. 3200, 4800" 
              value={scanResolution} 
              onChange={e=>{ setScanResolution(e.target.value); markDirty('scan_resolution'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Software</label>
            <input 
              className="fg-input" 
              placeholder="e.g. VueScan, Epson Scan 2" 
              value={scanSoftware} 
              onChange={e=>{ setScanSoftware(e.target.value); markDirty('scan_software'); }} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Cost</label>
            <input 
              className="fg-input" 
              type="number" 
              placeholder="0.00" 
              value={scanCost} 
              onChange={e=>{ setScanCost(e.target.value); markDirty('scan_cost'); }} 
            />
          </div>
        </div>
        <div className="fg-field" style={{ marginTop: 8 }}>
          <label className="fg-label">Scan Notes</label>
          <textarea 
            className="fg-textarea" 
            style={{ minHeight: 60, resize: 'vertical' }} 
            placeholder="Scan parameters, issues, etc..." 
            value={scanNotes} 
            onChange={e=>{ setScanNotes(e.target.value); markDirty('scan_notes'); }} 
          />
        </div>
      </section>
      )}

      {/* --- DIGITAL SOURCE SECTION (digital only) --- */}
      {base?.source_type === 'digital' && (
      <section className="fg-sidepanel-section">
        <SectionHeader title="Digital Source" sectionKey="digital" />
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Camera Make</label>
            <input className="fg-input" placeholder="—" value={base?.source_make || ''} readOnly />
          </div>
          <div className="fg-field">
            <label className="fg-label">Camera Model</label>
            <input className="fg-input" placeholder="—" value={base?.source_model || ''} readOnly />
          </div>
          <div className="fg-field">
            <label className="fg-label">Software</label>
            <input className="fg-input" placeholder="—" value={base?.source_software || ''} readOnly />
          </div>
          <div className="fg-field">
            <label className="fg-label">Lens</label>
            <input className="fg-input" placeholder="—" value={base?.source_lens || ''} readOnly />
          </div>
          <div className="fg-field">
            <label className="fg-label">Color Space</label>
            <input className="fg-input" placeholder="—" value={base?.color_space || ''} readOnly />
          </div>
          <div className="fg-field">
            <label className="fg-label">White Balance</label>
            <input className="fg-input" placeholder="—" value={base?.white_balance || ''} readOnly />
          </div>
        </div>
      </section>
      )}

      {/* --- CAPTION SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Caption" sectionKey="caption" />
        <div className="fg-separator" />
        <div className="fg-field">
          <textarea 
            className="fg-textarea" 
            style={{ minHeight: 80, resize: 'vertical' }} 
            placeholder="Add a description or caption for this photo..." 
            value={caption} 
            onChange={e=>{ setCaption(e.target.value); markDirty('caption'); }} 
          />
        </div>
      </section>

      {/* --- TAGS SECTION --- */}
      <section className="fg-sidepanel-section">
        <SectionHeader title="Tags" sectionKey="tags" />
        <div className="fg-separator" />
        {/* Current Tags */}
        {currentTags.length > 0 && (
          <div className="fg-field" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentTags.map(tag => (
              <span 
                key={tag} 
                className="fg-tag-chip"
                style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 12,
                  background: 'var(--fg-success-bg, #dcfce7)',
                  color: 'var(--fg-success-text, #166534)',
                  fontSize: '0.85rem'
                }}
              >
                {tag}
                <button 
                  type="button"
                  onClick={() => { 
                    setCurrentTags(prev => prev.filter(t => t !== tag)); 
                    markDirty('tags'); 
                  }}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    cursor: 'pointer', 
                    padding: 0,
                    lineHeight: 1,
                    color: 'inherit',
                    opacity: 0.6
                  }}
                  aria-label={`Remove tag ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {/* Tag Input */}
        <div className="fg-field" style={{ marginTop: currentTags.length > 0 ? 8 : 0 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input 
              className="fg-input" 
              type="text"
              list="tag-suggestions"
              placeholder="Add tag..." 
              value={tagInput} 
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault();
                  if (!currentTags.includes(tagInput.trim())) {
                    setCurrentTags(prev => [...prev, tagInput.trim()]);
                    markDirty('tags');
                  }
                  setTagInput('');
                }
              }}
              style={{ flex: 1 }}
            />
            <button 
              type="button" 
              className="fg-btn fg-btn-secondary"
              disabled={!tagInput.trim()}
              onClick={() => {
                if (tagInput.trim() && !currentTags.includes(tagInput.trim())) {
                  setCurrentTags(prev => [...prev, tagInput.trim()]);
                  markDirty('tags');
                }
                setTagInput('');
              }}
              style={{ padding: '0 12px' }}
            >
              +
            </button>
          </div>
          <datalist id="tag-suggestions">
            {allTags
              .filter(t => t.photos_count > 0)
              .filter(t => !currentTags.includes(t.name))
              .filter(t => !tagInput || t.name.toLowerCase().includes(tagInput.toLowerCase()))
              .map(t => <option key={t.id} value={t.name} />)
            }
          </datalist>
        </div>
      </section>

      <section className="fg-sidepanel-section" style={{ marginTop:'auto' }}>
        <div className="fg-separator" />
        <div className="fg-sidepanel-actions">
          <button type="button" className="fg-btn" onClick={handleClose}>Cancel</button>
          <button 
            type="button" 
            className="fg-btn fg-btn-primary" 
            onClick={() => handleSave(null)}
            disabled={!hasAnyDirty}
            style={{ opacity: hasAnyDirty ? 1 : 0.6 }}
          >
            Save All {hasAnyDirty && `(${dirtyFields.size})`} changes
          </button>
        </div>
      </section>
    </aside>

    {/* Location picker modal (lazy-loaded) */}
    <LocationPickerModal
      isOpen={showLocationPicker}
      initialValue={currentLocationValue}
      onConfirm={handlePickConfirm}
      onCancel={() => setShowLocationPicker(false)}
    />
    </div>
  );
}
