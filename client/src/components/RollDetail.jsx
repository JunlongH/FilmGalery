// src/components/RollDetail.jsx
import React, { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRoll, getPhotos, uploadPhotosToRoll, getTags, setRollCover, deletePhoto, updateRoll, updatePhoto, buildUploadUrl, getFilms, getMetadataOptions } from '../api';
import { useParams } from 'react-router-dom';
import ImageViewer from './ImageViewer';
import PhotoItem from './PhotoItem';
import TagEditModal from './TagEditModal';
import ModalDialog from './ModalDialog';
import LocationSelect from './LocationSelect.jsx';
import PhotoDetailsSidebar from './PhotoDetailsSidebar.jsx';
import '../styles/sidebar.css';
import '../styles/forms.css';
import '../styles/roll-detail-card.css';

export default function RollDetail() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [editingTagsPhoto, setEditingTagsPhoto] = useState(null);
  const [viewMode, setViewMode] = useState('positive'); // 'positive' | 'negative'
  const [availableFilms, setAvailableFilms] = useState([]);
  const [options, setOptions] = useState({ cameras: [], lenses: [], photographers: [] });
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });
  // Removed unused collapsible state
  const [multiSelect, setMultiSelect] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState([]);
  const [showBatchSidebar, setShowBatchSidebar] = useState(false);
  const [showRollSidebar, setShowRollSidebar] = useState(false);

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };

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

  const { data: roll } = useQuery({
    queryKey: ['roll', id],
    queryFn: () => getRoll(id)
  });

  const { data: photos = [] } = useQuery({
    queryKey: ['rollPhotos', id],
    queryFn: () => getPhotos(id)
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags
  });

  // Locations now embedded in roll response (row.locations)

  const uploadMutation = useMutation({
    mutationFn: uploadPhotosToRoll,
    onSuccess: () => {
      queryClient.invalidateQueries(['rollPhotos', id]);
      queryClient.invalidateQueries(['roll', id]); // Cover might change
    }
  });

  const deletePhotoMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      queryClient.invalidateQueries(['rollPhotos', id]);
      queryClient.invalidateQueries(['roll', id]);
    }
  });

  const setCoverMutation = useMutation({
    mutationFn: ({ rollId, photoId }) => setRollCover(rollId, { photoId }),
    onSuccess: () => queryClient.invalidateQueries(['roll', id])
  });

  const updateRollMutation = useMutation({
    mutationFn: ({ rollId, data }) => updateRoll(rollId, data),
    onSuccess: () => queryClient.invalidateQueries(['roll', id])
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => queryClient.invalidateQueries(['rollPhotos', id])
  });

  function resolveFilmName(rollObj) {
    if (!rollObj) return null;
    if (rollObj.film_name_joined) return rollObj.film_name_joined;
    if (rollObj.film && typeof rollObj.film === 'object' && rollObj.film.name) return rollObj.film.name;
    if (rollObj.film_type) return rollObj.film_type;
    return null;
  }

  const filmName = resolveFilmName(roll);

  const fileInputRef = useRef(null);

  async function onUpload(e) {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    try {
      await uploadMutation.mutateAsync({
        rollId: id,
        files,
        isNegative: viewMode === 'negative',
        onProgress: ({ index, total }) => console.debug(`Uploading ${index}/${total}`)
      });
    } catch (err) {
      console.error('Upload failed', err);
      showAlert('Error', 'Upload failed: ' + (err.message || err));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function onDeletePhoto(photoId) {
    showConfirm('Delete Photo', 'Delete this photo?', async () => {
      try {
        await deletePhotoMutation.mutateAsync(photoId);
      } catch (err) {
        console.error('Delete failed', err);
        showAlert('Error', 'Delete failed: ' + (err.message || err));
      }
    });
  }

  async function onSetCover(photoId) {
    showConfirm('Set Cover', 'Set this photo as roll cover?', async () => {
      try {
        await setCoverMutation.mutateAsync({ rollId: id, photoId });
      } catch (err) {
        console.error('Set cover failed', err);
        showAlert('Error', 'Set cover failed');
      }
    });
  }

  async function onUpdatePhoto(photoId, data) {
    try {
      await updatePhotoMutation.mutateAsync({ photoId, data });
      if (multiSelect) {
        // update in local selectedPhotos if present
        setSelectedPhotos(prev => prev.map(p => p.id === photoId ? { ...p, ...data } : p));
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleEditClick() {
    // Always fetch fresh films list when entering edit mode
    try {
      const [f, o] = await Promise.all([getFilms(), getMetadataOptions()]);
      setAvailableFilms(Array.isArray(f) ? f : []);
      setOptions(o || { cameras: [], lenses: [], photographers: [] });
    } catch (err) {
      console.error('Failed to load films/options for edit', err);
      setAvailableFilms([]);
      setOptions({ cameras: [], lenses: [], photographers: [] });
    }

    setEditData({
      title: roll.title || '',
      start_date: roll.start_date || '',
      end_date: roll.end_date || '',
      camera: roll.camera || '',
      lens: roll.lens || '',
      photographer: roll.photographer || '',
      film_type: roll.film_type || '',
      filmId: roll.filmId || roll.film_id || '',
      notes: roll.notes || '',
      develop_lab: roll.develop_lab || '',
      develop_process: roll.develop_process || '',
      develop_date: roll.develop_date || '',
      purchase_cost: roll.purchase_cost || '',
      develop_cost: roll.develop_cost || '',
      purchase_channel: roll.purchase_channel || '',
      develop_note: roll.develop_note || ''
    });
    setSelectedLocations(Array.isArray(roll.locations) ? roll.locations.slice() : []);
    setIsEditing(false);
    setShowRollSidebar(true);
  }

  const PROCESS_PRESETS = ['C-41', 'E-6', 'BW', 'ECN-2'];
  const [selectedLocations, setSelectedLocations] = useState([]);

  async function handleSaveEdit() {
    try {
      await updateRollMutation.mutateAsync({ 
        rollId: id, 
        data: { 
          ...editData,
          locations: selectedLocations.map(l => l.location_id)
        }
      });
      setShowRollSidebar(false);
    } catch (err) {
      console.error(err);
      alert('Update failed: ' + err.message);
    }
  }

  if (!roll) return <div>Loading...</div>;

  function formatDate(d) {
    if (d === undefined || d === null || d === '') return '';
    let val = d;
    if (typeof val === 'string' && /^\d+$/.test(val)) val = Number(val);
    if (typeof val === 'number') {
      if (val > 0 && val < 1e11) val = val * 1000;
      const dtN = new Date(val);
      if (!isNaN(dtN.getTime())) {
        const yyyy = dtN.getFullYear();
        const mm = String(dtN.getMonth() + 1).padStart(2, '0');
        const dd = String(dtN.getDate()).padStart(2, '0');
        return `${yyyy}.${mm}.${dd}`;
      }
    }
    const dt = new Date(d);
    if (!isNaN(dt.getTime())) {
      const yyyy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, '0');
      const dd = String(dt.getDate()).padStart(2, '0');
      return `${yyyy}.${mm}.${dd}`;
    }
    return String(d);
  }

  const rawStart = roll.start_date ?? null;
  const rawEnd = roll.end_date ?? null;
  const dateStr = (() => {
    const s = formatDate(rawStart);
    const e = formatDate(rawEnd);
    if (!s && !e) return '';
    if (s && e) return s === e ? s : `${s} — ${e}`;
    return s || e || '';
  })();

  return (
    <div className="roll-detail-page">
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
      <div className="roll-card">
        <div className="roll-info-column">
          <div className="roll-header-section">
            <div className="roll-title-block">
              <span className="roll-id">#{(roll && roll.display_seq) ? roll.display_seq : id}</span>
              <h1 className="roll-title">{roll.title || 'Untitled Roll'}</h1>
            </div>
            <button className="roll-action-btn" onClick={handleEditClick}>Edit Info</button>
          </div>

          <div className="roll-meta-grid">
            <div className="meta-group">
              <span className="meta-label">Date</span>
              <span className="meta-value-text date-inline">{dateStr || '—'}</span>
            </div>
            <div className="meta-group">
              <span className="meta-label">Film</span>
              <span className="meta-value-text">{filmName || '—'}</span>
            </div>
            
            {/* Locations - Moved to first row */}
            {Array.isArray(roll?.locations) && roll.locations.length > 0 && (
              <div className="meta-group">
                <span className="meta-label">Locations</span>
                <div className="tags-list">
                  {roll.locations.map(l => (
                    <span key={l.location_id} className="tag-pill">{l.city_name}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Collapsible Gear Details */}
            <details className="roll-collapsible" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
              <summary>
                <span className="meta-label">Gear & Crew</span>
                <svg className="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </summary>
              <div className="roll-collapsible-content" style={{ paddingTop: 20 }}>
                <div className="roll-meta-grid" style={{ gap: '24px' }}>
                  
                  {/* Cameras */}
                  <div className="meta-group">
                    <span className="meta-label">Cameras</span>
                    <div className="tags-list">
                      {(roll.gear?.cameras?.length ? roll.gear.cameras : (roll.camera ? [roll.camera] : [])).map((v, i) => (
                        <span key={i} className="tag-pill">{v}</span>
                      ))}
                      {!(roll.gear?.cameras?.length || roll.camera) && <span className="meta-value-text" style={{opacity:0.5, fontSize:13}}>—</span>}
                    </div>
                  </div>

                  {/* Lenses */}
                  <div className="meta-group">
                    <span className="meta-label">Lenses</span>
                    <div className="tags-list">
                      {(roll.gear?.lenses?.length ? roll.gear.lenses : (roll.lens ? [roll.lens] : [])).map((v, i) => (
                        <span key={i} className="tag-pill">{v}</span>
                      ))}
                      {!(roll.gear?.lenses?.length || roll.lens) && <span className="meta-value-text" style={{opacity:0.5, fontSize:13}}>—</span>}
                    </div>
                  </div>

                  {/* Photographers */}
                  <div className="meta-group">
                    <span className="meta-label">Photographers</span>
                    <div className="tags-list">
                      {(roll.gear?.photographers?.length ? roll.gear.photographers : (roll.photographer ? [roll.photographer] : [])).map((v, i) => (
                        <span key={i} className="tag-pill">{v}</span>
                      ))}
                      {!(roll.gear?.photographers?.length || roll.photographer) && <span className="meta-value-text" style={{opacity:0.5, fontSize:13}}>—</span>}
                    </div>
                  </div>

                </div>
              </div>
            </details>

            {roll.notes && (
              <div className="meta-group" style={{ gridColumn: '1 / -1', marginTop: 8 }}>
                <span className="meta-label">Notes</span>
                <span className="meta-value-text" style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{roll.notes}</span>
              </div>
            )}
          </div>

          <div className="roll-actions-bar" style={{ marginTop: 'auto', paddingTop: 24 }}>
            <div className="segmented-control">
              <button 
                className={`segment-btn ${viewMode === 'positive' ? 'active' : ''}`}
                onClick={() => !multiSelect && setViewMode('positive')}
                disabled={multiSelect}
              >
                Positive
              </button>
              <button 
                className={`segment-btn ${viewMode === 'negative' ? 'active' : ''}`}
                onClick={() => !multiSelect && setViewMode('negative')}
                disabled={multiSelect}
              >
                Negative
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="primary-btn" onClick={() => !multiSelect && fileInputRef.current && fileInputRef.current.click()} disabled={multiSelect}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:6}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload Photos
              </button>
              <button className="primary-btn" style={{ background: multiSelect ? '#1d4ed8' : '#334155' }} onClick={() => { setMultiSelect(!multiSelect); if (!multiSelect) setSelectedPhotos([]); }}>
                {multiSelect ? 'Multi-Select: ON' : 'Multi-Select'}
              </button>
              {multiSelect && selectedPhotos.length > 0 && (
                <button className="primary-btn" style={{ background:'#2563eb' }} onClick={() => setShowBatchSidebar(true)}>Edit Selected ({selectedPhotos.length})</button>
              )}
            </div>
          </div>
        </div>

        <div className="roll-visual-column">
          <div className="roll-cover-frame">
            {(() => {
               const cover = roll.coverPath || roll.cover_photo;
               if (cover) {
                 return <img src={buildUploadUrl(cover)} alt="Cover" className="roll-cover-img" />;
               }
               // Fallback to first photo
               const first = photos.find(p => p.positive_rel_path || p.full_rel_path || p.negative_rel_path);
               if (first) {
                 const path = first.positive_rel_path || first.full_rel_path || first.negative_rel_path;
                 return <img src={buildUploadUrl(path)} alt="Cover (Auto)" className="roll-cover-img" />;
               }
               return <div className="empty-cover-placeholder">No Cover Image</div>;
            })()}
          </div>
        </div>
      </div>

        {isEditing && (
          <div style={{ marginTop: 12, marginBottom: 20 }}>
            <button className="primary-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>Upload files</button>
          </div>
        )}

        {(() => {
          const positiveCount = photos.filter(p => !!p.full_rel_path || !!p.positive_rel_path).length;
          const negativeCount = photos.filter(p => !!p.negative_rel_path).length;

          // Auto-switch view mode if only negatives exist and we are in positive mode
          // Use a ref or effect to avoid infinite render loop, or just show a helpful message
          
          const filteredPhotos = photos.filter(p => {
            if (viewMode === 'positive') return !!p.full_rel_path || !!p.positive_rel_path;
            if (viewMode === 'negative') return !!p.negative_rel_path;
            return true;
          });

          if (filteredPhotos.length === 0) {
            if (viewMode === 'positive' && negativeCount > 0) {
               return (
                 <div style={{ padding: '60px 0', textAlign: 'center', color: '#888' }}>
                   <p>No positive photos available.</p>
                   <button className="btn btn-secondary" onClick={() => setViewMode('negative')}>
                     Switch to Negative View ({negativeCount} photos)
                   </button>
                 </div>
               );
            }
            return (
              <div style={{ 
                padding: '60px 0', 
                textAlign: 'center', 
                color: '#999',
                fontSize: '15px',
                background: '#f9f9f9',
                borderRadius: '12px',
                border: '1px dashed #ddd',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div>{viewMode === 'positive' ? 'No positive photos available.' : 'No negative photos available.'}</div>
                
                {viewMode === 'positive' && negativeCount > 0 && (
                  <button 
                    className="primary-btn" 
                    onClick={() => setViewMode('negative')}
                    style={{ fontSize: '14px', padding: '8px 16px' }}
                  >
                    Switch to Negative View ({negativeCount} photos)
                  </button>
                )}
                
                {viewMode === 'negative' && positiveCount > 0 && (
                  <button 
                    className="primary-btn" 
                    onClick={() => setViewMode('positive')}
                    style={{ fontSize: '14px', padding: '8px 16px' }}
                  >
                    Switch to Positive View ({positiveCount} photos)
                  </button>
                )}
              </div>
            );
          }

          return (
            <div className="photo-grid">
              {filteredPhotos.map((p, idx) => (
                <PhotoItem 
                  key={p.id} 
                  p={p} 
                  filmName={filmName} 
                  viewMode={viewMode}
                  onSelect={() => setSelectedPhotoIndex(idx)} 
                  onSetCover={onSetCover} 
                  onDeletePhoto={onDeletePhoto} 
                  onUpdatePhoto={onUpdatePhoto}
                  onEditTags={(photo) => setEditingTagsPhoto(photo)}
                  multiSelect={multiSelect}
                  selected={selectedPhotos.some(sp => sp.id === p.id)}
                  onToggleSelect={(photo)=>{
                    setSelectedPhotos(prev => prev.some(sp => sp.id === photo.id) ? prev.filter(sp => sp.id !== photo.id) : [...prev, photo]);
                  }}
                />
              ))}
            </div>
          );
        })()}

        {editingTagsPhoto && (
          <TagEditModal 
            photo={editingTagsPhoto} 
            allTags={allTags} 
            onClose={() => setEditingTagsPhoto(null)} 
            onSave={async (photoId, newTags) => {
              try {
                await onUpdatePhoto(photoId, { tags: newTags });
                // Refresh tags query and notify sidebar
                queryClient.invalidateQueries(['tags']);
                // Also dispatch event to refresh sidebar
                window.dispatchEvent(new Event('refresh-tags'));
              } catch (err) {
                console.error('Failed to save tags', err);
              }
              setEditingTagsPhoto(null);
            }}
          />
        )}

        {selectedPhotoIndex !== null && (
          <ImageViewer
            images={photos.filter(p => {
              if (viewMode === 'positive') return !!p.full_rel_path || !!p.positive_rel_path;
              if (viewMode === 'negative') return !!p.negative_rel_path;
              return true;
            })}
            index={selectedPhotoIndex}
            viewMode={viewMode}
            onClose={() => setSelectedPhotoIndex(null)}
            onPhotoUpdate={() => {
               queryClient.invalidateQueries(['rollPhotos', id]);
               queryClient.invalidateQueries(['roll', id]);
            }}
            roll={roll}
          />
        )}
        {showBatchSidebar && multiSelect && selectedPhotos.length > 0 && (
          <PhotoDetailsSidebar 
            photos={selectedPhotos}
            roll={roll}
            onClose={() => setShowBatchSidebar(false)}
            onSaved={() => {
              setShowBatchSidebar(false);
              queryClient.invalidateQueries(['rollPhotos', id]);
              queryClient.invalidateQueries(['roll', id]); // Refresh roll metadata
            }}
          />
        )}
        {showRollSidebar && (
          <div role="presentation" onClick={()=>setShowRollSidebar(false)} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.25)', zIndex:10019 }}>
          <aside className="fg-sidepanel fade-slide-enter-active" role="dialog" aria-modal="true" aria-label="Edit roll" onClick={(e)=>e.stopPropagation()}>
            <header className="fg-sidepanel-header">
              <h3 className="fg-sidepanel-title">Edit Roll</h3>
              <button className="fg-sidepanel-close" aria-label="Close" onClick={()=>setShowRollSidebar(false)}>×</button>
            </header>
            <section className="fg-sidepanel-section">
              <div className="fg-section-label">Basic</div>
              <div className="fg-separator" />
              <div className="fg-field">
                <label className="fg-label">Title</label>
                <input className="fg-input" value={editData.title} onChange={e=>setEditData({...editData, title:e.target.value})} />
              </div>
              <div className="fg-sidepanel-groupGrid cols-2">
                <div className="fg-field">
                  <label className="fg-label">Start Date</label>
                  <input className="fg-input" type="date" value={editData.start_date} onChange={e=>setEditData({...editData, start_date:e.target.value})} />
                </div>
                <div className="fg-field">
                  <label className="fg-label">End Date</label>
                  <input className="fg-input" type="date" value={editData.end_date} onChange={e=>setEditData({...editData, end_date:e.target.value})} />
                </div>
              </div>
              <div className="fg-sidepanel-groupGrid cols-2">
                <div className="fg-field">
                  <label className="fg-label">Camera</label>
                  <input className="fg-input" list="camera-options" value={editData.camera} onChange={e=>setEditData({...editData, camera:e.target.value})} />
                  <datalist id="camera-options">{options.cameras.map((c,i)=><option key={i} value={c} />)}</datalist>
                </div>
                <div className="fg-field">
                  <label className="fg-label">Lens</label>
                  <input className="fg-input" list="lens-options" value={editData.lens} onChange={e=>setEditData({...editData, lens:e.target.value})} />
                  <datalist id="lens-options">{options.lenses.map((l,i)=><option key={i} value={l} />)}</datalist>
                </div>
              </div>
              <div className="fg-field">
                <label className="fg-label">Photographer</label>
                <input className="fg-input" list="photographer-options" value={editData.photographer || ''} onChange={e=>setEditData({...editData, photographer:e.target.value})} />
                <datalist id="photographer-options">{(options.photographers || []).map((s,i)=><option key={i} value={s} />)}</datalist>
              </div>
              <div className="fg-field">
                <label className="fg-label">Film</label>
                <select className="fg-select" value={editData.filmId || ''} onChange={e=>{ const fid=e.target.value; const found=availableFilms.find(f=>String(f.id)===String(fid)); setEditData({...editData, filmId: fid, film_type: found?found.name:''}); }}>
                  <option value="">Select film</option>
                  {availableFilms.map(f => <option key={f.id} value={f.id}>{f.name} (ISO {f.iso})</option>)}
                </select>
              </div>
            </section>
            <section className="fg-sidepanel-section">
              <div className="fg-section-label">Shooting Cities</div>
              <div className="fg-separator" />
              <LocationSelect value={null} onChange={(loc)=>{ if(!loc||!loc.location_id) return; setSelectedLocations(prev=> prev.some(p=>p.location_id===loc.location_id)?prev:[...prev, loc]); }} />
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginTop:6 }}>
                {selectedLocations.map(l => <span key={l.location_id} className="fg-pill">{l.city_name}</span>)}
              </div>
            </section>
            <section className="fg-sidepanel-section">
              <div className="fg-section-label">Development</div>
              <div className="fg-separator" />
              <div className="fg-sidepanel-groupGrid cols-2">
                <input className="fg-input" placeholder="Lab" value={editData.develop_lab} onChange={e=>setEditData(d=>({...d, develop_lab:e.target.value}))} />
                <div style={{ display:'flex', gap:8 }}>
                  <select className="fg-select" value={editData.develop_process||''} onChange={e=>setEditData(d=>({...d, develop_process:e.target.value}))}>
                    <option value="">Preset</option>
                    {PROCESS_PRESETS.map(p=> <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input className="fg-input" placeholder="Custom" value={editData.develop_process||''} onChange={e=>setEditData(d=>({...d, develop_process:e.target.value}))} />
                </div>
                <input className="fg-input" type="date" placeholder="Develop Date" value={editData.develop_date} onChange={e=>setEditData(d=>({...d, develop_date:e.target.value}))} />
                <input className="fg-input" type="number" placeholder="Purchase Cost" value={editData.purchase_cost} onChange={e=>setEditData(d=>({...d, purchase_cost:e.target.value}))} />
                <input className="fg-input" type="number" placeholder="Develop Cost" value={editData.develop_cost} onChange={e=>setEditData(d=>({...d, develop_cost:e.target.value}))} />
                <input className="fg-input" placeholder="Purchase Channel" value={editData.purchase_channel} onChange={e=>setEditData(d=>({...d, purchase_channel:e.target.value}))} />
                <input className="fg-input" placeholder="Note" value={editData.develop_note} onChange={e=>setEditData(d=>({...d, develop_note:e.target.value}))} />
              </div>
              <div className="fg-field" style={{ marginTop:12 }}>
                <label className="fg-label">Notes</label>
                <textarea className="fg-textarea" style={{ minHeight:80 }} value={editData.notes} onChange={e=>setEditData({...editData, notes:e.target.value})} />
              </div>
            </section>
            <section className="fg-sidepanel-section" style={{ marginTop:'auto' }}>
              <div className="fg-separator" />
              <div className="fg-sidepanel-actions">
                <button type="button" className="fg-btn" onClick={()=>setShowRollSidebar(false)}>Cancel</button>
                <button type="button" className="fg-btn fg-btn-primary" onClick={handleSaveEdit}>Save</button>
              </div>
            </section>
          </aside>
          </div>
        )}
      
      <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={onUpload} />
    </div>
  );
}
