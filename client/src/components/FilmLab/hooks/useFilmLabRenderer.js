/**
 * useFilmLabRenderer Hook
 * 
 * 封装 FilmLabWebGL 渲染交互
 * 提供渲染控制、缓存管理和性能优化
 * 
 * 渲染路径：
 * 1. WebGL GPU 渲染（优先，最快）
 * 2. CPU 渲染（RenderCore，当 WebGL 不可用时）
 * 
 * @module hooks/useFilmLabRenderer
 * @since 2026-01-29
 * @updated 2026-01-31 - 添加完整的 CPU 渲染回退支持
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import FilmLabWebGL, { isWebGLAvailable, processImageWebGL, disposeWebGL } from '../FilmLabWebGL';
import { RenderCore } from '@filmgallery/shared';
import { stableSerializeParams } from '../utils';

// ============================================================================
// Constants
// ============================================================================

const PREVIEW_MAX_WIDTH = 2000;

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * FilmLab 渲染器 Hook
 * 
 * @param {Object} options - 配置选项
 * @param {HTMLCanvasElement} options.canvas - 目标画布
 * @param {HTMLImageElement} options.image - 源图像
 * @param {boolean} options.useGPU - 是否使用 GPU 渲染
 * @returns {Object} 渲染控制接口
 */
export function useFilmLabRenderer(options = {}) {
  const {
    canvas,
    image,
    useGPU = true,
  } = options;

  const [isRendering, setIsRendering] = useState(false);
  const [lastRenderTime, setLastRenderTime] = useState(0);
  const [renderError, setRenderError] = useState(null);
  const [webglAvailable] = useState(() => isWebGLAvailable());
  
  const renderQueueRef = useRef(null);
  const lastParamsRef = useRef(null);
  const frameRequestRef = useRef(null);
  const processedCanvasRef = useRef(null);

  /**
   * 检查 WebGL 是否可用
   */
  const canUseWebGL = useMemo(() => {
    return webglAvailable && useGPU;
  }, [webglAvailable, useGPU]);

  /**
   * 执行渲染
   */
  const doRender = useCallback((params) => {
    if (!canvas || !image) {
      return null;
    }

    const startTime = performance.now();
    setIsRendering(true);
    setRenderError(null);

    try {
      if (canUseWebGL) {
        // WebGL 渲染路径
        FilmLabWebGL.processImageWebGL(canvas, image, params);
        processedCanvasRef.current = canvas;
      } else {
        // CPU 渲染路径（使用 RenderCore）
        console.log('[useFilmLabRenderer] Using CPU rendering (RenderCore)');
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          // 设置 canvas 尺寸并绘制原始图像
          canvas.width = image.width;
          canvas.height = image.height;
          ctx.drawImage(image, 0, 0);
          
          // 使用 RenderCore 处理像素
          const core = new RenderCore(params);
          core.prepareLUTs();
          
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const length = data.length;
          
          for (let i = 0; i < length; i += 4) {
            // 跳过透明像素
            if (data[i + 3] === 0) continue;
            
            const [r, g, b] = core.processPixel(data[i], data[i + 1], data[i + 2]);
            data[i] = r;
            data[i + 1] = g;
            data[i + 2] = b;
          }
          
          ctx.putImageData(imageData, 0, 0);
          processedCanvasRef.current = canvas;
        }
      }

      const elapsed = performance.now() - startTime;
      setLastRenderTime(elapsed);
      // 存序列化快照而非浅拷贝（浅拷贝共享嵌套对象引用，原地修改会漏判）
      lastParamsRef.current = stableSerializeParams(params);

      return canvas;
    } catch (e) {
      console.error('[useFilmLabRenderer] Render error:', e);
      setRenderError(e.message || 'Render failed');
      return null;
    } finally {
      setIsRendering(false);
    }
  }, [canvas, image, canUseWebGL]);

  /**
   * 请求渲染（带防抖）
   */
  const requestRender = useCallback((params, options = {}) => {
    const { immediate = false, force = false } = options;

    // 检查参数是否变化（与序列化快照比较）
    if (!force && lastParamsRef.current !== null &&
        stableSerializeParams(params) === lastParamsRef.current) {
      return processedCanvasRef.current;
    }

    // 立即渲染
    if (immediate) {
      return doRender(params);
    }

    // 防抖渲染
    if (frameRequestRef.current) {
      cancelAnimationFrame(frameRequestRef.current);
    }

    renderQueueRef.current = params;
    
    frameRequestRef.current = requestAnimationFrame(() => {
      if (renderQueueRef.current) {
        doRender(renderQueueRef.current);
        renderQueueRef.current = null;
      }
    });

    return null;
  }, [doRender]);

  /**
   * 强制立即渲染
   */
  const renderNow = useCallback((params) => {
    return requestRender(params, { immediate: true, force: true });
  }, [requestRender]);

  /**
   * 清除缓存
   */
  const clearCache = useCallback(() => {
    processedCanvasRef.current = null;
    lastParamsRef.current = null;
  }, []);
  /**
   * 获取当前渲染结果
   */
  const getRenderedCanvas = useCallback(() => {
    return processedCanvasRef.current;
  }, []);

  /**
   * 读取渲染结果的像素数据
   */
  const readPixels = useCallback((x, y, width = 1, height = 1) => {
    if (!processedCanvasRef.current) {
      return null;
    }

    try {
      const ctx = processedCanvasRef.current.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      
      return ctx.getImageData(x, y, width, height);
    } catch (e) {
      console.error('[useFilmLabRenderer] readPixels error:', e);
      return null;
    }
  }, []);

  // 清理 — P0-2: 调用 disposeWebGL 释放 GL 资源（program + 6 张纹理 + buffer）
  // 旧实现只 cancelAnimationFrame，导致每次组件卸载/换图泄漏 GL 资源至页面卸载
  useEffect(() => {
    return () => {
      if (frameRequestRef.current) {
        cancelAnimationFrame(frameRequest.current);
      }
      // 释放 WebGL 资源（canvas 引用存在时）
      if (processedCanvasRef.current) {
        disposeWebGL(processedCanvasRef.current);
      }
    };
  }, []);

  // 当图像变化时清除缓存 + 释放旧 GL 资源
  // 注意：不在此处 disposeWebGL，因为同一 canvas 可能复用 program/纹理
  // clearCache 只清 JS 层缓存，GL 资源由组件卸载时统一释放
  useEffect(() => {
    clearCache();
  }, [image, clearCache]);

  return {
    // 状态
    isRendering,
    lastRenderTime,
    renderError,
    canUseWebGL,
    webglAvailable,
    
    // 渲染控制
    requestRender,
    renderNow,
    clearCache,
    
    // 数据访问
    getRenderedCanvas,
    readPixels,
  };
}

export default useFilmLabRenderer;
