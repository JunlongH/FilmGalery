/**
 * 批量导出进度组件
 * 
 * @component BatchExportProgress
 * @description 显示批量渲染/下载任务的进度
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 进度条组件
 */
function ProgressBar({ current, total, status }) {
  const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
  
  const getBarColor = () => {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'failed': return '#f44336';
      case 'cancelled': return '#9e9e9e';
      case 'paused': return '#ff9800';
      default: return '#2196F3';
    }
  };
  
  return (
    <div style={{
      width: '100%',
      height: 20,
      background: '#333',
      borderRadius: 10,
      overflow: 'hidden',
      marginBottom: 12
    }}>
      <div style={{
        width: `${percentage}%`,
        height: '100%',
        background: getBarColor(),
        transition: 'width 0.3s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {percentage > 10 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>
            {percentage}%
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 批量导出进度组件
 */
export default function BatchExportProgress({
  jobId,
  jobType = 'render', // 'render' | 'download'
  onProgress,
  onComplete,
  onCancel,
  onPause,
  onResume,
  getProgress, // (jobId) => Promise<progress>
  cancelJob,   // (jobId) => Promise
  pauseJob,    // (jobId) => Promise
  resumeJob,   // (jobId) => Promise
}) {
  const [progress, setProgress] = useState({
    status: 'processing',
    total: 0,
    completed: 0,
    failed: 0,
    current: null,
    failedItems: []
  });
  
  // 轮询 timer 引用：卸载时必须清理，避免组件销毁后继续轮询并对已卸载组件 setState
  const pollTimerRef = useRef(null);

  // 轮询进度
  const pollProgress = useCallback(async () => {
    if (!jobId || !getProgress) return;

    try {
      const data = await getProgress(jobId);
      setProgress(data);

      if (onProgress) {
        onProgress(data);
      }

      // 任务完成或终止 - 停止轮询，但不自动调用 onComplete
      // 让用户点击"完成"按钮来确认
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        return; // 停止轮询
      }

      // 继续轮询
      pollTimerRef.current = setTimeout(pollProgress, 500);
    } catch (e) {
      console.error('[BatchExportProgress] Poll error:', e);
      pollTimerRef.current = setTimeout(pollProgress, 2000);
    }
  }, [jobId, getProgress, onProgress]);

  useEffect(() => {
    if (jobId) {
      pollProgress();
    }
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [jobId, pollProgress]);
  
  const handleCancel = async () => {
    if (cancelJob) {
      await cancelJob(jobId);
      if (onCancel) onCancel();
    }
  };
  
  const handlePause = async () => {
    if (pauseJob) {
      await pauseJob(jobId);
      if (onPause) onPause();
    }
  };
  
  const handleResume = async () => {
    if (resumeJob) {
      await resumeJob(jobId);
      if (onResume) onResume();
    }
  };
  
  const isPaused = progress.status === 'paused';
  const isProcessing = progress.status === 'processing';
  const isComplete = progress.status === 'completed';
  const isFailed = progress.status === 'failed';
  const isCancelled = progress.status === 'cancelled';
  
  return (
    <div style={{
      background: '#1a1a1a',
      borderRadius: 8,
      padding: 20,
      minWidth: 400
    }}>
      {/* 标题 */}
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ margin: 0, color: '#fff' }}>
          {jobType === 'render' ? '批量渲染进度' : '批量下载进度'}
        </h3>
      </div>
      
      {/* 当前处理 */}
      {progress.current && (
        <div style={{
          padding: 10,
          background: '#252525',
          borderRadius: 6,
          marginBottom: 16
        }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>
            正在处理:
          </div>
          <div style={{ fontSize: 14, color: '#fff', fontFamily: 'monospace' }}>
            {progress.current.filename || `Photo #${progress.current.photoId}`}
          </div>
        </div>
      )}
      
      {/* 进度条 */}
      <ProgressBar 
        current={progress.completed + progress.failed}
        total={progress.total}
        status={progress.status}
      />
      
      {/* 统计 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 16,
        fontSize: 13
      }}>
        <span style={{ color: '#4CAF50' }}>
          ✓ 已完成: {progress.completed}
        </span>
        <span style={{ color: progress.failed > 0 ? '#f44336' : '#666' }}>
          ✗ 失败: {progress.failed}
        </span>
        <span style={{ color: '#888' }}>
          ○ 待处理: {Math.max(0, progress.total - progress.completed - progress.failed)}
        </span>
      </div>
      
      {/* 状态 */}
      {isComplete && (
        <div style={{
          padding: 10,
          background: '#1a3a1a',
          borderRadius: 6,
          marginBottom: 16,
          color: '#4CAF50',
          textAlign: 'center'
        }}>
          ✓ 任务完成！
        </div>
      )}
      
      {isFailed && (
        <div style={{
          padding: 10,
          background: '#3a1a1a',
          borderRadius: 6,
          marginBottom: 16,
          color: '#f44336',
          textAlign: 'center'
        }}>
          ✗ 任务失败
        </div>
      )}
      
      {isCancelled && (
        <div style={{
          padding: 10,
          background: '#2a2a2a',
          borderRadius: 6,
          marginBottom: 16,
          color: '#9e9e9e',
          textAlign: 'center'
        }}>
          任务已取消
        </div>
      )}
      
      {isPaused && (
        <div style={{
          padding: 10,
          background: '#3a2a1a',
          borderRadius: 6,
          marginBottom: 16,
          color: '#ff9800',
          textAlign: 'center'
        }}>
          任务已暂停
        </div>
      )}
      
      {/* 失败项列表 */}
      {progress.failedItems && progress.failedItems.length > 0 && (
        <div style={{
          marginBottom: 16,
          maxHeight: 100,
          overflow: 'auto',
          background: '#252525',
          borderRadius: 6,
          padding: 10
        }}>
          <div style={{ fontSize: 12, color: '#f44336', marginBottom: 8 }}>
            失败项:
          </div>
          {progress.failedItems.map((item, i) => (
            <div key={i} style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
              Photo #{item.photoId}: {item.error}
            </div>
          ))}
        </div>
      )}
      
      {/* 控制按钮 */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10
      }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {isProcessing && pauseJob && (
            <button
              onClick={handlePause}
              style={{
                padding: '8px 16px',
                background: '#ff9800',
                color: '#000',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              暂停
            </button>
          )}
          
          {isPaused && resumeJob && (
            <button
              onClick={handleResume}
              style={{
                padding: '8px 16px',
                background: '#4CAF50',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              继续
            </button>
          )}
          
          {(isProcessing || isPaused) && cancelJob && (
            <button
              onClick={handleCancel}
              style={{
                padding: '8px 16px',
                background: '#666',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer'
              }}
            >
              取消
            </button>
          )}
        </div>
        
        {(isComplete || isFailed || isCancelled) && (
          <button
            onClick={() => onComplete && onComplete(progress)}
            style={{
              padding: '8px 20px',
              background: '#2196F3',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            完成
          </button>
        )}
      </div>
    </div>
  );
}
