import React, { lazy, Suspense } from 'react';

/**
 * ImageViewer 的共享懒加载封装
 *
 * ImageViewer 静态依赖 FilmLab（WebGL 渲染链），体积大且仅在用户
 * 点开大图时才需要。全应用统一通过本组件引用，确保 ImageViewer
 * 及其依赖只存在于独立 chunk 中按需加载。
 */
const ImageViewer = lazy(() => import('../ImageViewer'));

export default function LazyImageViewer(props) {
  return (
    <Suspense fallback={null}>
      <ImageViewer {...props} />
    </Suspense>
  );
}
