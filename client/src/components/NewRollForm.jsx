// src/components/NewRollForm.jsx
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { getFilms, getMetadataOptions, createRollUnified, updateRoll, getFilmItems, updateFilmItem } from '../api';
import LocationSelect from './LocationSelect.jsx';
import '../styles/forms.css';
import FilmSelector from './FilmSelector';
import ModalDialog from './ModalDialog';

export default function NewRollForm({ onCreated }) {
  const location = useLocation();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [camera, setCamera] = useState('');
  const [lens, setLens] = useState('');
  const [photographer, setPhotographer] = useState('');
  const [filmId, setFilmId] = useState(null);
  const [exposures, setExposures] = useState(''); //数量
  const [notes, setNotes] = useState('');
  const [isNegative, setIsNegative] = useState(false);
  const [files, setFiles] = useState([]); // File[]
  const [previews, setPreviews] = useState([]); // { url, tmpName? }
  const [uploadProgress, setUploadProgress] = useState(null);
  const [films, setFilms] = useState([]);
  const [useTwoStep, setUseTwoStep] = useState(false); // default simplified pipeline
  const [options, setOptions] = useState({ cameras: [], lenses: [], photographers: [] });
  const [dialog, setDialog] = useState({ isOpen: false, title: '', message: '' });
  const [rollLocations, setRollLocations] = useState([]);
  const PROCESS_PRESETS = ['C-41', 'E-6', 'BW', 'ECN-2'];
  const [develop, setDevelop] = useState({ develop_lab: '', develop_process: '', develop_date: '', develop_cost: '', develop_note: '' });
  const [filmItems, setFilmItems] = useState([]);
  const [filmItemId, setFilmItemId] = useState(null);
  const [useInventory, setUseInventory] = useState(false);
  const [shotLogs, setShotLogs] = useState([]);
  const [fileDates, setFileDates] = useState({}); // { filename: 'YYYY-MM-DD' }

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };

  useEffect(() => { 
    getFilms().then(f => setFilms(f || [])); 
    getMetadataOptions().then(o => setOptions(o || { cameras: [], lenses: [], photographers: [] }));
    // Fetch all relevant statuses (excluding developed as per request)
    getFilmItems({ status: 'in_stock,loaded,shot,sent_to_lab' }).then(data => {
      const arr = data && Array.isArray(data.items) ? data.items : [];
      setFilmItems(arr);
    }).catch(() => setFilmItems([]));
  }, []);

  // Handle pre-selection from navigation state (Archive flow)
  useEffect(() => {
    if (location.state && location.state.filmItemId) {
      setUseInventory(true);
      setFilmItemId(location.state.filmItemId);
      
      // Auto-fill develop info if provided
      if (location.state.developInfo) {
        const info = location.state.developInfo;
        setDevelop(prev => ({
          ...prev,
          develop_lab: info.develop_lab || '',
          develop_process: info.develop_process || '',
          develop_date: info.develop_date || '',
          develop_cost: info.develop_cost || '',
          develop_note: info.develop_note || ''
        }));
      }
    }
  }, [location.state]);

  // Auto-fill dates and camera from inventory item
  useEffect(() => {
    if (useInventory && filmItemId && filmItems.length > 0) {
      const item = filmItems.find(i => i.id === filmItemId);
      if (item) {
        if (item.loaded_date) setStartDate(item.loaded_date);
        if (item.finished_date) setEndDate(item.finished_date);
        if (item.loaded_camera) setCamera(item.loaded_camera);
        
        // Parse shot logs
        if (item.shot_logs) {
          try {
            const logs = JSON.parse(item.shot_logs);
            if (Array.isArray(logs)) {
              setShotLogs(logs.sort((a, b) => a.date.localeCompare(b.date)));
            }
          } catch (e) { console.error(e); }
        } else {
          setShotLogs([]);
        }
      }
    }
  }, [useInventory, filmItemId, filmItems]);

  const handleAutoAssignDates = () => {
    if (!files.length || !shotLogs.length) return;
    
    // Sort files by name to ensure sequence
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const newMap = {};
    
    let fileIndex = 0;
    for (const log of shotLogs) {
      const count = log.count;
      const date = log.date;
      for (let i = 0; i < count; i++) {
        if (fileIndex >= sortedFiles.length) break;
        newMap[sortedFiles[fileIndex].name] = date;
        fileIndex++;
      }
    }
    setFileDates(newMap);
  };

  // create object URL previews
  useEffect(() => {
    const urls = files.map(f => ({ url: URL.createObjectURL(f), name: f.name }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  function onFileChange(e) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        showAlert('Invalid Date', 'Start date cannot be later than end date');
        return;
      }
      const fieldsBase = { title, start_date: startDate || null, end_date: endDate || null, camera, lens, photographer, exposures, notes };
      const fields = useInventory && filmItemId
        ? { ...fieldsBase, film_item_id: filmItemId }
        : { ...fieldsBase, filmId };

      // Add file metadata (dates)
      if (Object.keys(fileDates).length > 0) {
        fields.fileMetadata = JSON.stringify(fileDates);
      }

      const res = await createRollUnified({
        fields,
        files,
        useTwoStep,
        isNegative,
        onProgress: p => setUploadProgress(p)
      });
      setUploadProgress(null);
      if (res && res.ok) {
        setFiles([]); setPreviews([]);
        try {
          await updateRoll(res.roll.id, { locations: rollLocations.map(l => l.location_id), ...develop });
          
          // If created from inventory item, update its status to developed
          if (useInventory && filmItemId) {
            await updateFilmItem(filmItemId, { status: 'developed' });
          }

          showAlert('Success', 'Roll created and fields saved');
        } catch (err) {
          showAlert('Warning', 'Roll created but additional fields failed to save: ' + (err.message || err));
        }
        onCreated && onCreated(res.roll);
      } else {
        showAlert('Error', 'Create roll failed: ' + (res && res.error));
      }
    } catch (err) {
      setUploadProgress(null);
      console.error(err);
      showAlert('Error', 'Upload error: ' + (err.message || err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="fg-card" style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm} 
      />
      
      {/* Basic Info Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Basic Info</h3>
        <div className="fg-field">
          <label className="fg-label">Title</label>
          <input className="fg-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Roll title" />
        </div>
        <div className="fg-field">
          <label className="fg-label">Film Source</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={!useInventory} onChange={() => { setUseInventory(false); setFilmItemId(null); }} />
              <span>Manual film selection</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={useInventory} onChange={() => setUseInventory(true)} />
              <span>From inventory (FilmItem)</span>
            </label>
          </div>
        </div>
        {!useInventory && (
          <div className="fg-field">
            <label className="fg-label">Film</label>
            <FilmSelector films={films} value={filmId} onChange={setFilmId} />
          </div>
        )}
        {useInventory && (
          <div className="fg-field">
            <label className="fg-label">Inventory Item</label>
            <select
              className="fg-select"
              value={filmItemId || ''}
              onChange={e => setFilmItemId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select from in-stock / loaded</option>
              {filmItems.map(it => {
                const f = films.find(x => x.id === it.film_id);
                const filmName = f ? f.name : `Film #${it.film_id}`;
                const label = [filmName, it.batch_number, it.expiry_date].filter(Boolean).join(' • ');
                return (
                  <option key={it.id} value={it.id}>{label || `Item #${it.id}`}</option>
                );
              })}
            </select>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
              Listing items with status: in_stock, loaded, shot, sent_to_lab, developed.
            </div>
            
            {filmItemId && (() => {
              const it = filmItems.find(x => x.id === filmItemId);
              if (!it) return null;
              const f = films.find(x => x.id === it.film_id);
              return (
                <div className="fg-card" style={{ marginTop: 12, padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>{f ? f.name : 'Unknown Film'}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: '#475569' }}>
                    <div>Status: <span className="fg-pill">{it.status}</span></div>
                    <div>Expiry: {it.expiry_date || '—'}</div>
                    <div>Batch: {it.batch_number || '—'}</div>
                    <div>Price: {it.purchase_price ? `¥${it.purchase_price}` : '—'}</div>
                    <div>Channel: {it.purchase_channel || '—'}</div>
                    <div>Vendor: {it.purchase_vendor || '—'}</div>
                  </div>
                  {(it.label || it.purchase_note) && (
                    <div style={{ marginTop: 8, fontSize: 13, fontStyle: 'italic', color: '#64748b' }}>
                      "{it.label || it.purchase_note}"
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Start Date</label>
            <input className="fg-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="fg-field">
            <label className="fg-label">End Date</label>
            <input className="fg-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Gear & Photographer Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Gear & Photographer</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Camera</label>
            <input className="fg-input" list="camera-options" value={camera} onChange={e => setCamera(e.target.value)} placeholder="Select or type..." />
            <datalist id="camera-options">
              {options.cameras.map((c, i) => <option key={i} value={c} />)}
            </datalist>
          </div>
          <div className="fg-field">
            <label className="fg-label">Lens</label>
            <input className="fg-input" list="lens-options" value={lens} onChange={e => setLens(e.target.value)} placeholder="Select or type..." />
            <datalist id="lens-options">
              {options.lenses.map((l, i) => <option key={i} value={l} />)}
            </datalist>
          </div>
          <div className="fg-field">
            <label className="fg-label">Photographer</label>
            <input className="fg-input" list="photographer-options" value={photographer} onChange={e => setPhotographer(e.target.value)} placeholder="Select or type..." />
            <datalist id="photographer-options">
              {(options.photographers || []).map((s, i) => <option key={i} value={s} />)}
            </datalist>
          </div>
          <div className="fg-field">
            <label className="fg-label">Exposures</label>
            <input className="fg-input" type="number" value={exposures} onChange={e=>setExposures(e.target.value)} placeholder="e.g. 36" />
          </div>
        </div>
      </section>

      {/* Shooting Cities Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Shooting Cities</h3>
        <LocationSelect value={null} onChange={(loc)=>{
          if (!loc || !loc.location_id) return;
          setRollLocations(prev => (prev.some(p => p.location_id === loc.location_id) ? prev : [...prev, loc]));
        }} />
        {rollLocations.length > 0 && <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {rollLocations.map(l => (
            <span key={l.location_id} className="fg-pill">{l.city_name}</span>
          ))}
        </div>}
      </section>

      {/* Development Info Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Development Info</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Lab</label>
            <input className="fg-input" placeholder="Lab name" value={develop.develop_lab} onChange={e=>setDevelop(d=>({ ...d, develop_lab: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Develop Date</label>
            <input className="fg-input" type="date" value={develop.develop_date} onChange={e=>setDevelop(d=>({ ...d, develop_date: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Process</label>
            <select className="fg-select" value={develop.develop_process || ''} onChange={e=>setDevelop(d=>({ ...d, develop_process: e.target.value }))}>
              <option value="">Select process</option>
              {PROCESS_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="fg-field">
            <label className="fg-label">Custom Process</label>
            <input className="fg-input" placeholder="Or type custom" value={develop.develop_process || ''} onChange={e=>setDevelop(d=>({ ...d, develop_process: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Develop Cost</label>
            <input className="fg-input" type="number" step="0.01" placeholder="0.00" value={develop.develop_cost} onChange={e=>setDevelop(d=>({ ...d, develop_cost: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Note</label>
            <input className="fg-input" placeholder="Short note" value={develop.develop_note} onChange={e=>setDevelop(d=>({ ...d, develop_note: e.target.value }))} />
          </div>
        </div>
      </section>

      {/* Notes Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Notes</h3>
        <div className="fg-field">
          <textarea className="fg-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Additional notes about this roll..." style={{ minHeight: 90, resize: 'vertical' }} />
        </div>
      </section>

      {/* File Upload Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Photos</h3>
        
        {/* Options row */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13 }}>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input 
              type="checkbox" 
              checked={isNegative} 
              onChange={e => setIsNegative(e.target.checked)} 
            />
            <span>Import as Negative</span>
          </label>
          <label style={{ display:'flex', alignItems:'center', gap:6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={useTwoStep} onChange={e=>setUseTwoStep(e.target.checked)} />
            <span>Two-step upload</span>
          </label>
          <div style={{ fontSize: 12, color: 'var(--fg-muted)', flexBasis: '100%' }}>
            Single-step is recommended for most cases.
          </div>
        </div>

        <div className="fg-field">
          <input 
            type="file" 
            accept="image/*" 
            multiple 
            onChange={onFileChange}
            style={{ 
              padding: '14px',
              border: '2px dashed var(--fg-border)',
              borderRadius: 8,
              background: '#f9fafb',
              cursor: 'pointer',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Preview Grid */}
        {previews.length > 0 && (
          <>
            {shotLogs.length > 0 && (
              <div style={{ marginBottom: 12, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0369a1' }}>
                    Shot Logs Available: {shotLogs.reduce((a,b)=>a+b.count,0)} shots recorded
                  </div>
                  <button 
                    type="button" 
                    className="fg-btn fg-btn-sm fg-btn-primary"
                    onClick={handleAutoAssignDates}
                  >
                    Auto-Assign Dates
                  </button>
                </div>
                <div style={{ fontSize: 11, color: '#0c4a6e', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {shotLogs.map((l, i) => (
                    <span key={i} style={{ background: '#fff', padding: '2px 6px', borderRadius: 4, border: '1px solid #e0f2fe' }}>
                      {l.date}: {l.count}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ 
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10
            }}>
              {previews.map((p, i) => (
                <div key={i} style={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  padding: 6,
                  border: '1px solid var(--fg-border)',
                  borderRadius: 6,
                  background: '#fff',
                  transition: 'all 0.2s',
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: '100%',
                    aspectRatio: '1',
                    overflow: 'hidden',
                    borderRadius: 4,
                    background: '#f5f5f5',
                    position: 'relative'
                  }}>
                    <img 
                      src={p.url} 
                      alt={p.name || p.originalName} 
                      loading="lazy"
                      decoding="async"
                      style={{ 
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'center'
                      }} 
                    />
                    {fileDates[p.name] && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        fontSize: 10,
                        padding: '2px 4px',
                        textAlign: 'center'
                      }}>
                        {fileDates[p.name]}
                      </div>
                    )}
                  </div>
                  <div style={{ 
                    fontSize: 10,
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                    lineHeight: 1.3
                  }}>
                    {p.originalName || p.name}
                  </div>
                  <input 
                    type="date" 
                    style={{ fontSize: 10, padding: 2, border: '1px solid #ddd', borderRadius: 3, width: '100%' }}
                    value={fileDates[p.name] || ''}
                    onChange={e => setFileDates(prev => ({ ...prev, [p.name]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {previews.length === 0 && (
          <div style={{ 
            padding: 40,
            textAlign: 'center',
            color: '#999',
            fontSize: 13,
            border: '1px dashed var(--fg-border)',
            borderRadius: 8,
            background: '#f9fafb'
          }}>
            No files selected
          </div>
        )}
      </section>

      {uploadProgress !== null && (
        <div style={{ 
          padding: 16,
          background: '#dbeafe',
          borderRadius: 8,
          textAlign: 'center',
          fontWeight: 600,
          color: '#1e40af',
          border: '1px solid #93c5fd'
        }}>
          Uploading: {uploadProgress}%
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12 }}>
        <button className="fg-btn fg-btn-primary" type="submit" disabled={uploadProgress !== null} style={{ minWidth: 140, padding: '12px 24px', fontSize: 15, fontWeight: 600 }}>
          {uploadProgress !== null ? 'Uploading...' : 'Create Roll'}
        </button>
      </div>
    </form>
  );
}