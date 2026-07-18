import React from 'react';

/**
 * 路由级懒加载的兜底骨架（Suspense fallback）
 * 轻量 spinner，避免引入额外依赖
 */
export default function PageLoading() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[240px]">
      <div
        className="h-8 w-8 rounded-full border-2 border-zinc-200 dark:border-zinc-700 border-t-blue-600 dark:border-t-blue-500 animate-spin"
        role="status"
        aria-label="页面加载中"
      />
    </div>
  );
}
