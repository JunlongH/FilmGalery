import React, { useEffect, useState, useRef } from 'react';
import '../styles/forms.css';
import LocationInput from './LocationInput.jsx';
import GeoSearchInput from './GeoSearchInput.jsx';
import { getTags } from '../api';

export default function PhotoMetaEditModal({ roll, photo, onSave, onClose }) {
  const [dateTaken, setDateTaken] = useState(photo.date_taken || '');
  const [timeTaken, setTimeTaken] = useState(photo.time_taken || '');
  const [detailLocation, setDetailLocation] = useState(photo.detail_location || '');
  const [location, setLocation] = useState({ 
    location_id: photo.location_id || null, 
    country_name: photo.country_name || null,
    city_name: photo.city_name || null,
    latitude: photo.latitude, 
    longitude: photo.longitude 
  });
  // Available coordinates from LocationInput (for manual fill)
  const [availableCoords, setAvailableCoords] = useState(null);
  
  // Shooting parameters
  const [camera, setCamera] = useState(photo.camera || '');
  const [lens, setLens] = useState(photo.lens || '');
  const [aperture, setAperture] = useState(photo.aperture != null ? photo.aperture : '');
  const [shutterSpeed, setShutterSpeed] = useState(photo.shutter_speed || '');
  const [iso, setIso] = useState(photo.iso != null ? photo.iso : '');
  const [focalLength, setFocalLength] = useState(photo.focal_length != null ? photo.focal_length : '');

  // Caption & Tags
  const [caption, setCaption] = useState(photo.caption || '');
  const [currentTags, setCurrentTags] = useState(photo.tags ? photo.tags.map(t => t.name || t) : []);
  const [tagInput, setTagInput] = useState('');
  const [allTags, setAllTags] = useState([]);

  useEffect(() => {
    // Load all tags for suggestions
    getTags()
      .then(tags => setAllTags(tags || []))
      .catch(err => console.error('Failed to load tags', err));
  }, []);

  useEffect(() => {
    // Clamp date within roll bounds if provided
    if (dateTaken && roll) {
      const d = new Date(dateTaken);
      const s = roll.start_date ? new Date(roll.start_date) : null;
      const e = roll.end_date ? new Date(roll.end_date) : null;
      if (s && d < s) setDateTaken(roll.start_date);
      if (e && d > e) setDateTaken(roll.end_date);
    }
    // Use roll?.id instead of roll to avoid re-firing on object reference changes
  }, [dateTaken, roll?.id]);

  const onInc = (key, delta) => {
    const next = (location[key] || 0) + delta;
    setLocation(l => ({ ...l, [key]: Math.round(next * 1e6) / 1e6 }));
  };

  const rollMin = roll?.start_date || '';
  const rollMax = roll?.end_date || '';

  return (
    <div className="fg-modal-overlay" onClick={onClose} style={{ zIndex: 10001 }}>
      <div className="fg-modal-panel fg-card" onClick={e => e.stopPropagation()} style={{ width: 700, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ marginTop: 0 }}>Edit Photo Info</h3>
        
        {/* Date & Time */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
          <div className="fg-field">
            <label className="fg-label">Date Taken</label>
            <input className="fg-input" type="date" lang="en" value={dateTaken} min={rollMin} max={rollMax} onChange={e=>setDateTaken(e.target.value)} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Time Taken</label>
            <input className="fg-input" type="time" value={timeTaken} onChange={e=>setTimeTaken(e.target.value)} />
          </div>
        </div>
        
        {/* Shooting Parameters */}
        <fieldset style={{ border: '1px solid var(--fg-border)', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)', padding: '0 8px' }}>Shooting Parameters</legend>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
            <div className="fg-field">
              <label className="fg-label">Camera</label>
              <input className="fg-input" value={camera} onChange={e=>setCamera(e.target.value)} placeholder="e.g., Leica M6" />
            </div>
            <div className="fg-field">
              <label className="fg-label">Lens</label>
              <input className="fg-input" value={lens} onChange={e=>setLens(e.target.value)} placeholder="e.g., Summicron 50mm f/2" />
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
            <div className="fg-field">
              <label className="fg-label">Aperture</label>
              <input className="fg-input" type="number" step="0.1" min="0.5" max="64" value={aperture} onChange={e=>setAperture(e.target.value)} placeholder="e.g., 2.8" />
            </div>
            <div className="fg-field">
              <label className="fg-label">Shutter</label>
              <input className="fg-input" value={shutterSpeed} onChange={e=>setShutterSpeed(e.target.value)} placeholder="e.g., 1/125" />
            </div>
            <div className="fg-field">
              <label className="fg-label">ISO</label>
              <input className="fg-input" type="number" min="6" max="25600" value={iso} onChange={e=>setIso(e.target.value)} placeholder="e.g., 400" />
            </div>
            <div className="fg-field">
              <label className="fg-label">Focal (mm)</label>
              <input className="fg-input" type="number" step="1" min="1" max="2000" value={focalLength} onChange={e=>setFocalLength(e.target.value)} placeholder="e.g., 50" />
            </div>
          </div>
        </fieldset>
        
        {/* Location */}
        <div style={{ marginTop: 12 }}>
          <label className="fg-label">Location (Country / City)</label>
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
                return;
              }
              setLocation(prev => ({
                ...prev,
                location_id: loc.location_id || null,
                country_name: loc.country_name || null,
                city_name: loc.city_name || null
                // latitude and longitude are preserved
              }));
            }}
            onCoordinatesAvailable={setAvailableCoords}
          />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8, marginTop: 8 }}>
          <div className="fg-field">
            <label className="fg-label">Latitude</label>
            <div style={{ display:'flex', gap:6 }}>
              <input className="fg-input" type="number" value={location.latitude || ''} onChange={e=>setLocation(l=>({ ...l, latitude: parseFloat(e.target.value) }))} />
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <button type="button" className="fg-btn fg-btn-secondary" onClick={()=>onInc('latitude', 0.0001)}>+ nudge</button>
                <button type="button" className="fg-btn fg-btn-secondary" onClick={()=>onInc('latitude', -0.0001)}>- nudge</button>
              </div>
            </div>
          </div>
          <div className="fg-field">
            <label className="fg-label">Longitude</label>
            <div style={{ display:'flex', gap:6 }}>
              <input className="fg-input" type="number" value={location.longitude || ''} onChange={e=>setLocation(l=>({ ...l, longitude: parseFloat(e.target.value) }))} />
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                <button type="button" className="fg-btn fg-btn-secondary" onClick={()=>onInc('longitude', 0.0001)}>+ nudge</button>
                <button type="button" className="fg-btn fg-btn-secondary" onClick={()=>onInc('longitude', -0.0001)}>- nudge</button>
              </div>
            </div>
          </div>
        </div>
        {/* Fill coordinates button */}
        {availableCoords && (
          <div style={{ marginTop: 8 }}>
            <button 
              type="button" 
              className="fg-btn fg-btn-secondary" 
              onClick={() => {
                setLocation(l => ({
                  ...l,
                  latitude: availableCoords.lat,
                  longitude: availableCoords.lng
                }));
                setAvailableCoords(null);
              }}
              style={{ width: '100%' }}
            >
              📍 Fill Coordinates ({availableCoords.lat.toFixed(4)}, {availableCoords.lng.toFixed(4)})
            </button>
          </div>
        )}
        <div className="fg-field" style={{ marginTop: 8 }}>
          <label className="fg-label">Detail Location</label>
          <GeoSearchInput
            value={detailLocation}
            onChange={setDetailLocation}
            onSelect={(result) => {
              setLocation(l => ({
                ...l,
                latitude: result.latitude,
                longitude: result.longitude
              }));
              if (result.detail) {
                setDetailLocation(result.detail);
              }
            }}
            placeholder="Search address or type detail..."
          />
        </div>

        {/* Caption */}
        <fieldset style={{ border: '1px solid var(--fg-border)', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)', padding: '0 8px' }}>Caption</legend>
          <div className="fg-field">
            <textarea 
              className="fg-textarea" 
              style={{ minHeight: 60, resize: 'vertical', width: '100%' }} 
              placeholder="Add a description or caption for this photo..." 
              value={caption} 
              onChange={e => setCaption(e.target.value)} 
            />
          </div>
        </fieldset>

        {/* Tags */}
        <fieldset style={{ border: '1px solid var(--fg-border)', borderRadius: 8, padding: 12, marginTop: 12 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-muted)', padding: '0 8px' }}>Tags</legend>
          {/* Current Tags */}
          {currentTags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
              {currentTags.map(tag => (
                <span 
                  key={tag} 
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
                    onClick={() => setCurrentTags(prev => prev.filter(t => t !== tag))}
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
          <div style={{ display: 'flex', gap: 6 }}>
            <input 
              className="fg-input" 
              type="text"
              list="modal-tag-suggestions"
              placeholder="Add tag..." 
              value={tagInput} 
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  e.preventDefault();
                  if (!currentTags.includes(tagInput.trim())) {
                    setCurrentTags(prev => [...prev, tagInput.trim()]);
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
                }
                setTagInput('');
              }}
              style={{ padding: '0 12px' }}
            >
              +
            </button>
          </div>
          <datalist id="modal-tag-suggestions">
            {allTags
              .filter(t => t.photos_count > 0)
              .filter(t => !currentTags.includes(t.name))
              .filter(t => !tagInput || t.name.toLowerCase().includes(tagInput.toLowerCase()))
              .map(t => <option key={t.id} value={t.name} />)
            }
          </datalist>
        </fieldset>

        <div className="fg-actions" style={{ marginTop: 12 }}>
          <button type="button" className="fg-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="fg-btn fg-btn-primary" onClick={() => onSave({ 
            date_taken: dateTaken || null, 
            time_taken: timeTaken || null, 
            location_id: location.location_id || null,
            country: location.country_name || null,
            city: location.city_name || null,
            detail_location: detailLocation || null, 
            latitude: location.latitude ?? null, 
            longitude: location.longitude ?? null,
            camera: camera || null,
            lens: lens || null,
            aperture: aperture !== '' ? parseFloat(aperture) : null,
            shutter_speed: shutterSpeed || null,
            iso: iso !== '' ? parseInt(iso) : null,
            focal_length: focalLength !== '' ? parseFloat(focalLength) : null,
            caption: caption || null,
            tags: currentTags
          })}>Save</button>
        </div>
      </div>
    </div>
  );
}
