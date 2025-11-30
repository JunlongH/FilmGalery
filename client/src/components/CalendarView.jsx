import React, { useState } from 'react';
import PhotoCalendar from './PhotoCalendar';
import TimelineView from './TimelineView';

export default function CalendarView() {
  const [viewMode, setViewMode] = useState('timeline'); // 'calendar' | 'timeline'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '30px 20px 10px', display: 'flex', alignItems: 'center', gap: '20px' }}>
        <div style={{ display: 'flex', background: 'var(--color-bg-alt)', padding: '4px', borderRadius: '8px', border: '1px solid var(--color-border)' }}>
          <button 
            onClick={() => setViewMode('timeline')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: viewMode === 'timeline' ? 'var(--color-primary)' : 'transparent',
              color: viewMode === 'timeline' ? 'white' : 'var(--color-text-muted)',
              fontWeight: 500,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Timeline
          </button>
          <button 
            onClick={() => setViewMode('calendar')}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: viewMode === 'calendar' ? 'var(--color-primary)' : 'transparent',
              color: viewMode === 'calendar' ? 'white' : 'var(--color-text-muted)',
              fontWeight: 500,
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            Life Log
          </button>
        </div>
      </div>
      
      <div style={{ flex: 1, overflow: 'auto' }}>
        {viewMode === 'calendar' ? <PhotoCalendar /> : <TimelineView />}
      </div>
    </div>
  );
}
