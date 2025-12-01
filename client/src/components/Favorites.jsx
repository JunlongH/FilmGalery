import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFavoritePhotos, buildUploadUrl, updatePhoto } from '../api';
import ImageViewer from './ImageViewer';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';

export default function Favorites() {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const queryClient = useQueryClient();

  const { data: photos = [] } = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const p = await getFavoritePhotos();
      return Array.isArray(p) ? p : [];
    }
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => queryClient.invalidateQueries(['favorites'])
  });

  async function onUnlike(photoId) {
    try {
      await updatePhotoMutation.mutateAsync({ photoId, data: { rating: 0 } });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div>
      <h2>Favorites</h2>
      {photos.length === 0 ? <div style={{ color:'#666' }}>No favorites yet.</div> : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px, 1fr))', gap:12 }}>
          {photos.map((p, idx) => (
            <FavItem key={p.id} p={p} onSelect={()=>setSelectedPhotoIndex(idx)} onUnlike={onUnlike} />
          ))}
        </div>
      )}

      {selectedPhotoIndex !== null && (
        <ImageViewer
          images={photos}
          index={selectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
        />
      )}
    </div>
  );
}

function HeartIcon({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "#ff9e9e" : "none"} stroke={filled ? "none" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}>
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  );
}

function FavItem({ p, onSelect, onUnlike }) {
  const [url, setUrl] = useState(null);
  const [liked, setLiked] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    // Prefer new positive thumb/full paths, fallback to legacy
    let candidate = null;
    if (p.positive_thumb_rel_path) candidate = `/uploads/${p.positive_thumb_rel_path}`;
    else if (p.thumb_rel_path) candidate = `/uploads/${p.thumb_rel_path}`; // legacy fallback
    else if (p.positive_rel_path) candidate = `/uploads/${p.positive_rel_path}`;
    else if (p.full_rel_path) candidate = `/uploads/${p.full_rel_path}`;
    else if (p.filename) candidate = p.filename;
    if (!candidate) candidate = '';
    const bust = `?t=${Date.now()}`;
    setUrl(buildUploadUrl(candidate) + bust);
    setLiked((p.rating|0) === 1);
  }, [p]);
  const toggleLike = async (e) => {
    e.stopPropagation();
    onUnlike(p.id);
  };

  return (
    <div className="photo-item">
      <div className="photo-like-btn" onClick={toggleLike} title={liked ? 'Unlike' : 'Like'}>
        <HeartIcon filled={liked} />
      </div>
      
      {/* Delete/Trash icon on top-left */}
      <div 
        className="photo-delete-btn" 
        onClick={(e) => { e.stopPropagation(); if(window.confirm('Remove from favorites?')) onUnlike(p.id); }}
        title="Remove from favorites"
        style={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 20,
          cursor: 'pointer',
          opacity: 0,
          transform: 'scale(0.9)',
          transition: 'all 0.2s ease'
        }}
      >
        <TrashIcon />
      </div>

      <div className="photo-caption-overlay bottom" style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingBottom: 8, pointerEvents: 'none' }}>
        {p.caption && <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.caption}</div>}
        <div style={{ fontSize: 11, opacity: 0.9, display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto', overflow: 'hidden' }}>
          <span 
            className="overlay-link" 
            onClick={(e) => { e.stopPropagation(); navigate(`/rolls/${p.roll_id}`); }}
            style={{ textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}
          >
            {p.roll_title || 'Untitled Roll'}
          </span>
          <span style={{ flexShrink: 0 }}>•</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flexShrink: 1 }}>{p.film_name || 'Unknown Film'}</span>
        </div>
      </div>
      
      <div className="photo-thumb" onClick={onSelect}>
        <LazyLoadImage
          src={url}
          alt={p.caption || ''}
          effect="opacity"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      
      <style>{`
        .photo-item:hover .photo-delete-btn {
          opacity: 1;
          transform: scale(1);
        }
        .photo-delete-btn:hover {
          transform: scale(1.1);
        }
      `}</style>
    </div>
  );
}
