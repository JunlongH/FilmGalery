// src/components/NewRollForm.jsx
import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getFilms, getMetadataOptions, createRollUnified, updateRoll, getFilmItems } from '../api';
import { getCacheStrategy } from '../lib';
import LocationSelect from './LocationSelect.jsx';
import '../styles/forms.css';
import FilmSelector from './FilmSelector';
import ModalDialog from './ModalDialog';
import EquipmentSelector from './EquipmentSelector';
import { useFilePreviews } from '../hooks/useFilePreviews';
import ShotLogMapper from './ShotLogMapper';

export default function NewRollForm({ onCreated }) {
  const location = useLocation();
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [cameraEquipId, setCameraEquipId] = useState(null);
  const [lensEquipId, setLensEquipId] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState(null);
  const [photographer, setPhotographer] = useState('');
  const [filmId, setFilmId] = useState(null);
  const [exposures, setExposures] = useState(''); //数量
  const [notes, setNotes] = useState('');
  const [uploadType, setUploadType] = useState('positive'); // 'positive' | 'negative'
  const [isOriginalUpload, setIsOriginalUpload] = useState(true); // Default to save as original
  const isNegative = uploadType === 'negative'; // 兼容旧逻辑
  const [files, setFiles] = useState([]); // File[]
  // const [previews, setPreviews] = useState([]); // Replaced by useFilePreviews
  const previews = useFilePreviews(files);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [useTwoStep, setUseTwoStep] = useState(false); // default simplified pipeline
  const [dialog, setDialog] = useState({ isOpen: false, title: '', message: '' });
  const [rollLocations, setRollLocations] = useState([]);
  const PROCESS_PRESETS = ['C-41', 'E-6', 'BW', 'ECN-2'];
  const [develop, setDevelop] = useState({ develop_lab: '', develop_process: '', develop_date: '', develop_cost: '', develop_note: '' });
  const [filmItemId, setFilmItemId] = useState(null);
  const [useInventory, setUseInventory] = useState(false);
  const [shotLogs, setShotLogs] = useState([]);
  const [fileDates, setFileDates] = useState({}); // { filename: 'YYYY-MM-DD' }
  const [fileMeta, setFileMeta] = useState({});   // { filename: { date, lens } }
  const [applyShotLog, setApplyShotLog] = useState(false);
  const [showMapper, setShowMapper] = useState(false);
  
  // Scanning/Digitization Info
  const [scannerEquipId, setScannerEquipId] = useState(null);
  const [scanLab, setScanLab] = useState('');
  const [scanDate, setScanDate] = useState('');
  const [scanResolution, setScanResolution] = useState('');
  const [scanSoftware, setScanSoftware] = useState('');
  const [scanCost, setScanCost] = useState('');
  const [scanNotes, setScanNotes] = useState('');

  const totalShotLogCount = shotLogs.reduce((acc, cur) => acc + (Number(cur.count || cur.shots || 0) || 0), 0);

  const showAlert = (title, message) => {
    setDialog({ isOpen: true, type: 'alert', title, message, onConfirm: () => setDialog(prev => ({ ...prev, isOpen: false })) });
  };

  // 静态数据统一走 React Query（胶片/元数据选项为 STATIC，库存条目变化较少）
  const { data: filmsData } = useQuery({
    queryKey: ['films'],
    queryFn: getFilms,
    ...getCacheStrategy('films'),
  });
  const films = useMemo(() => filmsData || [], [filmsData]);

  const { data: optionsData } = useQuery({
    queryKey: ['metadataOptions'],
    queryFn: getMetadataOptions,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
  const options = useMemo(
    () => optionsData || { cameras: [], lenses: [], photographers: [] },
    [optionsData]
  );

  const { data: filmItemsData } = useQuery({
    // Fetch all relevant statuses (excluding developed as per request)
    queryKey: ['filmItems', 'available'],
    queryFn: () => getFilmItems({ status: 'in_stock,loaded,shot,sent_to_lab' }),
    ...getCacheStrategy('filmItems'),
  });
  const filmItems = useMemo(() => {
    const arr = filmItemsData && Array.isArray(filmItemsData.items) ? filmItemsData.items : [];
    return arr;
  }, [filmItemsData]);

  // Handle pre-selection from navigation state (Archive flow)
  useEffect(() => {
    if (location.state && location.state.filmItemId) {
      setUseInventory(true);
      setFilmItemId(location.state.filmItemId);
      
      // Auto-fill develop info if provided
      if (location.state.developInfo) {
        const info = location.state.developInfo;
        setDevelop(prev => ({
          ...prev,
          develop_lab: info.develop_lab || '',
          develop_process: info.develop_process || '',
          develop_date: info.develop_date || '',
          develop_cost: info.develop_cost || '',
          develop_note: info.develop_note || ''
        }));
      }
    }
  }, [location.state]);

  // Auto-fill dates and camera from inventory item
  useEffect(() => {
    if (useInventory && filmItemId && filmItems.length > 0) {
      const item = filmItems.find(i => i.id === filmItemId);
      if (item) {
        if (item.loaded_date) setStartDate(item.loaded_date);
        if (item.finished_date) setEndDate(item.finished_date);
        // Note: loaded_camera is legacy text, not used in submission (equipment IDs are used instead)
        
        // Parse shot logs
        if (item.shot_logs) {
          try {
            const logs = JSON.parse(item.shot_logs);
            if (Array.isArray(logs)) {
              setShotLogs(logs.sort((a, b) => a.date.localeCompare(b.date)));
            }
          } catch (e) { console.error(e); }
        } else {
          setShotLogs([]);
        }
      }
    }
  }, [useInventory, filmItemId, filmItems]);

  useEffect(() => {
    if (shotLogs.length > 0) {
      setApplyShotLog(true);
    }
  }, [shotLogs.length]);

  // Re-apply mapping when shot logs or files change while toggle is on
  useEffect(() => {
    // Only auto-apply if meta is empty (init) to respect manual mapping
    if (applyShotLog && Object.keys(fileMeta).length === 0 && files.length > 0 && shotLogs.length > 0) {
      handleApplyShotLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyShotLog, shotLogs, files]);

  const handleApplyShotLog = () => {
    if (!files.length || !shotLogs.length) return;
    const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));
    const metaMap = {};
    const dateMap = {};
    let fileIndex = 0;
    
    for (const log of shotLogs) {
      const count = Number(log.count || log.shots || 0) || 0;
      const date = log.date || '';
      const lensFromLog = log.lens || '';
      const focal_length = Number.isFinite(log.focal_length) ? log.focal_length : (log.focal_length !== undefined && log.focal_length !== null ? Number(log.focal_length) : null);
      const aperture = Number.isFinite(log.aperture) ? log.aperture : (log.aperture !== undefined && log.aperture !== null ? Number(log.aperture) : null);
      const shutter_speed = log.shutter_speed || '';
      const country = log.country || '';
      const city = log.city || '';
      const detail_location = log.detail_location || '';
      const latitude = log.latitude;
      const longitude = log.longitude;
      const caption = log.caption || '';
      const shot_time = log.shot_time || '';
      for (let i = 0; i < count; i++) {
        if (fileIndex >= sortedFiles.length) break;
        const name = sortedFiles[fileIndex].name;
        metaMap[name] = { date, shot_time, lens: lensFromLog, focal_length, country, city, detail_location, aperture, shutter_speed, latitude, longitude, caption, logIndex: shotLogs.indexOf(log) };
        if (date) dateMap[name] = date;
        fileIndex++;
      }
    }
    setFileMeta(metaMap);
    setFileDates(dateMap);
  };

  const handleMapperSave = (mapping) => {
    // mapping is now: { filename: { date, lens, aperture, shutter_speed, country, city, detail_location, logIndex } }
    setFileMeta(mapping);
    
    // Also update fileDates for overlay display
    const newDates = {};
    Object.entries(mapping).forEach(([name, meta]) => {
      if (meta && meta.date) newDates[name] = meta.date;
    });
    setFileDates(newDates);
    setApplyShotLog(true);
    setShowMapper(false);
  };

  /* Preview generation is now handled by useFilePreviews hook */

  function onFileChange(e) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
        showAlert('Invalid Date', 'Start date cannot be later than end date');
        return;
      }
      const fieldsBase = { 
        title, 
        start_date: startDate || null, 
        end_date: endDate || null, 
        camera_equip_id: cameraEquipId || null,
        lens_equip_id: lensEquipId || null,
        photographer, 
        exposures, 
        notes,
        // Default locations for fallback (from first location in list if available)
        default_location_id: rollLocations[0] ? rollLocations[0].location_id : null,
        default_country: rollLocations[0] ? (rollLocations[0].country_name || null) : null,
        default_city: rollLocations[0] ? (rollLocations[0].city_name || null) : null,
        // Scanning/Digitization fields
        scanner_equip_id: scannerEquipId || null,
        scan_resolution: scanResolution ? Number(scanResolution) : null,
        scan_software: scanSoftware || null,
        scan_lab: scanLab || null,
        scan_date: scanDate || null,
        scan_cost: scanCost ? Number(scanCost) : null,
        scan_notes: scanNotes || null
      };
      const fields = useInventory && filmItemId
        ? { ...fieldsBase, film_item_id: filmItemId }
        : { ...fieldsBase, filmId };

      // Add file metadata (date + lens + focal_length + location)
      const metaToSend = {};
      const keys = new Set([...Object.keys(fileDates), ...Object.keys(fileMeta)]);
      keys.forEach((k) => {
        const entry = fileMeta[k] || {};
        const date = entry.date || fileDates[k] || '';
        const lensFromMeta = entry.lens || '';
        const focal_length = entry.focal_length;
        const country = entry.country || '';
        const city = entry.city || '';
        const detail_location = entry.detail_location || '';
        const aperture = entry.aperture;
        const shutter_speed = entry.shutter_speed;
        const latitude = entry.latitude;
        const longitude = entry.longitude;
        const caption = entry.caption || '';
        if (date || lensFromMeta || Number.isFinite(focal_length) || country || city || detail_location || Number.isFinite(aperture) || !!shutter_speed || Number.isFinite(latitude) || Number.isFinite(longitude) || caption) {
          metaToSend[k] = {
            ...(date ? { date } : {}),
            ...(lensFromMeta ? { lens: lensFromMeta } : {}),
            ...(Number.isFinite(focal_length) ? { focal_length } : {}),
            ...(Number.isFinite(aperture) ? { aperture } : {}),
            ...(shutter_speed ? { shutter_speed } : {}),
            ...(country ? { country } : {}),
            ...(city ? { city } : {}),
            ...(detail_location ? { detail_location } : {}),
            ...(Number.isFinite(latitude) ? { latitude } : {}),
            ...(Number.isFinite(longitude) ? { longitude } : {}),
            ...(caption ? { caption } : {})
          };
        }
      });
      if (Object.keys(metaToSend).length > 0) {
        fields.fileMetadata = JSON.stringify(metaToSend);
      }

      const res = await createRollUnified({
        fields,
        files,
        useTwoStep,
        isNegative,
        uploadType,
        isOriginal: isOriginalUpload,
        onProgress: p => setUploadProgress(p)
      });
      setUploadProgress(null);
      if (res && res.ok) {
        setFiles([]); 
        try {
          await updateRoll(res.roll.id, { locations: rollLocations.map(l => l.location_id), ...develop });
          
          // Film item status is already updated by the server based on its current state:
          // - If was 'sent_to_lab' -> becomes 'developed' (scans uploaded)
          // - If was 'loaded' or 'shot' -> becomes 'shot' (just finished shooting)
          // No need to manually update here as linkFilmItemToRoll handles it
          
          showAlert('Success', 'Roll created and fields saved');
        } catch (err) {
          showAlert('Warning', 'Roll created but additional fields failed to save: ' + (err.message || err));
        }
        onCreated && onCreated(res.roll);
      } else {
        // Enhanced error display with details
        const errorMsg = res && res.error ? res.error : 'Unknown error';
        const errorDetails = res && res.details ? JSON.stringify(res.details, null, 2) : '';
        console.error('Roll creation failed:', { error: errorMsg, details: errorDetails, response: res });
        showAlert('Error', 'Create roll failed: ' + errorMsg + (errorDetails ? '\n\nDetails: ' + errorDetails : ''));
      }
    } catch (err) {
      setUploadProgress(null);
      console.error('Upload error:', err);
      console.error('Error stack:', err.stack);
      
      // Provide more user-friendly error messages
      let errorMessage = err.message || String(err);
      
      // Check for common OneDrive/TIF upload issues
      if (errorMessage.includes('timeout') || errorMessage.includes('timed out')) {
        errorMessage = '上传超时。请检查：\n1. TIF文件是否过大（建议<100MB）\n2. OneDrive是否正在同步（可暂停同步后重试）\n3. 网络连接是否稳定';
      } else if (errorMessage.includes('EBUSY') || errorMessage.includes('EPERM') || errorMessage.includes('locked')) {
        errorMessage = '文件被占用，无法上传。可能原因：\n1. OneDrive正在同步该文件夹\n2. 其他程序正在访问文件\n\n建议：暂停OneDrive同步，稍后重试';
      } else if (errorMessage.includes('Failed to process') || errorMessage.includes('Sharp')) {
        errorMessage = '图片处理失败。可能原因：\n1. TIF文件损坏或格式不支持\n2. 文件过大导致内存不足\n\n建议：尝试较小的文件或转换为JPEG格式';
      } else if (errorMessage.includes('OneDrive')) {
        errorMessage = 'OneDrive同步冲突。建议：\n1. 暂停OneDrive同步\n2. 稍等片刻后重试\n3. 或将文件移动到非OneDrive目录';
      }
      
      showAlert('上传错误', errorMessage);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="fg-card" style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      <ModalDialog 
        isOpen={dialog.isOpen} 
        type={dialog.type} 
        title={dialog.title} 
        message={dialog.message} 
        onConfirm={dialog.onConfirm} 
      />
      
      {/* Basic Info Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Basic Info</h3>
        <div className="fg-field">
          <label className="fg-label">Title</label>
          <input className="fg-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="Roll title" />
        </div>
        <div className="fg-field">
          <label className="fg-label">Film Source</label>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={!useInventory} onChange={() => { setUseInventory(false); setFilmItemId(null); }} />
              <span>Manual film selection</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" checked={useInventory} onChange={() => setUseInventory(true)} />
              <span>From inventory (FilmItem)</span>
            </label>
          </div>
        </div>
        {!useInventory && (
          <div className="fg-field">
            <label className="fg-label">Film</label>
            <FilmSelector films={films} value={filmId} onChange={setFilmId} />
          </div>
        )}
        {useInventory && (
          <div className="fg-field">
            <label className="fg-label">Inventory Item</label>
            <select
              className="fg-select"
              value={filmItemId || ''}
              onChange={e => setFilmItemId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select from in-stock / loaded</option>
              {filmItems.map(it => {
                const f = films.find(x => x.id === it.film_id);
                const filmName = f ? f.name : `Film #${it.film_id}`;
                const label = [filmName, it.batch_number, it.expiry_date].filter(Boolean).join(' • ');
                return (
                  <option key={it.id} value={it.id}>{label || `Item #${it.id}`}</option>
                );
              })}
            </select>
            <div style={{ fontSize: 12, color: 'var(--fg-muted)', marginTop: 4 }}>
              Listing items with status: in_stock, loaded, shot, sent_to_lab, developed.
            </div>
            
            {filmItemId && (() => {
              const it = filmItems.find(x => x.id === filmItemId);
              if (!it) return null;
              const f = films.find(x => x.id === it.film_id);
              return (
                <div className="fg-card bg-slate-50 dark:bg-zinc-800/50 border border-slate-200 dark:border-zinc-700" style={{ marginTop: 12, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>{f ? f.name : 'Unknown Film'}</div>
                  <div className="text-slate-600 dark:text-zinc-400" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                    <div>Status: <span className="fg-pill">{it.status}</span></div>
                    <div>Expiry: {it.expiry_date || '—'}</div>
                    <div>Batch: {it.batch_number || '—'}</div>
                    <div>Price: {it.purchase_price ? `¥${it.purchase_price}` : '—'}</div>
                    <div>Channel: {it.purchase_channel || '—'}</div>
                    <div>Vendor: {it.purchase_vendor || '—'}</div>
                  </div>
                  {(it.label || it.purchase_note) && (
                    <div style={{ marginTop: 8, fontSize: 13, fontStyle: 'italic', color: '#64748b' }}>
                      "{it.label || it.purchase_note}"
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Start Date</label>
            <input className="fg-input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="fg-field">
            <label className="fg-label">End Date</label>
            <input className="fg-input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
      </section>

      {/* Gear & Photographer Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Gear & Photographer</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Camera</label>
            <EquipmentSelector 
              type="camera" 
              mode="film"
              value={cameraEquipId} 
              onChange={(id, item) => {
                setCameraEquipId(id);
                setSelectedCamera(item);
                // If camera has fixed lens, clear lens selection (server will handle text)
                if (item?.has_fixed_lens) {
                  setLensEquipId(null);
                }
              }}
              placeholder="Select camera..."
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Lens</label>
            {selectedCamera?.has_fixed_lens ? (
              <div className="fg-input" style={{ background: '#f5f5f5', cursor: 'not-allowed', color: '#666' }}>
                Fixed lens: {selectedCamera.fixed_lens_focal_length ? `${selectedCamera.fixed_lens_focal_length}mm` : 'Built-in'} 
                {selectedCamera.fixed_lens_max_aperture ? ` f/${selectedCamera.fixed_lens_max_aperture}` : ''}
              </div>
            ) : (
              <EquipmentSelector 
                type="lens" 
                mode="film"
                value={lensEquipId} 
                cameraId={cameraEquipId}
                onChange={(id) => setLensEquipId(id)}
                placeholder="Select lens..."
              />
            )}
          </div>
          <div className="fg-field">
            <label className="fg-label">Photographer</label>
            <input className="fg-input" list="photographer-options" value={photographer} onChange={e => setPhotographer(e.target.value)} placeholder="Select or type..." />
            <datalist id="photographer-options">
              {(options.photographers || []).map((s, i) => <option key={i} value={s} />)}
            </datalist>
          </div>
          <div className="fg-field">
            <label className="fg-label">Exposures</label>
            <input className="fg-input" type="number" value={exposures} onChange={e=>setExposures(e.target.value)} placeholder="e.g. 36" />
          </div>
        </div>
      </section>

      {/* Shooting Cities Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Shooting Cities</h3>
        <LocationSelect value={null} onChange={(loc)=>{
          if (!loc || !loc.location_id) return;
          setRollLocations(prev => (prev.some(p => p.location_id === loc.location_id) ? prev : [...prev, loc]));
        }} />
        {rollLocations.length > 0 && <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
          {rollLocations.map(l => (
            <span key={l.location_id} className="fg-pill">{l.city_name}</span>
          ))}
        </div>}
      </section>

      {/* Development Info Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Development Info</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Lab</label>
            <input className="fg-input" placeholder="Lab name" value={develop.develop_lab} onChange={e=>setDevelop(d=>({ ...d, develop_lab: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Develop Date</label>
            <input className="fg-input" type="date" value={develop.develop_date} onChange={e=>setDevelop(d=>({ ...d, develop_date: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Process</label>
            <select className="fg-select" value={develop.develop_process || ''} onChange={e=>setDevelop(d=>({ ...d, develop_process: e.target.value }))}>
              <option value="">Select process</option>
              {PROCESS_PRESETS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="fg-field">
            <label className="fg-label">Custom Process</label>
            <input className="fg-input" placeholder="Or type custom" value={develop.develop_process || ''} onChange={e=>setDevelop(d=>({ ...d, develop_process: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Develop Cost</label>
            <input className="fg-input" type="number" step="0.01" placeholder="0.00" value={develop.develop_cost} onChange={e=>setDevelop(d=>({ ...d, develop_cost: e.target.value }))} />
          </div>
          <div className="fg-field">
            <label className="fg-label">Note</label>
            <input className="fg-input" placeholder="Short note" value={develop.develop_note} onChange={e=>setDevelop(d=>({ ...d, develop_note: e.target.value }))} />
          </div>
        </div>
      </section>

      {/* Scanning/Digitization Info Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Scanning Info</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg-field">
            <label className="fg-label">Scanner</label>
            <EquipmentSelector 
              type="scanner" 
              value={scannerEquipId} 
              onChange={(id) => setScannerEquipId(id)}
              placeholder="Select scanner..."
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Lab</label>
            <input 
              className="fg-input" 
              placeholder="e.g. Film Lab, Home scan" 
              value={scanLab} 
              onChange={e => setScanLab(e.target.value)} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Date</label>
            <input 
              className="fg-input" 
              type="date" 
              value={scanDate} 
              onChange={e => setScanDate(e.target.value)}
              lang="en-US"
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Resolution (DPI)</label>
            <input 
              className="fg-input" 
              type="number" 
              step="1" 
              placeholder="e.g. 3200, 4800" 
              value={scanResolution} 
              onChange={e => setScanResolution(e.target.value)} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Software</label>
            <input 
              className="fg-input" 
              placeholder="e.g. VueScan, Epson Scan 2" 
              value={scanSoftware} 
              onChange={e => setScanSoftware(e.target.value)} 
            />
          </div>
          <div className="fg-field">
            <label className="fg-label">Scan Cost</label>
            <input 
              className="fg-input" 
              type="number" 
              step="0.01" 
              placeholder="0.00" 
              value={scanCost} 
              onChange={e => setScanCost(e.target.value)} 
            />
          </div>
        </div>
        <div className="fg-field">
          <label className="fg-label">Scan Notes</label>
          <textarea 
            className="fg-textarea" 
            value={scanNotes} 
            onChange={e => setScanNotes(e.target.value)} 
            placeholder="Scan parameters, issues, etc..."
            style={{ minHeight: 70, resize: 'vertical' }} 
          />
        </div>
      </section>

      {/* Notes Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Notes</h3>
        <div className="fg-field">
          <textarea className="fg-textarea" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Additional notes about this roll..." style={{ minHeight: 90, resize: 'vertical' }} />
        </div>
      </section>

      {/* File Upload Section */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--fg-text)', paddingBottom: 10, borderBottom: '2px solid var(--fg-border)' }}>Photos</h3>
        
        {/* Upload Configuration */}
        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16, alignItems: 'start', fontSize: 13, background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
          
          {/* Label */}
          <span style={{ fontWeight: 600, color: '#334155', paddingTop: 2 }}>Upload Type:</span>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Type Radios */}
            <div style={{ display: 'flex', gap: 24 }}>
              <label style={{ display:'flex', alignItems:'center', gap:6, cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="uploadType"
                  value="positive"
                  checked={uploadType === 'positive'} 
                  onChange={e => setUploadType(e.target.value)} 
                  style={{ accentColor: '#0ea5e9', width: 16, height: 16 }}
                />
                <span style={{ color: '#0f172a' }}>正片 (Positive)</span>
              </label>
              <label style={{ display:'flex', alignItems:'center', gap:6, cursor: 'pointer' }}>
                <input 
                  type="radio" 
                  name="uploadType"
                  value="negative"
                  checked={uploadType === 'negative'} 
                  onChange={e => setUploadType(e.target.value)} 
                  style={{ accentColor: '#0ea5e9', width: 16, height: 16 }}
                />
                <span style={{ color: '#0f172a' }}>负片 (Negative)</span>
              </label>
            </div>

            {/* Checkboxes Row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, paddingLeft: 2 }}>
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor: 'pointer', userSelect:'none' }}>
                <input 
                  type="checkbox"
                  checked={isOriginalUpload}
                  onChange={e => setIsOriginalUpload(e.target.checked)}
                  style={{ width: 15, height: 15, accentColor: '#0ea5e9' }}
                />
                <span style={{ color: '#334155' }}>上传原始底片 (Upload Original)</span>
              </label>
              
              <label style={{ display:'flex', alignItems:'center', gap:8, cursor: 'pointer', userSelect:'none' }}>
                <input 
                  type="checkbox" 
                  checked={useTwoStep} 
                  onChange={e=>setUseTwoStep(e.target.checked)} 
                  style={{ width: 15, height: 15, accentColor: '#0ea5e9' }}
                />
                <span style={{ color: '#334155' }}>Two-step upload</span>
              </label>
            </div>

            {/* Hint Text */}
             <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
                {isOriginalUpload 
                  ? '支持 RAW 格式 (CR2, NEF, ARW, DNG, FFF 等)、扫描仪 BMP/TIFF 及高保真 JPG。原始底片将被存档用于 FilmLab 后期处理。'
                  : '仅支持普通图像格式。不保存原始底片存档。'}
             </div>
          </div>
        </div>

        <div className="fg-field">
          <input 
            type="file" 
            accept={isOriginalUpload
              ? 'image/*,.dng,.cr2,.cr3,.arw,.nef,.nrw,.orf,.raf,.rw2,.pef,.srw,.x3f,.3fr,.fff,.iiq,.raw,.rwl,.dcr,.kdc,.mrw,.erf,.mef,.mos,.srf,.sr2,.bmp,.dib'
              : 'image/*'
            } 
            multiple 
            onChange={onFileChange}
            style={{ 
              padding: '14px',
              border: '2px dashed var(--fg-border)',
              borderRadius: 8,
              background: '#f9fafb',
              cursor: 'pointer',
              fontSize: 13,
              width: '100%',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Preview Grid */}
        {previews.length > 0 && (
          <>
            {shotLogs.length > 0 && (
              <div style={{ marginBottom: 12, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0369a1' }}>
                    Shot Logs Available: {totalShotLogCount} shots recorded
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <label style={{ display:'flex', alignItems:'center', gap:6, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12 }}>
                      <input 
                        type="checkbox" 
                        checked={applyShotLog} 
                        onChange={e => {
                          const v = e.target.checked;
                          setApplyShotLog(v);
                          if (v && Object.keys(fileMeta).length === 0) handleApplyShotLog();
                        }} 
                      />
                      <span>Apply shot log</span>
                    </label>
                    <button 
                      type="button" 
                      className="fg-btn fg-btn-sm fg-btn-primary"
                      onClick={() => setShowMapper(true)}
                    >
                      Map Shot Logs
                    </button>
                  </div>
                </div>
                
                <div style={{ fontSize: 11, color: '#0c4a6e', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {shotLogs.map((l, i) => (
                    <span key={i} style={{ background: '#fff', padding: '2px 6px', borderRadius: 4, border: '1px solid #e0f2fe' }}>
                      {l.date}: {l.count}
                    </span>
                  ))}
                </div>
                {applyShotLog && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#0f172a' }}>
                    Mapped {Object.keys(fileMeta).length} / {files.length} files
                  </div>
                )}
              </div>
            )}

            <div style={{ 
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10
            }}>
              {previews.map((p, i) => (
                <div key={i} style={{ 
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  padding: 6,
                  border: '1px solid var(--fg-border)',
                  borderRadius: 6,
                  background: '#fff',
                  transition: 'all 0.2s',
                  overflow: 'hidden'
                }}>
                  <div style={{ 
                    width: '100%',
                    aspectRatio: '1',
                    overflow: 'hidden',
                    borderRadius: 4,
                    background: '#f5f5f5',
                    position: 'relative'
                  }}>
                    <img 
                      src={p.url} 
                      alt={p.name || p.originalName} 
                      loading="lazy"
                      decoding="async"
                      style={{ 
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        objectPosition: 'center'
                      }} 
                    />
                    {fileDates[p.name] && (
                      <div style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        fontSize: 10,
                        padding: '2px 4px',
                        textAlign: 'center'
                      }}>
                        {fileDates[p.name]}
                      </div>
                    )}
                    {/* Log assignment indicator */}
                    {applyShotLog && fileMeta[p.name]?.logIndex !== undefined && (
                      <div style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: 'rgba(14, 116, 144, 0.85)',
                        color: '#fff',
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 8,
                        fontWeight: 600
                      }}>
                        L{fileMeta[p.name].logIndex + 1}
                      </div>
                    )}
                  </div>
                  <div style={{ 
                    fontSize: 10,
                    color: '#666',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'center',
                    lineHeight: 1.3
                  }}>
                    {p.originalName || p.name}
                  </div>
                  {/* Show mapped metadata summary */}
                  {fileMeta[p.name] && (fileMeta[p.name].lens || fileMeta[p.name].city) && (
                    <div style={{ 
                      fontSize: 9, 
                      color: '#0369a1', 
                      textAlign: 'center',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      padding: '2px 0'
                    }}>
                      {[
                        fileMeta[p.name].lens,
                        fileMeta[p.name].aperture ? `f/${fileMeta[p.name].aperture}` : null,
                        fileMeta[p.name].city
                      ].filter(Boolean).join(' · ') || '—'}
                    </div>
                  )}
                  <input 
                    type="date" 
                    style={{ fontSize: 10, padding: 2, border: '1px solid #ddd', borderRadius: 3, width: '100%' }}
                    value={fileDates[p.name] || ''}
                    onChange={e => {
                      const val = e.target.value;
                      setFileDates(prev => ({ ...prev, [p.name]: val }));
                      setFileMeta(prev => ({ ...prev, [p.name]: { ...(prev[p.name] || {}), date: val } }));
                    }}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {previews.length === 0 && (
          <div style={{ 
            padding: 40,
            textAlign: 'center',
            color: '#999',
            fontSize: 13,
            border: '1px dashed var(--fg-border)',
            borderRadius: 8,
            background: '#f9fafb'
          }}>
            No files selected
          </div>
        )}
      </section>

      {uploadProgress !== null && (
        <div style={{ 
          padding: 16,
          background: '#dbeafe',
          borderRadius: 8,
          textAlign: 'center',
          fontWeight: 600,
          color: '#1e40af',
          border: '1px solid #93c5fd'
        }}>
          Uploading: {uploadProgress}%
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 12 }}>
        <button className="fg-btn fg-btn-primary" type="submit" disabled={uploadProgress !== null} style={{ minWidth: 140, padding: '12px 24px', fontSize: 15, fontWeight: 600 }}>
          {uploadProgress !== null ? 'Uploading...' : 'Create Roll'}
        </button>
      </div>
      {showMapper && (
        <ShotLogMapper 
          files={files.map((f, i) => ({ name: f.name, preview: previews[i] ? previews[i].url : null }))}
          shotLogs={shotLogs}
          initialAssignments={Object.keys(fileMeta).reduce((acc, key) => {
            if (fileMeta[key]?.logIndex !== undefined) acc[key] = fileMeta[key].logIndex;
            return acc;
          }, {})}
          onSave={handleMapperSave}
          onClose={() => setShowMapper(false)}
        />
      )}
    </form>
  );
}