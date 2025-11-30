import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { buildUploadUrl } from '../api';
import ImageViewer from './ImageViewer';

export default function HeroRandomPhotos() {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    const API = process.env.REACT_APP_API_BASE || 'http://127.0.0.1:4000';
    fetch(`${API}/api/photos/random?limit=5`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPhotos(data);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (photos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % photos.length);
    }, 6000); // Change every 6 seconds
    return () => clearInterval(timer);
  }, [photos]);

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
          src={buildUploadUrl(current.full_rel_path)}
          alt={current.caption || current.roll_title || ''}
          initial={{ opacity: 0, scale: 1.04 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={{ position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', display:'block' }}
          draggable={false}
        />
      </AnimatePresence>
      
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
