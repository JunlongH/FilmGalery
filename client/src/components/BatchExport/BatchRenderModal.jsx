/**
 * 批量渲染模态框
 * 
 * @component BatchRenderModal
 * @description 批量 FilmLab 渲染配置界面
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listLuts } from '../../api/luts';
import { getCacheStrategy } from '../../lib';
import BatchExportProgress from './BatchExportProgress';
import {
  createBatchRenderLibrary,
  createBatchRenderDownload,
  getBatchRenderProgress,
  cancelBatchRender,
  pauseBatchRender,
  resumeBatchRender,
  listPresets,
  getPhotos, // Added for hybrid mode
  getApiBase
} from '../../api';
import ComputeService from '../../services/ComputeService'; // Added for hybrid mode
import RemoteFileBrowser from '../common/RemoteFileBrowser'; // Added for remote path selection
import useIsDarkMode from '../../hooks/useIsDarkMode';

// ============================================================================
// 常量
// ============================================================================

const OUTPUT_MODE = {
  LIBRARY: 'library',
  DOWNLOAD: 'download'
};

const SCOPE = {
  SELECTED: 'selected',
  ALL: 'all',
  NO_POSITIVE: 'no-positive'
};

const PARAMS_SOURCE = {
  PRESET: 'preset',
  CUSTOM: 'custom',
  LUT: 'lut'
};

// ============================================================================
// 组件
// ============================================================================

export default function BatchRenderModal({
  isOpen,
  onClose,
  rollId,
  selectedPhotos = [],
  allPhotos = [],
  onComplete,
  onOpenFilmLab // 可选: 打开 FilmLab 调参
}) {
  const isDark = useIsDarkMode();
  // 状态
  const [outputMode, setOutputMode] = useState(OUTPUT_MODE.LIBRARY);
  const [outputDir, setOutputDir] = useState('');
  const [scope, setScope] = useState(SCOPE.SELECTED);
  const [paramsSource, setParamsSource] = useState(PARAMS_SOURCE.PRESET);
  const [selectedPresetId, setSelectedPresetId] = useState(null);
  const [customParams, setCustomParams] = useState(null);
  const [format, setFormat] = useState('jpeg');
  const [quality, setQuality] = useState(95);
  
  // LUT 状态
  // const [lutFile, setLutFile] = useState(null); // unused
  const [lutFileName, setLutFileName] = useState('');
  const [lutIntensity, setLutIntensity] = useState(1.0);
  
  // 预设列表
  const [presets, setPresets] = useState([]);
  
  // 任务状态
  const [jobId, setJobId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Local/Hybrid Processing State
  const [isLocalJob, setIsLocalJob] = useState(false);
  const localJobProgressRef = useRef({
    status: 'idle',
    total: 0, 
    completed: 0, 
    failed: 0, 
    current: 0
  });

  // Remote file browser state (for server path selection in hybrid mode)
  const [showRemoteBrowser, setShowRemoteBrowser] = useState(false);
  const [isRemoteMode, setIsRemoteMode] = useState(false);

  // Detect if we're in remote/hybrid mode on mount
  useEffect(() => {
    const checkRemoteMode = async () => {
      const caps = await ComputeService.getServerCapabilities();
      // If server is NAS mode, we're in remote/hybrid mode
      setIsRemoteMode(caps.mode === 'nas');
    };
    checkRemoteMode();
  }, []);

  // 模态框打开时重置 jobId
  useEffect(() => {
    if (isOpen) {
      setJobId(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);
  
  // 计算各范围的照片数量
  const counts = useMemo(() => {
    const noPositive = allPhotos.filter(p => !p.positive_rel_path);
    return {
      selected: selectedPhotos.length,
      all: allPhotos.length,
      noPositive: noPositive.length
    };
  }, [selectedPhotos, allPhotos]);
  
  // 加载预设
  useEffect(() => {
    if (isOpen) {
      listPresets().then(resp => {
        const data = resp?.presets || [];
        setPresets(data);
        if (data.length > 0 && !selectedPresetId) {
          setSelectedPresetId(data[0].id);
        }
      }).catch(e => console.error('Failed to load presets:', e));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);
  
  // 重置范围（如果没有选中照片）
  useEffect(() => {
    if (selectedPhotos.length === 0 && scope === SCOPE.SELECTED) {
      setScope(counts.noPositive > 0 ? SCOPE.NO_POSITIVE : SCOPE.ALL);
    }
  }, [selectedPhotos.length, scope, counts.noPositive]);
  
  // 选择输出目录
  const handleSelectDir = async () => {
    // In remote/hybrid mode when not in Electron, use remote file browser
    if (isRemoteMode && !window.__electron) {
      setShowRemoteBrowser(true);
      return;
    }
    
    if (window.__electron && window.__electron.selectDirectory) {
      // In Electron with local mode, use native dialog
      const dir = await window.__electron.selectDirectory();
      if (dir) setOutputDir(dir);
    } else if (isRemoteMode) {
      // Remote mode in browser
      setShowRemoteBrowser(true);
    } else {
      // Local browser fallback (dev mode)
      const dir = prompt('请输入输出目录路径:', outputDir || 'D:/Exports');
      if (dir) setOutputDir(dir);
    }
  };

  // Handle remote path selection
  const handleRemotePathSelect = (path) => {
    setOutputDir(path);
  };
  
  // 开始渲染
  const handleStart = async () => {
    if (isSubmitting) return;
    
    // 验证
    if (outputMode === OUTPUT_MODE.DOWNLOAD && !outputDir) {
      alert('请选择输出目录');
      return;
    }
    
    if (paramsSource === PARAMS_SOURCE.PRESET && !selectedPresetId) {
      alert('请选择预设');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // 构建参数
      let photoIds = scope === SCOPE.SELECTED 
        ? selectedPhotos.map(p => p.id)
        : undefined;
      
      const paramsSourceObj = (() => {
        switch (paramsSource) {
          case PARAMS_SOURCE.PRESET:
            return { type: 'preset', presetId: selectedPresetId };
          case PARAMS_SOURCE.CUSTOM:
            return { type: 'custom', params: customParams || {} };
          case PARAMS_SOURCE.LUT:
            return { type: 'lut', lutPath: lutFileName, lutIntensity: lutIntensity };
          default:
            return { type: 'preset', presetId: selectedPresetId };
        }
      })();
      
      // HYBRID MODE CHECK
      const isHybrid = ComputeService.isHybridMode();
      
      if (isHybrid) {
        setIsLocalJob(true);
        // Resolve photo IDs if not selected
        if (!photoIds) {
           // Fetch all photos for roll
           const rollPhotos = await getPhotos(rollId);
           if (rollPhotos && rollPhotos.value) {
             let eligible = rollPhotos.value;
             // Rough filter for NO_POSITIVE
             if (scope === SCOPE.NO_POSITIVE) {
               eligible = eligible.filter(p => !p.positive_rel_path); 
             }
             photoIds = eligible.map(p => p.id);
           } else {
             throw new Error('Failed to fetch roll photos for batch processing');
           }
        }
        
        if (!photoIds || photoIds.length === 0) {
           throw new Error('No photos to process');
        }

        // RESOLVE PARAMS locally
        let finalParams = {};
        if (paramsSource === PARAMS_SOURCE.PRESET) {
            const preset = presets.find(p => p.id === selectedPresetId);
            if (!preset) throw new Error('Preset not found');
            try {
                finalParams = typeof preset.params_json === 'string' ? JSON.parse(preset.params_json) : preset.params;
            } catch (e) {
                console.error('Failed to parse preset params', e);
                // Fallback to empty
            }
        } else if (paramsSource === PARAMS_SOURCE.CUSTOM) {
            finalParams = customParams;
        } else if (paramsSource === PARAMS_SOURCE.LUT) {
            // Apply LUT parameters structure that FilmLab expects
            finalParams = {
                lut: lutFileName,
                intensity: lutIntensity
            };
        }

        // Initialize local job
        setJobId('local-job-' + Date.now());
        localJobProgressRef.current = {
          status: 'processing',
          total: photoIds.length,
          completed: 0,
          failed: 0,
          current: 0
        };

        // Start processing in background (don't await)
        ComputeService.batchProcess(photoIds, finalParams, {
           format,
           outputDir: outputMode === OUTPUT_MODE.DOWNLOAD ? outputDir : undefined,
           uploadToServer: outputMode === OUTPUT_MODE.LIBRARY,
           onProgress: (p) => {
             localJobProgressRef.current = {
               status: 'processing',
               ...p
             };
           }
        }).then(res => {
           localJobProgressRef.current = {
             status: res.ok ? 'completed' : 'failed',
             ...localJobProgressRef.current
           };
        }).catch(err => {
           console.error('Local batch failed', err);
           localJobProgressRef.current = {
             status: 'failed',
             ...localJobProgressRef.current
           };
        });

      } else {
        // SERVER MODE (Original Logic)
        let result;
        if (outputMode === OUTPUT_MODE.LIBRARY) {
          result = await createBatchRenderLibrary({
            rollId,
            scope,
            photoIds,
            paramsSource: paramsSourceObj
          });
        } else {
          result = await createBatchRenderDownload({
            rollId,
            scope,
            photoIds,
            paramsSource: paramsSourceObj,
            outputDir,
            format,
            quality
          });
        }
        
        if (result.jobId) {
          setJobId(result.jobId);
        } else {
          throw new Error(result.error || 'Failed to create job');
        }
      }
    } catch (e) {
      console.error('Failed to start batch render:', e);
      alert('启动批量渲染失败: ' + e.message);
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
      // 有正在进行的任务，确认取消
      if (!window.confirm('任务正在进行中，确定要关闭吗？')) {
        return;
      }
      cancelBatchRender(jobId).catch(() => {});
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
    cardBg: isDark ? '#27272a' : '#f4f4f5',
    buttonSecondary: isDark ? '#27272a' : '#f4f4f5',
    buttonSecondaryText: isDark ? '#ECEDEE' : '#11181C'
  };
  
  return (
    <>
      {/* Remote File Browser Modal */}
      <RemoteFileBrowser
        isOpen={showRemoteBrowser}
        onClose={() => setShowRemoteBrowser(false)}
        onSelect={handleRemotePathSelect}
        mode="directory"
        title="选择输出目录 (服务器端)"
      />
      
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
            <h2 style={{ margin: 0, color: colors.text }}>批量渲染</h2>
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
            jobType="render"
            getProgress={isLocalJob ? () => Promise.resolve(localJobProgressRef.current) : getBatchRenderProgress}
            cancelJob={isLocalJob ? undefined : cancelBatchRender} // Allow local cancel later if needed
            pauseJob={isLocalJob ? undefined : pauseBatchRender}
            resumeJob={isLocalJob ? undefined : resumeBatchRender}
            onComplete={handleJobComplete}
          />
        ) : (
          <>
            {/* 输出模式 */}
            <Section title="输出模式" colors={colors}>
              <RadioGroup
                value={outputMode}
                onChange={setOutputMode}
                colors={colors}
                options={[
                  { value: OUTPUT_MODE.LIBRARY, label: '写入库 (更新正片和缩略图)' },
                  { value: OUTPUT_MODE.DOWNLOAD, label: '渲染后下载到本地' }
                ]}
              />
              
              {outputMode === OUTPUT_MODE.DOWNLOAD && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    value={outputDir}
                    onChange={e => setOutputDir(e.target.value)}
                    placeholder="输出目录"
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
                    label: `选中的照片 (${counts.selected} 张)`,
                    disabled: counts.selected === 0
                  },
                  { 
                    value: SCOPE.ALL, 
                    label: `所有照片 (${counts.all} 张)` 
                  },
                  { 
                    value: SCOPE.NO_POSITIVE, 
                    label: `仅无正片 (${counts.noPositive} 张)`,
                    disabled: counts.noPositive === 0
                  }
                ]}
              />
            </Section>
            
            {/* 处理参数 */}
            <Section title="处理参数" colors={colors}>
              <RadioGroup
                value={paramsSource}
                onChange={setParamsSource}
                colors={colors}
                options={[
                  { value: PARAMS_SOURCE.PRESET, label: '使用预设' },
                  { value: PARAMS_SOURCE.CUSTOM, label: '使用 FilmLab 调参', disabled: !onOpenFilmLab },
                  { value: PARAMS_SOURCE.LUT, label: '应用 LUT 文件' }
                ]}
              />
              
              {paramsSource === PARAMS_SOURCE.PRESET && (
                <div style={{ marginTop: 12 }}>
                  <select
                    value={selectedPresetId || ''}
                    onChange={e => setSelectedPresetId(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      background: colors.inputBg,
                      border: `1px solid ${colors.inputBorder}`,
                      borderRadius: 4,
                      color: colors.text
                    }}
                  >
                    {presets.length === 0 && (
                      <option value="">无可用预设</option>
                    )}
                    {presets.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              {paramsSource === PARAMS_SOURCE.CUSTOM && onOpenFilmLab && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => onOpenFilmLab((params) => setCustomParams(params))}
                    style={{
                      padding: '8px 16px',
                      background: '#2196F3',
                      border: 'none',
                      borderRadius: 4,
                      color: '#fff',
                      cursor: 'pointer'
                    }}
                  >
                    打开 FilmLab 调参...
                  </button>
                  {customParams && (
                    <div style={{ marginTop: 8, color: '#4CAF50', fontSize: 12 }}>
                      ✓ 已配置自定义参数
                    </div>
                  )}
                </div>
              )}
              
              {paramsSource === PARAMS_SOURCE.LUT && (
                <LutSelector
                  lutFileName={lutFileName}
                  lutIntensity={lutIntensity}
                  onLutSelect={(name) => setLutFileName(name)}
                  onIntensityChange={(v) => setLutIntensity(v)}
                  colors={colors}
                />
              )}
            </Section>
            
            {/* 输出设置 (仅下载模式) */}
            {outputMode === OUTPUT_MODE.DOWNLOAD && (
              <Section title="输出设置" colors={colors}>
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
                disabled={isSubmitting}
                style={{
                  padding: '10px 24px',
                  background: isSubmitting ? colors.textMuted : '#2196F3',
                  border: 'none',
                  borderRadius: 6,
                  color: '#fff',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer'
                }}
              >
                {isSubmitting ? '启动中...' : '开始渲染'}
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </>
  );
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

/**
 * LUT 选择器组件
 */
function LutSelector({ lutFileName, lutIntensity, onLutSelect, onIntensityChange, colors }) {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef(null);

  // LUT 列表走 React Query（STATIC 策略）：弹窗反复打开不再重复请求
  const { data: lutsData } = useQuery({
    queryKey: ['luts'],
    queryFn: listLuts,
    ...getCacheStrategy('luts'),
  });
  const luts = useMemo(() => lutsData?.luts || [], [lutsData]);

  const loadLuts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['luts'] }),
    [queryClient]
  );
  
  // 上传新 LUT 文件
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const ext = file.name.toLowerCase().split('.').pop();
    if (!['cube', '3dl', 'csp', 'lut'].includes(ext)) {
      alert('仅支持 .cube, .3dl, .csp, .lut 格式');
      return;
    }
    
    const formData = new FormData();
    formData.append('lut', file);
    
    try {
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/luts/upload`, {
        method: 'POST',
        body: formData
      });
      
      // 检查响应内容类型，避免解析 HTML 错误页面
      const contentType = res.headers.get('content-type');
      if (res.ok) {
        const data = await res.json();
        await loadLuts();
        onLutSelect(data.filename);
      } else {
        // 只有当响应是 JSON 时才尝试解析
        if (contentType && contentType.includes('application/json')) {
          const err = await res.json();
          alert('上传失败: ' + (err.error || '未知错误'));
        } else {
          alert('上传失败: 服务器错误 (' + res.status + ')');
        }
      }
    } catch (e) {
      console.error('Failed to upload LUT:', e);
      alert('上传失败: ' + e.message);
    }
    
    e.target.value = '';
  };
  
  return (
    <div style={{ marginTop: 12 }}>
      {/* LUT 选择 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <select
          value={lutFileName || ''}
          onChange={e => onLutSelect(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            background: colors?.inputBg || '#252525',
            border: `1px solid ${colors?.inputBorder || '#333'}`,
            borderRadius: 4,
            color: colors?.text || '#fff'
          }}
        >
          <option value="">选择 LUT 文件...</option>
          {luts.map(lut => (
            <option key={lut.name} value={lut.name}>{lut.name}</option>
          ))}
        </select>
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".cube,.3dl,.csp,.lut"
          onChange={handleUpload}
          style={{ display: 'none' }}
        />
        
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            padding: '8px 12px',
            background: colors?.inputBorder || '#333',
            border: 'none',
            borderRadius: 4,
            color: colors?.text || '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          上传 LUT
        </button>
      </div>
      
      {/* 强度滑块 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <label style={{ color: colors?.textMuted || '#888', fontSize: 12, minWidth: 40 }}>强度</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={lutIntensity}
          onChange={e => onIntensityChange(parseFloat(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ color: colors?.text || '#fff', fontSize: 12, minWidth: 40, textAlign: 'right' }}>
          {Math.round(lutIntensity * 100)}%
        </span>
      </div>
      
      {lutFileName && (
        <div style={{ marginTop: 8, color: '#4CAF50', fontSize: 12 }}>
          ✓ 已选择: {lutFileName}
        </div>
      )}
    </div>
  );
}
// Export RemoteFileBrowser for other components to use
export { default as RemoteFileBrowser } from '../common/RemoteFileBrowser';