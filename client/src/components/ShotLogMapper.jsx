import React, { useState, useMemo, useCallback } from 'react';
import ReactDOM from 'react-dom';

/**
 * ShotLogMapper - A visual interface for mapping shot logs to files
 * 
 * Design:
 * - Left panel: File list with thumbnails (sorted by name)
 * - Right panel: Shot log list with assignment controls
 * - Interaction: Click a log, then click files to assign (or drag log to file)
 * - Each log can be assigned to multiple files (up to its count)
 */
export default function ShotLogMapper({ onClose, onSave, files = [], shotLogs = [], initialAssignments = null }) {
  // Sort files by name to match NewRollForm behavior
  const sortedFiles = useMemo(() => 
    [...files].sort((a, b) => a.name.localeCompare(b.name)), 
    [files]
  );

  // Generate consistent colors for logs
  const logColors = useMemo(() => {
    const hues = [200, 150, 40, 280, 340, 80, 20, 180, 120, 320];
    return shotLogs.map((_, i) => `hsl(${hues[i % hues.length]}, 70%, 85%)`);
  }, [shotLogs]);

  // Assignment state: { [filename]: logIndex }
  const [assignments, setAssignments] = useState(() => {
    // Use previous assignments if available
    if (initialAssignments && Object.keys(initialAssignments).length > 0) {
      return { ...initialAssignments };
    }

    // Initialize with sequential assignment
    const initial = {};
    let fileIdx = 0;
    shotLogs.forEach((log, logIdx) => {
      const count = Number(log.count || log.shots || 0) || 1;
      for (let i = 0; i < count && fileIdx < sortedFiles.length; i++) {
        initial[sortedFiles[fileIdx].name] = logIdx;
        fileIdx++;
      }
    });
    return initial;
  });

  // Currently selected log for click-to-assign mode
  const [selectedLogIdx, setSelectedLogIdx] = useState(null);
  
  // Dragging state
  const [draggingLogIdx, setDraggingLogIdx] = useState(null);

  // Calculate how many times each log is assigned
  const assignmentCounts = useMemo(() => {
    const counts = shotLogs.map(() => 0);
    Object.values(assignments).forEach(logIdx => {
      if (logIdx !== null && logIdx !== undefined) {
        counts[logIdx]++;
      }
    });
    return counts;
  }, [assignments, shotLogs]);

  // Handle clicking a file to assign the selected log
  const handleFileClick = useCallback((filename) => {
    if (selectedLogIdx === null) return;
    
    const log = shotLogs[selectedLogIdx];
    const maxCount = Number(log.count || log.shots || 0) || 1;
    const currentCount = assignmentCounts[selectedLogIdx];
    
    // Check if this file is already assigned to this log (toggle off)
    if (assignments[filename] === selectedLogIdx) {
      setAssignments(prev => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
    } else if (currentCount < maxCount || assignments[filename] !== undefined) {
      // Assign if under limit or replacing existing
      setAssignments(prev => ({ ...prev, [filename]: selectedLogIdx }));
    }
  }, [selectedLogIdx, shotLogs, assignmentCounts, assignments]);

  // Handle dropping a log onto a file
  const handleFileDrop = useCallback((e, filename) => {
    e.preventDefault();
    if (draggingLogIdx === null) return;
    
    const log = shotLogs[draggingLogIdx];
    const maxCount = Number(log.count || log.shots || 0) || 1;
    const currentCount = assignmentCounts[draggingLogIdx];
    
    if (currentCount < maxCount || assignments[filename] !== undefined) {
      setAssignments(prev => ({ ...prev, [filename]: draggingLogIdx }));
    }
    setDraggingLogIdx(null);
  }, [draggingLogIdx, shotLogs, assignmentCounts, assignments]);

  // Auto-assign sequentially
  const autoSequential = useCallback(() => {
    const newAssignments = {};
    let fileIdx = 0;
    shotLogs.forEach((log, logIdx) => {
      const count = Number(log.count || log.shots || 0) || 1;
      for (let i = 0; i < count && fileIdx < sortedFiles.length; i++) {
        newAssignments[sortedFiles[fileIdx].name] = logIdx;
        fileIdx++;
      }
    });
    setAssignments(newAssignments);
  }, [shotLogs, sortedFiles]);

  // Reverse order assignment
  const autoReverse = useCallback(() => {
    const newAssignments = {};
    let fileIdx = 0;
    const reversedLogs = [...shotLogs].reverse();
    reversedLogs.forEach((log, i) => {
      const logIdx = shotLogs.length - 1 - i;
      const count = Number(log.count || log.shots || 0) || 1;
      for (let j = 0; j < count && fileIdx < sortedFiles.length; j++) {
        newAssignments[sortedFiles[fileIdx].name] = logIdx;
        fileIdx++;
      }
    });
    setAssignments(newAssignments);
  }, [shotLogs, sortedFiles]);

  // Clear all assignments
  const clearAll = useCallback(() => {
    setAssignments({});
    setSelectedLogIdx(null);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    const mapping = {};
    Object.entries(assignments).forEach(([filename, logIdx]) => {
      if (logIdx !== null && logIdx !== undefined && shotLogs[logIdx]) {
        const log = shotLogs[logIdx];
        mapping[filename] = {
          date: log.date || '',
          shot_time: log.shot_time || '',
          lens: log.lens || '',
          aperture: log.aperture,
          shutter_speed: log.shutter_speed || '',
          country: log.country || '',
          city: log.city || '',
          detail_location: log.detail_location || '',
          latitude: log.latitude,
          longitude: log.longitude,
          caption: log.caption || '',
          logIndex: logIdx
        };
      }
    });
    onSave(mapping);
    onClose();
  }, [assignments, shotLogs, onSave, onClose]);

  // Stats
  const totalAssigned = Object.keys(assignments).length;
  const totalFiles = sortedFiles.length;

  return ReactDOM.createPortal(
    <div style={styles.overlay}>
      <div style={styles.modal}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h3 style={{ margin: 0 }}>Map Shot Logs to Files</h3>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {selectedLogIdx !== null 
                ? `Click files to assign: ${shotLogs[selectedLogIdx]?.date || 'Selected log'}` 
                : 'Select a log on the right, then click files to assign'}
            </div>
          </div>
          <div style={styles.controls}>
            <span style={{ fontSize: 13, color: '#666', marginRight: 10 }}>
              {totalAssigned}/{totalFiles} files mapped
            </span>
            <button type="button" onClick={autoSequential} style={styles.btn}>顺序</button>
            <button type="button" onClick={autoReverse} style={styles.btn}>逆序</button>
            <button type="button" onClick={clearAll} style={styles.btn}>清除</button>
            <div style={styles.spacer} />
            <button type="button" onClick={onClose} style={styles.btnSecondary}>Cancel</button>
            <button type="button" onClick={handleSave} style={styles.btnPrimary}>Save</button>
          </div>
        </div>

        {/* Body: Two-column layout */}
        <div style={styles.body}>
          {/* Left Panel: Files */}
          <div style={styles.leftPanel}>
            <div style={styles.panelHeader}>Files ({sortedFiles.length})</div>
            <div style={styles.fileList}>
              {sortedFiles.map((file, idx) => {
                const assignedLogIdx = assignments[file.name];
                const isAssigned = assignedLogIdx !== undefined;
                const bgColor = isAssigned ? logColors[assignedLogIdx] : '#fff';
                
                return (
                  <div
                    key={file.name}
                    onClick={() => handleFileClick(file.name)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleFileDrop(e, file.name)}
                    style={{
                      ...styles.fileItem,
                      backgroundColor: bgColor,
                      border: selectedLogIdx !== null ? '2px dashed #0369a1' : '1px solid #ddd',
                      cursor: selectedLogIdx !== null ? 'pointer' : 'default'
                    }}
                  >
                    <span style={styles.fileIndex}>{idx + 1}</span>
                    {file.preview ? (
                      <img src={file.preview} alt="" style={styles.thumb} />
                    ) : (
                      <div style={styles.thumbPlaceholder}>IMG</div>
                    )}
                    <div style={styles.fileInfo}>
                      <div style={styles.fileName}>{file.name}</div>
                      {isAssigned && (
                        <div style={styles.fileAssignment}>
                          {shotLogs[assignedLogIdx]?.date || `Log ${assignedLogIdx + 1}`}
                          {shotLogs[assignedLogIdx]?.lens && ` · ${shotLogs[assignedLogIdx].lens}`}
                        </div>
                      )}
                    </div>
                    {isAssigned && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAssignments(prev => {
                            const next = { ...prev };
                            delete next[file.name];
                            return next;
                          });
                        }}
                        style={styles.clearBtn}
                        title="Remove assignment"
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Panel: Shot Logs */}
          <div style={styles.rightPanel}>
            <div style={styles.panelHeader}>Shot Logs ({shotLogs.length})</div>
            <div style={styles.logList}>
              {shotLogs.map((log, idx) => {
                const maxCount = Number(log.count || log.shots || 0) || 1;
                const currentCount = assignmentCounts[idx];
                const isSelected = selectedLogIdx === idx;
                const isFull = currentCount >= maxCount;
                
                return (
                  <div
                    key={idx}
                    draggable
                    onDragStart={() => setDraggingLogIdx(idx)}
                    onDragEnd={() => setDraggingLogIdx(null)}
                    onClick={() => setSelectedLogIdx(isSelected ? null : idx)}
                    style={{
                      ...styles.logItem,
                      backgroundColor: logColors[idx],
                      border: isSelected ? '3px solid #0369a1' : '1px solid #999',
                      opacity: isFull && !isSelected ? 0.6 : 1,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={styles.logHeader}>
                      <span style={styles.logDate}>{log.date || 'No date'}</span>
                      <span style={styles.logCount}>
                        {currentCount}/{maxCount}
                      </span>
                    </div>
                    <div style={styles.logDetails}>
                      {log.lens && <span>{log.lens}</span>}
                      {log.aperture && <span> f/{log.aperture}</span>}
                      {log.shutter_speed && <span> {log.shutter_speed}</span>}
                    </div>
                    <div style={styles.logLocation}>
                      {[log.city, log.detail_location].filter(Boolean).join(' · ') || '—'}
                    </div>
                    {log.caption && (
                      <div style={styles.logCaption}>
                        💬 {log.caption}
                      </div>
                    )}
                    {isSelected && (
                      <div style={styles.selectedBadge}>
                        SELECTED - Click files to assign
                      </div>
                    )}
                    {/* Quick assign buttons */}
                    <div style={styles.quickActions}>
                      <button
                        type="button"
                        style={styles.quickBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Assign to next N unassigned files
                          const remaining = maxCount - currentCount;
                          if (remaining <= 0) return;
                          const unassigned = sortedFiles
                            .filter(f => assignments[f.name] === undefined)
                            .slice(0, remaining);
                          if (unassigned.length === 0) return;
                          setAssignments(prev => {
                            const next = { ...prev };
                            unassigned.forEach(f => { next[f.name] = idx; });
                            return next;
                          });
                        }}
                        disabled={isFull}
                        title="Auto-fill remaining slots"
                      >
                        Auto-fill
                      </button>
                      <button
                        type="button"
                        style={styles.quickBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Clear all assignments for this log
                          setAssignments(prev => {
                            const next = { ...prev };
                            Object.keys(next).forEach(k => {
                              if (next[k] === idx) delete next[k];
                            });
                            return next;
                          });
                        }}
                        disabled={currentCount === 0}
                        title="Clear all assignments for this log"
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 12000,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center'
  },
  modal: {
    width: '95%',
    maxWidth: 1400,
    height: '90%',
    backgroundColor: '#fff',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 0 30px rgba(0,0,0,0.5)'
  },
  header: {
    padding: '15px 20px',
    borderBottom: '1px solid #ddd',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    flexShrink: 0
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  body: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden'
  },
  leftPanel: {
    flex: 2,
    display: 'flex',
    flexDirection: 'column',
    borderRight: '2px solid #ddd',
    overflow: 'hidden'
  },
  rightPanel: {
    flex: 1,
    minWidth: 320,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  panelHeader: {
    padding: '10px 15px',
    backgroundColor: '#e9ecef',
    fontWeight: 600,
    fontSize: 14,
    borderBottom: '1px solid #ddd',
    flexShrink: 0
  },
  fileList: {
    flex: 1,
    overflowY: 'auto',
    padding: 10
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px',
    marginBottom: 6,
    borderRadius: 6,
    transition: 'all 0.15s'
  },
  fileIndex: {
    width: 28,
    fontWeight: 600,
    color: '#666',
    fontSize: 12
  },
  thumb: {
    width: 40,
    height: 40,
    objectFit: 'cover',
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: '#ddd'
  },
  thumbPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 4,
    marginRight: 10,
    backgroundColor: '#ddd',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    color: '#666'
  },
  fileInfo: {
    flex: 1,
    minWidth: 0
  },
  fileName: {
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  fileAssignment: {
    fontSize: 11,
    color: '#0369a1',
    marginTop: 2
  },
  clearBtn: {
    width: 24,
    height: 24,
    border: 'none',
    borderRadius: '50%',
    backgroundColor: 'rgba(0,0,0,0.2)',
    color: '#fff',
    fontSize: 16,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8
  },
  logList: {
    flex: 1,
    overflowY: 'auto',
    padding: 10
  },
  logItem: {
    padding: 12,
    marginBottom: 8,
    borderRadius: 8,
    cursor: 'move',
    transition: 'all 0.15s'
  },
  logHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4
  },
  logDate: {
    fontWeight: 700,
    color: '#0369a1',
    fontSize: 14
  },
  logCount: {
    fontSize: 12,
    fontWeight: 600,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
    padding: '2px 8px',
    borderRadius: 10
  },
  logDetails: {
    fontSize: 12,
    color: '#333',
    marginBottom: 2
  },
  logLocation: {
    fontSize: 11,
    color: '#555',
    fontStyle: 'italic'
  },
  logCaption: {
    fontSize: 11,
    color: '#6366f1',
    marginTop: 2,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  selectedBadge: {
    marginTop: 8,
    padding: '4px 8px',
    backgroundColor: '#0369a1',
    color: '#fff',
    fontSize: 10,
    fontWeight: 600,
    borderRadius: 4,
    textAlign: 'center'
  },
  quickActions: {
    display: 'flex',
    gap: 6,
    marginTop: 8
  },
  quickBtn: {
    flex: 1,
    padding: '4px 8px',
    fontSize: 11,
    border: '1px solid rgba(0,0,0,0.2)',
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.7)',
    cursor: 'pointer'
  },
  btn: {
    padding: '6px 12px',
    cursor: 'pointer',
    backgroundColor: '#fff',
    border: '1px solid #ccc',
    borderRadius: 4,
    fontSize: 13
  },
  btnPrimary: {
    padding: '6px 16px',
    cursor: 'pointer',
    backgroundColor: '#007bff',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontWeight: 600,
    fontSize: 13
  },
  btnSecondary: {
    padding: '6px 12px',
    cursor: 'pointer',
    backgroundColor: '#6c757d',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    fontSize: 13
  },
  spacer: {
    width: 16
  }
};
