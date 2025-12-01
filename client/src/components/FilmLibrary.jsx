// src/components/FilmLibrary.jsx
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getFilms, createFilm, buildUploadUrl, getRolls, deleteFilm, updateFilm } from '../api';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/opacity.css';
import SquareImage from './SquareImage';
import ModalDialog from './ModalDialog';

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

  const films = Array.isArray(filmsData) ? filmsData : [];
  const rolls = Array.isArray(rollsData) ? rollsData : [];

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
        <h3 style={{ margin:0 }}>Film Library</h3>
      </div>

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
    </div>
  );
}