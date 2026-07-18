/**
 * 导入外部正片模态框
 * 
 * @component ImportPositiveModal
 * @description 从外部软件导入处理好的正片并与底片匹配
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import MatchPreviewTable from './MatchPreviewTable';
import ManualMatchPanel from './ManualMatchPanel';
import {
  previewImport,
  updateManualMatch,
  executeImport,
  getImportProgress
} from '../../api';
import useIsDarkMode from '../../hooks/useIsDarkMode';

// ============================================================================
// 常量
// ============================================================================

const STRATEGY = {
  FILENAME: 'filename',
  FRAME: 'frame',
  MANUAL: 'manual'
};

const CONFLICT_RESOLUTION = {
  OVERWRITE: 'overwrite',
  SKIP: 'skip'
};

const STRATEGIES = [
  { id: STRATEGY.FILENAME, name: '文件名匹配', desc: '根据文件名匹配（推荐）', recommended: true },
  { id: STRATEGY.FRAME, name: '帧号顺序匹配', desc: '按文件排序顺序与帧号对应' },
  { id: STRATEGY.MANUAL, name: '手动匹配', desc: '手动指定每个文件对应的照片' }
];

// ============================================================================
// 主组件
// ============================================================================

export default function ImportPositiveModal({
  isOpen,
  onClose,
  rollId,
  rollName = '',
  onComplete
}) {
  const isDark = useIsDarkMode();
  // 步骤状态
  const [step, setStep] = useState('select'); // 'select' | 'preview' | 'importing' | 'done'
  
  // 文件选择
  const [filePaths, setFilePaths] = useState([]);
  const [inputPath, setInputPath] = useState('');
  
  // 匹配策略
  const [strategy, setStrategy] = useState(STRATEGY.FILENAME);
  
  // 匹配结果
  const [matches, setMatches] = useState([]);
  const [stats, setStats] = useState({ total: 0, matched: 0, conflict: 0, unmatched: 0 });
  const [unmatchedPhotos, setUnmatchedPhotos] = useState([]);
  
  // 手动匹配
  const [selectedFileIndex, setSelectedFileIndex] = useState(null);
  
  // 冲突处理
  const [conflictResolution, setConflictResolution] = useState(CONFLICT_RESOLUTION.OVERWRITE);
  
  // 导入状态
  // const [currentJobId, setCurrentJobId] = useState(null); // unused
  const [progress, setProgress] = useState({ completed: 0, total: 0, status: '' });
  const [importResult, setImportResult] = useState(null);
  
  // 加载状态
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // 重置状态
  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setFilePaths([]);
      setInputPath('');
      setStrategy(STRATEGY.FILENAME);
      setMatches([]);
      setStats({ total: 0, matched: 0, conflict: 0, unmatched: 0 });
      setUnmatchedPhotos([]);
      setSelectedFileIndex(null);
      setConflictResolution(CONFLICT_RESOLUTION.OVERWRITE);
      // setCurrentJobId(null);
      setProgress({ completed: 0, total: 0, status: '' });
      setImportResult(null);
      setError(null);
    }
  }, [isOpen]);
  
  // 选择文件/文件夹
  const handleSelectFiles = async () => {
    if (window.__electron && window.__electron.selectFiles) {
      const files = await window.__electron.selectFiles({ multiple: true });
      if (files && files.length > 0) {
        setFilePaths(files);
        setInputPath(files.length === 1 ? files[0] : `${files.length} 个文件`);
      }
    } else {
      // 浏览器环境使用输入框
      alert('请在输入框中输入文件路径，多个路径用分号分隔');
    }
  };
  
  const handleSelectFolder = async () => {
    if (window.__electron && window.__electron.selectDirectory) {
      const dir = await window.__electron.selectDirectory();
      if (dir) {
        setFilePaths([dir]);
        setInputPath(dir);
      }
    } else {
      alert('请在输入框中输入文件夹路径');
    }
  };
  
  // 解析输入路径
  const handleInputChange = (value) => {
    setInputPath(value);
    if (value.trim()) {
      // 支持分号分隔多个路径
      const paths = value.split(';').map(p => p.trim()).filter(Boolean);
      setFilePaths(paths);
    } else {
      setFilePaths([]);
    }
  };
  
  // 预览匹配
  const handlePreview = async () => {
    if (filePaths.length === 0) {
      setError('请先选择要导入的文件或文件夹');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const result = await previewImport(rollId, filePaths, strategy);
      
      if (result.success) {
        setMatches(result.matches);
        setStats(result.stats);
        setUnmatchedPhotos(result.unmatchedPhotos || []);
        setStep('preview');
      } else {
        setError(result.error || '预览失败');
      }
    } catch (e) {
      setError(e.message || '请求失败');
    } finally {
      setLoading(false);
    }
  };
  
  // 切换策略时重新预览
  const handleStrategyChange = async (newStrategy) => {
    setStrategy(newStrategy);
    
    if (step === 'preview' && filePaths.length > 0) {
      setLoading(true);
      try {
        const result = await previewImport(rollId, filePaths, newStrategy);
        if (result.success) {
          setMatches(result.matches);
          setStats(result.stats);
          setUnmatchedPhotos(result.unmatchedPhotos || []);
          setSelectedFileIndex(null);
        }
      } catch (e) {
        console.error('Preview failed:', e);
      } finally {
        setLoading(false);
      }
    }
  };
  
  // 手动匹配
  const handleManualMatch = async (fileIndex, photoId) => {
    setLoading(true);
    try {
      const result = await updateManualMatch(rollId, matches, fileIndex, photoId);
      if (result.success) {
        setMatches(result.matches);
        setStats(result.stats);
        setUnmatchedPhotos(result.unmatchedPhotos || []);
        if (photoId !== null) {
          setSelectedFileIndex(null); // 匹配成功后取消选择
        }
      }
    } catch (e) {
      console.error('Manual match failed:', e);
    } finally {
      setLoading(false);
    }
  };
  
  // 选择照片进行手动匹配
  const handleSelectPhoto = (photoId) => {
    if (selectedFileIndex !== null) {
      handleManualMatch(selectedFileIndex, photoId);
    }
  };
  
  // 执行导入
  const handleExecute = async () => {
    const importableCount = stats.matched + (conflictResolution === CONFLICT_RESOLUTION.OVERWRITE ? stats.conflict : 0);
    
    if (importableCount === 0) {
      setError('没有可导入的文件');
      return;
    }
    
    setLoading(true);
    setError(null);
    setStep('importing');
    
    try {
      const result = await executeImport(rollId, matches, conflictResolution);
      
      if (result.jobId) {
        // setCurrentJobId(result.jobId);
        setProgress({ completed: 0, total: result.total, status: 'processing' });
        
        // 轮询进度
        pollProgress(result.jobId);
      } else {
        setError(result.error || '启动导入失败');
        setStep('preview');
      }
    } catch (e) {
      setError(e.message || '请求失败');
      setStep('preview');
    } finally {
      setLoading(false);
    }
  };
  
  // 轮询 timer 引用：卸载时清理，避免弹窗关闭后轮询继续
  const pollTimerRef = useRef(null);

  // 轮询进度
  const pollProgress = useCallback(async (jid) => {
    try {
      const p = await getImportProgress(jid);
      setProgress({
        completed: p.completed,
        total: p.total,
        status: p.status,
        failed: p.failed,
        skipped: p.skipped
      });

      if (p.status === 'completed' || p.status === 'failed' || p.status === 'cancelled') {
        setStep('done');
        setImportResult(p);
        if (onComplete) {
          onComplete(p);
        }
      } else {
        pollTimerRef.current = setTimeout(() => pollProgress(jid), 500);
      }
    } catch (e) {
      console.error('Poll progress error:', e);
      pollTimerRef.current = setTimeout(() => pollProgress(jid), 1000);
    }
  }, [onComplete]);

  // 卸载时停止轮询
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, []);
  
  // 关闭
  const handleClose = () => {
    if (step === 'importing') {
      if (!window.confirm('导入正在进行中，确定要关闭吗？')) {
        return;
      }
    }
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
    buttonSecondaryText: isDark ? '#ECEDEE' : '#11181C',
    progressBg: isDark ? '#3f3f46' : '#e4e4e7'
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
        width: 650,
        maxWidth: '90vw',
        maxHeight: '85vh',
        overflow: 'auto'
      }}>
        {/* 标题栏 */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20
        }}>
          <h2 style={{ margin: 0, color: colors.text }}>
            导入外部正片
            {rollName && <span style={{ color: colors.textMuted, fontSize: 14, marginLeft: 8 }}>- {rollName}</span>}
          </h2>
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
        
        {/* 错误提示 */}
        {error && (
          <div style={{
            background: '#f4433620',
            border: '1px solid #f44336',
            borderRadius: 4,
            padding: 12,
            marginBottom: 16,
            color: '#f44336'
          }}>
            {error}
          </div>
        )}
        
        {/* 步骤内容 */}
        {step === 'select' && (
          <SelectStep
            inputPath={inputPath}
            onInputChange={handleInputChange}
            onSelectFiles={handleSelectFiles}
            onSelectFolder={handleSelectFolder}
            strategy={strategy}
            onStrategyChange={setStrategy}
            loading={loading}
            onPreview={handlePreview}
            onClose={handleClose}
            colors={colors}
          />
        )}
        
        {step === 'preview' && (
          <PreviewStep
            matches={matches}
            stats={stats}
            unmatchedPhotos={unmatchedPhotos}
            strategy={strategy}
            onStrategyChange={handleStrategyChange}
            selectedFileIndex={selectedFileIndex}
            onSelectFile={setSelectedFileIndex}
            onManualMatch={handleManualMatch}
            onSelectPhoto={handleSelectPhoto}
            conflictResolution={conflictResolution}
            onConflictResolutionChange={setConflictResolution}
            loading={loading}
            onBack={() => setStep('select')}
            onExecute={handleExecute}
            colors={colors}
          />
        )}
        
        {step === 'importing' && (
          <ImportingStep progress={progress} colors={colors} />
        )}
        
        {step === 'done' && (
          <DoneStep result={importResult} onClose={handleClose} colors={colors} />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 子步骤组件
// ============================================================================

function SelectStep({
  inputPath,
  onInputChange,
  onSelectFiles,
  onSelectFolder,
  strategy,
  onStrategyChange,
  loading,
  onPreview,
  onClose,
  colors
}) {
  const btnSecondaryStyle = getBtnSecondary(colors);
  const btnPrimaryStyle = getBtnPrimary(colors);
  
  return (
    <>
      {/* 选择文件 */}
      <Section title="选择文件" colors={colors}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={inputPath}
            onChange={e => onInputChange(e.target.value)}
            placeholder="输入路径或点击右侧按钮选择"
            style={{
              flex: 1,
              padding: '10px 12px',
              background: colors.inputBg,
              border: `1px solid ${colors.inputBorder}`,
              borderRadius: 4,
              color: colors.text
            }}
          />
          <button onClick={onSelectFolder} style={btnSecondaryStyle}>
            选择文件夹
          </button>
          <button onClick={onSelectFiles} style={btnSecondaryStyle}>
            选择文件
          </button>
        </div>
      </Section>
      
      {/* 匹配策略 */}
      <Section title="匹配策略" colors={colors}>
        {STRATEGIES.map(s => (
          <label
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              marginBottom: 8,
              cursor: 'pointer'
            }}
          >
            <input
              type="radio"
              checked={strategy === s.id}
              onChange={() => onStrategyChange(s.id)}
              style={{ marginTop: 3, accentColor: '#2196F3' }}
            />
            <div>
              <span style={{ color: colors.textSecondary }}>
                {s.name}
                {s.recommended && <span style={{ color: '#4CAF50', marginLeft: 4 }}>(推荐)</span>}
              </span>
              <div style={{ color: colors.textMuted, fontSize: 12 }}>{s.desc}</div>
            </div>
          </label>
        ))}
      </Section>
      
      {/* 按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 24 }}>
        <button onClick={onClose} style={btnSecondaryStyle}>取消</button>
        <button onClick={onPreview} disabled={loading} style={btnPrimaryStyle}>
          {loading ? '加载中...' : '预览匹配'}
        </button>
      </div>
    </>
  );
}

function PreviewStep({
  matches,
  stats,
  unmatchedPhotos,
  strategy,
  onStrategyChange,
  selectedFileIndex,
  onSelectFile,
  onManualMatch,
  onSelectPhoto,
  conflictResolution,
  onConflictResolutionChange,
  loading,
  onBack,
  onExecute,
  colors
}) {
  const isManualMode = strategy === STRATEGY.MANUAL;
  const importableCount = stats.matched + (conflictResolution === CONFLICT_RESOLUTION.OVERWRITE ? stats.conflict : 0);
  const btnSecondaryStyle = getBtnSecondary(colors);
  const btnPrimaryStyle = getBtnPrimary(colors);
  
  return (
    <>
      {/* 策略切换 */}
      <Section title="匹配策略" colors={colors}>
        <div style={{ display: 'flex', gap: 12 }}>
          {STRATEGIES.map(s => (
            <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
              <input
                type="radio"
                checked={strategy === s.id}
                onChange={() => onStrategyChange(s.id)}
                style={{ accentColor: '#2196F3' }}
              />
              <span style={{ color: colors.textSecondary, fontSize: 13 }}>{s.name}</span>
            </label>
          ))}
        </div>
      </Section>
      
      {/* 统计 */}
      <Section title={`匹配预览 (${stats.matched + stats.conflict}/${stats.total})`} colors={colors}>
        <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13 }}>
          <span style={{ color: '#4CAF50' }}>✓ 匹配: {stats.matched}</span>
          <span style={{ color: '#FF9800' }}>⚠ 冲突: {stats.conflict}</span>
          <span style={{ color: colors.textMuted }}>○ 未匹配: {stats.unmatched}</span>
        </div>
        
        <MatchPreviewTable
          matches={matches}
          unmatchedPhotos={unmatchedPhotos}
          isManualMode={isManualMode}
          onManualMatch={onManualMatch}
          selectedFileIndex={selectedFileIndex}
          onSelectFile={onSelectFile}
        />
      </Section>
      
      {/* 手动匹配面板 */}
      {isManualMode && (
        <Section title="选择底片" colors={colors}>
          <ManualMatchPanel
            unmatchedPhotos={unmatchedPhotos}
            selectedFileIndex={selectedFileIndex}
            onSelectPhoto={onSelectPhoto}
          />
        </Section>
      )}
      
      {/* 冲突处理 */}
      {stats.conflict > 0 && (
        <Section title={`冲突处理 (${stats.conflict} 张已有正片)`} colors={colors}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={conflictResolution === CONFLICT_RESOLUTION.OVERWRITE}
              onChange={() => onConflictResolutionChange(CONFLICT_RESOLUTION.OVERWRITE)}
              style={{ accentColor: '#2196F3' }}
            />
            <span style={{ color: colors.textSecondary }}>覆盖现有正片</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="radio"
              checked={conflictResolution === CONFLICT_RESOLUTION.SKIP}
              onChange={() => onConflictResolutionChange(CONFLICT_RESOLUTION.SKIP)}
              style={{ accentColor: '#2196F3' }}
            />
            <span style={{ color: colors.textSecondary }}>跳过已有正片</span>
          </label>
        </Section>
      )}
      
      {/* 按钮 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
        <button onClick={onBack} style={btnSecondaryStyle}>返回</button>
        <button 
          onClick={onExecute} 
          disabled={loading || importableCount === 0} 
          style={{
            ...btnPrimaryStyle,
            background: importableCount === 0 ? colors.textMuted : '#4CAF50'
          }}
        >
          {loading ? '处理中...' : `导入 ${importableCount} 张`}
        </button>
      </div>
    </>
  );
}

function ImportingStep({ progress, colors }) {
  const percent = progress.total > 0 ? (progress.completed / progress.total * 100) : 0;
  
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>📥</div>
      <div style={{ color: colors.text, fontSize: 18, marginBottom: 20 }}>
        正在导入...
      </div>
      
      {/* 进度条 */}
      <div style={{
        width: '100%',
        height: 8,
        background: colors.progressBg,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 12
      }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: '#4CAF50',
          transition: 'width 0.3s'
        }} />
      </div>
      
      <div style={{ color: colors.textMuted }}>
        {progress.completed} / {progress.total}
      </div>
    </div>
  );
}

function DoneStep({ result, onClose, colors }) {
  const isSuccess = result?.status === 'completed';
  const btnPrimaryStyle = getBtnPrimary(colors);
  
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 48, marginBottom: 16 }}>
        {isSuccess ? '✅' : '⚠️'}
      </div>
      <div style={{ color: colors.text, fontSize: 18, marginBottom: 20 }}>
        {isSuccess ? '导入完成' : '导入结束'}
      </div>
      
      {result && (
        <div style={{ color: colors.textMuted, marginBottom: 20 }}>
          <div>成功: {result.completed} 张</div>
          {result.failed > 0 && <div style={{ color: '#f44336' }}>失败: {result.failed} 张</div>}
          {result.skipped > 0 && <div>跳过: {result.skipped} 张</div>}
        </div>
      )}
      
      <button onClick={onClose} style={btnPrimaryStyle}>
        关闭
      </button>
    </div>
  );
}

// ============================================================================
// 辅助组件和样式
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

const getBtnSecondary = (colors) => ({
  padding: '10px 16px',
  background: colors?.buttonSecondary || '#333',
  border: `1px solid ${colors?.inputBorder || '#333'}`,
  borderRadius: 6,
  color: colors?.buttonSecondaryText || '#fff',
  cursor: 'pointer'
});

const getBtnPrimary = (colors) => ({
  padding: '10px 24px',
  background: '#2196F3',
  border: 'none',
  borderRadius: 6,
  color: '#fff',
  cursor: 'pointer'
});
