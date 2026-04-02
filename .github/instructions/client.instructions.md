---
description: "Use when writing or modifying desktop client React components, hooks, API calls, or styling. Covers React Query patterns, HeroUI components, and Tailwind CSS usage."
applyTo: "client/src/**"
---
# Desktop 客户端开发规范

## 技术栈

- React 18 + React Router 7 + React Query 5
- HeroUI 2.8 组件库 + Tailwind CSS 4
- Framer Motion 动画 + Lucide 图标
- Craco 构建配置（CRA override）

## 组件模板

```jsx
import React, { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getResource } from '../api';

export default function ResourceList({ rollId }) {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['resources', rollId],
    queryFn: () => getResource(rollId),
    staleTime: 5 * 60 * 1000,
  });

  const handleClick = useCallback((id) => {
    // ...
  }, []);

  const filtered = useMemo(() =>
    data?.filter(item => item.name.includes(search)) ?? [],
    [data, search]
  );

  if (isLoading) return <Spinner />;

  return (
    <div className="flex flex-col gap-4 p-6">
      {filtered.map(item => (
        <Card key={item.id} onClick={() => handleClick(item.id)} />
      ))}
    </div>
  );
}
```

## API 客户端规范

- 所有 API 函数在 `client/src/api/` 按资源拆分文件
- 通过 `client/src/api/index.js` 聚合导出
- 使用 `jsonFetch()` 而非原生 fetch
- 图片 URL 必须用 `buildUploadUrl()` 构建
- `API_BASE` 从 `window.__electron.API_BASE` 或环境变量获取

## React Query 缓存策略

```
STATIC     — staleTime: Infinity   （films, equipment, luts）
SEMI_STATIC — staleTime: 30min     （locations, tags）
DYNAMIC    — staleTime: 5min       （rolls, photos）
REALTIME   — staleTime: 30sec      （uploads, exports）
```

新增查询时须在 `DATA_CACHE_MAP` 中配置对应策略。

## 关键约束

- 事件处理器用 `useCallback` 包装
- 昂贵计算用 `useMemo` 包装
- 组件文件名 PascalCase.jsx，工具文件 camelCase.js
- 样式使用 Tailwind utility classes，避免自定义 CSS
- 跨平台共享代码通过 `@filmgallery/shared` 别名导入
- UI 组件通过 `@ui` 别名导入
