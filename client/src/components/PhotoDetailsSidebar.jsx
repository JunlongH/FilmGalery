import React, { useEffect, useState } from 'react';
import LocationSelect from './LocationSelect.jsx';
import { getMetadataOptions } from '../api';
import '../styles/forms.css';
import '../styles/sidebar.css';

export default function PhotoDetailsSidebar({ photo, photos, roll, onClose, onSaved }) {
  const isBatch = Array.isArray(photos) && photos.length > 1;
  const base = photo || (isBatch ? photos[0] : null);
  const [dateTaken, setDateTaken] = useState(base?.date_taken || '');
  const [timeTaken, setTimeTaken] = useState(base?.time_taken || '');
  const [detailLocation, setDetailLocation] = useState(base?.detail_location || '');
  const [camera, setCamera] = useState(base?.camera || roll?.camera || '');
  const [lens, setLens] = useState(base?.lens || roll?.lens || '');
  const [photographer, setPhotographer] = useState(base?.photographer || roll?.photographer || '');
  const [location, setLocation] = useState({
    location_id: base?.location_id || null,
    latitude: base?.latitude,
    longitude: base?.longitude,
  });
  const [options, setOptions] = useState({ cameras: [], lenses: [], photographers: [] });

  // Load metadata options for autocomplete
  useEffect(() => {
    getMetadataOptions()
      .then(opts => setOptions(opts || { cameras: [], lenses: [], photographers: [] }))
      .catch(err => console.error('Failed to load metadata options', err));
  }, []);

  useEffect(() => {
    if (!roll) return;
    if (dateTaken) {
      const d = new Date(dateTaken);
      const s = roll.start_date ? new Date(roll.start_date) : null;
      const e = roll.end_date ? new Date(roll.end_date) : null;
      if (s && d < s) setDateTaken(roll.start_date);
      if (e && d > e) setDateTaken(roll.end_date);
    }
  }, [dateTaken, roll]);

  const handleLocationSelect = (loc) => {
    if (!loc) return;
    setLocation(prev => {
      // If location matches and we already have coordinates, preserve them.
      // Otherwise (location changed OR we have no coords), update to city defaults.
      const hasCoords = prev.latitude != null || prev.longitude != null;
      if (prev.location_id === loc.location_id && hasCoords) return prev;

      return { 
        location_id: loc.location_id, 
        latitude: loc.latitude != null ? Number(loc.latitude) : null, 
        longitude: loc.longitude != null ? Number(loc.longitude) : null 
      };
    });
  };

  async function handleSave() {
    const payload = {
      date_taken: dateTaken || null,
      time_taken: timeTaken || null,
      location_id: location.location_id || null,
      detail_location: detailLocation || null,
      latitude: location.latitude ?? null,
      longitude: location.longitude ?? null,
      camera: camera || null,
      lens: lens || null,
      photographer: photographer || null
    };
    try {
      const API = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000';
      const targets = isBatch ? photos : [photo];
      for (const p of targets) {
        await fetch(`${API}/api/photos/${p.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(r=>r.text()).catch(()=>null);
      }

      // Server-side logic now handles roll metadata sync automatically
      onSaved && onSaved(payload);
      onClose && onClose();
    } catch (e) {
      console.error('Batch/Single save failed', e);
      onClose && onClose();
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
  return (
    <div role="presentation" onClick={handleClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.25)', zIndex:10019 }}>
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

      <section className="fg-sidepanel-section">
        <div className="fg-section-label">Capture</div>
        <div className="fg-separator" />
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Date Taken</label>
            <input className="fg-input" type="date" value={dateTaken} onChange={e=>setDateTaken(e.target.value)} min={roll?.start_date || ''} max={roll?.end_date || ''} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Time Taken</label>
            <input className="fg-input" type="time" value={timeTaken} onChange={e=>setTimeTaken(e.target.value)} />
          </div>
        </div>
        <div className="fg-sidepanel-groupGrid cols-2" style={{ marginTop: 10 }}>
          <div className="fg-field">
            <label className="fg-label">Camera</label>
            <input 
              className="fg-input" 
              type="text" 
              list="camera-options"
              placeholder={roll?.camera ? `Default: ${roll.camera}` : 'e.g. Nikon FM2'} 
              value={camera} 
              onChange={e=>setCamera(e.target.value)} 
            />
            <datalist id="camera-options">
              {(options.cameras || []).map((c, i) => <option key={i} value={c} />)}
            </datalist>
          </div>
          <div className="fg-field">
            <label className="fg-label">Lens</label>
            <input 
              className="fg-input" 
              type="text" 
              list="lens-options"
              placeholder={roll?.lens ? `Default: ${roll.lens}` : 'e.g. 50mm f/1.8'} 
              value={lens} 
              onChange={e=>setLens(e.target.value)} 
            />
            <datalist id="lens-options">
              {(options.lenses || []).map((l, i) => <option key={i} value={l} />)}
            </datalist>
          </div>
        </div>
        <div className="fg-sidepanel-groupGrid cols-1" style={{ marginTop: 8 }}>
          <div className="fg-field">
            <label className="fg-label">Photographer</label>
            <input 
              className="fg-input" 
              type="text" 
              list="photographer-options"
              placeholder={roll?.photographer ? `Default: ${roll.photographer}` : 'e.g. Junlong'} 
              value={photographer} 
              onChange={e=>setPhotographer(e.target.value)} 
            />
            <datalist id="photographer-options">
              {(options.photographers || []).map((p, i) => <option key={i} value={p} />)}
            </datalist>
          </div>
        </div>
      </section>

      <section className="fg-sidepanel-section">
        <div className="fg-section-label">Location</div>
        <div className="fg-separator" />
        <div className="fg-field">
          <label className="fg-label">Country / City</label>
          <LocationSelect value={location.location_id} onChange={handleLocationSelect} />
        </div>
        <div className="fg-sidepanel-groupGrid cols-2">
          <div className="fg-field">
            <label className="fg-label">Latitude</label>
            <input className="fg-input" type="number" value={location.latitude || ''} onChange={e=>setLocation(l=>({ ...l, latitude: parseFloat(e.target.value) }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Longitude</label>
            <input className="fg-input" type="number" value={location.longitude || ''} onChange={e=>setLocation(l=>({ ...l, longitude: parseFloat(e.target.value) }))} />
          </div>
        </div>
        <div className="fg-field">
          <label className="fg-label">Detail Location</label>
          <input className="fg-input" value={detailLocation} onChange={e=>setDetailLocation(e.target.value)} placeholder="e.g. North Gate / street corner" />
        </div>
      </section>

      <section className="fg-sidepanel-section" style={{ marginTop:'auto' }}>
        <div className="fg-separator" />
        <div className="fg-sidepanel-actions">
          <button type="button" className="fg-btn" onClick={handleClose}>Cancel</button>
          <button type="button" className="fg-btn fg-btn-primary" onClick={handleSave}>Save</button>
        </div>
      </section>
    </aside>
    </div>
  );
}
