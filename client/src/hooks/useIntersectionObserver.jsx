/**
 * useIntersectionObserver - 交叉观察器 Hook
 * 
 * 检测元素是否进入/离开视口
 * 用于懒加载、无限滚动等场景
 * 
 * @version 1.0.0
 * @date 2026-01-31
 */

import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * 交叉观察器 Hook
 * @param {Object} options - IntersectionObserver 选项
 * @param {string} [options.rootMargin='0px'] - 根边距
 * @param {number|number[]} [options.threshold=0] - 阈值
 * @param {boolean} [options.triggerOnce=false] - 是否只触发一次
 * @param {Function} [options.onChange] - 可见性变化回调
 * @returns {Object} { ref, isVisible, entry }
 * 
 * @example
 * const { ref, isVisible } = useIntersectionObserver({
 *   rootMargin: '100px',
 *   triggerOnce: true,
 * });
 * 
 * return (
 *   <div ref={ref}>
 *     {isVisible && <ExpensiveComponent />}
 *   </div>
 * );
 */
export function useIntersectionObserver(options = {}) {
  const {
    rootMargin = '0px',
    threshold = 0,
    triggerOnce = false,
    onChange,
  } = options;

  const [isVisible, setIsVisible] = useState(false);
  const [entry, setEntry] = useState(null);
  const elementRef = useRef(null);
  const observerRef = useRef(null);
  const frozenRef = useRef(false);

  const ref = useCallback((node) => {
    elementRef.current = node;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || frozenRef.current) return;

    const handleIntersection = (entries) => {
      const [entry] = entries;
      const visible = entry.isIntersecting;
      
      setEntry(entry);
      setIsVisible(visible);
      onChange?.(visible, entry);

      // 如果只触发一次且已可见，停止观察
      if (triggerOnce && visible) {
        frozenRef.current = true;
        observerRef.current?.disconnect();
      }
    };

    observerRef.current = new IntersectionObserver(handleIntersection, {
      rootMargin,
      threshold,
    });

    observerRef.current.observe(element);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [rootMargin, threshold, triggerOnce, onChange]);

  // 重置方法
  const reset = useCallback(() => {
    frozenRef.current = false;
    setIsVisible(false);
    setEntry(null);
  }, []);

  return { ref, isVisible, entry, reset };
}

export default useIntersectionObserver;
