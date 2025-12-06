import React, { useState, useEffect } from 'react';
import ModalDialog from './ModalDialog';
import { updateFilmItem, getMetadataOptions } from '../api';

const FALLBACK_LENSES = [
  '50mm f/1.8',
  '35mm f/1.4',
  '28mm f/2.8',
  '85mm f/1.8',
  '24-70mm f/2.8',
  '70-200mm f/2.8'
];

export default function ShotLogModal({ item, isOpen, onClose, onUpdated }) {
  const [logs, setLogs] = useState([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCount, setNewCount] = useState('1');
  const [newLens, setNewLens] = useState('');
  const [selectedLens, setSelectedLens] = useState('');
  const [lensOptions, setLensOptions] = useState(FALLBACK_LENSES);
  const [loading, setLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const dedupeAndSort = (list) => Array.from(new Set((list || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const addLensToOptions = (lens) => {
    if (!lens) return;
    setLensOptions((prev) => dedupeAndSort([...prev, lens]));
  };

  useEffect(() => {
    if (item && item.shot_logs) {
      try {
        const parsed = JSON.parse(item.shot_logs);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map(entry => ({
            date: entry.date,
            count: Number(entry.count || entry.shots || 0) || 0,
            lens: entry.lens || ''
          })).filter(e => e.date && e.count > 0);
          setLogs(normalized);
          setLensOptions((prev) => dedupeAndSort([...prev, ...normalized.map(e => e.lens).filter(Boolean)]));
        }
      } catch (e) {
        console.error('Failed to parse shot_logs', e);
      }
    } else {
      setLogs([]);
    }
  }, [item]);

  useEffect(() => {
    let mounted = true;
    getMetadataOptions()
      .then((opts) => {
        if (!mounted) return;
        const base = Array.isArray(opts?.lenses) && opts.lenses.length ? opts.lenses : FALLBACK_LENSES;
        setLensOptions(dedupeAndSort(base));
      })
      .catch(() => setLensOptions(dedupeAndSort(FALLBACK_LENSES)));
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setLensOptions((prev) => dedupeAndSort([...prev, ...logs.map(l => l.lens).filter(Boolean)]));
  }, [logs]);

  const handleAdd = () => {
    if (!newDate || !newCount || Number(newCount) <= 0) return;
    const lensVal = newLens.trim() || selectedLens || '';
    const entry = { date: newDate, count: Number(newCount), lens: lensVal };

    const updatedLogs = [...logs, entry].sort((a, b) => a.date.localeCompare(b.date));
    setLogs(updatedLogs);
    if (lensVal) addLensToOptions(lensVal);
    setNewCount('1');
    setNewLens('');
  };

  const handleRemoveIndex = (index) => {
    const updated = [...logs];
    updated.splice(index, 1);
    setLogs(updated);
  };

  const handleRemoveDate = (date) => {
    setLogs(prev => prev.filter(l => l.date !== date));
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
  const uniqueDays = new Set(logs.map(l => l.date)).size;

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 900, width: '90%', background: '#fff', color: '#333', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="fg-modal-header" style={{ borderBottom: '1px solid #eee', paddingBottom: 16, marginBottom: 0 }}>
          <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#1e293b' }}>Shot Log - {item.label || `Item #${item.id}`}</h3>
          <button className="fg-modal-close" onClick={onClose} style={{ color: '#64748b' }}>&times;</button>
        </div>
        
        <div className="fg-modal-body" style={{ padding: 24, overflowY: 'auto' }}>
          
          {/* Quick Add Section */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginBottom: 24, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 20, borderRadius: 12, boxShadow: '0 4px 12px rgba(102, 126, 234, 0.25)' }}>
            <div className="fg-field" style={{ flex: 1 }}>
              <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Date</label>
              <input 
                type="date" 
                className="fg-input" 
                value={newDate} 
                onChange={e => setNewDate(e.target.value)} 
                style={{ background: '#fff', height: 40, border: 'none' }}
              />
            </div>
            <div className="fg-field" style={{ width: 150 }}>
              <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Shot Count</label>
              <input 
                type="number" 
                className="fg-input" 
                value={newCount} 
                onChange={e => setNewCount(e.target.value)} 
                placeholder="#"
                min="1"
                style={{ background: '#fff', height: 40, border: 'none' }}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div className="fg-field" style={{ flex: 1 }}>
              <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>Lens</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  className="fg-input"
                  value={selectedLens}
                  onChange={e => setSelectedLens(e.target.value)}
                  style={{ background: '#fff', height: 40, border: 'none', flex: 1 }}
                >
                  <option value="">Common lenses...</option>
                  {lensOptions.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <input
                  type="text"
                  className="fg-input"
                  value={newLens}
                  onChange={e => setNewLens(e.target.value)}
                  placeholder="Custom lens"
                  style={{ background: '#fff', height: 40, border: 'none', flex: 1 }}
                />
              </div>
            </div>
            <button 
              type="button" 
              className="fg-btn" 
              onClick={handleAdd}
              disabled={!newCount}
              style={{ height: 40, padding: '0 24px', fontSize: 14, fontWeight: 600, background: '#fff', color: '#667eea', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
            >
              Add Log
            </button>
          </div>

          {/* Calendar View */}
          <div style={{ marginBottom: 20 }}>
            {/* Month Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '0 8px' }}>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                style={{ border: '1px solid #e2e8f0', background: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#475569', fontWeight: 500 }}
              >
                ← Prev
              </button>
              <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1e293b' }}>
                {currentMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </h4>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                style={{ border: '1px solid #e2e8f0', background: '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#475569', fontWeight: 500 }}
              >
                Next →
              </button>
            </div>

            {/* Calendar Grid */}
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
              {/* Weekday Headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar Days */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {(() => {
                  const year = currentMonth.getFullYear();
                  const month = currentMonth.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const days = [];
                  
                  // Empty cells before first day
                  for (let i = 0; i < firstDay; i++) {
                    days.push(<div key={`empty-${i}`} style={{ aspectRatio: '1', borderTop: '1px solid #f1f5f9', borderLeft: i > 0 ? '1px solid #f1f5f9' : 'none', background: '#fafafa' }} />);
                  }
                  
                  // Day cells
                  for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayLogs = logs.filter(l => l.date === dateStr);
                    const hasLog = dayLogs.length > 0;
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    const colIndex = (firstDay + day - 1) % 7;
                    const dayCount = dayLogs.reduce((sum, l) => sum + l.count, 0);
                    const lensLabel = dayLogs.map(l => l.lens).filter(Boolean).join(', ');
                    
                    days.push(
                      <div 
                        key={day}
                        onClick={() => {
                          // Calendar click now just selects the date; deletion stays per-entry in the table below.
                          setNewDate(dateStr);
                        }}
                        style={{
                          aspectRatio: '1',
                          borderTop: '1px solid #e2e8f0',
                          borderLeft: colIndex > 0 ? '1px solid #e2e8f0' : 'none',
                          padding: 8,
                          cursor: 'pointer',
                          position: 'relative',
                          background: hasLog ? '#eff6ff' : isToday ? '#fef3c7' : '#fff',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between'
                        }}
                        onMouseEnter={e => {
                          if (!hasLog) e.currentTarget.style.background = '#f8fafc';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = hasLog ? '#eff6ff' : isToday ? '#fef3c7' : '#fff';
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: hasLog ? '#2563eb' : isToday ? '#92400e' : '#475569' }}>
                          {day}
                        </div>
                        {hasLog && (
                          <div style={{ 
                            fontSize: 11, 
                            fontWeight: 700, 
                            color: '#fff', 
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            borderRadius: 6,
                            padding: '4px 6px',
                            textAlign: 'center',
                            boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                          }}>
                            {dayCount} 📸
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  return days;
                })()}
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 20 }}>
              <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 20, borderRadius: 12, color: '#fff', boxShadow: '0 4px 12px rgba(102, 126, 234, 0.25)' }}>
              <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>Total Shots</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{totalShots}</div>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', padding: 20, borderRadius: 12, color: '#fff', boxShadow: '0 4px 12px rgba(245, 87, 108, 0.25)' }}>
              <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>Days Logged</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{uniqueDays}</div>
            </div>
          </div>

          {/* Editable List */}
          <div style={{ marginTop: 24 }}>
            <h4 style={{ margin: '0 0 12px', color: '#1e293b' }}>Entries</h4>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 80px', background: '#f8fafc', padding: '10px 12px', fontWeight: 600, color: '#475569', fontSize: 13 }}>
                <div>Date</div>
                <div>Shots</div>
                <div>Lens</div>
                <div></div>
              </div>
              {logs.length === 0 && (
                <div style={{ padding: 12, color: '#94a3b8', fontSize: 13 }}>No entries yet.</div>
              )}
              {logs.map((entry, idx) => (
                <div key={`${entry.date}-${idx}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.4fr 80px', padding: '10px 12px', alignItems: 'center', borderTop: '1px solid #e2e8f0' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 13 }}>{entry.date}</div>
                  <input
                    type="number"
                    className="fg-input"
                    value={entry.count}
                    min="0"
                    onChange={e => {
                      const val = Number(e.target.value) || 0;
                      setLogs(prev => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], count: val };
                        return next;
                      });
                    }}
                    style={{ width: '100%', padding: '6px 8px' }}
                  />
                  <input
                    type="text"
                    className="fg-input"
                    value={entry.lens || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setLogs(prev => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], lens: val };
                        return next;
                      });
                    }}
                    placeholder="Lens model"
                    style={{ width: '100%', padding: '6px 8px' }}
                  />
                  <button
                    className="fg-btn"
                    style={{ background: '#fff', border: '1px solid #e2e8f0', color: '#ef4444', padding: '6px 10px' }}
                    onClick={() => handleRemoveIndex(idx)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
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
