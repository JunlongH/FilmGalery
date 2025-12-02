import React, { useState, useEffect } from 'react';
import ModalDialog from './ModalDialog';
import { updateFilmItem } from '../api';

export default function FilmItemEditModal({ item, isOpen, onClose, onUpdated }) {
  const emptyForm = {
    status: 'in_stock',
    label: '',
    purchase_price: '',
    purchase_date: '',
    expiry_date: '',
    batch_number: '',
    purchase_channel: '',
    purchase_vendor: '',
    purchase_note: '',
    develop_lab: '',
    develop_process: '',
    develop_price: '',
    develop_date: '',
    develop_note: '',
    loaded_camera: '',
    loaded_date: '',
    finished_date: '',
  };

  const [formData, setFormData] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (item) {
      setFormData({
        status: item.status || 'in_stock',
        label: item.label || '',
        purchase_price: item.purchase_price ?? '',
        purchase_date: item.purchase_date || '',
        expiry_date: item.expiry_date || '',
        batch_number: item.batch_number || '',
        purchase_channel: item.purchase_channel || '',
        purchase_vendor: item.purchase_vendor || '',
        purchase_note: item.purchase_note || '',
        develop_lab: item.develop_lab || '',
        develop_process: item.develop_process || '',
        develop_price: item.develop_price ?? '',
        develop_date: item.develop_date || '',
        develop_note: item.develop_note || '',
        loaded_camera: item.loaded_camera || '',
        loaded_date: item.loaded_date || '',
        finished_date: item.finished_date || '',
      });
    } else {
      setFormData(emptyForm);
    }
  }, [item]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading || !item) return;
    setLoading(true);
    setError(null);
    try {
      const patch = { ...formData };
      // Convert numbers
      if (patch.purchase_price) patch.purchase_price = Number(patch.purchase_price);
      if (patch.develop_price) patch.develop_price = Number(patch.develop_price);
      
      // Special handling for status transitions if needed, but backend handles basic updates
      // If status is changing to 'loaded' and camera is set, backend might need loaded_at
      // For now, we rely on updateFilmItem generic update.
      
      const res = await updateFilmItem(item.id, patch);
      if (!res || res.ok === false) {
        throw new Error((res && res.error) || 'Update failed');
      }

      if (onUpdated) await onUpdated();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to update');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 600, width: '90%' }}>
        <div className="fg-modal-header">
          <h3>Edit Film Item #{item?.id}</h3>
          <button className="fg-modal-close" onClick={onClose}>&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="fg-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && <div className="fg-alert fg-alert-error">{error}</div>}
          
          <div className="fg-grid-2">
            <div className="fg-field">
              <label className="fg-label">Status</label>
              <select className="fg-select" name="status" value={formData.status} onChange={handleChange}>
                <option value="in_stock">In Stock</option>
                <option value="loaded">Loaded</option>
                <option value="shot">Shot</option>
                <option value="sent_to_lab">Sent to Lab</option>
                <option value="developed">Developed</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="fg-field">
              <label className="fg-label">Label</label>
              <input className="fg-input" name="label" value={formData.label} onChange={handleChange} placeholder="Optional label" />
            </div>
          </div>

          {formData.status === 'loaded' && (
            <div className="fg-field">
              <label className="fg-label">Loaded Camera</label>
              <input className="fg-input" name="loaded_camera" value={formData.loaded_camera} onChange={handleChange} placeholder="Camera name" />
            </div>
          )}

          <h4 style={{ margin: '8px 0 0', borderBottom: '1px solid #eee', paddingBottom: 4 }}>Purchase Info</h4>
          <div className="fg-grid-2">
            <div className="fg-field">
              <label className="fg-label">Price</label>
              <input className="fg-input" type="number" step="0.01" name="purchase_price" value={formData.purchase_price} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Date</label>
              <input className="fg-input" type="date" name="purchase_date" value={formData.purchase_date} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Expiry</label>
              <input className="fg-input" type="date" name="expiry_date" value={formData.expiry_date} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Batch #</label>
              <input className="fg-input" name="batch_number" value={formData.batch_number} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Channel</label>
              <input className="fg-input" name="purchase_channel" value={formData.purchase_channel} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Vendor</label>
              <input className="fg-input" name="purchase_vendor" value={formData.purchase_vendor} onChange={handleChange} />
            </div>
          </div>
          <div className="fg-field">
            <label className="fg-label">Purchase Note</label>
            <input className="fg-input" name="purchase_note" value={formData.purchase_note} onChange={handleChange} />
          </div>

          <h4 style={{ margin: '8px 0 0', borderBottom: '1px solid #eee', paddingBottom: 4 }}>Usage Info</h4>
          <div className="fg-grid-2">
            <div className="fg-field">
              <label className="fg-label">Loaded Date</label>
              <input className="fg-input" type="date" name="loaded_date" value={formData.loaded_date} onChange={handleChange} />
            </div>
            <div className="fg-field">
              <label className="fg-label">Finished Date</label>
              <input className="fg-input" type="date" name="finished_date" value={formData.finished_date} onChange={handleChange} />
            </div>
          </div>

          {(formData.status === 'sent_to_lab' || formData.status === 'developed' || formData.status === 'archived') && (
            <>
              <h4 style={{ margin: '8px 0 0', borderBottom: '1px solid #eee', paddingBottom: 4 }}>Develop Info</h4>
              <div className="fg-grid-2">
                <div className="fg-field">
                  <label className="fg-label">Lab</label>
                  <input className="fg-input" name="develop_lab" value={formData.develop_lab} onChange={handleChange} />
                </div>
                <div className="fg-field">
                  <label className="fg-label">Process</label>
                  <input 
                    className="fg-input" 
                    name="develop_process" 
                    value={formData.develop_process} 
                    onChange={handleChange} 
                    list="process-options"
                    placeholder="Select or type..."
                  />
                  <datalist id="process-options">
                    <option value="C-41" />
                    <option value="E-6" />
                    <option value="BW" />
                    <option value="ECN-2" />
                  </datalist>
                </div>
                <div className="fg-field">
                  <label className="fg-label">Dev Price</label>
                  <input className="fg-input" type="number" step="0.01" name="develop_price" value={formData.develop_price} onChange={handleChange} />
                </div>
                <div className="fg-field">
                  <label className="fg-label">Dev Date</label>
                  <input className="fg-input" type="date" name="develop_date" value={formData.develop_date} onChange={handleChange} />
                </div>
              </div>
              <div className="fg-field">
                <label className="fg-label">Develop Note</label>
                <input className="fg-input" name="develop_note" value={formData.develop_note} onChange={handleChange} />
              </div>
            </>
          )}

          <div className="fg-modal-footer" style={{ marginTop: 16 }}>
            <button type="button" className="fg-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="fg-btn fg-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
