/**
 * 批量下载模态框
 * 
 * @component BatchDownloadModal
 * @description 批量下载配置界面（下载现有正片/底片/原始）
 */

import React, { useState, useEffect, useMemo } from 'react';
import BatchExportProgress from './BatchExportProgress';
import {
  createBatchDownload,
  getBatchDownloadProgress,
  cancelBatchDownload,
  checkDownloadAvailability
} from '../../api';
import useIsDarkMode from '../../hooks/useIsDarkMode';

// ============================================================================
// 常量
// ============================================================================

const DOWNLOAD_TYPE = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  ORIGINAL: 'original'
};

const SCOPE = {
  SELECTED: 'selected',
  ALL: 'all'
};

const NAMING_PATTERNS = [
  { value: '{filename}', label: '原始文件名 (DSC_0001.jpg)' },
  { value: '{frame}_{filename}', label: '帧号_原始文件名 (01_DSC_0001.jpg)' },
  { value: '{date}_{frame}', label: '日期_帧号 (2025-01-14_01.jpg)' },
  { value: '{roll}_{frame}', label: '卷名_帧号 (Portra400_01.jpg)' }
];

// ============================================================================
// 组件
// ============================================================================

export default function BatchDownloadModal({
  isOpen,
  onClose,
  rollId,
  rollName = '',
  selectedPhotos = [],
  allPhotos = [],
  onComplete
}) {
  const isDark = useIsDarkMode();
  // 状态
  const [downloadType, setDownloadType] = useState(DOWNLOAD_TYPE.POSITIVE);
  const [outputDir, setOutputDir] = useState('');
  const [scope, setScope] = useState(SCOPE.SELECTED);
  const [includeExif, setIncludeExif] = useState(true);
  const [namingPattern, setNamingPattern] = useState('{filename}');
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(95);
  
  // 可用性检查
  const [availability, setAvailability] = useState(null);
  const [loadingAvailability, setLoadingAvailability] = useState(false);
  
  // 任务状态
  const [jobId, setJobId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 模态框打开时重置状态
  useEffect(() => {
    if (isOpen) {
      setJobId(null);
      setIsSubmitting(false);
      setAvailability(null);
    }
  }, [isOpen]);
  
  // 计算范围照片
  const scopedPhotos = useMemo(() => {
    return scope === SCOPE.SELECTED ? selectedPhotos : allPhotos;
  }, [scope, selectedPhotos, allPhotos]);
  
  // 检查可用性
  useEffect(() => {
    if (isOpen && scopedPhotos.length > 0 && rollId) {
      setLoadingAvailability(true);
      const photoIds = scopedPhotos.map(p => p.id);
      
      checkDownloadAvailability(rollId, downloadType, scope, photoIds)
        .then(data => setAvailability(data))
        .catch(e => {
          console.error('Failed to check availability:', e);
          setAvailability(null);
        })
        .finally(() => setLoadingAvailability(false));
    }
  }, [isOpen, scopedPhotos, downloadType, rollId, scope]);
  
  // 重置范围
  useEffect(() => {
    if (selectedPhotos.length === 0 && scope === SCOPE.SELECTED) {
      setScope(SCOPE.ALL);
    }
  }, [selectedPhotos.length, scope]);
  
  // 选择输出目录
  const handleSelectDir = async () => {
    if (window.__electron && window.__electron.selectDirectory) {
      const dir = await window.__electron.selectDirectory();
      if (dir) setOutputDir(dir);
    } else {
      const dir = prompt('请输入输出目录路径:', outputDir || 'D:/Downloads');
      if (dir) setOutputDir(dir);
    }
  };
  
  // 开始下载
  const handleStart = async () => {
    if (isSubmitting) return;
    
    if (!outputDir) {
      alert('请选择输出目录');
      return;
    }
    
    if (availability && availability.available === 0) {
      alert('没有可供下载的照片');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      const photoIds = scopedPhotos.map(p => p.id);
      
      const result = await createBatchDownload({
        rollId,
        scope,
        photoIds,
        type: downloadType,
        outputDir,
        exif: { enabled: includeExif },
        namingPattern
      });
      
      if (result.jobId) {
        setJobId(result.jobId);
      } else {
        throw new Error(result.error || 'Failed to create download job');
      }
    } catch (e) {
      console.error('Failed to start batch download:', e);
      alert('启动批量下载失败: ' + e.message);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // 任务完成
  const handleJobComplete = (progress) => {
    // 清除 jobId，返回配置界面
    setJobId(null);
    
    // 弹窗提示
    alert(`完成\n成功处理 ${progress.completed} / ${progress.total} 张照片`);
    
    if (onComplete) {
      onComplete(progress);
    }
  };
  
  // 关闭
  const handleClose = () => {
    if (jobId) {
      if (!window.confirm('下载正在进行中，确定要关闭吗？')) {
        return;
      }
      cancelBatchDownload(jobId).catch(() => {});
    }
    setJobId(null);
    onClose();
  };
  
  if (!isOpen) return null;
  
  // Theme-aware colors
  const colors = {
    overlay: isDark ? 'rgba(0,0,0,0.8)' : 'rgba(0,0,0,0.5)',
    modalBg: isDark ? '#18181b' : '#ffffff',
    modalBorder: isDark ? '#27272a' : '#e4e4e7',
    text: isDark ? '#ECEDEE' : '#11181C',
    textMuted: isDark ? '#71717a' : '#a1a1aa',
    textSecondary: isDark ? '#d4d4d8' : '#3f3f46',
    inputBg: isDark ? '#27272a' : '#f4f4f5',
    inputBorder: isDark ? '#3f3f46' : '#e4e4e7',
    buttonSecondary: isDark ? '#27272a' : '#f4f4f5',
    buttonSecondaryText: isDark ? '#ECEDEE' : '#11181C'
  };
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: colors.overlay,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div style={{
        background: colors.modalBg,
        border: `1px solid ${colors.modalBorder}`,
        borderRadius: 12,
        padding: 24,
        minWidth: 500,
        maxWidth: 600,
        maxHeight: '80vh',
        overflow: 'auto'
      }}>
        {/* 标题栏 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20
        }}>
          <h2 style={{ margin: 0, color: colors.text }}>批量下载</h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: colors.textMuted,
              fontSize: 24,
              cursor: 'pointer'
            }}
          >
            ×
          </button>
        </div>
        
        {/* 任务进行中显示进度 */}
        {jobId ? (
          <BatchExportProgress
            jobId={jobId}
            jobType="download"
            getProgress={getBatchDownloadProgress}
            cancelJob={cancelBatchDownload}
            onComplete={handleJobComplete}
          />
        ) : (
          <>
            {/* 下载类型 */}
            <Section title="下载类型" colors={colors}>
              <RadioGroup
                value={downloadType}
                onChange={setDownloadType}
                colors={colors}
                options={[
                  { value: DOWNLOAD_TYPE.POSITIVE, label: '正片 (渲染后的图像)' },
                  { value: DOWNLOAD_TYPE.NEGATIVE, label: '底片 (原始扫描)' },
                  { value: DOWNLOAD_TYPE.ORIGINAL, label: '原始文件 (保持原格式)' }
                ]}
              />
              
              {/* 可用性信息 */}
              {loadingAvailability ? (
                <div style={{ marginTop: 8, color: colors.textMuted, fontSize: 12 }}>
                  检查可用数量...
                </div>
              ) : availability && (
                <div style={{ 
                  marginTop: 8, 
                  fontSize: 12,
                  color: availability.available > 0 ? '#4CAF50' : '#f44336'
                }}>
                  可下载: {availability.available} / {availability.total} 张
                  {availability.available < availability.total && (
                    <span style={{ color: colors.textMuted, marginLeft: 8 }}>
                      ({availability.total - availability.available} 张文件不存在)
                    </span>
                  )}
                </div>
              )}
            </Section>
            
            {/* 照片范围 */}
            <Section title="照片范围" colors={colors}>
              <RadioGroup
                value={scope}
                onChange={setScope}
                colors={colors}
                options={[
                  { 
                    value: SCOPE.SELECTED, 
                    label: `选中的照片 (${selectedPhotos.length} 张)`,
                    disabled: selectedPhotos.length === 0
                  },
                  { 
                    value: SCOPE.ALL, 
                    label: `所有照片 (${allPhotos.length} 张)` 
                  }
                ]}
              />
            </Section>
            
            {/* 输出目录 */}
            <Section title="输出目录" colors={colors}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={outputDir}
                  onChange={e => setOutputDir(e.target.value)}
                  placeholder="选择保存位置"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    background: colors.inputBg,
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: 4,
                    color: colors.text
                  }}
                />
                <button
                  onClick={handleSelectDir}
                  style={{
                    padding: '8px 16px',
                    background: colors.buttonSecondary,
                    border: `1px solid ${colors.inputBorder}`,
                    borderRadius: 4,
                    color: colors.buttonSecondaryText,
                    cursor: 'pointer'
                  }}
                >
                  选择...
                </button>
              </div>
            </Section>
            
            {/* 命名规则 */}
            <Section title="命名规则" colors={colors}>
              <select
                value={namingPattern}
                onChange={e => setNamingPattern(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  background: colors.inputBg,
                  border: `1px solid ${colors.inputBorder}`,
                  borderRadius: 4,
                  color: colors.text
                }}
              >
                {NAMING_PATTERNS.map(p => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              
              {/* 命名预览 */}
              <div style={{ marginTop: 8, color: colors.textMuted, fontSize: 12 }}>
                预览: {generateNamingPreview(namingPattern, rollName)}
              </div>
            </Section>
            
            {/* EXIF 选项 (仅正片) */}
            {downloadType === DOWNLOAD_TYPE.POSITIVE && (
              <Section title="EXIF 元数据" colors={colors}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: 'pointer'
                }}>
                  <input
                    type="checkbox"
                    checked={includeExif}
                    onChange={e => setIncludeExif(e.target.checked)}
                    style={{ accentColor: '#2196F3' }}
                  />
                  <span style={{ color: colors.textSecondary }}>
                    写入 EXIF 元数据（相机、镜头、光圈、快门、ISO等）
                  </span>
                </label>
              </Section>
            )}
            
            {/* 格式设置 (仅正片) */}
            {downloadType === DOWNLOAD_TYPE.POSITIVE && (
              <Section title="输出格式" colors={colors}>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>
                      格式
                    </label>
                    <select
                      value={format}
                      onChange={e => setFormat(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        background: colors.inputBg,
                        border: `1px solid ${colors.inputBorder}`,
                        borderRadius: 4,
                        color: colors.text
                      }}
                    >
                      <option value="jpeg">JPEG</option>
                      <option value="tiff16">TIFF (16-bit)</option>
                    </select>
                  </div>
                  
                  {format === 'jpeg' && (
                    <div style={{ flex: 1 }}>
                      <label style={{ display: 'block', color: colors.textMuted, fontSize: 12, marginBottom: 4 }}>
                        质量
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={quality}
                        onChange={e => setQuality(Number(e.target.value))}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          background: colors.inputBg,
                          border: `1px solid ${colors.inputBorder}`,
                          borderRadius: 4,
                          color: colors.text
                        }}
                      />
                    </div>
                  )}
                </div>
              </Section>
            )}
            
            {/* 按钮 */}
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
              marginTop: 24
            }}>
              <button
                onClick={handleClose}
                style={{
                  padding: '10px 24px',
                  background: colors.inputBorder,
                  border: 'none',
                  borderRadius: 6,
                  color: colors.text,
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={handleStart}
                disabled={isSubmitting || (availability && availability.available === 0)}
                style={{
                  padding: '10px 24px',
                  background: (isSubmitting || (availability && availability.available === 0)) 
                    ? colors.textMuted : '#4CAF50',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: (isSubmitting || (availability && availability.available === 0)) 
                    ? 'not-allowed' : 'pointer'
                }}
              >
                {isSubmitting ? '启动中...' : '开始下载'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 辅助函数
// ============================================================================

function generateNamingPreview(pattern, rollName) {
  const example = {
    filename: 'DSC_0001',
    frame: '01',
    date: '2025-01-14',
    roll: rollName || 'Portra400'
  };
  
  return pattern
    .replace('{filename}', example.filename)
    .replace('{frame}', example.frame)
    .replace('{date}', example.date)
    .replace('{roll}', example.roll)
    + '.jpg';
}

// ============================================================================
// 子组件
// ============================================================================

function Section({ title, children, colors }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{
        color: colors?.textMuted || '#888',
        fontSize: 12,
        fontWeight: 600,
        marginBottom: 10,
        textTransform: 'uppercase'
      }}>
        ▼ {title}
      </div>
      {children}
    </div>
  );
}

function RadioGroup({ value, onChange, options, colors }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {options.map(opt => (
        <label
          key={opt.value}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: opt.disabled ? 'not-allowed' : 'pointer',
            opacity: opt.disabled ? 0.5 : 1
          }}
        >
          <input
            type="radio"
            checked={value === opt.value}
            onChange={() => !opt.disabled && onChange(opt.value)}
            disabled={opt.disabled}
            style={{ accentColor: '#2196F3' }}
          />
          <span style={{ color: colors?.textSecondary || '#ddd' }}>{opt.label}</span>
        </label>
      ))}
    </div>
  );
}
