import React, { useState, useEffect } from 'react';
import ModalDialog from './ModalDialog';
import { updateFilmItem } from '../api';

export default function ShotLogModal({ item, isOpen, onClose, onUpdated }) {
  const [logs, setLogs] = useState([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCount, setNewCount] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (item && item.shot_logs) {
      try {
        const parsed = JSON.parse(item.shot_logs);
        if (Array.isArray(parsed)) {
          setLogs(parsed);
        }
      } catch (e) {
        console.error('Failed to parse shot_logs', e);
      }
    } else {
      setLogs([]);
    }
  }, [item]);

  const handleAdd = () => {
    if (!newDate || !newCount || Number(newCount) <= 0) return;
    const entry = { date: newDate, count: Number(newCount) };
    
    // Merge if date exists
    const existingIndex = logs.findIndex(l => l.date === newDate);
    let updatedLogs;
    if (existingIndex >= 0) {
      updatedLogs = [...logs];
      updatedLogs[existingIndex].count += entry.count;
    } else {
      updatedLogs = [...logs, entry].sort((a, b) => a.date.localeCompare(b.date));
    }
    
    setLogs(updatedLogs);
    setNewCount('');
  };

  const handleRemove = (index) => {
    const updated = [...logs];
    updated.splice(index, 1);
    setLogs(updated);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await updateFilmItem(item.id, { shot_logs: JSON.stringify(logs) });
      if (!res.ok) throw new Error(res.error || 'Update failed');

      if (onUpdated) await onUpdated();
      onClose();
    } catch (err) {
      alert('Failed to save logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const totalShots = logs.reduce((acc, cur) => acc + cur.count, 0);

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 900, width: '90%', background: '#fff', color: '#333', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="fg-modal-header" style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 0 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#1e293b' }}>Shot Log - {item.label || `Item #${item.id}`}</h3>
          <button className="fg-modal-close" onClick={onClose} style={{ color: '#64748b' }}>&times;</button>
        </div>
        
        <div className="fg-modal-body" style={{ padding: 24, overflowY: 'auto' }}>
          
          {/* Add New Log Section */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 24, background: '#f8fafc', padding: 20, borderRadius: 12, border: '1px solid #e2e8f0' }}>
            <div className="fg-field" style={{ flex: 1 }}>
              <label className="fg-label" style={{ color: '#475569', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Date</label>
              <input 
                type="date" 
                className="fg-input" 
                value={newDate} 
                onChange={e => setNewDate(e.target.value)} 
                style={{ background: '#fff', height: 40 }}
              />
            </div>
            <div className="fg-field" style={{ width: 150 }}>
              <label className="fg-label" style={{ color: '#475569', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Shot Count</label>
              <input 
                type="number" 
                className="fg-input" 
                value={newCount} 
                onChange={e => setNewCount(e.target.value)} 
                placeholder="#"
                min="1"
                style={{ background: '#fff', height: 40 }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <button 
              type="button" 
              className="fg-btn fg-btn-primary" 
              onClick={handleAdd}
              disabled={!newCount}
              style={{ height: 40, padding: '0 24px', fontSize: 14, fontWeight: 600 }}
            >
              Add Log
            </button>
          </div>

          {/* Logs Table */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead style={{ background: '#f1f5f9' }}>
                <tr>
                  <th style={{ padding: '12px 20px', textAlign: 'left', color: '#475569', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Date</th>
                  <th style={{ padding: '12px 20px', textAlign: 'right', color: '#475569', fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shots</th>
                  <th style={{ padding: '12px 20px', width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan="3" style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                      No logs recorded yet. Add one above.
                    </td>
                  </tr>
                ) : (
                  logs.map((log, idx) => (
                    <tr key={idx} style={{ borderTop: '1px solid #e2e8f0', background: '#fff' }}>
                      <td style={{ padding: '12px 20px', color: '#334155' }}>{log.date}</td>
                      <td style={{ padding: '12px 20px', textAlign: 'right', color: '#334155', fontWeight: 500 }}>{log.count}</td>
                      <td style={{ padding: '12px 20px', textAlign: 'center' }}>
                        <button 
                          type="button"
                          onClick={() => handleRemove(idx)}
                          style={{ 
                            border: 'none', 
                            background: 'transparent', 
                            color: '#ef4444', 
                            cursor: 'pointer',
                            padding: 6,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'background 0.2s'
                          }}
                          onMouseOver={e => e.currentTarget.style.background = '#fee2e2'}
                          onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                          title="Remove log"
                        >
                          <span style={{ fontSize: 18, lineHeight: 1 }}>&times;</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {logs.length > 0 && (
                <tfoot style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                  <tr>
                    <td style={{ padding: '12px 20px', fontWeight: 700, color: '#1e293b' }}>Total Shots</td>
                    <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, color: '#1e293b', fontSize: 16 }}>{totalShots}</td>
                    <td></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <div className="fg-modal-footer" style={{ padding: 20, borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 12, background: '#fff', borderRadius: '0 0 8px 8px' }}>
          <button 
            type="button" 
            className="fg-btn" 
            onClick={onClose} 
            disabled={loading}
            style={{ background: '#fff', border: '1px solid #cbd5e1', color: '#475569', padding: '8px 20px' }}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="fg-btn fg-btn-primary" 
            onClick={handleSave} 
            disabled={loading}
            style={{ padding: '8px 24px' }}
          >
            {loading ? 'Saving...' : 'Save Logs'}
          </button>
        </div>
      </div>
    </div>
  );
}
