// src/components/RollDetail.jsx
import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRoll, getPhotos, getTags, setRollCover, deletePhoto, updateRoll, updatePhoto, buildUploadUrl, getFilms, getMetadataOptions } from '../api';
import { getCacheStrategy } from '../lib';
import { useParams } from 'react-router-dom';
import ImageViewer from './common/LazyImageViewer';
import RollHeader from './RollDetail/RollHeader';
import RollToolbar from './RollDetail/RollToolbar';
import PhotoItem from './PhotoItem';
import TagEditModal from './TagEditModal';
import ModalDialog from './ModalDialog';
import LocationSelect from './LocationSelect.jsx';
import PhotoDetailsSidebar from './PhotoDetailsSidebar.jsx';
import EquipmentSelector from './EquipmentSelector';
import UploadModal from './UploadModal';
import { lazyModal } from './common/lazyModal';
import '../styles/sidebar.css';
import '../styles/forms.css';
import '../styles/roll-detail-card.css';

// 低频重型模态框：首次打开时才加载对应 chunk
const ContactSheetModal = lazyModal(() => import('./ContactSheetModal.jsx'));
const BatchRenderModal = lazyModal(() => import('./BatchExport').then(m => ({ default: m.BatchRenderModal })));
const BatchDownloadModal = lazyModal(() => import('./BatchExport').then(m => ({ default: m.BatchDownloadModal })));
const ImportPositiveModal = lazyModal(() => import('./ImportPositive').then(m => ({ default: m.ImportPositiveModal })));
const RawImportWizard = lazyModal(() => import('./RawImport').then(m => ({ default: m.RawImportWizard })));

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
  const [showContactSheet, setShowContactSheet] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null); // for fixed lens detection
  // 批量渲染/下载模态框状态
  const [showBatchRenderModal, setShowBatchRenderModal] = useState(false);
  const [showBatchDownloadModal, setShowBatchDownloadModal] = useState(false);
  const [showImportPositiveModal, setShowImportPositiveModal] = useState(false);
  const [showRawImportWizard, setShowRawImportWizard] = useState(false);
  // Replaced inline upload state
  const [showUploadModal, setShowUploadModal] = useState(false);
  // Batch Render Callback State
  const [batchRenderCallback, setBatchRenderCallback] = useState(null);

  const showAlert = useCallback((title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  }, []);

  const showConfirm = useCallback((title, message, onConfirm) => {
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
  }, []);

  const { data: roll } = useQuery({
    queryKey: ['roll', id],
    queryFn: () => getRoll(id),
    ...getCacheStrategy('rolls'),
  });

  const { data: photos = [] } = useQuery({
    queryKey: ['rollPhotos', id],
    queryFn: () => getPhotos(id),
    ...getCacheStrategy('photos'),
  });

  const { data: allTags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
    ...getCacheStrategy('tags'),
  });

  // Locations now embedded in roll response (row.locations)

  /* uploadMutation removed as it is now handled by UploadModal */

  const deletePhotoMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
      queryClient.invalidateQueries({ queryKey: ['roll', id] });
    }
  });

  const setCoverMutation = useMutation({
    mutationFn: ({ rollId, photoId }) => setRollCover(rollId, { photoId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roll', id] })
  });

  const updateRollMutation = useMutation({
    mutationFn: ({ rollId, data }) => updateRoll(rollId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roll', id] })
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] })
  });

  function resolveFilmName(rollObj) {
    if (!rollObj) return null;
    if (rollObj.film_name_joined) return rollObj.film_name_joined;
    if (rollObj.film && typeof rollObj.film === 'object' && rollObj.film.name) return rollObj.film.name;
    if (rollObj.film_type) return rollObj.film_type;
    return null;
  }

  const filmName = resolveFilmName(roll);

  function handleUploadComplete() {
    queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
    queryClient.invalidateQueries({ queryKey: ['roll', id] });
  }

  /* Old inline upload logic removed */


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

  // 派生数据 memo 化：避免每次渲染重算
  const positiveCount = useMemo(
    () => photos.filter(p => !!p.full_rel_path || !!p.positive_rel_path).length,
    [photos]
  );
  const negativeCount = useMemo(
    () => photos.filter(p => !!p.negative_rel_path).length,
    [photos]
  );
  const filteredPhotos = useMemo(
    () => photos.filter(p => {
      if (viewMode === 'positive') return !!p.full_rel_path || !!p.positive_rel_path;
      if (viewMode === 'negative') return !!p.negative_rel_path;
      return true;
    }),
    [photos, viewMode]
  );
  // O(1) 选中查找（原 selectedPhotos.some(...) 为 O(n×m)）
  const selectedPhotoIds = useMemo(
    () => new Set(selectedPhotos.map(sp => sp.id)),
    [selectedPhotos]
  );

  // 稳定回调：配合 PhotoItem 的 React.memo 生效
  const handleToggleSelect = useCallback((photo) => {
    setSelectedPhotos(prev =>
      prev.some(sp => sp.id === photo.id)
        ? prev.filter(sp => sp.id !== photo.id)
        : [...prev, photo]
    );
  }, []);

  const handleSelectPhoto = useCallback((idx) => {
    setSelectedPhotoIndex(idx);
  }, []);

  const handleEditTags = useCallback((photo) => {
    setEditingTagsPhoto(photo);
  }, []);

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

  // 批量渲染 - 打开模态框
  function handleBatchRender() {
    if (photos.length === 0) {
      showAlert('No Photos', 'No photos to render.');
      return;
    }
    setShowBatchRenderModal(true);
  }

  // 批量下载 - 打开模态框
  function handleBatchDownload() {
    if (photos.length === 0) {
      showAlert('No Photos', 'No photos to download.');
      return;
    }
    setShowBatchDownloadModal(true);
  }

  // 批量渲染/下载完成回调
  function handleBatchExportComplete(progress) {
    queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
    queryClient.invalidateQueries({ queryKey: ['roll', id] });
    if (progress.status === 'completed') {
      showAlert('完成', `成功处理 ${progress.completed} / ${progress.total} 张照片`);
    }
  }

  // Handle opening FilmLab for batch parameter adjustment
  const handleOpenFilmLabForBatch = (callback) => {
    // 1. Hide the batch modal
    setShowBatchRenderModal(false);
    // 2. Save the callback
    setBatchRenderCallback(() => callback);
    // 3. Open the first selected photo (or first photo) in ImageViewer
    if (multiSelect && selectedPhotos.length > 0) {
      const firstId = selectedPhotos[0].id;
      const index = photos.findIndex(p => p.id === firstId);
      if (index !== -1) setSelectedPhotoIndex(index);
      else setSelectedPhotoIndex(0);
    } else {
      setSelectedPhotoIndex(0); // Default to first photo
    }
  };

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
      camera_equip_id: roll.camera_equip_id || null,
      lens_equip_id: roll.lens_equip_id || null,
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
      develop_note: roll.develop_note || '',
      scanner_equip_id: roll.scanner_equip_id || null,
      scan_resolution: roll.scan_resolution || '',
      scan_software: roll.scan_software || '',
      scan_lab: roll.scan_lab || '',
      scan_date: roll.scan_date || '',
      scan_cost: roll.scan_cost || '',
      scan_notes: roll.scan_notes || ''
    });
    setSelectedCamera(null); // reset camera selection
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

  // eslint-disable-next-line no-unused-vars
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

  return (
    <div className="roll-detail-page flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
      
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        rollId={id}
        onUploadComplete={handleUploadComplete}
      />
      
      {/* 
          MODERNIZED ROLL HEADER & TOOLBAR 
          Replaces the old .roll-card structure
      */}
      <RollHeader 
         roll={roll} 
         onEdit={handleEditClick}
         coverUrl={(() => {
             const cover = roll.coverPath || roll.cover_photo;
             if (cover) return buildUploadUrl(cover);
             const first = photos.find(p => p.positive_rel_path || p.full_rel_path || p.negative_rel_path);
             if (first) {
                 const path = first.positive_rel_path || first.full_rel_path || first.negative_rel_path;
                 return buildUploadUrl(path);
             }
             return null;
         })()} 
      />
      
      <RollToolbar 
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        multiSelect={multiSelect}
        onMultiSelectChange={(val) => {
          setMultiSelect(val);
          if (!val) setSelectedPhotos([]);
        }}
        selectedCount={selectedPhotos.length}
        totalCount={photos ? photos.length : 0}
        onUpload={() => setShowUploadModal(true)}
        onBatchRender={handleBatchRender}
        onBatchDownload={handleBatchDownload}
        onImportPositive={() => setShowImportPositiveModal(true)}
        onContactSheet={() => setShowContactSheet(true)}
        onEditSelected={() => setShowBatchSidebar(true)}
        onSelectAll={() => setSelectedPhotos([...(photos || [])])}
        onDeselectAll={() => setSelectedPhotos([])}
        onInvertSelection={() => {
          if (!photos) return;
          const selectedIds = new Set(selectedPhotos.map(p => p.id));
          setSelectedPhotos(photos.filter(p => !selectedIds.has(p.id)));
        }}
      />

        {isEditing && (
          <div style={{ marginTop: 12, marginBottom: 20 }}>
            {/* Removed redundant Upload files button in edit mode, users can use the main button */}
          </div>
        )}

        {(() => {
          // Auto-switch view mode if only negatives exist and we are in positive mode
          // Use a ref or effect to avoid infinite render loop, or just show a helpful message

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
              <div
                className="bg-zinc-50 dark:bg-zinc-800/50 border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400"
                style={{
                  padding: '60px 0',
                  textAlign: 'center',
                  fontSize: '15px',
                  borderRadius: '12px',
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
                  index={idx}
                  filmName={filmName}
                  viewMode={viewMode}
                  onSelect={handleSelectPhoto}
                  onSetCover={onSetCover}
                  onDeletePhoto={onDeletePhoto}
                  onUpdatePhoto={onUpdatePhoto}
                  onEditTags={handleEditTags}
                  multiSelect={multiSelect}
                  selected={selectedPhotoIds.has(p.id)}
                  onToggleSelect={handleToggleSelect}
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
                console.log('[RollDetail] Calling onUpdatePhoto with:', { photoId, tags: newTags });
                await onUpdatePhoto(photoId, { tags: newTags });
                console.log('[RollDetail] Tags saved successfully');
                // Refresh tags query and notify sidebar
                queryClient.invalidateQueries({ queryKey: ['tags'] });
                // Also dispatch event to refresh sidebar
                window.dispatchEvent(new Event('refresh-tags'));
              } catch (err) {
                console.error('[RollDetail] Failed to save tags:', err);
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
            onClose={() => { 
               setSelectedPhotoIndex(null); 
               // If returning from batch param selection, reopen the modal
               if (batchRenderCallback) {
                 setShowBatchRenderModal(true);
                 setBatchRenderCallback(null);
               }
            }}
            onPhotoUpdate={() => {
               queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
               queryClient.invalidateQueries({ queryKey: ['roll', id] });
            }}
            roll={roll}
            batchRenderCallback={batchRenderCallback}
          />
        )}
        {showBatchSidebar && multiSelect && selectedPhotos.length > 0 && (
          <PhotoDetailsSidebar 
            key={`batch-${selectedPhotos.map(p=>p.id).join(',')}`}
            photos={selectedPhotos}
            roll={roll}
            onClose={() => setShowBatchSidebar(false)}
            onSaved={() => {
              setShowBatchSidebar(false);
              queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
              queryClient.invalidateQueries({ queryKey: ['roll', id] }); // Refresh roll metadata
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
                  <EquipmentSelector 
                    type="camera" 
                    mode="film"
                    value={editData.camera_equip_id} 
                    onChange={(id, item) => {
                      setSelectedCamera(item);
                      setEditData(d => ({
                        ...d, 
                        camera_equip_id: id,
                        // If camera has fixed lens, clear lens selection (server will handle text)
                        lens_equip_id: item?.has_fixed_lens ? null : d.lens_equip_id
                      }));
                    }}
                    placeholder="Select camera..."
                  />
                </div>
                <div className="fg-field">
                  <label className="fg-label">Lens</label>
                  {selectedCamera?.has_fixed_lens ? (
                    <div className="fg-input" style={{ background: '#f5f5f5', cursor: 'not-allowed', color: '#666' }}>
                      Fixed: {selectedCamera.fixed_lens_focal_length ? `${selectedCamera.fixed_lens_focal_length}mm` : 'Built-in'} 
                      {selectedCamera.fixed_lens_max_aperture ? ` f/${selectedCamera.fixed_lens_max_aperture}` : ''}
                    </div>
                  ) : (
                    <EquipmentSelector 
                      type="lens" 
                      mode="film"
                      value={editData.lens_equip_id} 
                      cameraId={editData.camera_equip_id}
                      onChange={(id) => setEditData(d => ({ ...d, lens_equip_id: id }))}
                      placeholder="Select lens..."
                    />
                  )}
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
            <section className="fg-sidepanel-section">
              <div className="fg-section-label">Scanning Info</div>
              <div className="fg-separator" />
              <div className="fg-sidepanel-groupGrid cols-2">
                <div className="fg-field">
                  <label className="fg-label">Scanner</label>
                  <EquipmentSelector 
                    type="scanner" 
                    value={editData.scanner_equip_id} 
                    onChange={(id) => setEditData(d=>({...d, scanner_equip_id: id}))}
                    placeholder="Select scanner..."
                  />
                </div>
                <input className="fg-input" placeholder="Scan Lab" value={editData.scan_lab} onChange={e=>setEditData(d=>({...d, scan_lab:e.target.value}))} />
                <input className="fg-input" type="date" placeholder="Scan Date" value={editData.scan_date} onChange={e=>setEditData(d=>({...d, scan_date:e.target.value}))} lang="en-US" />
                <input className="fg-input" type="number" placeholder="Resolution (DPI)" value={editData.scan_resolution} onChange={e=>setEditData(d=>({...d, scan_resolution:e.target.value}))} />
                <input className="fg-input" placeholder="Scan Software" value={editData.scan_software} onChange={e=>setEditData(d=>({...d, scan_software:e.target.value}))} />
                <input className="fg-input" type="number" placeholder="Scan Cost" value={editData.scan_cost} onChange={e=>setEditData(d=>({...d, scan_cost:e.target.value}))} />
              </div>
              <div className="fg-field" style={{ marginTop:12 }}>
                <label className="fg-label">Scan Notes</label>
                <textarea className="fg-textarea" style={{ minHeight:60 }} placeholder="Scan parameters, issues, etc..." value={editData.scan_notes} onChange={e=>setEditData(d=>({...d, scan_notes:e.target.value}))} />
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
      
      {/* Contact Sheet Modal */}
      <ContactSheetModal 
        isOpen={showContactSheet} 
        onClose={() => setShowContactSheet(false)}
        roll={roll}
        photos={photos}
      />

      {/* 批量渲染模态框 */}
      <BatchRenderModal
        isOpen={showBatchRenderModal}
        onClose={() => setShowBatchRenderModal(false)}
        rollId={Number(id)}
        selectedPhotos={multiSelect ? selectedPhotos : []}
        allPhotos={photos}
        onComplete={handleBatchExportComplete}
        onOpenFilmLab={handleOpenFilmLabForBatch}
      />

      {/* 批量下载模态框 */}
      <BatchDownloadModal
        isOpen={showBatchDownloadModal}
        onClose={() => setShowBatchDownloadModal(false)}
        rollId={Number(id)}
        rollName={roll?.title || ''}
        selectedPhotos={multiSelect ? selectedPhotos : []}
        allPhotos={photos}
        onComplete={handleBatchExportComplete}
      />

      {/* 导入外部正片模态框 */}
      <ImportPositiveModal
        isOpen={showImportPositiveModal}
        onClose={() => setShowImportPositiveModal(false)}
        rollId={Number(id)}
        rollName={roll?.title || ''}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['photos', id] });
          setShowImportPositiveModal(false);
        }}
      />

      {/* RAW 文件导入向导 (保留作为高级选项) */}
      <RawImportWizard
        isOpen={showRawImportWizard}
        onClose={() => setShowRawImportWizard(false)}
        rollId={Number(id)}
        onImportComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['rollPhotos', id] });
          queryClient.invalidateQueries({ queryKey: ['roll', id] });
        }}
      />
    </div>
  );
}
