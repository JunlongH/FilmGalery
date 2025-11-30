import React, { useEffect, useState } from 'react';
import '../styles/forms.css';
import LocationSelect from './LocationSelect.jsx';

export default function PhotoMetaEditModal({ roll, photo, onSave, onClose }) {
  const [dateTaken, setDateTaken] = useState(photo.date_taken || '');
  const [timeTaken, setTimeTaken] = useState(photo.time_taken || '');
  const [detailLocation, setDetailLocation] = useState(photo.detail_location || '');
  const [location, setLocation] = useState({ location_id: photo.location_id || null, latitude: photo.latitude, longitude: photo.longitude });

  useEffect(() => {
    // Clamp date within roll bounds if provided
    if (dateTaken && roll) {
      const d = new Date(dateTaken);
      const s = roll.start_date ? new Date(roll.start_date) : null;
      const e = roll.end_date ? new Date(roll.end_date) : null;
      if (s && d < s) setDateTaken(roll.start_date);
      if (e && d > e) setDateTaken(roll.end_date);
    }
  }, [dateTaken, roll]);

  const onInc = (key, delta) => {
    const next = (location[key] || 0) + delta;
    setLocation(l => ({ ...l, [key]: Math.round(next * 1e6) / 1e6 }));
  };

  const handleLocationSelect = (loc) => {
    if (!loc) return;
    setLocation({ location_id: loc.location_id, latitude: loc.latitude, longitude: loc.longitude });
  };

  const rollMin = roll?.start_date || '';
  const rollMax = roll?.end_date || '';

  return (
    <div className="iv-overlay" onClick={onClose} style={{ background: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
      <div className="modal-content fg-card" onClick={e => e.stopPropagation()} style={{ background: 'var(--fg-card-bg)', color: 'var(--fg-text)', padding: 20, borderRadius: 12, width: 640 }}>
        <h3 style={{ marginTop: 0 }}>Edit Shooting Info</h3>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 8 }}>
          <div className="fg-field">
            <label className="fg-label">Date Taken</label>
            <input className="fg-input" type="date" value={dateTaken} min={rollMin} max={rollMax} onChange={e=>setDateTaken(e.target.value)} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Time Taken</label>
            <input className="fg-input" type="time" value={timeTaken} onChange={e=>setTimeTaken(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="fg-label">Location (Country / City)</label>
          <LocationSelect value={location.location_id} onChange={handleLocationSelect} />
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
        <div className="fg-field" style={{ marginTop: 8 }}>
          <label className="fg-label">Detail Location</label>
          <input className="fg-input" value={detailLocation} onChange={e=>setDetailLocation(e.target.value)} placeholder="e.g., North Gate, street corner" />
        </div>
        <div className="fg-actions" style={{ marginTop: 12 }}>
          <button type="button" className="fg-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="fg-btn fg-btn-primary" onClick={() => onSave({ date_taken: dateTaken || null, time_taken: timeTaken || null, location_id: location.location_id || null, detail_location: detailLocation || null, latitude: location.latitude ?? null, longitude: location.longitude ?? null })}>Save</button>
        </div>
      </div>
    </div>
  );
}
