// src/components/NewRollForm.jsx
import React, { useState, useEffect } from 'react';
import { getFilms, getMetadataOptions, createRollUnified, updateRoll } from '../api';
import LocationSelect from './LocationSelect.jsx';
import '../styles/forms.css';
import FilmSelector from './FilmSelector';
import ModalDialog from './ModalDialog';

export default function NewRollForm({ onCreated }) {
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
  const [develop, setDevelop] = useState({ develop_lab: '', develop_process: '', develop_date: '', purchase_cost: '', develop_cost: '', purchase_channel: '', develop_note: '' });

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };

  useEffect(() => { 
    getFilms().then(f => setFilms(f || [])); 
    getMetadataOptions().then(o => setOptions(o || { cameras: [], lenses: [], photographers: [] }));
  }, []);

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
      const res = await createRollUnified({
        fields: { title, start_date: startDate || null, end_date: endDate || null, camera, lens, photographer, filmId, exposures, notes },
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
          <label className="fg-label">Film</label>
          <FilmSelector films={films} value={filmId} onChange={setFilmId} />
        </div>
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
            <label className="fg-label">Purchase Cost</label>
            <input className="fg-input" type="number" step="0.01" placeholder="0.00" value={develop.purchase_cost} onChange={e=>setDevelop(d=>({ ...d, purchase_cost: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Develop Cost</label>
            <input className="fg-input" type="number" step="0.01" placeholder="0.00" value={develop.develop_cost} onChange={e=>setDevelop(d=>({ ...d, develop_cost: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Purchase Channel</label>
            <input className="fg-input" placeholder="e.g. Taobao" value={develop.purchase_channel} onChange={e=>setDevelop(d=>({ ...d, purchase_channel: e.target.value }))} />
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
          <div style={{ 
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))',
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
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.1)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}>
                <div style={{ 
                  width: '100%',
                  aspectRatio: '1',
                  overflow: 'hidden',
                  borderRadius: 4,
                  background: '#f5f5f5'
                }}>
                  <img 
                    src={p.url} 
                    alt={p.name || p.originalName} 
                    style={{ 
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      objectPosition: 'center'
                    }} 
                  />
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
              </div>
            ))}
          </div>
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