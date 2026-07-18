/**
 * 库模块统一导出
 * 
 * @version 1.1.0
 */

export { 
  queryClient, 
  CACHE_STRATEGIES,
  DATA_CACHE_MAP,
  getCacheStrategy,
  isElectron,
  isDevelopment
} from './queryClient';

export {
  prefetchManager,
  prefetchCommonData
} from './dataPrefetch';
