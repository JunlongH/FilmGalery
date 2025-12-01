import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';
import { buildUploadUrl } from '../api';
import ModalDialog from './ModalDialog';

function HeartIcon({ filled }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={filled ? "#ff9e9e" : "none"} stroke={filled ? "none" : "white"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))' }}>
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
  );
}

function NoteEditModal({ initialValue, onSave, onClose }) {
  const [val, setVal] = React.useState(initialValue);
  return (
    <div className="iv-overlay" onClick={onClose} style={{ background: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', zIndex: 10001 }}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ background: '#fff', color: '#333', padding: 20, borderRadius: 8, width: 300 }}>
        <h3 style={{ marginTop: 0 }}>Edit Note</h3>
        <textarea 
          value={val} 
          onChange={e => setVal(e.target.value)} 
          style={{ width: '100%', height: 80, marginBottom: 10, padding: 8, borderRadius: 4, border: '1px solid #ccc' }}
          autoFocus
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onClose} style={{ padding: '6px 12px' }}>Cancel</button>
          <button onClick={() => onSave(val)} style={{ padding: '6px 12px', background: '#2f7d32', color: '#fff', border: 'none', borderRadius: 4 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default function PhotoItem({ p, onSelect, onSetCover, onDeletePhoto, onUpdatePhoto, filmName, onEditTags, viewMode = 'positive', multiSelect=false, selected=false, onToggleSelect }) {
  const navigate = useNavigate();
  const [fullUrl, setFullUrl] = React.useState(null);
  const [thumbUrl, setThumbUrl] = React.useState(null);
  const [liked, setLiked] = React.useState(p.rating === 1);
  const [editingNote, setEditingNote] = React.useState(false); // Add state for editing note
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const [dialog, setDialog] = React.useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });

  const showConfirm = (title, message, onConfirm) => {
    setDialog({ 
      isOpen: true, 
      type: 'confirm', 
      title, 
      message, 
      onConfirm: () => {
        onConfirm();
        setDialog(prev => ({ ...prev, isOpen: false }));
      },
      onCancel: () => setDialog(prev => ({ ...prev, isOpen: false }))
    });
  };

  React.useEffect(() => {
    let fullCandidate = null;
    let thumbCandidate = null;

    // Cache buster (implicit below via Date.now())
    
    if (viewMode === 'negative') {
      // Prefer new negative paths
      if (p.negative_rel_path) fullCandidate = `/uploads/${p.negative_rel_path}`;
      else if (p.full_rel_path) fullCandidate = `/uploads/${p.full_rel_path}`; // legacy fallback
      else if (p.filename) fullCandidate = p.filename;

      if (p.negative_thumb_rel_path) {
        thumbCandidate = `/uploads/${p.negative_thumb_rel_path}`;
      } else if (p.thumb_rel_path) {
        thumbCandidate = `/uploads/${p.thumb_rel_path}`; // legacy thumb fallback
      } else {
        // Infer from negative path if possible
        if (p.negative_rel_path) {
          try {
            const parts = p.negative_rel_path.split('/');
            const filename = parts.pop();
            const dir = parts.join('/');
            const dotIndex = filename.lastIndexOf('.');
            const nameNoExt = filename.substring(0, dotIndex);
            const base = nameNoExt.endsWith('_neg') ? nameNoExt.slice(0, -4) : nameNoExt;
            const thumbName = `${base}-thumb.jpg`;
            thumbCandidate = `/uploads/${dir}/thumb/${thumbName}`;
          } catch {
            thumbCandidate = fullCandidate;
          }
        } else {
          thumbCandidate = fullCandidate;
        }
      }
    } else {
      // Positive/main view prefers positive_rel_path & positive_thumb_rel_path
      if (p.positive_rel_path) fullCandidate = `/uploads/${p.positive_rel_path}`;
      else if (p.full_rel_path) fullCandidate = `/uploads/${p.full_rel_path}`;
      else if (p.filename) fullCandidate = p.filename;

      if (p.positive_thumb_rel_path) {
        thumbCandidate = `/uploads/${p.positive_thumb_rel_path}`;
      } else if (p.thumb_rel_path) {
        thumbCandidate = `/uploads/${p.thumb_rel_path}`; // legacy fallback
      } else {
        thumbCandidate = fullCandidate;
      }
    }
    
    // Append timestamp to force reload if file changed
    const bust = `?t=${Date.now()}`; 

    // If viewMode is positive but no positive image exists, show placeholder or handle gracefully
    if (viewMode === 'positive' && !p.full_rel_path && !p.positive_rel_path) {
        setFullUrl(null); // Or a placeholder URL
        setThumbUrl(null);
    } else {
        setFullUrl(buildUploadUrl(fullCandidate) + bust);
        setThumbUrl(buildUploadUrl(thumbCandidate) + bust);
    }
    setLiked(p.rating === 1);
  }, [p, viewMode]);

  const handleEditNote = (e) => {
    e.stopPropagation();
    // Use IPC or a custom modal instead of prompt() in Electron
    // For now, we can use a simple custom implementation or just rely on the fact that
    // we are replacing prompt() with a non-blocking UI in the next step.
    // But actually, let's just use a small overlay state here for simplicity.
    setEditingNote(true);
  };

  const saveNote = (newNote) => {
    onUpdatePhoto(p.id, { caption: newNote });
    setEditingNote(false);
  };

  const toggleLike = (e) => {
    e.stopPropagation();
    const newVal = liked ? 0 : 1;
    setLiked(!liked);
    onUpdatePhoto(p.id, { rating: newVal });
  };

  const handleEditTags = (e) => {
    e.stopPropagation();
    if (onEditTags) onEditTags(p);
  };

  // Removed inline meta modal in favor of ImageViewer sidebar

  const handleDeleteTag = async (tagId) => {
    showConfirm('Remove Tag', 'Remove this tag?', async () => {
        const nextTags = tags.filter(t => t.id !== tagId).map(t => t.name);
        try {
          await onUpdatePhoto(p.id, { tags: nextTags });
        } catch (err) {
          console.error('Failed to remove tag', err);
        }
    });
  };

  const handleRootClick = () => {
    if (multiSelect) {
      onToggleSelect && onToggleSelect(p);
      return;
    }
    onSelect && onSelect();
  };

  return (
    <div className={`photo-item ${selected ? 'selected' : ''}`} onClick={handleRootClick} style={multiSelect ? { outline: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', position:'relative', cursor:'pointer' } : {}}>
      {multiSelect && (
        <div style={{ position:'absolute', top:6, left:6, zIndex:10 }}>
          <input type="checkbox" checked={selected} onChange={(e)=>{ e.stopPropagation(); onToggleSelect && onToggleSelect(p); }} />
        </div>
      )}
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
      <div className="photo-like-btn" onClick={multiSelect ? undefined : toggleLike} title={liked ? "Unlike" : "Like"} style={multiSelect ? { pointerEvents:'none', opacity:0.5 } : {}}>
        <HeartIcon filled={liked} />
      </div>
      <div className="photo-tags-overlay" onClick={(e)=>e.stopPropagation()}>
        {tags && tags.length > 0 ? (
          <div className="photo-tag-inline-list">
            {tags.map((t, i) => (
              <span key={i} className="photo-tag-wrapper">
                <span 
                  className="photo-tag-inline clickable" 
                  onClick={(e) => {
                    e.stopPropagation();
                    if (t.id) navigate(`/themes/${t.id}`);
                  }}
                >
                  {t.name || t}
                </span>
                <button 
                  className="photo-tag-remove-btn" 
                  onClick={(e) => { e.stopPropagation(); handleDeleteTag(t.id); }}
                  title="Remove tag"
                >
                  ×
                </button>
                {i < tags.length - 1 ? <span className="tag-separator">·</span> : ''}
              </span>
            ))}
          </div>
        ) : null}
        <button className="photo-tag-add-btn" onClick={multiSelect ? undefined : handleEditTags} title="Add / Edit tags" style={multiSelect ? { pointerEvents:'none', opacity:0.5 } : {}}>
          <PlusIcon />
        </button>
      </div>
      {!multiSelect && (
        <div className="photo-actions">
          <button onClick={(e)=>{e.stopPropagation(); onSetCover(p.id);}}>Set cover</button>
          <button onClick={handleEditNote}>Note</button>
          {/* Edit Meta moved to fullscreen ImageViewer sidebar */}
          <button onClick={(e)=>{e.stopPropagation(); onDeletePhoto(p.id);}}>Delete</button>
        </div>
      )}
      {p.caption && (
        <div className="photo-caption-overlay bottom">
          {p.caption}
        </div>
      )}
      <div className="photo-thumb">
        {(thumbUrl || fullUrl) ? (
          <LazyLoadImage
            alt={p.caption || ''}
            src={thumbUrl || fullUrl}
            effect="opacity"
            wrapperClassName="lazy-load-wrapper"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div style={{ 
            width: '100%', 
            height: '100%', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            background: '#f0f0f0', 
            color: '#999', 
            fontSize: '12px',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <span>No Photo</span>
            {viewMode === 'positive' && p.negative_rel_path && (
              <span style={{ fontSize: '10px', opacity: 0.7 }}>(Negative Available)</span>
            )}
          </div>
        )}
      </div>
      {editingNote && (
        <NoteEditModal 
          initialValue={p.caption} 
          onSave={saveNote} 
          onClose={() => setEditingNote(false)} 
        />
      )}
      
    </div>
  );
}
