/**
 * LUT 选择器模态框
 * 
 * @component LutSelector
 * @description 从 LUT 库中选择 LUT 文件
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { listLuts, uploadLut, loadLutFromLibrary } from '../../api';
import useIsDarkMode from '../../hooks/useIsDarkMode';

// ============================================================================
// 样式 - 支持亮色/暗色模式
// ============================================================================

const getStyles = (isDark) => ({
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000
  },
  modal: {
    background: isDark ? '#18181b' : '#ffffff',
    borderRadius: 12,
    width: '90%',
    maxWidth: 700,
    maxHeight: '80vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: isDark ? '1px solid #27272a' : '1px solid #e4e4e7'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: isDark ? '1px solid #27272a' : '1px solid #e4e4e7'
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: isDark ? '#ECEDEE' : '#11181C',
    margin: 0
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: isDark ? '#71717a' : '#a1a1aa',
    fontSize: 24,
    cursor: 'pointer',
    padding: 4
  },
  toolbar: {
    display: 'flex',
    gap: 8,
    padding: '12px 20px',
    borderBottom: isDark ? '1px solid #27272a' : '1px solid #e4e4e7',
    alignItems: 'center'
  },
  searchInput: {
    flex: 1,
    padding: '8px 12px',
    background: isDark ? '#27272a' : '#f4f4f5',
    border: isDark ? '1px solid #3f3f46' : '1px solid #e4e4e7',
    borderRadius: 6,
    color: isDark ? '#ECEDEE' : '#11181C',
    fontSize: 14
  },
  uploadBtn: {
    padding: '8px 16px',
    background: isDark ? '#27272a' : '#f4f4f5',
    color: isDark ? '#ECEDEE' : '#11181C',
    border: isDark ? '1px solid #3f3f46' : '1px solid #e4e4e7',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 20
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 12
  },
  card: {
    background: isDark ? '#27272a' : '#f4f4f5',
    borderRadius: 8,
    padding: 12,
    cursor: 'pointer',
    border: '2px solid transparent',
    transition: 'border-color 0.2s'
  },
  cardSelected: {
    borderColor: '#4a9eff'
  },
  cardHover: {
    borderColor: isDark ? '#52525b' : '#d4d4d8'
  },
  lutName: {
    fontSize: 13,
    fontWeight: 500,
    color: isDark ? '#ECEDEE' : '#11181C',
    marginBottom: 4,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  lutInfo: {
    fontSize: 11,
    color: isDark ? '#71717a' : '#a1a1aa'
  },
  preview: {
    width: '100%',
    height: 40,
    borderRadius: 4,
    marginTop: 8
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 12,
    padding: '16px 20px',
    borderTop: isDark ? '1px solid #27272a' : '1px solid #e4e4e7'
  },
  btn: {
    padding: '10px 24px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500
  },
  btnPrimary: {
    background: '#4a9eff',
    color: '#fff'
  },
  btnSecondary: {
    background: isDark ? '#27272a' : '#f4f4f5',
    color: isDark ? '#ECEDEE' : '#11181C',
    border: isDark ? '1px solid #3f3f46' : '1px solid #e4e4e7'
  },
  emptyState: {
    textAlign: 'center',
    padding: 40,
    color: isDark ? '#71717a' : '#a1a1aa'
  },
  loading: {
    textAlign: 'center',
    padding: 40,
    color: isDark ? '#71717a' : '#a1a1aa'
  },
  builtInBadge: {
    display: 'inline-block',
    padding: '1px 4px',
    background: '#2d5a1d',
    color: '#8bc34a',
    borderRadius: 3,
    fontSize: 9,
    marginLeft: 4
  }
});

// 生成 LUT 预览渐变
function generatePreviewGradient(lutName) {
  const hash = lutName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash * 2) % 360;
  
  return `linear-gradient(135deg, 
    hsl(${hue1}, 40%, 20%) 0%, 
    hsl(${(hue1 + hue2) / 2}, 50%, 40%) 50%, 
    hsl(${hue2}, 40%, 60%) 100%)`;
}

// ============================================================================
// LUT 卡片组件
// ============================================================================

function LutCard({ lut, selected, onClick, styles }) {
  const [hover, setHover] = useState(false);
  const isBuiltIn = lut.name.startsWith('FilmGallery_');
  
  return (
    <div 
      style={{ 
        ...styles.card, 
        ...(selected ? styles.cardSelected : {}),
        ...(hover && !selected ? styles.cardHover : {})
      }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div style={styles.lutName}>
        {lut.name.replace(/\.(cube|3dl|csp|lut)$/i, '')}
        {isBuiltIn && <span style={styles.builtInBadge}>内置</span>}
      </div>
      <div style={styles.lutInfo}>{lut.type}</div>
      <div 
        style={{ 
          ...styles.preview, 
          background: generatePreviewGradient(lut.name)
        }} 
      />
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function LutSelectorModal({ onClose, onSelect, currentLutName }) {
  const [luts, setLuts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState(currentLutName || null);
  const [search, setSearch] = useState('');
  const [applying, setApplying] = useState(false);
  const fileInputRef = useRef(null);
  
  // Theme detection
  const isDark = useIsDarkMode();
  const styles = getStyles(isDark);
  
  // 加载 LUT 列表
  useEffect(() => {
    loadLuts();
    setSelected(currentLutName || null);
  }, [currentLutName]);
  
  const loadLuts = async () => {
    setLoading(true);
    try {
      const data = await listLuts();
      setLuts(data.luts || []);
    } catch (e) {
      console.error('Failed to load LUTs:', e);
    } finally {
      setLoading(false);
    }
  };
  
  // 上传 LUT
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['cube', '3dl', 'csp', 'lut'].includes(ext)) {
      alert('仅支持 .cube, .3dl, .csp, .lut 格式');
      return;
    }
    
    setUploading(true);
    try {
      const result = await uploadLut(file);
      await loadLuts();
      setSelected(result.filename);
    } catch (e) {
      console.error('Failed to upload LUT:', e);
      alert('上传失败: ' + e.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };
  
  // 应用选中的 LUT
  const handleApply = async () => {
    if (!selected) {
      onClose();
      return;
    }
    
    setApplying(true);
    try {
      const lutData = await loadLutFromLibrary(selected);
      onSelect({
        name: selected,
        size: lutData.size,
        data: lutData.data,
        intensity: 1.0
      });
      onClose();
    } catch (e) {
      console.error('Failed to load LUT:', e);
      alert('加载 LUT 失败: ' + e.message);
    } finally {
      setApplying(false);
    }
  };
  
  // 清除 LUT
  const handleClear = () => {
    onSelect(null);
    onClose();
  };
  
  // 过滤 LUT
  const filteredLuts = luts.filter(lut => 
    lut.name.toLowerCase().includes(search.toLowerCase())
  );
  
  // 不再检查isOpen - 由父组件控制渲染
  // 使用Portal渲染到body，避免被父容器overflow影响
  return ReactDOM.createPortal(
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.header}>
          <h2 style={styles.title}>选择 LUT</h2>
          <button style={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        
        <div style={styles.toolbar}>
          <input
            type="text"
            placeholder="搜索 LUT..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={styles.searchInput}
          />
          <label style={{ ...styles.uploadBtn, opacity: uploading ? 0.7 : 1 }}>
            {uploading ? '上传中...' : '上传'}
            <input
              ref={fileInputRef}
              type="file"
              accept=".cube,.3dl,.csp,.lut"
              onChange={handleUpload}
              style={{ display: 'none' }}
              disabled={uploading}
            />
          </label>
        </div>
        
        <div style={styles.content}>
          {loading ? (
            <div style={styles.loading}>加载中...</div>
          ) : filteredLuts.length === 0 ? (
            <div style={styles.emptyState}>
              {search ? '未找到匹配的 LUT' : '暂无 LUT 文件，请上传'}
            </div>
          ) : (
            <div style={styles.grid}>
              {filteredLuts.map(lut => (
                <LutCard
                  key={lut.name}
                  lut={lut}
                  selected={selected === lut.name}
                  onClick={() => setSelected(lut.name)}
                  styles={styles}
                />
              ))}
            </div>
          )}
        </div>
        
        <div style={styles.footer}>
          {currentLutName && (
            <button 
              style={{ ...styles.btn, ...styles.btnSecondary, marginRight: 'auto' }}
              onClick={handleClear}
            >
              清除 LUT
            </button>
          )}
          <button 
            style={{ ...styles.btn, ...styles.btnSecondary }}
            onClick={onClose}
          >
            取消
          </button>
          <button 
            style={{ ...styles.btn, ...styles.btnPrimary, opacity: applying ? 0.7 : 1 }}
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? '加载中...' : '应用'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
