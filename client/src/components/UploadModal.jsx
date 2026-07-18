import React, { useState, useRef } from 'react';
import { uploadPhotoToRoll } from '../api';
import useIsDarkMode from '../hooks/useIsDarkMode';
import '../styles/forms.css';

// Theme-aware styles generator
const getStyles = (isDark) => ({
  modalOverlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.5)',
    zIndex: 99999,
    display: 'flex', alignItems: 'center', justifyContent: 'center'
  },
  modalPanel: {
    backgroundColor: isDark ? '#18181b' : '#ffffff',
    borderRadius: '12px',
    width: '600px',
    maxWidth: '90vw',
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: isDark ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    border: isDark ? '1px solid #27272a' : '1px solid #e4e4e7'
  },
  dropZone: {
    border: isDark ? '2px dashed #3f3f46' : '2px dashed #d4d4d8',
    borderRadius: '8px',
    padding: '40px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'all 0.2s',
    backgroundColor: isDark ? '#09090b' : '#fafafa',
    margin: '0 20px 20px'
  },
  fileList: {
    flex: 1,
    overflowY: 'auto',
    padding: '0 20px',
    minHeight: '100px',
    maxHeight: '300px'
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 12px',
    backgroundColor: isDark ? '#27272a' : '#f4f4f5',
    borderRadius: '6px',
    marginBottom: '8px',
    gap: '12px',
    fontSize: '13px'
  },
  progressBarContainer: {
    flex: 1,
    height: '6px',
    backgroundColor: isDark ? '#27272a' : '#e4e4e7',
    borderRadius: '3px',
    overflow: 'hidden',
    position: 'relative'
  },
  header: { 
    padding: '20px', 
    borderBottom: isDark ? '1px solid #27272a' : '1px solid #e4e4e7', 
    display: 'flex', 
    justifyContent: 'space-between', 
    alignItems: 'center' 
  },
  headerTitle: { 
    margin: 0, 
    fontSize: '18px', 
    color: isDark ? '#ECEDEE' : '#11181C' 
  },
  closeButton: { 
    background: 'none', 
    border: 'none', 
    color: isDark ? '#71717a' : '#a1a1aa', 
    cursor: 'pointer' 
  },
  typeSelector: { 
    padding: '20px', 
    display: 'flex', 
    gap: '12px' 
  },
  typeLabel: (isSelected, isUploading) => ({
    flex: 1, 
    padding: '12px', 
    borderRadius: '8px', 
    border: isSelected ? '2px solid #3b82f6' : (isDark ? '1px solid #27272a' : '1px solid #e4e4e7'),
    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
    cursor: isUploading ? 'not-allowed' : 'pointer',
    opacity: isUploading ? 0.6 : 1
  }),
  typeLabelTitle: (isSelected) => ({
    fontWeight: 600, 
    color: isSelected ? '#60a5fa' : (isDark ? '#ECEDEE' : '#11181C'), 
    marginBottom: 4
  }),
  typeLabelDesc: { 
    fontSize: '12px', 
    color: isDark ? '#71717a' : '#a1a1aa' 
  },
  dropZoneText: { 
    color: isDark ? '#a1a1aa' : '#71717a', 
    marginBottom: 8 
  },
  dropZoneHint: { 
    fontSize: '12px', 
    color: isDark ? '#52525b' : '#a1a1aa' 
  },
  fileName: { 
    color: isDark ? '#ECEDEE' : '#11181C', 
    overflow: 'hidden', 
    textOverflow: 'ellipsis', 
    whiteSpace: 'nowrap' 
  },
  fileSize: { 
    fontSize: '11px', 
    color: isDark ? '#71717a' : '#a1a1aa' 
  },
  footer: { 
    padding: '20px', 
    borderTop: isDark ? '1px solid #27272a' : '1px solid #e4e4e7', 
    display: 'flex', 
    flexDirection: 'column', 
    gap: 12 
  },
  progressText: { 
    fontSize: '12px', 
    color: isDark ? '#71717a' : '#a1a1aa', 
    minWidth: 60, 
    textAlign: 'right' 
  },
  statsText: { 
    fontSize: '13px', 
    color: isDark ? '#71717a' : '#a1a1aa' 
  },
  removeButton: { 
    background: 'none', 
    border: 'none', 
    color: isDark ? '#52525b' : '#a1a1aa', 
    cursor: 'pointer' 
  }
});

const progressBarStyle = (percent, color = '#3b82f6') => ({
  width: `${percent}%`,
  height: '100%',
  backgroundColor: color,
  transition: 'width 0.2s'
});

export default function UploadModal({ isOpen, onClose, rollId, onUploadComplete }) {
  const [files, setFiles] = useState([]);
  const [uploadType, setUploadType] = useState('positive');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  
  // Theme detection
  const isDark = useIsDarkMode();
  const styles = getStyles(isDark);
  
  // Stats
  const completedCount = files.filter(f => f.status === 'success').length;
  const failedCount = files.filter(f => f.status === 'error').length;
  const totalCount = files.length;
  const overallProgress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  if (!isOpen) return null;

  const handleFileSelect = (e) => {
    if (e.target.files) {
      addFiles(Array.from(e.target.files));
    }
    // reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addFiles = (newFiles) => {
    const queueItems = newFiles.map(f => ({
      id: Math.random().toString(36).substr(2, 9),
      file: f,
      status: 'pending', // pending, uploading, success, error
      progress: 0,
      error: null
    }));
    setFiles(prev => [...prev, ...queueItems]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const removeItem = (id) => {
    if (isUploading) return;
    setFiles(prev => prev.filter(item => item.id !== id));
  };

  const processQueue = async () => {
    setIsUploading(true);
    
    // Process strictly sequentially to avoid overwhelming server with heavyweight Image ops
    // We update state for each item
    
    // We need to work on a copy of the list that mirrors current state, 
    // but the loop needs access to live references or indices.
    // Easier strategy: iterate by index, check status.
    
    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (item.status === 'success') continue; // already done

      // Update status to uploading
      setFiles(prev => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'uploading', progress: 0 };
        return next;
      });

      try {
        // We don't have per-byte progress from fetch/api layer easily for single files yet
        // without custom XHR. For now, simulate or just jump to 100 on done.
        
        await uploadPhotoToRoll(rollId, item.file, { uploadType });
        
        setFiles(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'success', progress: 100 };
          return next;
        });
        
      } catch (err) {
        console.error('Upload failed', err);
        setFiles(prev => {
          const next = [...prev];
          const msg = err.message || 'Upload failed';
          next[i] = { ...next[i], status: 'error', error: msg };
          return next;
        });
      }
    }
    
    setIsUploading(false);
    if (files.every(f => f.status === 'success')) {
       // Optional: Auto close or show success message?
       // For now, let user see green checks then close manually
       if (onUploadComplete) onUploadComplete();
    } else {
       // Partial success, refresh anyway
       if (onUploadComplete) onUploadComplete();
    }
  };

  const clearQueue = () => {
    setFiles([]);
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose} onDragOver={e => e.preventDefault()} onDrop={handleDrop}>
      <div style={styles.modalPanel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.headerTitle}>Upload Photos</h2>
          <button onClick={onClose} style={styles.closeButton}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Type Selector */}
        <div style={styles.typeSelector}>
          {[
            { id: 'positive', label: 'Positive', desc: 'Processed JPGs' },
            { id: 'negative', label: 'Negative', desc: 'Film Scans' },
            { id: 'original', label: 'Original', desc: 'RAW / Backups' }
          ].map(type => (
            <label 
              key={type.id}
              style={styles.typeLabel(uploadType === type.id, isUploading)}
            >
              <input 
                type="radio" 
                name="uploadType" 
                value={type.id} 
                checked={uploadType === type.id} 
                onChange={e => setUploadType(e.target.value)}
                disabled={isUploading}
                style={{ display: 'none' }}
              />
              <div style={styles.typeLabelTitle(uploadType === type.id)}>{type.label}</div>
              <div style={styles.typeLabelDesc}>{type.desc}</div>
            </label>
          ))}
        </div>

        {/* Drop Zone */}
        {!isUploading && (
          <div 
            style={styles.dropZone}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            className="upload-dropzone"
          >
            <input 
              type="file" 
              multiple 
              onChange={handleFileSelect} 
              style={{ display: 'none' }} 
              ref={fileInputRef} 
            />
            <div style={styles.dropZoneText}>
              Click to browse or drag files here
            </div>
            <div style={styles.dropZoneHint}>
              Supports JPG, JPEG, TIFF, DNG, CR2, NEF, ARW...
            </div>
          </div>
        )}

        {/* File List */}
        {files.length > 0 && (
          <div style={styles.fileList}>
            {files.map((item, index) => (
              <div key={item.id} style={styles.fileItem}>
                <div style={{ width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {item.status === 'pending' && <span style={{color: isDark ? '#71717a' : '#a1a1aa'}}>•</span>}
                  {item.status === 'uploading' && <div className="spinner-sm" style={{borderColor: isDark ? '#fff' : '#3b82f6'}} />}
                  {item.status === 'success' && <span style={{color: '#4ade80'}}>✓</span>}
                  {item.status === 'error' && <span style={{color: '#ef4444'}}>✕</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={styles.fileName}>{item.file.name}</span>
                    <span style={styles.fileSize}>{(item.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  {item.error && <div style={{ fontSize: '11px', color: '#ef4444', marginTop: 2 }}>{item.error}</div>}
                  {item.status === 'uploading' && <div style={{ fontSize: '11px', color: isDark ? '#71717a' : '#a1a1aa', marginTop: 2 }}>Processing...</div>}
                </div>
                {!isUploading && item.status === 'pending' && (
                  <button onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} style={styles.removeButton}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={styles.footer}>
          {/* Progress Bar Area */}
          {isUploading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
               <div style={styles.progressBarContainer}>
                 <div style={progressBarStyle(overallProgress)} />
               </div>
               <div style={styles.progressText}>
                 {Math.round(overallProgress)}%
               </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div style={styles.statsText}>
               {files.length} files selected 
               {failedCount > 0 && <span style={{ color: '#ef4444', marginLeft: 8 }}>({failedCount} failed)</span>}
             </div>
             <div style={{ display: 'flex', gap: '12px' }}>
               {!isUploading && (
                 <button className="secondary-btn" onClick={clearQueue} disabled={files.length === 0}>Clear</button>
               )}
               {isUploading ? (
                 <button className="primary-btn" disabled style={{ opacity: 0.7 }}>
                   Uploading {completedCount}/{totalCount}
                 </button>
               ) : (
                 <button 
                  className="primary-btn" 
                  onClick={processQueue} 
                  disabled={files.length === 0 || files.every(f => f.status === 'success')}
                  style={{ backgroundColor: uploadType === 'positive' ? '#2563eb' : (uploadType === 'negative' ? '#ea580c' : '#7c3aed') }}
                >
                   Start Upload
                 </button>
               )}
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
