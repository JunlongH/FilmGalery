/**
 * 数据预取管理器
 *
 * 应用启动后的闲时预取：提前加载用户大概率访问的静态/半静态数据。
 * - 队列管理避免请求拥堵
 * - 延迟执行避免阻塞首屏
 * - 预取 key 与实际 useQuery 消费 key 严格对齐（否则白请求）
 *
 * @version 2.0.0
 * @date 2026-07-17
 */

import { queryClient, CACHE_STRATEGIES } from './queryClient';
import { getFilms, getCameras, getLenses, getTags } from '../api';

// ============================================================================
// 预取管理器
// ============================================================================

class DataPrefetchManager {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.processDelay = 300; // 任务间隔(ms)
  }

  /**
   * 添加预取任务
   * @param {Object} task - 预取任务
   * @param {string[]} task.queryKey - 查询键
   * @param {Function} task.queryFn - 查询函数
   * @param {Object} task.options - 额外选项
   * @param {number} task.priority - 优先级 (0最高)
   */
  add(task) {
    // 检查是否已在队列中
    const exists = this.queue.some(
      t => JSON.stringify(t.queryKey) === JSON.stringify(task.queryKey)
    );

    if (exists) return;

    // 检查缓存是否已存在且新鲜
    const cached = queryClient.getQueryData(task.queryKey);
    const queryState = queryClient.getQueryState(task.queryKey);

    if (cached && queryState && !queryState.isStale) {
      return; // 缓存有效，跳过预取
    }

    this.queue.push({
      ...task,
      priority: task.priority ?? 5,
    });

    // 按优先级排序
    this.queue.sort((a, b) => a.priority - b.priority);

    if (!this.isProcessing) {
      this.process();
    }
  }

  /**
   * 处理预取队列
   */
  async process() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();

    try {
      await queryClient.prefetchQuery({
        queryKey: task.queryKey,
        queryFn: task.queryFn,
        staleTime: task.options?.staleTime ?? CACHE_STRATEGIES.DYNAMIC.staleTime,
        ...task.options,
      });

      if (process.env.NODE_ENV === 'development') {
        console.log('[Prefetch] Loaded:', task.queryKey.join('/'));
      }
    } catch (err) {
      console.warn('[Prefetch] Failed:', task.queryKey, err.message);
    }

    // 延迟处理下一个任务，避免阻塞主线程
    setTimeout(() => this.process(), this.processDelay);
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue = [];
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.isProcessing,
      pendingKeys: this.queue.map(t => t.queryKey.join('/')),
    };
  }
}

export const prefetchManager = new DataPrefetchManager();

// ============================================================================
// 启动预取
// ============================================================================

/**
 * 应用启动时预取常用数据
 * 延迟 3 秒执行避免影响首屏渲染。
 *
 * 注意：每个 queryKey 都必须有对应的 useQuery 消费者——
 * films:      FilmLibrary / NewRollForm
 * equipment:  EquipmentManager（['equipment', tab]）
 * tags:       App 侧边栏 / RollDetail / TagGallery
 */
export function prefetchCommonData() {
  setTimeout(() => {
    // 胶片列表（静态数据）
    prefetchManager.add({
      queryKey: ['films'],
      queryFn: getFilms,
      priority: 5,
      options: { staleTime: CACHE_STRATEGIES.STATIC.staleTime },
    });

    // 相机列表
    prefetchManager.add({
      queryKey: ['equipment', 'cameras'],
      queryFn: () => getCameras({}),
      priority: 5,
      options: { staleTime: CACHE_STRATEGIES.STATIC.staleTime },
    });

    // 镜头列表
    prefetchManager.add({
      queryKey: ['equipment', 'lenses'],
      queryFn: () => getLenses({}),
      priority: 6,
      options: { staleTime: CACHE_STRATEGIES.STATIC.staleTime },
    });

    // 标签列表
    prefetchManager.add({
      queryKey: ['tags'],
      queryFn: getTags,
      priority: 6,
      options: { staleTime: CACHE_STRATEGIES.SEMI_STATIC.staleTime },
    });
  }, 3000);
}

export default prefetchManager;
