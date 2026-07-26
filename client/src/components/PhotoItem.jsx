import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import LazyImage from './common/LazyImage';
import { buildUploadUrl } from '../api';
import { addCacheKey } from '../utils/imageOptimization';
import ModalDialog from './ModalDialog';
import GlassModal from './ui/GlassModal';
import { Button } from '@heroui/react';
import { FileText } from 'lucide-react';

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
  const [val, setVal] = React.useState(initialValue || '');
  
  const handleSave = () => {
    onSave(val);
  };

  // Prevent click-through to elements behind the modal
  const handleContentClick = (e) => {
    e.stopPropagation();
  };
  
  return (
    <div onClick={handleContentClick}>
      <GlassModal
        isOpen={true}
        onClose={onClose}
        size="md"
        title="Edit Note"
        subtitle="Add a description or caption for this photo"
        icon={<FileText className="w-5 h-5" />}
        footer={
          <div className="flex gap-3 justify-end w-full">
            <Button
              variant="bordered"
              onPress={onClose}
              className="border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={handleSave}
              className="bg-blue-600 text-white"
            >
              Save
            </Button>
          </div>
        }
      >
        <textarea
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="Enter note or caption..."
          rows={4}
          className="w-full p-3 rounded-lg border border-zinc-200/50 dark:border-zinc-700/50 bg-white/80 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      </GlassModal>
    </div>
  );
}

function PhotoItem({ p, index, onSelect, onSetCover, onDeletePhoto, onUpdatePhoto, filmName, onEditTags, viewMode = 'positive', multiSelect=false, selected=false, onToggleSelect }) {
  const navigate = useNavigate();
  const [liked, setLiked] = React.useState(p.rating === 1);
  const [editingNote, setEditingNote] = React.useState(false); // Add state for editing note
  const tags = Array.isArray(p.tags) ? p.tags : [];
  const [dialog, setDialog] = React.useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });

  // rating 外部变更时同步（如批量操作后）
  React.useEffect(() => {
    setLiked(p.rating === 1);
  }, [p.rating]);

  // 缩略图/全尺寸 URL：纯派生数据，useMemo 计算（原 useState+useEffect 会多一轮渲染）
  // 缓存键基于 updated_at：文件未变命中浏览器 immutable 缓存，更新后自动换 URL
  const { fullUrl, thumbUrl } = useMemo(() => {
    let fullCandidate = null;
    let thumbCandidate = null;

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

    // If viewMode is positive but no positive image exists, show placeholder
    if (viewMode === 'positive' && !p.full_rel_path && !p.positive_rel_path) {
      return { fullUrl: null, thumbUrl: null };
    }
    return {
      fullUrl: addCacheKey(buildUploadUrl(fullCandidate), p.updated_at),
      thumbUrl: addCacheKey(buildUploadUrl(thumbCandidate), p.updated_at),
    };
  }, [p, viewMode]);

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

  const handleEditNote = (e) => {
    e.stopPropagation();
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
    onSelect && onSelect(index);
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
          {onSetCover && (<button onClick={(e)=>{e.stopPropagation(); onSetCover(p.id);}}>Set cover</button>)}
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
          <LazyImage
            alt={p.caption || ''}
            src={thumbUrl || fullUrl}
            aspectRatio="1"
            className="w-full h-full"
            objectFit="cover"
            fadeInDuration={0.3}
          />
        ) : (
          <div
            className="bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500"
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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

// memo 化：大网格中仅当自身 props 变化时才重渲染
// （依赖父组件传入稳定回调与原始 photo 对象，React Query structuralSharing 保证引用稳定）
export default React.memo(PhotoItem);
