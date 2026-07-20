import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * 从当前路由提取 AI 上下文，便于 AI 助手理解当前视图
 * 
 * 注意：AIPanel 渲染在 <Routes> 外部，不能使用 useParams()，
 * 因此通过 pathname 正则解析路由参数。
 * 
 * 返回:
 *   route          — 当前路径
 *   entityType     — 'roll' | 'film' | 'equipment' | 'tag' | 'overview' | ...
 *   entityId       — 当前实体 ID（如 roll id）
 *   filters        — URL search params 转成对象
 */
export function useAIContext() {
  const location = useLocation();

  return useMemo(() => {
    const path = location.pathname;
    const search = Object.fromEntries(new URLSearchParams(location.search));

    let entityType = 'overview';
    let entityId = null;

    // 从 pathname 解析参数（代替 useParams，因组件在 <Routes> 外部）
    const rollMatch = path.match(/^\/rolls\/(\d+)$/);
    const tagMatch = path.match(/^\/themes\/(\d+)$/);

    if (rollMatch) {
      entityType = 'roll';
      entityId = rollMatch[1];
    } else if (path === '/rolls' || path === '/rolls/new') {
      entityType = 'roll_list';
    } else if (path === '/films') {
      entityType = 'film_list';
    } else if (path === '/equipment') {
      entityType = 'equipment';
    } else if (tagMatch) {
      entityType = 'tag';
      entityId = tagMatch[1];
    } else if (path === '/themes') {
      entityType = 'tag_list';
    } else if (path === '/stats' || path === '/spending') {
      entityType = 'statistics';
    } else if (path === '/calendar') {
      entityType = 'calendar';
    } else if (path === '/map') {
      entityType = 'map';
    } else if (path === '/favorites') {
      entityType = 'favorites';
    }

    return {
      route: path,
      entityType,
      entityId,
      filters: search,
    };
  }, [location.pathname, location.search]);
}
