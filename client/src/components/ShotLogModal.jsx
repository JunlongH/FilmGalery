import React, { useState, useEffect, useRef } from 'react';
import { updateFilmItem, exportShotLogsCsv, getCountries, searchLocations, getCompatibleLenses, getLenses } from '../api';
import { getCityCoordinates } from '../utils/geocoding';
import GeoSearchInput from './GeoSearchInput.jsx';
import useIsDarkMode from '../hooks/useIsDarkMode';

const FALLBACK_LENSES = [
  '50mm f/1.8',
  '35mm f/1.4',
  '28mm f/2.8',
  '85mm f/1.8',
  '24-70mm f/2.8',
  '70-200mm f/2.8'
];

// Entry Edit Modal Component
function EntryEditModal({ entry, index, onSave, onClose, countries, citiesByCountry, lensOptions, nativeLenses, adaptedLenses, fixedLensInfo, cameraMount }) {
  const [editData, setEditData] = useState({ ...entry });
  const isDark = useIsDarkMode();
  
  const handleGeoSelect = (result) => {
    setEditData(prev => ({
      ...prev,
      detail_location: result.detail || result.displayName || '',
      country: result.country || prev.country || '',
      city: result.city || prev.city || '',
      latitude: result.latitude,
      longitude: result.longitude
    }));
  };
  
  return (
    <div className="fg-modal-overlay" style={{ zIndex: 1100 }} onClick={onClose}>
      <div 
        className="fg-modal-content" 
        style={{ 
          maxWidth: 600, 
          width: '90%', 
          background: isDark ? '#1e293b' : '#fff', 
          color: isDark ? '#f1f5f9' : '#333' 
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="fg-modal-header" style={{ borderBottom: isDark ? '1px solid #334155' : '1px solid #eee', paddingBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>
            Edit Entry - {entry.date}
          </h3>
          <button className="fg-modal-close" onClick={onClose} style={{ color: isDark ? '#94a3b8' : '#64748b' }}>&times;</button>
        </div>
        
        <div className="fg-modal-body" style={{ padding: 24 }}>
          {/* Row 0: Date, Time */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="fg-field">
              <label className="fg-label">Date</label>
              <input
                type="date"
                className="fg-input"
                value={editData.date || ''}
                onChange={e => setEditData(prev => ({ ...prev, date: e.target.value }))}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">Time (Shot Time)</label>
              <input
                type="time"
                className="fg-input"
                value={editData.shot_time || ''}
                onChange={e => setEditData(prev => ({ ...prev, shot_time: e.target.value }))}
              />
            </div>
          </div>
          {/* Row 1: Shots, Aperture, Shutter, Focal Length */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="fg-field">
              <label className="fg-label">Shots</label>
              <input
                type="number"
                className="fg-input"
                value={editData.count}
                min="0"
                onChange={e => setEditData(prev => ({ ...prev, count: Number(e.target.value) || 0 }))}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">Aperture (f/)</label>
              <input
                type="number"
                step="0.1"
                className="fg-input"
                value={editData.aperture ?? ''}
                placeholder="e.g. 2.8"
                onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  setEditData(prev => ({ ...prev, aperture: Number.isFinite(val) ? val : null }));
                }}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">Shutter Speed</label>
              <input
                type="text"
                className="fg-input"
                value={editData.shutter_speed || ''}
                placeholder="e.g. 1/125"
                onChange={e => setEditData(prev => ({ ...prev, shutter_speed: e.target.value }))}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">Focal (mm)</label>
              <input
                type="number"
                step="1"
                min="1"
                max="2000"
                className="fg-input"
                value={editData.focal_length ?? ''}
                placeholder="e.g. 50"
                onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  setEditData(prev => ({ ...prev, focal_length: Number.isFinite(val) ? val : null }));
                }}
              />
            </div>
          </div>
          
          {/* Row 2: Lens */}
          <div className="fg-field" style={{ marginBottom: 20 }}>
            <label className="fg-label">
              Lens {fixedLensInfo && <span style={{ color: '#10b981' }}>(Fixed)</span>}
            </label>
            {fixedLensInfo ? (
              <div style={{ 
                padding: '10px 12px', 
                background: isDark ? '#064e3b' : '#f0fdf4', 
                border: isDark ? '1px solid #10b981' : '1px solid #86efac', 
                borderRadius: 6, 
                color: isDark ? '#d1fae5' : '#166534' 
              }}>
                🔒 {fixedLensInfo.text}
              </div>
            ) : (
              <input
                type="text"
                className="fg-input"
                value={editData.lens || ''}
                placeholder="Lens model"
                onChange={e => setEditData(prev => ({ ...prev, lens: e.target.value }))}
                list="edit-lens-options"
              />
            )}
            <datalist id="edit-lens-options">
              {lensOptions.map(l => <option key={l} value={l} />)}
            </datalist>
          </div>
          
          {/* Row 3: Country, City */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="fg-field">
              <label className="fg-label">Country</label>
              <input
                type="text"
                className="fg-input"
                value={editData.country || ''}
                placeholder="Country"
                onChange={e => setEditData(prev => ({ ...prev, country: e.target.value }))}
                list="edit-country-options"
              />
              <datalist id="edit-country-options">
                {countries.map(c => (
                  <option key={c.country_code || c.country_name} value={c.country_name || c.country_code} />
                ))}
              </datalist>
            </div>
            <div className="fg-field">
              <label className="fg-label">City</label>
              <input
                type="text"
                className="fg-input"
                value={editData.city || ''}
                placeholder="City"
                onChange={e => setEditData(prev => ({ ...prev, city: e.target.value }))}
              />
            </div>
          </div>
          
          {/* Row 4: Detail Location with Geo Search */}
          <div className="fg-field" style={{ marginBottom: 20 }}>
            <label className="fg-label">Detail / Address (Search for GPS)</label>
            <GeoSearchInput
              value={editData.detail_location || ''}
              onChange={val => setEditData(prev => ({ ...prev, detail_location: val }))}
              onSelect={handleGeoSelect}
              placeholder="Search address to get coordinates..."
            />
          </div>
          
          {/* Row 5: Latitude, Longitude */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <div className="fg-field">
              <label className="fg-label">Latitude</label>
              <input
                type="number"
                step="0.00001"
                className="fg-input"
                value={editData.latitude ?? ''}
                placeholder="e.g. 40.00119"
                onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  setEditData(prev => ({ ...prev, latitude: Number.isFinite(val) ? val : null }));
                }}
              />
            </div>
            <div className="fg-field">
              <label className="fg-label">Longitude</label>
              <input
                type="number"
                step="0.00001"
                className="fg-input"
                value={editData.longitude ?? ''}
                placeholder="e.g. 116.32000"
                onChange={e => {
                  const val = e.target.value === '' ? null : Number(e.target.value);
                  setEditData(prev => ({ ...prev, longitude: Number.isFinite(val) ? val : null }));
                }}
              />
            </div>
          </div>
          
          {/* Coordinates Preview */}
          {editData.latitude && editData.longitude && (
            <div style={{ 
              padding: 12, 
              background: isDark ? '#064e3b' : '#f0fdf4', 
              borderRadius: 8, 
              marginBottom: 20,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <span style={{ fontSize: 18 }}>📍</span>
              <span style={{ color: isDark ? '#d1fae5' : '#166534', fontSize: 14 }}>
                {editData.latitude.toFixed(5)}, {editData.longitude.toFixed(5)}
              </span>
            </div>
          )}
          
          {/* Row 6: Caption */}
          <div className="fg-field" style={{ marginBottom: 20 }}>
            <label className="fg-label">Caption (Photo Description)</label>
            <textarea
              className="fg-input"
              rows={3}
              value={editData.caption || ''}
              placeholder="Describe what you shot, e.g. 'Sunset at the Great Wall'"
              onChange={e => setEditData(prev => ({ ...prev, caption: e.target.value }))}
              style={{ resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>
        </div>
        
        <div className="fg-modal-footer" style={{ borderTop: isDark ? '1px solid #334155' : '1px solid #eee', padding: 16, display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button className="fg-btn fg-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button 
            className="fg-btn fg-btn-primary" 
            onClick={() => onSave(index, editData)}
            style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', border: 'none' }}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ShotLogModal({ item, isOpen, onClose, onUpdated }) {
  const isDark = useIsDarkMode();
  const [logs, setLogs] = useState([]);
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newTime, setNewTime] = useState('');
  const [newCount, setNewCount] = useState('1');
  const [newLens, setNewLens] = useState('');
  const [newAperture, setNewAperture] = useState('');
  const [newShutter, setNewShutter] = useState('');
  const [newFocalLength, setNewFocalLength] = useState('');
  const [newCountry, setNewCountry] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newDetail, setNewDetail] = useState('');
  const [newCaption, setNewCaption] = useState('');
  const [selectedLens, setSelectedLens] = useState('');
  const [lensOptions, setLensOptions] = useState(FALLBACK_LENSES);
  // Inventory-based lens categorization
  const [nativeLenses, setNativeLenses] = useState([]); // [{ id, displayName, ... }]
  const [adaptedLenses, setAdaptedLenses] = useState([]); // [{ id, displayName, mount, ... }]
  const [countries, setCountries] = useState([]);
  const [citiesByCountry, setCitiesByCountry] = useState({}); // code -> cities
  const [countryCode, setCountryCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [exporting, setExporting] = useState(false);
  // Fixed lens camera detection
  const [fixedLensInfo, setFixedLensInfo] = useState(null); // { text, focal_length, max_aperture }
  const [cameraName, setCameraName] = useState('');
  const [cameraMount, setCameraMount] = useState('');
  
  // Geolocation state
  const [newLatitude, setNewLatitude] = useState(null);
  const [newLongitude, setNewLongitude] = useState(null);
  
  // Edit Modal state
  const [editingEntry, setEditingEntry] = useState(null); // { index, entry }
  
  // Import CSV state
  const [importing, setImporting] = useState(false);
  const [showImportOptions, setShowImportOptions] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);
  const fileInputRef = useRef(null);
  // Ref to track item object without triggering effect re-runs
  const itemRef = useRef(item);
  itemRef.current = item;

  // CSV Template header
  const CSV_TEMPLATE = 'date,shot_time,count,lens,focal_length,aperture,shutter_speed,country,city,detail_location,latitude,longitude\n2026-01-01,14:30,1,50mm f/1.8,50,2.8,1/125,China,Beijing,Sample Location,39.9042,116.4074';

  // Parse CSV string to log entries
  const parseCSV = (csvText) => {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return []; // Need at least header + 1 data row
    
    const header = lines[0].toLowerCase().split(',').map(h => h.trim());
    const entries = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      
      // Handle quoted fields with commas
      const values = [];
      let inQuotes = false;
      let currentValue = '';
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(currentValue.trim());
          currentValue = '';
        } else {
          currentValue += char;
        }
      }
      values.push(currentValue.trim());
      
      const entry = {};
      header.forEach((col, idx) => {
        const val = values[idx] || '';
        switch (col) {
          case 'date':
            entry.date = val;
            break;
          case 'shot_time':
          case 'time':
            entry.shot_time = val;
            break;
          case 'count':
          case 'shots':
            entry.count = Number(val) || 0;
            break;
          case 'lens':
            entry.lens = val;
            break;
          case 'focal_length':
          case 'focal':
            entry.focal_length = val ? Number(val) : null;
            break;
          case 'aperture':
          case 'f':
            entry.aperture = val ? Number(val) : null;
            break;
          case 'shutter_speed':
          case 'shutter':
          case 's':
            entry.shutter_speed = val;
            break;
          case 'country':
            entry.country = val;
            break;
          case 'city':
            entry.city = val;
            break;
          case 'detail_location':
          case 'detail':
          case 'address':
            entry.detail_location = val;
            break;
          case 'latitude':
          case 'lat':
            entry.latitude = val ? Number(val) : null;
            break;
          case 'longitude':
          case 'lng':
          case 'lon':
            entry.longitude = val ? Number(val) : null;
            break;
          // iso is ignored on import (comes from film definition)
          default:
            break;
        }
      });
      
      // Validate required fields
      if (entry.date && entry.count > 0) {
        entries.push({
          date: entry.date,
          shot_time: entry.shot_time || '',
          count: entry.count,
          lens: entry.lens || '',
          focal_length: Number.isFinite(entry.focal_length) ? entry.focal_length : null,
          aperture: Number.isFinite(entry.aperture) ? entry.aperture : null,
          shutter_speed: entry.shutter_speed || '',
          country: entry.country || '',
          city: entry.city || '',
          detail_location: entry.detail_location || '',
          latitude: Number.isFinite(entry.latitude) ? entry.latitude : null,
          longitude: Number.isFinite(entry.longitude) ? entry.longitude : null
        });
      }
    }
    
    return entries;
  };

  // Handle file selection
  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      
      if (parsed.length === 0) {
        alert('No valid entries found in CSV. Please check the format.');
        return;
      }
      
      // Show import options dialog
      setPendingImportData(parsed);
      setShowImportOptions(true);
    } catch (err) {
      alert('Failed to read CSV: ' + (err.message || err));
    } finally {
      setImporting(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Execute import with selected strategy
  const executeImport = (strategy) => {
    if (!pendingImportData) return;
    
    let newLogs;
    switch (strategy) {
      case 'replace':
        newLogs = pendingImportData;
        break;
      case 'append':
        newLogs = [...logs, ...pendingImportData];
        break;
      case 'merge':
        // Merge by date - imported entries override existing ones with same date
        const existingByDate = {};
        logs.forEach(l => {
          if (!existingByDate[l.date]) existingByDate[l.date] = [];
          existingByDate[l.date].push(l);
        });
        pendingImportData.forEach(l => {
          if (!existingByDate[l.date]) existingByDate[l.date] = [];
          existingByDate[l.date].push(l);
        });
        newLogs = Object.values(existingByDate).flat();
        break;
      default:
        newLogs = [...logs, ...pendingImportData];
    }
    
    // Sort by date
    newLogs.sort((a, b) => a.date.localeCompare(b.date));
    setLogs(newLogs);
    
    setShowImportOptions(false);
    setPendingImportData(null);
    
    alert(`Successfully imported ${pendingImportData.length} entries!`);
  };

  // Download CSV template
  const downloadTemplate = () => {
    const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shot-log-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Format lens for display
  const formatLensDisplay = (lens) => {
    const name = `${lens.brand || ''} ${lens.model || ''}`.trim();
    if (lens.focal_length_min) {
      const focalStr = lens.focal_length_min === lens.focal_length_max || !lens.focal_length_max
        ? `${lens.focal_length_min}mm`
        : `${lens.focal_length_min}-${lens.focal_length_max}mm`;
      const apertureStr = lens.max_aperture ? ` f/${lens.max_aperture}` : '';
      return name ? `${name} ${focalStr}${apertureStr}` : `${focalStr}${apertureStr}`;
    }
    return name || lens.name || 'Unknown Lens';
  };

  const dedupeAndSort = (list) => Array.from(new Set((list || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));

  const addLensToOptions = (lens) => {
    if (!lens) return;
    setLensOptions((prev) => dedupeAndSort([...prev, lens]));
  };

  useEffect(() => {
    const currentItem = itemRef.current;
    if (currentItem && currentItem.shot_logs) {
      try {
        const parsed = JSON.parse(currentItem.shot_logs);
        if (Array.isArray(parsed)) {
          const normalized = parsed.map(entry => ({
            date: entry.date,
            shot_time: entry.shot_time || '',
            count: Number(entry.count || entry.shots || 0) || 0,
            lens: entry.lens || '',
            focal_length: entry.focal_length !== undefined && entry.focal_length !== null ? Number(entry.focal_length) : null,
            aperture: entry.aperture !== undefined && entry.aperture !== null ? Number(entry.aperture) : null,
            shutter_speed: entry.shutter_speed || '',
            country: entry.country || '',
            city: entry.city || '',
            detail_location: entry.detail_location || '',
            // Preserve latitude and longitude!
            latitude: entry.latitude !== undefined && entry.latitude !== null ? Number(entry.latitude) : null,
            longitude: entry.longitude !== undefined && entry.longitude !== null ? Number(entry.longitude) : null,
            caption: entry.caption || ''
          })).filter(e => e.date && e.count > 0);
          setLogs(normalized);
          setLensOptions((prev) => dedupeAndSort([...prev, ...normalized.map(e => e.lens).filter(Boolean)]));
        }
      } catch (e) {
        console.error('Failed to parse shot_logs', e);
      }
    } else {
      setLogs([]);
    }
    if (currentItem && currentItem.shot_logs) {
      const today = new Date().toISOString().split('T')[0];
      setSelectedDate(today);
    }
    // Use item?.id (stable primitive) to avoid re-firing on every object reference change
  }, [item?.id]);

  // Detect fixed lens camera OR fetch compatible lenses for interchangeable lens cameras
  useEffect(() => {
    let mounted = true;
    
    const checkCameraAndLenses = async () => {
      if (!item?.camera_equip_id) {
        setFixedLensInfo(null);
        setCameraName('');
        setCameraMount('');
        setNativeLenses([]);
        setAdaptedLenses([]);
        return;
      }
      
      try {
        // Use getCompatibleLenses which returns camera info + compatible lenses (native + adapted)
        const result = await getCompatibleLenses(item.camera_equip_id);
        if (!mounted) return;
        
        if (result.fixed_lens) {
          // Fixed lens camera
          const lensText = result.focal_length 
            ? `${result.focal_length}mm${result.max_aperture ? ` f/${result.max_aperture}` : ''}`
            : 'Fixed Lens';
          
          setCameraName(result.camera_name || '');
          setCameraMount('');
          setFixedLensInfo({
            text: lensText,
            focal_length: result.focal_length,
            max_aperture: result.max_aperture
          });
          setNativeLenses([]);
          setAdaptedLenses([]);
          
          // Auto-fill lens and focal_length for new entries
          setSelectedLens(lensText);
          setNewLens('');
          if (result.focal_length) {
            setNewFocalLength(String(result.focal_length));
          }
        } else {
          // Interchangeable lens camera - store native and adapted lenses separately
          setFixedLensInfo(null);
          setCameraName(result.camera_name || '');
          setCameraMount(result.camera_mount || '');
          
          // Process native lenses
          const native = (result.lenses || []).map(lens => ({
            ...lens,
            displayName: formatLensDisplay(lens)
          }));
          setNativeLenses(native);
          
          // Process adapted lenses (grouped by mount)
          const adapted = (result.adapted_lenses || []).map(lens => ({
            ...lens,
            displayName: formatLensDisplay(lens)
          }));
          setAdaptedLenses(adapted);
          
          // Add to flat lensOptions for backward compatibility (custom input)
          const allLensNames = [...native, ...adapted].map(l => l.displayName).filter(Boolean);
          setLensOptions(prev => dedupeAndSort([...allLensNames, ...prev]));
        }
      } catch (err) {
        console.warn('Failed to fetch camera/lens info', err);
        if (mounted) {
          setFixedLensInfo(null);
          setCameraName('');
          setCameraMount('');
          setNativeLenses([]);
          setAdaptedLenses([]);
        }
      }
    };
    
    checkCameraAndLenses();
    return () => { mounted = false; };
  }, [item?.camera_equip_id]);

  useEffect(() => {
    let mounted = true;
    
    // Fetch lens library for suggestions (instead of dirty metadata)
    getLenses()
      .then((lenses) => {
        if (!mounted) return;
        const formatted = (Array.isArray(lenses) ? lenses : []).map(l => formatLensDisplay(l));
        setLensOptions(prev => dedupeAndSort([...prev, ...formatted]));
      })
      .catch((err) => {
        console.warn('Failed to fetch library lenses:', err);
        setLensOptions(prev => dedupeAndSort([...prev, ...FALLBACK_LENSES]));
      });

    getCountries()
      .then(rows => {
        if (!mounted) return;
        const sorted = (Array.isArray(rows) ? rows : []).sort((a, b) => (a.country_name || '').localeCompare(b.country_name || ''));
        setCountries(sorted);
      })
      .catch(() => setCountries([]));
    return () => { mounted = false; };
  }, []);

  // Removed: auto-adding non-standard lenses from existing logs
  // useEffect(() => {
  //   setLensOptions((prev) => dedupeAndSort([...prev, ...logs.map(l => l.lens).filter(Boolean)]));
  // }, [logs]);

  useEffect(() => {
    const last = logs[logs.length - 1];
    if (!last) return;
    if (!newCountry) setNewCountry(last.country || '');
    if (!newCity) setNewCity(last.city || '');
    if (!newDetail) setNewDetail(last.detail_location || '');
    if (!newAperture && (last.aperture || last.aperture === 0)) setNewAperture(String(last.aperture));
    if (!newShutter && last.shutter_speed) setNewShutter(last.shutter_speed);
    // derive country code for quick city lookup
    const matched = countries.find(c => (c.country_name || '').toLowerCase() === (last.country || '').toLowerCase());
    if (matched) setCountryCode(matched.country_code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.length]);

  useEffect(() => {
    const matched = countries.find(c => (c.country_name || '').toLowerCase() === (newCountry || '').toLowerCase());
    const code = matched ? matched.country_code : '';
    setCountryCode(code || '');
    if (code && !citiesByCountry[code]) {
      searchLocations({ country: code }).then(rows => {
        setCitiesByCountry(prev => ({ ...prev, [code]: Array.isArray(rows) ? rows : [] }));
      }).catch(() => {});
    }
  }, [newCountry, countries, citiesByCountry]);

  const handleAdd = () => {
    if (!newDate || !newCount || Number(newCount) <= 0) return;
    // For fixed lens cameras, always use the fixed lens text
    const lensVal = fixedLensInfo ? fixedLensInfo.text : (newLens.trim() || selectedLens || '');
    const last = logs[logs.length - 1] || {};
    const apertureVal = newAperture !== '' ? Number(newAperture) : (last.aperture ?? null);
    const shutterVal = newShutter || last.shutter_speed || '';
    const focalVal = newFocalLength !== '' ? Number(newFocalLength) : (fixedLensInfo?.focal_length ?? last.focal_length ?? null);
    const entry = {
      date: newDate,
      shot_time: newTime.trim(),
      count: Number(newCount),
      lens: lensVal,
      focal_length: Number.isFinite(focalVal) ? focalVal : null,
      aperture: Number.isFinite(apertureVal) ? apertureVal : null,
      shutter_speed: shutterVal,
      country: newCountry || last.country || '',
      city: newCity || last.city || '',
      detail_location: newDetail || last.detail_location || '',
      // Include coordinates if available
      latitude: newLatitude,
      longitude: newLongitude,
      caption: newCaption.trim()
    };

    const updatedLogs = [...logs, entry].sort((a, b) => a.date.localeCompare(b.date));
    setLogs(updatedLogs);
    if (lensVal) addLensToOptions(lensVal);
    setNewCount('1');
    setNewLens('');
    setNewTime('');
    setNewAperture(apertureVal !== null && apertureVal !== undefined && apertureVal !== '' ? String(apertureVal) : '');
    setNewShutter(shutterVal || '');
    setNewFocalLength(focalVal !== null && focalVal !== undefined ? String(focalVal) : '');
    setNewCountry(entry.country || '');
    setNewCity(entry.city || '');
    setNewDetail(entry.detail_location || '');
    // Reset coordinates and caption for next entry
    setNewLatitude(null);
    setNewLongitude(null);
    setNewCaption('');
  };

  // Handle geocoding result selection from GeoSearchInput
  const handleGeoSelect = (result) => {
    setNewLatitude(result.latitude);
    setNewLongitude(result.longitude);
    if (result.country) setNewCountry(result.country);
    if (result.city) setNewCity(result.city);
    if (result.detail) setNewDetail(result.detail);
  };

  // Auto-fill coordinates from country/city when no specific address
  const handleAutoFillCoordinates = async () => {
    if (newLatitude && newLongitude) return; // Already have coordinates
    if (!newCountry && !newCity) return; // Nothing to search for
    
    try {
      const coords = await getCityCoordinates(newCountry, newCity);
      if (coords) {
        setNewLatitude(coords.latitude);
        setNewLongitude(coords.longitude);
      }
    } catch (err) {
      console.error('Auto-fill coordinates failed:', err);
    }
  };

  const handleRemoveIndex = (index) => {
    const updated = [...logs];
    updated.splice(index, 1);
    setLogs(updated);
  };

  // Handle editing an entry via modal
  const handleEditEntry = (index) => {
    setEditingEntry({ index, entry: logs[index] });
  };
  
  const handleSaveEditedEntry = (index, updatedEntry) => {
    setLogs(prev => {
      const next = [...prev];
      next[index] = updatedEntry;
      return next;
    });
    setEditingEntry(null);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await updateFilmItem(item.id, { shot_logs: JSON.stringify(logs) });
      if (!res.ok) throw new Error(res.error || 'Update failed');

      if (onUpdated) await onUpdated();
      onClose();
    } catch (err) {
      alert('Failed to save logs: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportShotLogsCsv(item.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shot-logs-${item.id}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Export failed: ' + (err.message || err));
    } finally {
      setExporting(false);
    }
  };

  const totalShots = logs.reduce((acc, cur) => acc + cur.count, 0);
  const uniqueDays = new Set(logs.map(l => l.date)).size;
  const selectedDayLogs = logs.map((entry, idx) => ({ ...entry, idx })).filter(l => l.date === selectedDate);

  if (!isOpen) return null;

  return (
    <div className="fg-modal-overlay">
      <div className="fg-modal-content" style={{ maxWidth: 1100, width: '94%', background: isDark ? '#1e293b' : '#fff', color: isDark ? '#f1f5f9' : '#333', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="fg-modal-header" style={{ borderBottom: isDark ? '1px solid #334155' : '1px solid #eee', paddingBottom: 16, marginBottom: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>Shot Log - {item.label || `Item #${item.id}`}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="fg-btn fg-btn-sm"
                onClick={handleExport}
                disabled={exporting}
                style={{ background: isDark ? '#334155' : '#fff', border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', color: isDark ? '#f1f5f9' : '#0f172a', padding: '6px 10px', fontSize: 12 }}
              >
                {exporting ? 'Exporting…' : '📤 Export CSV'}
              </button>
              <button
                type="button"
                className="fg-btn fg-btn-sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
                style={{ background: isDark ? '#334155' : '#fff', border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', color: isDark ? '#f1f5f9' : '#0f172a', padding: '6px 10px', fontSize: 12 }}
              >
                {importing ? 'Importing…' : '📥 Import CSV'}
              </button>
              <button
                type="button"
                className="fg-btn fg-btn-sm"
                onClick={downloadTemplate}
                style={{ background: isDark ? '#334155' : '#fff', border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', color: isDark ? '#94a3b8' : '#64748b', padding: '6px 10px', fontSize: 12 }}
                title="Download CSV template"
              >
                📋 Template
              </button>
            </div>
            {/* Hidden file input for CSV import */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
          <button className="fg-modal-close" onClick={onClose} style={{ color: isDark ? '#94a3b8' : '#64748b' }}>&times;</button>
        </div>
        
        {/* Import Options Dialog */}
        {showImportOptions && pendingImportData && (
          <div style={{ 
            position: 'absolute', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0,0,0,0.5)', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            zIndex: 100,
            borderRadius: 8
          }}>
            <div style={{ 
              background: isDark ? '#1e293b' : '#fff', 
              borderRadius: 12, 
              padding: 24, 
              maxWidth: 400, 
              width: '90%',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)'
            }}>
              <h4 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>
                Import {pendingImportData.length} Entries
              </h4>
              <p style={{ margin: '0 0 20px', color: isDark ? '#94a3b8' : '#64748b', fontSize: 14 }}>
                How would you like to import these entries?
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <button
                  className="fg-btn"
                  onClick={() => executeImport('append')}
                  style={{ 
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                    color: '#fff', 
                    border: 'none',
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontWeight: 500
                  }}
                >
                  ➕ Append to existing ({logs.length} + {pendingImportData.length})
                </button>
                <button
                  className="fg-btn"
                  onClick={() => executeImport('merge')}
                  style={{ 
                    background: isDark ? '#334155' : '#fff', 
                    color: isDark ? '#f1f5f9' : '#475569', 
                    border: isDark ? '1px solid #475569' : '1px solid #e2e8f0',
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontWeight: 500
                  }}
                >
                  🔀 Merge (combine entries by date)
                </button>
                <button
                  className="fg-btn"
                  onClick={() => executeImport('replace')}
                  style={{ 
                    background: '#fff', 
                    color: '#ef4444', 
                    border: '1px solid #fecaca',
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontWeight: 500
                  }}
                >
                  🔄 Replace all (delete existing {logs.length} entries)
                </button>
                <button
                  className="fg-btn"
                  onClick={() => { setShowImportOptions(false); setPendingImportData(null); }}
                  style={{ 
                    background: isDark ? '#0f172a' : '#f8fafc', 
                    color: isDark ? '#94a3b8' : '#64748b', 
                    border: 'none',
                    padding: '10px 16px',
                    borderRadius: 8,
                    marginTop: 8
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
        
        <div className="fg-modal-body" style={{ padding: 24, overflowY: 'auto' }}>
          
          {/* Quick Add Section */}
          <div style={{ marginBottom: 24, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 20, borderRadius: 12, boxShadow: '0 4px 12px rgba(102, 126, 234, 0.25)' }}>
            {/* Row 1: Date, Time, Count, Aperture, Shutter */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <div className="fg-field" style={{ flex: '0 0 140px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Date</label>
                <input 
                  type="date" 
                  className="fg-input" 
                  value={newDate} 
                  onChange={e => setNewDate(e.target.value)} 
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                />
              </div>
              <div className="fg-field" style={{ flex: '0 0 100px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Time</label>
                <input
                  type="time"
                  className="fg-input"
                  value={newTime}
                  onChange={e => setNewTime(e.target.value)}
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                />
              </div>
              <div className="fg-field" style={{ flex: '0 0 80px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Shots</label>
                <input 
                  type="number" 
                  className="fg-input" 
                  value={newCount} 
                  onChange={e => setNewCount(e.target.value)} 
                  placeholder="#"
                  min="1"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div className="fg-field" style={{ flex: '0 0 90px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>f/</label>
                <input
                  type="number"
                  step="0.1"
                  className="fg-input"
                  value={newAperture}
                  onChange={e => setNewAperture(e.target.value)}
                  placeholder="1.8"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div className="fg-field" style={{ flex: '0 0 100px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>s</label>
                <input
                  type="text"
                  className="fg-input"
                  value={newShutter}
                  onChange={e => setNewShutter(e.target.value)}
                  placeholder="1/125"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div className="fg-field" style={{ flex: '0 0 80px' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>mm</label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="2000"
                  className="fg-input"
                  value={newFocalLength}
                  onChange={e => setNewFocalLength(e.target.value)}
                  placeholder="50"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div className="fg-field" style={{ flex: 1, minWidth: 0 }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>
                  Lens {fixedLensInfo && <span style={{ opacity: 0.7 }}>(Fixed)</span>}
                  {cameraMount && !fixedLensInfo && <span style={{ opacity: 0.6, fontSize: 10, marginLeft: 4 }}>({cameraMount})</span>}
                </label>
                {fixedLensInfo ? (
                  /* Fixed lens camera - show locked indicator */
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    background: '#f0fdf4', 
                    border: '1px solid #86efac', 
                    borderRadius: 6, 
                    padding: '8px 12px',
                    height: 38,
                    boxSizing: 'border-box'
                  }}>
                    <span style={{ fontSize: 14 }}>🔒</span>
                    <span style={{ fontSize: 13, color: '#166534', fontWeight: 500 }}>{fixedLensInfo.text}</span>
                    {cameraName && <span style={{ fontSize: 11, color: '#15803d', marginLeft: 'auto' }}>{cameraName}</span>}
                  </div>
                ) : (
                  /* Inventory lens selection with Native/Adapted categories */
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select
                      className="fg-input"
                      value={selectedLens}
                      onChange={e => {
                        // e.target.value is now lens.name, find the lens to get focal info
                        const lens = [...nativeLenses, ...adaptedLenses].find(l => l.name === e.target.value);
                        setSelectedLens(e.target.value);
                        if (lens) {
                          const isPrime = lens.focal_length_min && (!lens.focal_length_max || lens.focal_length_min === lens.focal_length_max);
                          if (isPrime) {
                            setNewFocalLength(String(lens.focal_length_min));
                          }
                        }
                      }}
                      style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', flex: 1, minWidth: 0, fontSize: 13 }}
                    >
                      <option value="">Select lens...</option>
                      {/* Inventory lenses (Native) - use name for value, displayName for label */}
                      {nativeLenses.length > 0 && (
                        <optgroup label={`📷 Native Lenses${cameraMount ? ` (${cameraMount})` : ''}`}>
                          {nativeLenses.map(l => (
                            <option key={`native-${l.id}`} value={l.name}>{l.displayName}</option>
                          ))}
                        </optgroup>
                      )}
                      {/* Inventory lenses (Adapted) - use name for value, displayName for label */}
                      {adaptedLenses.length > 0 && (
                        <optgroup label="🔄 Adapted Lenses">
                          {adaptedLenses.map(l => (
                            <option key={`adapted-${l.id}`} value={l.name}>
                              {l.displayName} [{l.mount}]
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {/* Fallback: show flat options if no inventory lenses */}
                      {nativeLenses.length === 0 && adaptedLenses.length === 0 && lensOptions.length > 0 && (
                        <optgroup label="Other Lenses">
                          {lensOptions.map(l => <option key={l} value={l}>{l}</option>)}
                        </optgroup>
                      )}
                    </select>
                    <input
                      type="text"
                      className="fg-input"
                      value={newLens}
                      onChange={e => setNewLens(e.target.value)}
                      placeholder="Custom"
                      style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', flex: 1, minWidth: 0, fontSize: 13 }}
                      onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    />
                  </div>
                )}
              </div>
            </div>
            
            {/* Row 2: Country, City, Detail */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div className="fg-field" style={{ flex: 1, minWidth: 0 }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Country</label>
                <input
                  type="text"
                  className="fg-input"
                  list="fg-country-options"
                  value={newCountry}
                  onChange={e => setNewCountry(e.target.value)}
                  placeholder="From DB"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                />
                <datalist id="fg-country-options">
                  {countries.map(c => (
                    <option key={c.country_code || c.country_name} value={c.country_name || c.country_code} />
                  ))}
                </datalist>
              </div>
              <div className="fg-field" style={{ flex: 1, minWidth: 0 }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>City</label>
                <input
                  type="text"
                  className="fg-input"
                  list="fg-city-options"
                  value={newCity}
                  onChange={e => setNewCity(e.target.value)}
                  placeholder={countryCode ? 'Filtered' : 'Country first'}
                  disabled={!countryCode && !newCountry}
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                />
                <datalist id="fg-city-options">
                  {(citiesByCountry[countryCode] || []).map(ct => (
                    <option key={ct.id} value={ct.city_name} />
                  ))}
                </datalist>
              </div>
              <div className="fg-field" style={{ flex: 1.2, minWidth: 0, position: 'relative' }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>
                  Detail / Address
                  {newLatitude && newLongitude && (
                    <span style={{ marginLeft: 8, color: '#4ade80', fontSize: 11 }}>
                      📍 {newLatitude.toFixed(5)}, {newLongitude.toFixed(5)}
                    </span>
                  )}
                </label>
                <GeoSearchInput
                  value={newDetail}
                  onChange={setNewDetail}
                  onSelect={handleGeoSelect}
                  placeholder="Search address or type detail"
                  style={{ background: 'transparent' }}
                />
              </div>
            </div>
            
            {/* Row 3: Caption + Add Button */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <div className="fg-field" style={{ flex: 1, minWidth: 0 }}>
                <label className="fg-label" style={{ color: 'rgba(255,255,255,0.95)', marginBottom: 6, fontSize: 12, fontWeight: 600 }}>Caption (Photo Description)</label>
                <input
                  type="text"
                  className="fg-input"
                  value={newCaption}
                  onChange={e => setNewCaption(e.target.value)}
                  placeholder="Describe the shot, e.g. 'Sunset at the Great Wall'"
                  style={{ background: '#fff', color: '#1f2937', height: 38, border: 'none', fontSize: 13 }}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <button 
                type="button" 
                className="fg-btn" 
                onClick={() => {
                  // Auto-fill coordinates if not set
                  if (!newLatitude && !newLongitude && (newCountry || newCity)) {
                    handleAutoFillCoordinates();
                  }
                  handleAdd();
                }}
                disabled={!newCount}
                style={{ height: 38, padding: '0 20px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#667eea', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.15)', whiteSpace: 'nowrap' }}
              >
                Add Log
              </button>
            </div>
          </div>

          {/* Selected Day Entries (above calendar) */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>
                Selected Day
              </h4>
              <span style={{ 
                fontSize: 13, 
                color: '#fff',
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                padding: '4px 12px',
                borderRadius: 6,
                fontWeight: 500
              }}>
                {selectedDate || 'Pick a date'}
              </span>
            </div>
            {selectedDayLogs.length === 0 ? (
              <div style={{ border: isDark ? '2px dashed #475569' : '2px dashed #e2e8f0', borderRadius: 12, padding: 20, color: '#94a3b8', fontSize: 13, textAlign: 'center' }}>
                <div style={{ marginBottom: 4 }}>📅</div>
                No entries for this day. Click the calendar to choose a date, then add logs above.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {selectedDayLogs.map((entry) => (
                  <div 
                    key={`${entry.date}-${entry.idx}`} 
                    style={{ 
                      border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', 
                      borderRadius: 10, 
                      padding: 12,
                      background: isDark ? '#334155' : '#fff',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
                      <span style={{ 
                        background: '#eff6ff', 
                        color: '#2563eb', 
                        padding: '4px 10px', 
                        borderRadius: 6,
                        fontWeight: 600,
                        fontSize: 13
                      }}>
                        {entry.count} shot{entry.count !== 1 ? 's' : ''}
                      </span>
                      {entry.shot_time && <span style={{ color: '#64748b', fontSize: 13 }}>🕐 {entry.shot_time}</span>}
                      {entry.aperture && <span style={{ color: '#64748b', fontSize: 13 }}>f/{entry.aperture}</span>}
                      {entry.shutter_speed && <span style={{ color: '#64748b', fontSize: 13 }}>{entry.shutter_speed}</span>}
                      {entry.focal_length && <span style={{ color: '#64748b', fontSize: 13 }}>{entry.focal_length}mm</span>}
                      {entry.lens && <span style={{ color: '#475569', fontSize: 13 }}>• {entry.lens}</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {entry.caption && (
                        <span style={{ 
                          color: isDark ? '#a5b4fc' : '#6366f1', 
                          fontSize: 12,
                          maxWidth: 150,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }} title={entry.caption}>
                          💬 {entry.caption}
                        </span>
                      )}
                      {(entry.country || entry.city) && (
                        <span style={{ color: '#64748b', fontSize: 12 }}>
                          📍 {[entry.country, entry.city].filter(Boolean).join(' / ')}
                        </span>
                      )}
                      {entry.latitude && entry.longitude && (
                        <span style={{ 
                          background: '#dcfce7', 
                          color: '#166534', 
                          padding: '2px 6px', 
                          borderRadius: 4,
                          fontSize: 10,
                          fontFamily: 'monospace'
                        }}>
                          GPS ✓
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        className="fg-btn"
                        style={{ background: isDark ? '#1e293b' : '#fff', border: isDark ? '1px solid #64748b' : '1px solid #e2e8f0', color: isDark ? '#cbd5e1' : '#475569', padding: '4px 10px', fontSize: 12 }}
                        onClick={() => handleEditEntry(entry.idx)}
                      >
                        ✏️
                      </button>
                      <button
                        className="fg-btn"
                        style={{ background: isDark ? '#1e293b' : '#fff', border: '1px solid #fecaca', color: '#ef4444', padding: '4px 10px', fontSize: 12 }}
                        onClick={() => {
                          if (window.confirm('Delete this log entry?')) handleRemoveIndex(entry.idx);
                        }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Calendar View */}
          <div style={{ marginBottom: 20 }}>
            {/* Month Navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, padding: '0 8px' }}>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}
                style={{ border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', background: isDark ? '#334155' : '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: isDark ? '#f1f5f9' : '#475569', fontWeight: 500 }}
              >
                ← Prev
              </button>
              <h4 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>
                {currentMonth.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
              </h4>
              <button
                type="button"
                onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}
                style={{ border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', background: isDark ? '#334155' : '#fff', padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: isDark ? '#f1f5f9' : '#475569', fontWeight: 500 }}
              >
                Next →
              </button>
            </div>

            {/* Calendar Grid */}
            <div style={{ border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: isDark ? '#1e293b' : '#fff' }}>
              {/* Weekday Headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: isDark ? '#0f172a' : '#f8fafc', borderBottom: isDark ? '1px solid #475569' : '1px solid #e2e8f0' }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} style={{ padding: '12px 8px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar Days */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {(() => {
                  const year = currentMonth.getFullYear();
                  const month = currentMonth.getMonth();
                  const firstDay = new Date(year, month, 1).getDay();
                  const daysInMonth = new Date(year, month + 1, 0).getDate();
                  const days = [];
                  
                  // Empty cells before first day
                  for (let i = 0; i < firstDay; i++) {
                    days.push(<div key={`empty-${i}`} style={{ aspectRatio: '1', borderTop: isDark ? '1px solid #334155' : '1px solid #f1f5f9', borderLeft: i > 0 ? (isDark ? '1px solid #334155' : '1px solid #f1f5f9') : 'none', background: isDark ? '#0f172a' : '#fafafa' }} />);
                  }
                  
                  // Day cells
                  for (let day = 1; day <= daysInMonth; day++) {
                    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const dayLogs = logs.filter(l => l.date === dateStr);
                    const hasLog = dayLogs.length > 0;
                    const isToday = dateStr === new Date().toISOString().split('T')[0];
                    const colIndex = (firstDay + day - 1) % 7;
                    const dayCount = dayLogs.reduce((sum, l) => sum + l.count, 0);
                    
                    days.push(
                      <div 
                        key={day}
                        onClick={() => {
                          // Calendar click selects date; per-entry deletion handled below.
                          setNewDate(dateStr);
                          setSelectedDate(dateStr);
                        }}
                        style={{
                          aspectRatio: '1',
                          borderTop: isDark ? '1px solid #475569' : '1px solid #e2e8f0',
                          borderLeft: colIndex > 0 ? (isDark ? '1px solid #475569' : '1px solid #e2e8f0') : 'none',
                          padding: 8,
                          cursor: 'pointer',
                          position: 'relative',
                          background: hasLog ? (isDark ? '#1e3a5f' : '#eff6ff') : isToday ? (isDark ? '#451a03' : '#fef3c7') : (isDark ? '#1e293b' : '#fff'),
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between'
                        }}
                        onMouseEnter={e => {
                          if (!hasLog) e.currentTarget.style.background = isDark ? '#334155' : '#f8fafc';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = hasLog ? (isDark ? '#1e3a5f' : '#eff6ff') : isToday ? (isDark ? '#451a03' : '#fef3c7') : (isDark ? '#1e293b' : '#fff');
                        }}
                      >
                        <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 500, color: hasLog ? (isDark ? '#60a5fa' : '#2563eb') : isToday ? (isDark ? '#fbbf24' : '#92400e') : (isDark ? '#cbd5e1' : '#475569') }}>
                          {day}
                        </div>
                        {hasLog && (
                          <div style={{ 
                            fontSize: 11, 
                            fontWeight: 700, 
                            color: '#fff', 
                            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                            borderRadius: 6,
                            padding: '4px 6px',
                            textAlign: 'center',
                            boxShadow: '0 2px 4px rgba(102, 126, 234, 0.3)'
                          }}>
                            {dayCount} 📸
                          </div>
                        )}
                      </div>
                    );
                  }
                  
                  return days;
                })()}
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 20, marginBottom: 24 }}>
              <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: 20, borderRadius: 12, color: '#fff', boxShadow: '0 4px 12px rgba(102, 126, 234, 0.25)' }}>
              <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>Total Shots</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{totalShots}</div>
            </div>
            <div style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', padding: 20, borderRadius: 12, color: '#fff', boxShadow: '0 4px 12px rgba(245, 87, 108, 0.25)' }}>
              <div style={{ fontSize: 13, opacity: 0.9, marginBottom: 4 }}>Days Logged</div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{uniqueDays}</div>
            </div>
          </div>

          {/* All Entries - Card Layout */}
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>
                All Entries ({logs.length})
              </h4>
            </div>
            
            {logs.length === 0 ? (
              <div style={{ 
                border: isDark ? '2px dashed #475569' : '2px dashed #e2e8f0', 
                borderRadius: 12, 
                padding: 32, 
                textAlign: 'center',
                color: '#94a3b8'
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📷</div>
                <div style={{ fontSize: 14 }}>No entries yet. Use the form above to add your first shot log.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {logs.map((entry, idx) => (
                  <div 
                    key={`${entry.date}-${idx}`} 
                    style={{ 
                      border: isDark ? '1px solid #475569' : '1px solid #e2e8f0', 
                      borderRadius: 12, 
                      padding: 16,
                      background: isDark ? '#334155' : '#fff',
                      transition: 'box-shadow 0.2s',
                      cursor: 'pointer'
                    }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = isDark ? '0 4px 12px rgba(0,0,0,0.3)' : '0 4px 12px rgba(0,0,0,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
                    onClick={() => handleEditEntry(idx)}
                  >
                    {/* Row 1: Date, Shots, Camera Settings */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ 
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
                          color: '#fff', 
                          padding: '8px 12px', 
                          borderRadius: 8,
                          fontWeight: 600,
                          fontSize: 14
                        }}>
                          {entry.date}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ 
                            background: '#eff6ff', 
                            color: '#2563eb', 
                            padding: '4px 10px', 
                            borderRadius: 6,
                            fontWeight: 600,
                            fontSize: 13
                          }}>
                            {entry.count} shot{entry.count !== 1 ? 's' : ''}
                          </span>
                          {entry.aperture && (
                            <span style={{ color: '#64748b', fontSize: 13 }}>f/{entry.aperture}</span>
                          )}
                          {entry.shutter_speed && (
                            <span style={{ color: '#64748b', fontSize: 13 }}>{entry.shutter_speed}</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="fg-btn"
                          style={{ 
                            background: isDark ? '#1e293b' : '#fff', 
                            border: isDark ? '1px solid #64748b' : '1px solid #e2e8f0', 
                            color: isDark ? '#cbd5e1' : '#475569', 
                            padding: '6px 12px',
                            fontSize: 12
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditEntry(idx);
                          }}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="fg-btn"
                          style={{ 
                            background: isDark ? '#1e293b' : '#fff', 
                            border: '1px solid #fecaca', 
                            color: '#ef4444', 
                            padding: '6px 12px',
                            fontSize: 12
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Delete this log entry?')) handleRemoveIndex(idx);
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    
                    {/* Row 2: Lens */}
                    {(entry.lens || entry.focal_length) && (
                      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: '#94a3b8', fontSize: 12 }}>📷</span>
                        <span style={{ color: '#475569', fontSize: 13 }}>{entry.lens}{entry.focal_length ? ` @ ${entry.focal_length}mm` : ''}</span>
                      </div>
                    )}
                    
                    {/* Row 3: Location */}
                    {(entry.country || entry.city || entry.detail_location) && (
                      <div style={{ 
                        background: isDark ? '#1e293b' : '#f8fafc', 
                        borderRadius: 8, 
                        padding: 10,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                          <span style={{ fontSize: 14 }}>📍</span>
                          <div>
                            <div style={{ color: isDark ? '#f1f5f9' : '#1e293b', fontSize: 13, fontWeight: 500 }}>
                              {[entry.country, entry.city].filter(Boolean).join(' / ') || 'Unknown Location'}
                            </div>
                            {entry.detail_location && (
                              <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                                {entry.detail_location}
                              </div>
                            )}
                          </div>
                        </div>
                        {entry.latitude && entry.longitude && (
                          <div style={{ 
                            background: '#dcfce7', 
                            color: '#166534', 
                            padding: '4px 8px', 
                            borderRadius: 6,
                            fontSize: 11,
                            fontFamily: 'monospace'
                          }}>
                            {entry.latitude.toFixed(4)}, {entry.longitude.toFixed(4)}
                          </div>
                        )}
                      </div>
                    )}
                    
                    {/* No location indicator */}
                    {!entry.country && !entry.city && !entry.detail_location && (
                      <div style={{ 
                        color: '#94a3b8', 
                        fontSize: 12, 
                        fontStyle: 'italic',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span>📍</span>
                        <span>No location set - click Edit to add</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="fg-modal-footer" style={{ padding: 20, borderTop: isDark ? '1px solid #334155' : '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: 12, background: isDark ? '#1e293b' : '#fff', borderRadius: '0 0 8px 8px' }}>
          <button 
            type="button" 
            className="fg-btn" 
            onClick={onClose} 
            disabled={loading}
            style={{ background: isDark ? '#334155' : '#fff', border: isDark ? '1px solid #64748b' : '1px solid #cbd5e1', color: isDark ? '#f1f5f9' : '#475569', padding: '8px 20px' }}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="fg-btn fg-btn-primary" 
            onClick={handleSave} 
            disabled={loading}
            style={{ padding: '8px 24px' }}
          >
            {loading ? 'Saving...' : 'Save Logs'}
          </button>
        </div>
      </div>
      
      {/* Entry Edit Modal */}
      {editingEntry && (
        <EntryEditModal
          entry={editingEntry.entry}
          index={editingEntry.index}
          onSave={handleSaveEditedEntry}
          onClose={() => setEditingEntry(null)}
          countries={countries}
          citiesByCountry={citiesByCountry}
          lensOptions={lensOptions}
          nativeLenses={nativeLenses}
          adaptedLenses={adaptedLenses}
          fixedLensInfo={fixedLensInfo}
          cameraMount={cameraMount}
        />
      )}
    </div>
  );
}
