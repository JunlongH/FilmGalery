import React, { useEffect, useState } from 'react';
import './ConflictBanner.css';

const ConflictBanner = () => {
  const [conflicts, setConflicts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    checkConflicts();
    // Check every 5 minutes
    const interval = setInterval(checkConflicts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const checkConflicts = async () => {
    try {
      const API_BASE = window.__electron?.API_BASE || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/conflicts`);
      const data = await res.json();
      if (data.hasConflicts && data.conflicts.length > 0) {
        setConflicts(data);
        setDismissed(false);
      } else {
        setConflicts(null);
      }
    } catch (err) {
      console.error('Failed to check conflicts:', err);
    }
  };

  const handleResolve = async () => {
    setLoading(true);
    try {
      const API_BASE = window.__electron?.API_BASE || 'http://localhost:4000';
      const res = await fetch(`${API_BASE}/api/conflicts/resolve`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.ok) {
        alert(`已成功合并 ${data.conflictsProcessed} 个冲突副本`);
        setConflicts(null);
        setDismissed(true);
      } else {
        alert('合并失败: ' + (data.error || '未知错误'));
      }
    } catch (err) {
      alert('合并请求失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
  };

  if (!conflicts || dismissed) return null;

  const totalRecordsToMerge = conflicts.conflicts.reduce((sum, c) => {
    const count = c.analysis?.reduce((s, a) => s + (a.toImport || 0) + (a.toUpdate || 0), 0) || 0;
    return sum + count;
  }, 0);

  return (
    <div className="conflict-banner">
      <div className="conflict-banner-content">
        <div className="conflict-icon">⚠️</div>
        <div className="conflict-info">
          <div className="conflict-title">检测到数据库冲突副本</div>
          <div className="conflict-details">
            发现 {conflicts.conflicts.length} 个OneDrive同步冲突文件
            {totalRecordsToMerge > 0 && ` (包含 ${totalRecordsToMerge} 条新记录)`}
          </div>
        </div>
        <div className="conflict-actions">
          <button 
            className="conflict-btn conflict-btn-resolve" 
            onClick={handleResolve}
            disabled={loading}
          >
            {loading ? '合并中...' : '自动合并'}
          </button>
          <button 
            className="conflict-btn conflict-btn-dismiss" 
            onClick={handleDismiss}
          >
            暂时忽略
          </button>
        </div>
      </div>
      <div className="conflict-details-list">
        {conflicts.conflicts.map((c, idx) => (
          <div key={idx} className="conflict-item">
            <span className="conflict-filename">{c.filename}</span>
            <span className="conflict-time">
              {new Date(c.mtime).toLocaleString()}
            </span>
            {c.analysis && c.analysis.map((a, i) => (
              a.needsMerge && (
                <span key={i} className="conflict-table-info">
                  {a.table}: {a.toImport || 0} 新增, {a.toUpdate || 0} 更新
                </span>
              )
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConflictBanner;
