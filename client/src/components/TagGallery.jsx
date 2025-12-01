import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ImageViewer from './ImageViewer';
import { buildUploadUrl, getTagPhotos, getTags, updatePhoto } from '../api';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';

export default function TagGallery() {
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const [viewerIndex, setViewerIndex] = useState(null);

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const t = await getTags();
      return (Array.isArray(t) ? t : []).filter(tag => tag.photos_count > 0);
    }
  });

  const selectedTag = params.tagId ? tags.find(t => String(t.id) === String(params.tagId)) : null;

  const { data: photos = [], isLoading: loadingPhotos } = useQuery({
    queryKey: ['tagPhotos', params.tagId],
    queryFn: () => getTagPhotos(params.tagId),
    enabled: !!params.tagId
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['tagPhotos', params.tagId]);
      queryClient.invalidateQueries(['tags']);
    }
  });

  // View: List of all tags (Tag Cloud)
  if (!selectedTag) {
    return (
      <div>
        <div className="page-header">
          <h3>Themes</h3>
        </div>
        <div className="card-grid">
          {tags.length === 0 ? (
            <div style={{ color: '#666' }}>No themes yet. Add tags to your photos to see them here.</div>
          ) : (
            tags.map(t => (
              <div key={t.id} className="card" onClick={() => navigate(`/themes/${t.id}`)}>
                <div className="card-cover">
                  {t.cover_thumb || t.cover_full ? (
                    <LazyLoadImage
                      src={buildUploadUrl((t.cover_thumb || t.cover_full).startsWith('/') ? (t.cover_thumb || t.cover_full) : `/uploads/${t.cover_thumb || t.cover_full}`)}
                      alt={t.name}
                      effect="opacity"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div className="no-cover">No Cover</div>
                  )}
                  <div className="card-overlay">
                    <div className="card-title">{t.name}</div>
                    <div className="card-meta">{t.photos_count} photos</div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // View: Single Tag Gallery
  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate('/themes')} className="btn-back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </button>
          <h3>{selectedTag.name}</h3>
          <span style={{ color: '#666', fontSize: '14px', fontWeight: 'normal' }}>{photos.length} photos</span>
        </div>
      </div>

      {loadingPhotos ? <div>Loading...</div> : (
        photos.length === 0 ? <div style={{ color:'#666' }}>No photos for this theme.</div> : (
          <div className="grid">
            {photos.map((p, idx) => (
              <TagPhotoItem 
                key={p.id} 
                photo={p} 
                index={idx} 
                onOpenViewer={(i)=>setViewerIndex(i)} 
                onToggleFavorite={async (photo, prevLiked)=>{
                  try { 
                    await updatePhotoMutation.mutateAsync({ photoId: photo.id, data: { rating: prevLiked ? 0 : 1 } });
                  } catch (err) { console.error(err); }
                }}
                onRemoveFromTheme={async (photo) => {
                  if (!window.confirm(`Remove this photo from theme "${selectedTag.name}"?`)) return;
                  const currentTags = photo.tags || [];
                  const newTags = currentTags.filter(t => t.id !== selectedTag.id).map(t => t.name);
                  try {
                    await updatePhotoMutation.mutateAsync({ photoId: photo.id, data: { tags: newTags } });
                    window.dispatchEvent(new Event('refresh-tags'));
                  } catch (err) {
                    console.error(err);
                    alert('Failed to remove from theme');
                  }
                }}
              />
            ))}
          </div>
        )
      )}

      {viewerIndex !== null && (
        <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}

function TagPhotoItem({ photo, index, onOpenViewer, onToggleFavorite, onRemoveFromTheme }) {
  const navigate = useNavigate();
  const [url, setUrl] = useState(null);
  const [liked, setLiked] = useState((photo.rating|0) === 1);

  useEffect(() => {
    // Prefer new positive/negative thumbs; fallback to legacy
    let candidate = null;
    if (photo.positive_thumb_rel_path) candidate = `/uploads/${photo.positive_thumb_rel_path}`;
    else if (photo.negative_thumb_rel_path) candidate = `/uploads/${photo.negative_thumb_rel_path}`; // if viewing generic tag gallery, still show something
    else if (photo.thumb_rel_path) candidate = `/uploads/${photo.thumb_rel_path}`;
    else if (photo.positive_rel_path) candidate = `/uploads/${photo.positive_rel_path}`;
    else if (photo.full_rel_path) candidate = `/uploads/${photo.full_rel_path}`;
    else if (photo.filename) candidate = photo.filename;
    if (!candidate) candidate = '';
    const bust = `?t=${Date.now()}`;
    setUrl(buildUploadUrl(candidate) + bust);
    setLiked((photo.rating|0) === 1);
  }, [photo]);

  const toggleFavorite = async (e) => {
    e.stopPropagation();
    const prev = liked;
    setLiked(!prev);
    try {
      await onToggleFavorite(photo, prev);
    } catch (err) {
      setLiked(prev);
      throw err;
    }
  };

  return (
    <div className="photo-item" onClick={() => onOpenViewer(index)}>
      <div className="photo-like-btn" onClick={toggleFavorite} title={liked ? 'Unlike' : 'Like'}>
        <HeartIcon filled={liked} />
      </div>
      <div className="photo-tags-overlay">
        <button 
          onClick={(e) => { e.stopPropagation(); onRemoveFromTheme(photo); }}
          className="btn-remove-theme-overlay"
          title="Remove from theme"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
      {photo.caption && (
        <div className="photo-caption-overlay bottom">{photo.caption}</div>
      )}
      {(photo.film_name || photo.roll_title) && (
        <div className="photo-film-overlay">
          {photo.roll_title ? (
            <span className="overlay-link" onClick={(e) => {
              e.stopPropagation();
              if (photo.roll_id) navigate(`/rolls/${photo.roll_id}`);
            }}>{photo.roll_title}</span>
          ) : null}
          {(photo.roll_title && photo.film_name) ? <span style={{ margin: '0 6px' }}>•</span> : null}
          {photo.film_name || null}
        </div>
      )}
      <div className="photo-thumb">
        <LazyLoadImage
          src={url}
          alt={photo.caption || ''}
          effect="opacity"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
    </div>
  );
}

function HeartIcon({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "#ff9e9e" : "none"} stroke={filled ? "none" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>
  );
}
