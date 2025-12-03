import React, { useState, useEffect } from 'react';
import ModalDialog from './ModalDialog';
import { updateFilmItem } from '../api';

export default function ShotLogModal({ item, isOpen, onClose, onUpdated }) {
  const [logs, setLogs] = useState([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCount, setNewCount] = useState('1');
  const [loading, setLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());

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
    setNewCount('1');
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
                    const logEntry = logs.find(l => l.date === dateStr);
                    const hasLog = !!logEntry;
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    const colIndex = (firstDay + day - 1) % 7;
                    
                    days.push(
                      <div 
                        key={day}
                        onClick={() => {
                          setNewDate(dateStr);
                          if (hasLog) {
                            const idx = logs.findIndex(l => l.date === dateStr);
                            if (window.confirm(`Remove log for ${dateStr} (${logEntry.count} shots)?`)) {
                              handleRemove(idx);
                            }
                          }
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
                            {logEntry.count} 📸
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
              <div style={{ fontSize: 32, fontWeight: 700 }}>{logs.length}</div>
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
