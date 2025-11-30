import React, { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, 
  eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, 
  addYears, subYears, setMonth, setYear 
} from 'date-fns';
import { buildUploadUrl } from '../api';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';
import ImageViewer from './ImageViewer';

// Icons
const ChevronLeft = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>;
const ChevronRight = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>;
const ArrowLeft = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>;
const ArrowRight = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>;
const HeartIcon = ({ filled }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={filled ? "#ff7875" : "none"} stroke={filled ? "none" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
  </svg>
);

export default function PhotoCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' | 'year'
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(null);
  
  // Persist cover photo selections
  const [coverPrefs, setCoverPrefs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('calendar_covers') || '{}');
    } catch {
      return {};
    }
  });

  const saveCoverPref = (dateKey, index) => {
    const newPrefs = { ...coverPrefs, [dateKey]: index };
    setCoverPrefs(newPrefs);
    localStorage.setItem('calendar_covers', JSON.stringify(newPrefs));
  };

  const year = format(currentDate, 'yyyy');
  const month = format(currentDate, 'MM');

  // Fetch photos based on view mode
  const { data: photos = [] } = useQuery({
    queryKey: ['photos', year, viewMode === 'month' ? month : 'all'],
    queryFn: async () => {
      const url = viewMode === 'month' 
        ? `${process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000'}/api/photos?year=${year}&month=${month}`
        : `${process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000'}/api/photos?year=${year}`;
      const res = await fetch(url);
      return res.json();
    }
  });

  // Group photos by date
  const photosByDay = useMemo(() => {
    const map = new Map();
    photos.forEach(p => {
      if (!p.date_taken) return;
      const d = p.date_taken.split('T')[0];
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(p);
    });
    return map;
  }, [photos]);

  // Navigation
  const handlePrev = () => {
    if (viewMode === 'month') setCurrentDate(subMonths(currentDate, 1));
    else setCurrentDate(subYears(currentDate, 1));
  };

  const handleNext = () => {
    if (viewMode === 'month') setCurrentDate(addMonths(currentDate, 1));
    else setCurrentDate(addYears(currentDate, 1));
  };

  const switchToMonth = (monthIndex) => {
    const newDate = setMonth(currentDate, monthIndex);
    setCurrentDate(newDate);
    setViewMode('month');
  };

  // Helper to get photo URL
  const getPhotoUrl = (photo) => {
    if (!photo) return null;
    let path = photo.thumb_rel_path || photo.full_rel_path;
    if (!path) return null;
    if (!path.startsWith('http') && !path.startsWith('/') && !path.startsWith('uploads') && !path.includes(':')) {
      path = `uploads/${path}`;
    }
    return buildUploadUrl(path);
  };

  const selectedPhotos = selectedDay ? (photosByDay.get(format(selectedDay, 'yyyy-MM-dd')) || []) : [];

  return (
    <div style={{ padding: '20px', height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700, color: 'var(--color-text)' }}>Life Log</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', background: 'var(--color-bg-alt)', padding: '4px 12px', borderRadius: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
          <button className="icon-btn" onClick={handlePrev} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', color: 'var(--color-text)' }}>
            <ChevronLeft />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 600 }}>
            {viewMode === 'month' ? (
              <>
                <span style={{ cursor: 'pointer' }} onClick={() => setViewMode('year')}>{format(currentDate, 'MMMM')}</span>
                <span style={{ cursor: 'pointer' }} onClick={() => setViewMode('year')}>{year}</span>
              </>
            ) : (
              <span>{year}</span>
            )}
          </div>
          <button className="icon-btn" onClick={handleNext} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '8px', display: 'flex', alignItems: 'center', color: 'var(--color-text)' }}>
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {viewMode === 'month' ? (
          <MonthView 
            currentDate={currentDate} 
            photosByDay={photosByDay} 
            onSelectDay={setSelectedDay}
            getPhotoUrl={getPhotoUrl}
            coverPrefs={coverPrefs}
            onSaveCoverPref={saveCoverPref}
          />
        ) : (
          <YearView 
            year={year} 
            photosByDay={photosByDay} 
            onMonthClick={switchToMonth}
            getPhotoUrl={getPhotoUrl}
            coverPrefs={coverPrefs}
          />
        )}
      </div>

      {/* Selected Day Modal */}
      {selectedDay && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 1000,
          display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '40px',
          backdropFilter: 'blur(5px)'
        }} onClick={() => setSelectedDay(null)}>
          <div style={{
            background: 'var(--color-bg)', borderRadius: '16px', width: '100%', maxWidth: '900px', maxHeight: '90vh',
            overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '20px' }}>{format(selectedDay, 'MMMM d, yyyy')}</h3>
              <button className="fg-btn" onClick={() => setSelectedDay(null)}>Close</button>
            </div>
            <div style={{ padding: '24px', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
              <style>{`
                .calendar-photo-tag { color: #ffffff !important; }
                .calendar-photo-note { color: #ffffff !important; text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
              `}</style>
              {selectedPhotos.map((p, idx) => (
                <div key={p.id} onClick={() => setViewerIndex(idx)} 
                  style={{ 
                    cursor: 'pointer', aspectRatio: '1', borderRadius: '12px', overflow: 'hidden', 
                    position: 'relative', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
                    transition: 'transform 0.2s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <LazyLoadImage 
                    src={getPhotoUrl(p)} alt="" effect="opacity"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    wrapperProps={{ style: { width: '100%', height: '100%', display: 'block' } }}
                  />
                  
                  {/* Top Left: Tags */}
                  <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, flexWrap: 'wrap', pointerEvents: 'none', zIndex: 10, maxWidth: 'calc(100% - 32px)' }}>
                    {Array.isArray(p.tags) && p.tags.map((t, i) => (
                      <span key={i} className="calendar-photo-tag" style={{ 
                        background: 'rgba(0,0,0,0.6)', 
                        padding: '2px 6px', borderRadius: '4px', 
                        fontSize: '10px', backdropFilter: 'blur(4px)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                      }}>
                        {t.name || t}
                      </span>
                    ))}
                  </div>

                  {/* Top Right: Like */}
                  {(Number(p.rating) > 0) && (
                     <div style={{ 
                       position: 'absolute', top: 8, right: 8, 
                       color: '#ff7875', 
                       zIndex: 10, pointerEvents: 'none',
                       filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                     }}>
                       <HeartIcon filled={true} />
                     </div>
                  )}

                  {/* Bottom: Note */}
                  {p.caption && (
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)', 
                      padding: '24px 8px 8px 8px', 
                      zIndex: 10,
                      display: 'flex', alignItems: 'flex-end'
                    }}>
                      <span className="calendar-photo-note" style={{
                        fontSize: '12px', fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%'
                      }}>
                        {p.caption}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Image Viewer */}
      {viewerIndex !== null && selectedDay && (
        <ImageViewer 
          images={selectedPhotos}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      )}
    </div>
  );
}

function MonthView({ currentDate, photosByDay, onSelectDay, getPhotoUrl, coverPrefs, onSaveCoverPref }) {
  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', 
      gridTemplateRows: 'auto 1fr',
      height: '100%',
      gap: '1px',
      background: 'var(--color-border)', // Grid lines
      border: '1px solid var(--color-border)',
      borderRadius: '12px',
      overflow: 'hidden',
      boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
    }}>
      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
        <div key={d} style={{ 
          background: 'var(--color-bg-alt)', 
          padding: '12px', 
          textAlign: 'center', 
          fontWeight: 600, 
          fontSize: '13px',
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px'
        }}>
          {d}
        </div>
      ))}
      
      <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '1px', background: 'var(--color-border)' }}>
        {days.map(day => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayPhotos = photosByDay.get(dateKey) || [];
          const isCurrentMonth = isSameMonth(day, currentDate);
          const hasPhotos = dayPhotos.length > 0;
          const isToday = isSameDay(day, new Date());
          
          // Determine cover photo
          const prefIndex = coverPrefs[dateKey] || 0;
          const coverIndex = hasPhotos ? Math.abs(prefIndex % dayPhotos.length) : 0;
          const cover = hasPhotos ? dayPhotos[coverIndex] : null;

          return (
            <div 
              key={day.toString()} 
              onClick={() => hasPhotos && onSelectDay(day)}
              className="calendar-cell"
              style={{ 
                background: hasPhotos ? 'var(--color-bg-alt)' : (isCurrentMonth ? 'var(--color-bg)' : 'rgba(0,0,0,0.02)'),
                aspectRatio: '1/1',
                position: 'relative',
                cursor: hasPhotos ? 'pointer' : 'default',
                opacity: isCurrentMonth ? 1 : 0.5,
                transition: 'all 0.2s ease',
                overflow: 'hidden'
              }}
            >
              {/* Date Number */}
              <div style={{ 
                position: 'absolute', top: '8px', left: '8px', zIndex: 2,
                fontWeight: 600, fontSize: '14px',
                color: cover ? 'white' : (isToday ? 'var(--color-primary)' : 'var(--color-text-muted)'),
                textShadow: cover ? '0 1px 3px rgba(0,0,0,0.8)' : 'none',
                background: isToday && !cover ? 'rgba(var(--color-primary-rgb), 0.1)' : 'transparent',
                width: isToday && !cover ? '28px' : 'auto',
                height: isToday && !cover ? '28px' : 'auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: '50%'
              }}>
                {format(day, 'd')}
              </div>
              
              {cover && (
                <div className="photo-container" style={{ position: 'absolute', inset: 0 }}>
                  <LazyLoadImage 
                    src={getPhotoUrl(cover)} alt="" effect="opacity"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    wrapperProps={{ style: { width: '100%', height: '100%', display: 'block' } }}
                  />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 40%)' }} />
                  
                  {/* Photo Switcher Controls (Visible on Hover) */}
                  {dayPhotos.length > 1 && (
                    <div className="photo-controls" style={{
                      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '0 4px', opacity: 0, transition: 'opacity 0.2s',
                      pointerEvents: 'none'
                    }}>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        onSaveCoverPref(dateKey, prefIndex - 1);
                      }} style={{
                        background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%',
                        width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', backdropFilter: 'blur(2px)',
                        pointerEvents: 'auto'
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                      </button>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        onSaveCoverPref(dateKey, prefIndex + 1);
                      }} style={{
                        background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: '50%',
                        width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', backdropFilter: 'blur(2px)',
                        pointerEvents: 'auto'
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                      </button>
                    </div>
                  )}

                  {/* Location Overlay */}
                  {(cover.city_name || cover.country_name || cover.detail_location) && (
                    <div className="location-overlay" style={{
                      position: 'absolute', bottom: '0', left: '0', width: '100%',
                      background: 'rgba(0,0,0,0.2)', color: 'white',
                      fontSize: '11px', padding: '6px 8px',
                      transform: 'translateY(100%)', transition: 'transform 0.2s ease-out',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      textAlign: 'left',
                      zIndex: 5
                    }}>
                      {cover.city_name || cover.country_name || cover.detail_location}
                    </div>
                  )}

                  {/* Count Badge */}
                  {dayPhotos.length > 1 && (
                    <div style={{
                      position: 'absolute', bottom: '6px', right: '6px',
                      background: 'rgba(0,0,0,0.6)', color: '#FFFFFF',
                      fontSize: '11px', fontWeight: 700,
                      padding: '2px 6px', borderRadius: '10px',
                      backdropFilter: 'blur(4px)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                    }}>
                      {dayPhotos.length}
                    </div>
                  )}
                </div>
              )}
              <style>{`
                .calendar-cell:hover .photo-controls { opacity: 1 !important; }
                .calendar-cell:hover .location-overlay { transform: translateY(0) !important; }
              `}</style>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function YearView({ year, photosByDay, onMonthClick, getPhotoUrl, coverPrefs }) {
  const months = Array.from({ length: 12 }, (_, i) => i);

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
      gap: '20px', 
      padding: '10px',
      overflowY: 'auto'
    }}>
      {months.map(monthIdx => {
        const date = new Date(parseInt(year), monthIdx, 1);
        const start = startOfWeek(startOfMonth(date));
        const end = endOfWeek(endOfMonth(date));
        const days = eachDayOfInterval({ start, end });

        return (
          <div key={monthIdx} onClick={() => onMonthClick(monthIdx)} style={{ 
            cursor: 'pointer', 
            background: 'var(--color-bg-alt)', 
            borderRadius: '12px', 
            padding: '12px',
            border: '1px solid var(--color-border)',
            transition: 'transform 0.2s, box-shadow 0.2s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-2px)';
            e.currentTarget.style.boxShadow = '0 8px 16px rgba(0,0,0,0.1)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = 'none';
            e.currentTarget.style.boxShadow = 'none';
          }}
          >
            <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: 'var(--color-primary)' }}>{format(date, 'MMMM')}</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', marginBottom: '4px' }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
                <div key={i} style={{ textAlign: 'center', fontSize: '10px', color: 'var(--color-text-muted)', fontWeight: 600 }}>{d}</div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px' }}>
              {days.map(day => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayPhotos = photosByDay.get(dateKey) || [];
                const hasPhotos = dayPhotos.length > 0;
                const isCurrentMonth = isSameMonth(day, date);
                
                if (!isCurrentMonth) return <div key={day.toString()} />;

                // Determine cover photo using same logic as MonthView
                const prefIndex = coverPrefs[dateKey] || 0;
                const coverIndex = hasPhotos ? Math.abs(prefIndex % dayPhotos.length) : 0;
                const cover = hasPhotos ? dayPhotos[coverIndex] : null;

                return (
                  <div key={day.toString()} style={{ 
                    aspectRatio: '1/1', 
                    overflow: 'hidden',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {!hasPhotos && (
                      <span style={{ fontSize: '10px', color: 'var(--color-text-muted)', opacity: 0.5 }}>{format(day, 'd')}</span>
                    )}
                    {hasPhotos && (
                      <img 
                        src={getPhotoUrl(cover)} 
                        alt="" 
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                        loading="lazy"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}