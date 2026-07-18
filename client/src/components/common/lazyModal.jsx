import React, { lazy, Suspense, useEffect, useState } from 'react';

/**
 * 为低频重型模态框创建懒加载包装组件
 *
 * 保持与常规模态框相同的 `isOpen` 接口：
 * - 首次 isOpen=true 时才触发 chunk 加载并挂载内部组件
 * - 之后保持挂载（保留内部状态与开关动画）
 *
 * @param {Function} loader - 动态导入函数，例：
 *   () => import('./BatchExport') 或
 *   () => import('./BatchExport').then(m => ({ default: m.BatchRenderModal }))
 * @returns 懒加载包装组件
 */
export function lazyModal(loader) {
  const Component = lazy(loader);
  return function LazyModal({ isOpen, ...props }) {
    const [hasOpened, setHasOpened] = useState(false);
    useEffect(() => {
      if (isOpen) setHasOpened(true);
    }, [isOpen]);

    if (!hasOpened) return null;

    return (
      <Suspense fallback={null}>
        <Component isOpen={isOpen} {...props} />
      </Suspense>
    );
  };
}
