import React, { useState, useEffect } from 'react';
import ModalDialog from './ModalDialog';
import { updateFilmItem, getMetadataOptions } from '../api';

export function LoadFilmModal({ item, isOpen, onClose, onLoaded }) {
  const [camera, setCamera] = useState('');
  const [loadedDate, setLoadedDate] = useState(new Date().toISOString().split('T')[0]);
  const [options, setOptions] = useState({ cameras: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMetadataOptions().then(o => {
      if (!cancelled) setOptions(o || { cameras: [] });
    });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !item) return;
    setLoading(true);
    // Optimistic UI: close immediately, then persist in background
    const optimisticPatch = {
      status: 'loaded',
      loaded_camera: camera,
      loaded_date: loadedDate || null,
    };
    if (onLoaded && item) {
      // Let parent update cache optimistically if desired
      onLoaded({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, { 
        status: 'loaded', 
        loaded_camera: camera,
        loaded_at: new Date().toISOString(),
        loaded_date: loadedDate || null
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');
      if (onLoaded) await onLoaded(res);
    } catch (err) {
      alert('Failed to load film: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 400 }}>
        <div className="fg-modal-header">
          <h3>Load Film into Camera</h3>
          <button className="fg-modal-close" onClick={onClose} disabled={loading}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="fg-modal-body">
          <div className="fg-field">
            <label className="fg-label">Load Date</label>
            <input 
              type="date"
              className="fg-input" 
              value={loadedDate} 
              onChange={e => setLoadedDate(e.target.value)} 
              required
              disabled={loading}
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Camera (Optional)</label>
            <input 
              className="fg-input" 
              list="camera-options-load" 
              value={camera} 
              onChange={e => setCamera(e.target.value)} 
              placeholder="Select or type camera..." 
              autoFocus
              disabled={loading}
            />
            <datalist id="camera-options-load">
              {options.cameras.map((c, i) => <option key={i} value={c} />)}
            </datalist>
          </div>
          <div className="fg-modal-footer" style={{ marginTop: 20 }}>
            <button type="button" className="fg-btn" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="fg-btn fg-btn-primary" disabled={loading}>
              {loading ? 'Loading...' : 'Load Film'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UnloadFilmModal({ item, isOpen, onClose, onUnloaded }) {
  const [finishedDate, setFinishedDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'shot',
      finished_date: finishedDate,
    };
    if (onUnloaded && item) {
      onUnloaded({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, { 
        status: 'shot', 
        shot_at: new Date().toISOString(),
        finished_date: finishedDate
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');

      if (onUnloaded) await onUnloaded(res);
    } catch (err) {
      alert('Failed to unload film: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 400 }}>
        <div className="fg-modal-header">
          <h3>Unload Film (Finished)</h3>
          <button className="fg-modal-close" onClick={onClose} disabled={loading}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="fg-modal-body">
          <div className="fg-field">
            <label className="fg-label">Finished Date</label>
            <input 
              type="date"
              className="fg-input" 
              value={finishedDate} 
              onChange={e => setFinishedDate(e.target.value)} 
              required
              disabled={loading}
            />
          </div>
          <div className="fg-modal-footer" style={{ marginTop: 20 }}>
            <button type="button" className="fg-btn" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="fg-btn fg-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Mark as Shot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DevelopFilmModal({ item, isOpen, onClose, onDeveloped }) {
  const [formData, setFormData] = useState({
    develop_lab: '',
    develop_process: '',
    develop_date: new Date().toISOString().split('T')[0],
    develop_price: '',
    develop_note: ''
  });
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !item) return;
    setLoading(true);
    const optimisticPatch = {
      status: 'sent_to_lab',
      develop_lab: formData.develop_lab,
      develop_process: formData.develop_process,
      develop_date: formData.develop_date,
      develop_price: formData.develop_price ? Number(formData.develop_price) : null,
      develop_note: formData.develop_note,
    };
    if (onDeveloped && item) {
      onDeveloped({ ok: true, optimistic: true, patch: optimisticPatch, item: { ...item, ...optimisticPatch } });
    }
    onClose();

    try {
      const res = await updateFilmItem(item.id, {
        status: 'sent_to_lab', // Or 'developed' depending on user flow, but user said "enter developing status"
        sent_to_lab_at: new Date().toISOString(),
        ...formData,
        develop_price: formData.develop_price ? Number(formData.develop_price) : null
      });
      if (!res || res.ok === false) throw new Error((res && res.error) || 'Update failed');

      if (onDeveloped) await onDeveloped(res);
    } catch (err) {
      alert('Failed to update status: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 500 }}>
        <div className="fg-modal-header">
          <h3>Send to Lab / Develop</h3>
          <button className="fg-modal-close" onClick={onClose} disabled={loading}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="fg-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="fg-grid-2">
            <div className="fg-field">
              <label className="fg-label">Lab Name</label>
              <input className="fg-input" name="develop_lab" value={formData.develop_lab} onChange={handleChange} placeholder="e.g. FilmNeverDie" disabled={loading} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Process</label>
              <input 
                className="fg-input" 
                name="develop_process" 
                value={formData.develop_process} 
                onChange={handleChange} 
                list="process-options-develop"
                placeholder="e.g. C-41" 
                disabled={loading}
              />
              <datalist id="process-options-develop">
                <option value="C-41" />
                <option value="E-6" />
                <option value="BW" />
                <option value="ECN-2" />
              </datalist>
            </div>
            <div className="fg-field">
              <label className="fg-label">Date</label>
              <input className="fg-input" type="date" name="develop_date" value={formData.develop_date} onChange={handleChange} disabled={loading} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Cost</label>
              <input className="fg-input" type="number" step="0.01" name="develop_price" value={formData.develop_price} onChange={handleChange} placeholder="0.00" disabled={loading} />
            </div>
          </div>
          <div className="fg-field">
            <label className="fg-label">Note</label>
            <input className="fg-input" name="develop_note" value={formData.develop_note} onChange={handleChange} placeholder="Optional notes" disabled={loading} />
          </div>
          <div className="fg-modal-footer" style={{ marginTop: 16 }}>
            <button type="button" className="fg-btn" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="fg-btn fg-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
