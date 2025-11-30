import React, { useState, useEffect } from 'react';
import ImageViewer from './ImageViewer';
import { buildUploadUrl } from '../api';

export default function PhotoGrid({ photos = [] }) {
  const [viewerIndex, setViewerIndex] = useState(null);
  if (!Array.isArray(photos) || photos.length === 0) return <div style={{ color:'#666' }}>No photos found.</div>;
  return (
    <div>
      <div className="grid">
        {photos.map((p, idx) => (
          <PhotoThumb key={p.id || idx} photo={p} onClick={() => setViewerIndex(idx)} />
        ))}
      </div>
      {viewerIndex !== null && (
        <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}

function PhotoThumb({ photo, onClick }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let candidate = null;
    if (photo.thumb_rel_path) candidate = `/uploads/${photo.thumb_rel_path}`;
    else if (photo.full_rel_path) candidate = `/uploads/${photo.full_rel_path}`;
    else if (photo.filename) candidate = photo.filename;
    setUrl(buildUploadUrl(candidate));
  }, [photo]);
  return (
    <div className="photo-item" onClick={onClick}>
      <div className="photo-thumb">
        <img src={url} alt={photo.caption || ''} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
      </div>
    </div>
  );
}
