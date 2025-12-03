// src/components/FilmLibrary.jsx
import '../styles/FilmInventory.css';
import '../styles/FilmButtons.css';
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import FilmItemEditModal from './FilmItemEditModal';
import { LoadFilmModal, DevelopFilmModal, UnloadFilmModal } from './FilmActionModals';
import { getFilms, createFilm, buildUploadUrl, getRolls, deleteFilm, updateFilm, getFilmItems, createFilmItemsBatch, updateFilmItem, deleteFilmItem } from '../api';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';
import SquareImage from './SquareImage';
import ModalDialog from './ModalDialog';
import ShotLogModal from './ShotLogModal';

export default function FilmLibrary() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedFilm, setSelectedFilm] = useState(null);
  const [name, setName] = useState('');
  const [iso, setIso] = useState(100);
  const [category, setCategory] = useState('color-negative');
  const [thumb, setThumb] = useState(null);
  const fileInputRef = useRef(null);
  const [dialog, setDialog] = useState({ isOpen: false, type: 'alert', title: '', message: '', onConfirm: null });
  const [editName, setEditName] = useState('');
  const [editIso, setEditIso] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editThumb, setEditThumb] = useState(null);
  const editFileInputRef = useRef(null);
  const [activeTab, setActiveTab] = useState('inventory');

  // Inventory state
  // 默认展示所有库存记录（All），而不是仅 In Stock
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState('all');
  const [batchForm, setBatchForm] = useState({
    order_date: new Date().toISOString().slice(0, 10),
    channel: '',
    vendor: '',
    shipping_cost: '',
    notes: '',
    items: [
      { film_id: '', quantity: 1, unit_price: '', expiry_date: '', label: '', batch_code: '' }
    ]
  });
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [expandedItemId, setExpandedItemId] = useState(null);
  
  // Store IDs instead of objects to ensure modals always show fresh data from query cache
  const [loadModalItemId, setLoadModalItemId] = useState(null);
  const [unloadModalItemId, setUnloadModalItemId] = useState(null);
  const [developModalItemId, setDevelopModalItemId] = useState(null);
  const [shotLogModalItemId, setShotLogModalItemId] = useState(null);

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

  const { data: filmsData, isLoading: loadingFilms } = useQuery({
    queryKey: ['films'],
    queryFn: getFilms
  });

  const { data: rollsData } = useQuery({
    queryKey: ['rolls'],
    queryFn: getRolls
  });

  const { data: filmItemsData, isLoading: loadingFilmItems } = useQuery({
    queryKey: ['filmItems'],
    queryFn: () => getFilmItems()
  });

  const films = Array.isArray(filmsData) ? filmsData : [];
  const rolls = Array.isArray(rollsData) ? rollsData : [];
  const allFilmItems = filmItemsData && Array.isArray(filmItemsData.items) ? filmItemsData.items : [];

  // Calculate counts
  const statusCounts = allFilmItems.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  const totalCount = allFilmItems.length;

  // Filter for display
  const filmItems = inventoryStatusFilter === 'all' 
    ? allFilmItems 
    : allFilmItems.filter(item => item.status === inventoryStatusFilter);

  // Helper to handle various path formats (absolute, relative, or just filename)
  const getFilmThumbUrl = (path) => {
    if (!path) return null;
    // If it's already a URL or has uploads path, use standard builder
    if (path.startsWith('http') || path.includes('/') || path.includes('\\')) {
      return buildUploadUrl(path);
    }
    // If it's just a filename, assume it's in uploads/films
    return buildUploadUrl(`/uploads/films/${path}`);
  };

  const createFilmMutation = useMutation({
    mutationFn: createFilm,
    onSuccess: () => {
      queryClient.invalidateQueries(['films']);
      setName(''); setIso(100); setThumb(null);
    }
  });

  const deleteFilmMutation = useMutation({
    mutationFn: deleteFilm,
    onSuccess: () => queryClient.invalidateQueries(['films'])
  });

  const updateFilmMutation = useMutation({
    mutationFn: updateFilm,
    onSuccess: () => {
      queryClient.invalidateQueries(['films']);
      // refresh selected film reference
      if (selectedFilm) {
        setSelectedFilm(prev => prev ? { ...prev, name: editName || prev.name, iso: editIso || prev.iso, category: editCategory || prev.category } : prev);
      }
      setEditThumb(null);
    }
  });

  const createFilmItemsBatchMutation = useMutation({
    mutationFn: createFilmItemsBatch,
    onSuccess: () => {
      queryClient.invalidateQueries(['filmItems']);
      setBatchForm(prev => ({
        order_date: new Date().toISOString().slice(0, 10),
        channel: '',
        vendor: '',
        shipping_cost: '',
        notes: '',
        items: [
          { film_id: '', quantity: 1, unit_price: '', expiry_date: '', label: '', batch_code: '' }
        ]
      }));
    }
  });

  async function onCreate(e) {
    e.preventDefault();
    try {
      await createFilmMutation.mutateAsync({ name, iso, category, thumbFile: thumb });
    } catch (err) {
      showAlert('Error', 'Create film failed');
    }
  }

  function onDeleteFilm(filmId) {
    showConfirm('Delete Film', 'Delete this film? This cannot be undone.', async () => {
      try {
        await deleteFilmMutation.mutateAsync(filmId);
      } catch (err) {
        console.error(err);
        showAlert('Error', 'Delete failed: ' + (err.message || err));
      }
    });
  }

  function beginEdit(film) {
    if (!film) return;
    setSelectedFilm(film);
    setEditName(film.name);
    setEditIso(film.iso);
    setEditCategory(film.category);
    setEditThumb(null);
  }

  async function onUpdateFilm(e) {
    e.preventDefault();
    if (!selectedFilm) return;
    try {
      await updateFilmMutation.mutateAsync({ id: selectedFilm.id, name: editName, iso: editIso, category: editCategory, thumbFile: editThumb });
    } catch (err) {
      showAlert('Error', 'Update failed');
    }
  }

  const STATUS_FILTERS = [
    { value: 'all', label: `All: ${totalCount}` },
    { value: 'in_stock', label: `In Stock: ${statusCounts['in_stock'] || 0}` },
    { value: 'loaded', label: `Loaded: ${statusCounts['loaded'] || 0}` },
    { value: 'shot', label: `Shot: ${statusCounts['shot'] || 0}` },
    { value: 'sent_to_lab', label: `Sent to Lab: ${statusCounts['sent_to_lab'] || 0}` },
    { value: 'developed', label: `Developed: ${statusCounts['developed'] || 0}` },
    { value: 'archived', label: `Archived: ${statusCounts['archived'] || 0}` }
  ];

  const STATUS_LABELS = {
    in_stock: 'In Stock',
    loaded: 'Loaded',
    shot: 'Shot',
    sent_to_lab: 'Sent to Lab',
    developed: 'Developed',
    archived: 'Archived'
  };

  const formatMoney = (value) => {
    if (value == null || value === '') return '';
    const num = Number(value);
    if (Number.isNaN(num)) return value;
    return num.toFixed(2);
  };

  function updateBatchItem(index, patch) {
    setBatchForm(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, ...patch } : item)
    }));
  }

  function addBatchRow() {
    setBatchForm(prev => ({
      ...prev,
      items: [...prev.items, { film_id: '', quantity: 1, unit_price: '', expiry_date: '', label: '', batch_code: '' }]
    }));
  }

  function removeBatchRow(index) {
    setBatchForm(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  }

  async function onSubmitBatch(e) {
    e.preventDefault();
    try {
      const totalQuantity = batchForm.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const shipping = Number(batchForm.shipping_cost || 0);
      const perItemShipping = totalQuantity > 0 ? shipping / totalQuantity : 0;

      const confirmMsg = `This batch has ${totalQuantity} rolls. Shipping will be split as ${formatMoney(perItemShipping)} per roll.\n\nDo you want to continue?`;
      showConfirm('Confirm shipping split', confirmMsg, async () => {
        await createFilmItemsBatchMutation.mutateAsync({
          purchase_date: batchForm.order_date || null,
          purchase_channel: batchForm.channel || null,
          purchase_vendor: batchForm.vendor || null,
          purchase_order_id: null,
          total_shipping: shipping,
          purchase_currency: 'CNY',
          note: batchForm.notes || null,
          items: batchForm.items.map(item => ({
            film_id: item.film_id ? Number(item.film_id) : null,
            quantity: Number(item.quantity || 0),
            unit_price: item.unit_price === '' ? null : Number(item.unit_price),
            expiry_date: item.expiry_date || null,
            batch_number: item.batch_code || null,
            label: item.label || null,
            note_purchase: null
          }))
        });
      });
    } catch (err) {
      console.error(err);
      showAlert('Error', 'Create film items failed');
    }
  }

  return (
    <div>
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm}
        onCancel={dialog.onCancel}
      />
      <div className="page-header">
        <h3 style={{ margin:0 }}>Film</h3>
      </div>

      <div className="fg-tab-bar" style={{ display:'flex', gap:8, marginTop:8, marginBottom:16 }}>
        <button
          type="button"
          className={activeTab === 'library' ? 'fg-tab fg-tab-active' : 'fg-tab'}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
        <button
          type="button"
          className={activeTab === 'inventory' ? 'fg-tab fg-tab-active' : 'fg-tab'}
          onClick={() => setActiveTab('inventory')}
        >
          Inventory
        </button>
      </div>

      {activeTab === 'library' && (
      <>

      <form onSubmit={onCreate} style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:12 }}>
        <div>
          <label>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} />
        </div>
        <div>
          <label>ISO</label>
          <input type="number" value={iso} onChange={e=>setIso(e.target.value)} />
        </div>
        <div>
          <label>Category</label>
          <select value={category} onChange={e=>setCategory(e.target.value)}>
            <option value="color-negative">Color negative</option>
            <option value="color-reversal">Color reversal</option>
            <option value="bw-negative">BW negative</option>
            <option value="bw-reversal">BW reversal</option>
          </select>
        </div>
        <div>
          <label>Thumb</label>
          <div style={{ display:'flex', alignItems:'center', gap:8, alignSelf: 'flex-start' }}>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>setThumb(e.target.files[0])} />
            <button type="button" className="btn btn-sm" onClick={() => { if (fileInputRef.current) fileInputRef.current.click(); }} style={{ alignSelf: 'flex-start' }}>Choose file</button>
            <div style={{ fontSize:13, color:'#666' }}>{thumb ? thumb.name : 'No file selected'}</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <button type="submit" className="btn btn-primary" style={{ alignSelf: 'center' }}>Add Film</button>
        </div>
      </form>

      <div style={{ marginTop: 12 }}>
        {loadingFilms ? <div>Loading films...</div> : (
          films.length ? (
            <div className="card-grid">
            {films.map(f => (
              <div 
                key={f.id} 
                className="card" 
                onClick={() => beginEdit(f)}
                style={{ border: selectedFilm?.id === f.id ? '2px solid #2f7d32' : '1px solid rgba(0,0,0,0.04)' }}
              >
                <button className="card-delete btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); onDeleteFilm(f.id); }}>Delete</button>
                <div className="card-cover">
                  {f.thumbPath ? (
                    <LazyLoadImage
                      src={getFilmThumbUrl(f.thumbPath)}
                      alt={f.name}
                      effect="opacity"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center center' }}
                    />
                  ) : (
                    <div style={{ color:'#999' }}>No thumb</div>
                  )}
                </div>
                <div className="card-body">
                  <div className="card-title">{f.name}</div>
                  <div className="card-meta">{f.iso} • {f.category}</div>
                </div>
              </div>
            ))}
            </div>
          ) : <div>No films yet</div>
        )}
      </div>

      {selectedFilm && (
        <div style={{ marginTop: 32, borderTop: '1px solid #eee', paddingTop: 16 }}>
          <h4 style={{ marginTop: 0, marginBottom: 16 }}>Rolls shot with {selectedFilm.name}</h4>
          <form onSubmit={onUpdateFilm} style={{ display:'flex', flexWrap:'wrap', gap:12, marginBottom:16, background:'#fafafa', padding:12, border:'1px solid #e5e5e5', borderRadius:8 }}>
            <div style={{ flex:'1 1 160px' }}>
              <label style={{ fontSize:12 }}>Name</label>
              <input value={editName} onChange={e=>setEditName(e.target.value)} />
            </div>
            <div style={{ width:100 }}>
              <label style={{ fontSize:12 }}>ISO</label>
              <input type="number" value={editIso} onChange={e=>setEditIso(e.target.value)} />
            </div>
            <div style={{ flex:'1 1 160px' }}>
              <label style={{ fontSize:12 }}>Category</label>
              <select value={editCategory} onChange={e=>setEditCategory(e.target.value)}>
                <option value="color-negative">Color negative</option>
                <option value="color-reversal">Color reversal</option>
                <option value="bw-negative">BW negative</option>
                <option value="bw-reversal">BW reversal</option>
              </select>
            </div>
            <div style={{ flex:'1 1 220px' }}>
              <label style={{ fontSize:12 }}>Replace Thumb</label>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <input ref={editFileInputRef} type="file" accept="image/*" style={{ display:'none' }} onChange={e=>setEditThumb(e.target.files[0])} />
                <button type="button" className="btn btn-sm" onClick={() => editFileInputRef.current && editFileInputRef.current.click()}>Choose</button>
                <div style={{ fontSize:12, color:'#666' }}>{editThumb ? editThumb.name : 'No new file'}</div>
              </div>
            </div>
            <div style={{ alignSelf:'flex-end', display:'flex', gap:8 }}>
              <button type="submit" className="btn btn-primary btn-sm" disabled={updateFilmMutation.isLoading}>{updateFilmMutation.isLoading ? 'Saving...' : 'Save Changes'}</button>
              <button type="button" className="btn btn-sm" onClick={() => { setSelectedFilm(null); }}>Close</button>
            </div>
          </form>
          {rolls.filter(r => r.filmId === selectedFilm.id).length > 0 ? (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 }}>
              {rolls.filter(r => r.filmId === selectedFilm.id).map(r => (
                <div key={r.id} className="roll-card" onClick={() => navigate(`/rolls/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <SquareImage
                    src={(r.coverPath || r.cover_photo) ? buildUploadUrl(r.coverPath || r.cover_photo) : null}
                    alt={r.title}
                    radius={4}
                    aspect={'1 / 1'}
                  />
                  <div style={{ padding: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title || 'Untitled'}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{r.start_date || 'No date'}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: '#666', fontSize: 14 }}>No rolls found for this film.</div>
          )}
        </div>
      )}

      </>
      )}

      {activeTab === 'inventory' && (
        <>
          <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {STATUS_FILTERS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`fg-tab ${inventoryStatusFilter === opt.value ? 'fg-tab-active' : ''}`}
                  onClick={() => setInventoryStatusFilter(opt.value)}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="fg-btn fg-btn-primary"
              onClick={() => setIsBatchModalOpen(true)}
              title="Record purchase batch"
              style={{ width: 32, height: 32, padding: 0, borderRadius: '50%', fontSize: 20, fontWeight: 'bold', flexShrink: 0 }}
            >
              +
            </button>
          </div>

          <div className="fg-film-items-grid">
            {loadingFilmItems && (
              <div style={{ fontSize: 13, color: '#777' }}>Loading inventory...</div>
            )}
            {!loadingFilmItems && filmItems.length === 0 && (
              <div style={{ fontSize: 13, color: '#777' }}>No inventory records for current filters.</div>
            )}
            {!loadingFilmItems && filmItems.length > 0 && (
              <div className="fg-film-items-grid-inner">
                {filmItems.map(item => {
                  const film = films.find(f => f.id === item.film_id);
                  const thumbUrl = film && film.thumbPath ? getFilmThumbUrl(film.thumbPath) : null;
                  // Status label: for loaded items, show loaded camera when available
                  const statusLabel =
                    item.status === 'loaded' && item.loaded_camera
                      ? `Loaded on ${item.loaded_camera}`
                      : (STATUS_LABELS[item.status] || item.status);
                  const isExpired = item.expiry_date && new Date(item.expiry_date) < new Date();
                  const isExpanded = expandedItemId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={isExpanded ? 'fg-film-item-card fg-film-item-card-expanded' : 'fg-film-item-card'}
                      onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                    >
                      <div className="fg-film-item-thumb-wrapper">
                        {thumbUrl ? (
                          <img 
                            src={thumbUrl} 
                            alt={film ? film.name : 'Film'} 
                            className="fg-film-item-thumb" 
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="fg-film-item-thumb fg-film-item-thumb-empty">No cover</div>
                        )}
                        {item.expiry_date && (
                          <div className={isExpired ? 'fg-film-item-expiry fg-film-item-expiry-expired' : 'fg-film-item-expiry'}>
                            Expiry {item.expiry_date}
                          </div>
                        )}
                        <div className="fg-film-item-meta-bottom">
                          <div className="fg-film-item-meta-type">{film ? film.name : 'Unspecified'}</div>
                          <div className="fg-film-item-meta-status">{statusLabel}</div>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="fg-film-item-details">
                          <div className="fg-film-item-details-row">
                            <span>Channel</span>
                            <span>{item.purchase_channel || '—'}</span>
                          </div>
                          <div className="fg-film-item-details-row">
                            <span>Vendor</span>
                            <span>{item.purchase_vendor || '—'}</span>
                          </div>
                          <div className="fg-film-item-details-row">
                            <span>Unit price</span>
                            <span>{formatMoney(item.purchase_price) || '—'}</span>
                          </div>
                          <div className="fg-film-item-details-row">
                            <span>Shipping share</span>
                            <span>{formatMoney(item.purchase_shipping_share) || '—'}</span>
                          </div>
                          <div className="fg-film-item-details-row">
                            <span>Batch</span>
                            <span>{item.batch_number || '—'}</span>
                          </div>
                          {(item.label || item.purchase_note) && (
                            <div className="fg-film-item-details-notes">
                              {item.label || item.purchase_note}
                            </div>
                          )}
                          
                          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            {/* Status-based Actions */}
                            {item.status === 'in_stock' && (
                              <button 
                                className="fg-btn fg-btn-primary fg-btn-sm"
                                onClick={(e) => { e.stopPropagation(); setLoadModalItemId(item.id); }}
                              >
                                Load
                              </button>
                            )}
                            {item.status === 'loaded' && (
                              <>
                                <button 
                                  className="fg-btn fg-btn-secondary fg-btn-sm"
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setShotLogModalItemId(item.id);
                                  }}
                                >
                                  Log Shots
                                </button>
                                <button 
                                  className="fg-btn fg-btn-warning fg-btn-sm"
                                  onClick={(e) => { 
                                    e.stopPropagation(); 
                                    setUnloadModalItemId(item.id);
                                  }}
                                >
                                  Unload
                                </button>
                              </>
                            )}
                            {item.status === 'shot' && (
                              <button 
                                className="fg-btn fg-btn-primary fg-btn-sm"
                                onClick={(e) => { e.stopPropagation(); setDevelopModalItemId(item.id); }}
                              >
                                Develop
                              </button>
                            )}
                            {item.status === 'sent_to_lab' && (
                              <button 
                                className="fg-btn fg-btn-success fg-btn-sm"
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  // Navigate to create roll, passing film item ID and develop info
                                  navigate('/rolls/new', { 
                                    state: { 
                                      filmItemId: item.id,
                                      developInfo: {
                                        develop_lab: item.develop_lab,
                                        develop_process: item.develop_process,
                                        develop_date: item.develop_date,
                                        develop_cost: item.develop_price,
                                        develop_note: item.develop_note
                                      }
                                    } 
                                  });
                                }}
                              >
                                Create Roll
                              </button>
                            )}
                            {item.status === 'developed' && (
                              <button 
                                className="fg-btn fg-btn-secondary fg-btn-sm"
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  showConfirm('Archive Film', 'Archive this film item? This will hide it from active lists.', async () => {
                                    try {
                                      await updateFilmItem(item.id, { 
                                        status: 'archived',
                                        archived_at: new Date().toISOString()
                                      });
                                      queryClient.invalidateQueries(['filmItems']);
                                    } catch (err) {
                                      console.error(err);
                                      alert('Failed to archive: ' + err.message);
                                    }
                                  });
                                }}
                              >
                                Archive
                              </button>
                            )}

                            {/* View Roll Section - Prominent for developed/archived items */}
                            {(item.status === 'developed' || item.status === 'archived') && item.roll_id && (
                              <button 
                                className="fg-btn fg-btn-view-roll"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/rolls/${item.roll_id}`);
                                }}
                                title="View the roll created from this film"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 16, height: 16, marginRight: 6 }}>
                                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                  <circle cx="12" cy="12" r="3"/>
                                </svg>
                                <span>View Roll Details</span>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14, marginLeft: 6 }}>
                                  <path d="M5 12h14M12 5l7 7-7 7"/>
                                </svg>
                              </button>
                            )}

                            {/* Negative Archive Toggle */}
                            {(item.status === 'developed' || item.status === 'archived') && (
                              <button 
                                className={`fg-btn fg-btn-sm ${item.negative_archived ? 'fg-btn-outline-success' : 'fg-btn-outline-secondary'}`}
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await updateFilmItem(item.id, { negative_archived: item.negative_archived ? 0 : 1 });
                                  queryClient.invalidateQueries(['filmItems']);
                                }}
                                title="Toggle physical negative archive status"
                              >
                                {item.negative_archived ? 'Negatives Archived' : 'Negatives Pending'}
                              </button>
                            )}

                            <button 
                              className="fg-btn fg-btn-secondary fg-btn-sm" 
                              onClick={(e) => { e.stopPropagation(); setEditingItem(item); }}
                            >
                              Edit
                            </button>

                            {!item.roll_id && (
                              <button 
                                className="fg-btn fg-btn-danger fg-btn-sm" 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  showConfirm('Delete Film Item', 'Permanently delete this film item? This cannot be undone.', async () => {
                                    try {
                                      const res = await deleteFilmItem(item.id, true);
                                      if (!res.ok) throw new Error(res.error || 'Delete failed');
                                      queryClient.invalidateQueries(['filmItems']);
                                    } catch (err) {
                                      console.error(err);
                                      showAlert('Error', 'Failed to delete: ' + err.message);
                                    }
                                  });
                                }}
                                title="Delete this film item (only available when not linked to a roll)"
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {loadModalItemId && (
            <LoadFilmModal 
              item={allFilmItems.find(i => i.id === loadModalItemId)}
              isOpen={!!loadModalItemId}
              onClose={() => setLoadModalItemId(null)}
              onLoaded={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  // optimistic local update - use correct cache key
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                // Server response - update cache directly without invalidation
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {unloadModalItemId && (
            <UnloadFilmModal 
              item={allFilmItems.find(i => i.id === unloadModalItemId)}
              isOpen={!!unloadModalItemId}
              onClose={() => setUnloadModalItemId(null)}
              onUnloaded={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {developModalItemId && (
            <DevelopFilmModal
              item={allFilmItems.find(i => i.id === developModalItemId)}
              isOpen={!!developModalItemId}
              onClose={() => setDevelopModalItemId(null)}
              onDeveloped={async (updated) => {
                if (updated && updated.optimistic && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                  return;
                }
                if (updated && updated.item) {
                  queryClient.setQueryData(['filmItems'], (old) => {
                    if (!old || !Array.isArray(old.items)) return old;
                    return {
                      ...old,
                      items: old.items.map(it => it.id === updated.item.id ? updated.item : it),
                    };
                  });
                }
              }}
            />
          )}

          {shotLogModalItemId && (
            <ShotLogModal
              item={allFilmItems.find(i => i.id === shotLogModalItemId)}
              isOpen={!!shotLogModalItemId}
              onClose={() => setShotLogModalItemId(null)}
              onUpdated={async () => { await queryClient.invalidateQueries(['filmItems']); }}
            />
          )}

          {editingItem && (
            <FilmItemEditModal
              item={editingItem}
              isOpen={!!editingItem}
              onClose={() => setEditingItem(null)}
              onUpdated={async () => {
                await queryClient.invalidateQueries(['filmItems']);
              }}
            />
          )}

          {isBatchModalOpen && (
            <div className="fg-modal-overlay">
              <div className="fg-modal-panel">
                <div className="fg-modal-header">
                  <h4>Record a new purchase batch</h4>
                  <button type="button" className="fg-modal-close" onClick={() => setIsBatchModalOpen(false)}>&times;</button>
                </div>
                <form onSubmit={async (e) => { await onSubmitBatch(e); setIsBatchModalOpen(false); }} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  
                  <div className="fg-form-grid-top">
                    <div className="fg-form-group">
                      <label>Purchase date</label>
                      <input
                        type="date"
                        value={batchForm.order_date}
                        onChange={e => setBatchForm(prev => ({ ...prev, order_date: e.target.value }))}
                      />
                    </div>
                    <div className="fg-form-group">
                      <label>Channel</label>
                      <input
                        value={batchForm.channel}
                        onChange={e => setBatchForm(prev => ({ ...prev, channel: e.target.value }))}
                        placeholder="e.g. eBay, Local Store"
                      />
                    </div>
                    <div className="fg-form-group">
                      <label>Vendor</label>
                      <input
                        value={batchForm.vendor}
                        onChange={e => setBatchForm(prev => ({ ...prev, vendor: e.target.value }))}
                        placeholder="Store name"
                      />
                    </div>
                    <div className="fg-form-group">
                      <label>Total shipping</label>
                      <input
                        type="number"
                        step="0.01"
                        value={batchForm.shipping_cost}
                        onChange={e => setBatchForm(prev => ({ ...prev, shipping_cost: e.target.value }))}
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="fg-form-group">
                    <label>Notes</label>
                    <input
                      value={batchForm.notes}
                      onChange={e => setBatchForm(prev => ({ ...prev, notes: e.target.value }))}
                      placeholder="Optional notes about this purchase..."
                    />
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: '#334155' }}>Films included in this batch</div>
                    <div className="fg-batch-grid-container">
                      <div className="fg-batch-grid fg-batch-header">
                        <div>Film</div>
                        <div>Qty</div>
                        <div>Unit price</div>
                        <div>Expiry</div>
                        <div>Batch Code</div>
                        <div>Label / notes</div>
                        <div></div>
                      </div>
                      <div className="fg-batch-rows">
                        {batchForm.items.map((item, index) => (
                          <div key={index} className="fg-batch-grid fg-batch-row">
                            <div>
                              <select
                                className="fg-input-select"
                                value={item.film_id}
                                onChange={e => updateBatchItem(index, { film_id: e.target.value })}
                              >
                                <option value="">Select film...</option>
                                {films.map(f => (
                                  <option key={f.id} value={f.id}>{f.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <input
                                type="number"
                                min="1"
                                className="fg-input-cell"
                                value={item.quantity}
                                onChange={e => updateBatchItem(index, { quantity: e.target.value })}
                              />
                            </div>
                            <div>
                              <input
                                type="number"
                                step="0.01"
                                className="fg-input-cell"
                                value={item.unit_price}
                                onChange={e => updateBatchItem(index, { unit_price: e.target.value })}
                              />
                            </div>
                            <div>
                              <input
                                type="date"
                                className="fg-input-cell"
                                value={item.expiry_date}
                                onChange={e => updateBatchItem(index, { expiry_date: e.target.value })}
                              />
                            </div>
                            <div>
                              <input
                                className="fg-input-cell"
                                value={item.batch_code}
                                onChange={e => updateBatchItem(index, { batch_code: e.target.value })}
                                placeholder="Emulsion #"
                              />
                            </div>
                            <div>
                              <input
                                className="fg-input-cell"
                                value={item.label}
                                onChange={e => updateBatchItem(index, { label: e.target.value })}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                              <button
                                type="button"
                                className="fg-btn-icon-danger"
                                onClick={() => removeBatchRow(index)}
                                disabled={batchForm.items.length === 1}
                                title="Remove row"
                              >
                                &times;
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                    <button
                      type="button"
                      className="fg-btn fg-btn-secondary"
                      onClick={addBatchRow}
                    >
                      + Add another film
                    </button>
                    <button
                      type="submit"
                      className="fg-btn fg-btn-primary"
                      disabled={createFilmItemsBatchMutation.isLoading}
                    >
                      {createFilmItemsBatchMutation.isLoading ? 'Saving...' : 'Save Purchase Batch'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}