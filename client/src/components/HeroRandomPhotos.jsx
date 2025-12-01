import React, { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { buildUploadUrl } from '../api';
import ImageViewer from './ImageViewer';

export default function HeroRandomPhotos() {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadRandom = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const API = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000';
      const r = await fetch(`${API}/api/photos/random?limit=5`);
      const data = await r.json();
      if (Array.isArray(data)) {
        setPhotos(data);
        setCurrentIndex(0);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadRandom();
  }, [loadRandom]);

  useEffect(() => {
    if (viewerOpen || photos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % photos.length);
    }, 6000); // Change every 6 seconds
    return () => clearInterval(timer);
  }, [photos, viewerOpen]);

  if (photos.length === 0) return null;

  const current = photos[currentIndex];

  return (
    <div style={{ 
      position: 'relative', 
      width: '100%', 
      aspectRatio: '3 / 2',
      overflow: 'hidden',
      borderRadius: '12px',
      marginBottom: '32px',
      boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
      cursor: 'pointer'
    }} onClick={() => { if (!viewerOpen) setViewerOpen(true); }}>
      <AnimatePresence mode='wait'>
        <motion.img
          key={current.id}
          src={buildUploadUrl(current.positive_rel_path || current.full_rel_path)}
          alt={current.caption || current.roll_title || ''}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:'block' }}
          draggable={false}
        />
      </AnimatePresence>
      
      {/* Controls: Left/Right Arrows */}
      <button
        aria-label="Previous photo"
        onClick={(e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev - 1 + photos.length) % photos.length); }}
        style={{
          position: 'absolute',
          left: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'rgba(0,0,0,0.45)',
          color: 'white',
          border: 'none',
          borderRadius: '999px',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(2px)'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
      </button>
      <button
        aria-label="Next photo"
        onClick={(e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev + 1) % photos.length); }}
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'rgba(0,0,0,0.45)',
          color: 'white',
          border: 'none',
          borderRadius: '999px',
          width: '40px',
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          backdropFilter: 'blur(2px)'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
      </button>

      {/* Refresh random batch */}
      <button
        aria-label="Refresh random photos"
        onClick={(e) => { e.stopPropagation(); if (!isRefreshing) loadRandom(); }}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
          background: 'rgba(0,0,0,0.45)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '8px 10px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: isRefreshing ? 'default' : 'pointer',
          opacity: isRefreshing ? 0.7 : 1,
          backdropFilter: 'blur(2px)'
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"></path><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"></path></svg>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </button>

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '40px 32px 24px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)',
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end'
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 300, letterSpacing: '1px' }}>
            {current.roll_title}
          </h2>
          <div style={{ marginTop: '8px', fontSize: '14px', opacity: 0.8, display: 'flex', gap: '12px' }}>
            {current.camera && <span>{current.camera}</span>}
            {current.lens && <span>{current.lens}</span>}
            {current.date_taken && <span>{current.date_taken}</span>}
          </div>
        </div>
      </div>
      {viewerOpen && (
        <ImageViewer
          images={photos}
          index={currentIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
