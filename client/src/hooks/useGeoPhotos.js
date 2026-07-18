/**
 * useGeoPhotos.js
 * 
 * React hook for fetching photos with geographic coordinates.
 * Uses React Query for caching and automatic refetching.
 * 
 * @module hooks/useGeoPhotos
 */
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../api';

/**
 * Fetch geo-tagged photos from the API
 * 
 * @param {Object} options - Query options
 * @param {number} options.rollId - Filter by roll ID
 * @param {Object} options.dateRange - Filter by date range
 * @param {Object} options.bounds - Map bounds for viewport filtering
 * @param {number} options.limit - Maximum photos to fetch
 */
async function fetchGeoPhotos({ rollId, dateRange, limit = 2000 }) {
  const apiBase = API_BASE;
  const params = new URLSearchParams();
  
  if (limit) {
    params.append('limit', limit);
  }
  
  if (rollId) {
    params.append('roll_id', rollId);
  }
  
  if (dateRange?.start) {
    params.append('date_start', dateRange.start);
  }
  
  if (dateRange?.end) {
    params.append('date_end', dateRange.end);
  }
  
  const url = `${apiBase}/api/photos/geo?${params.toString()}`;
  
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to fetch geo photos: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data;
}

/**
 * useGeoPhotos Hook
 * 
 * Fetches and caches photos with geographic coordinates.
 * 
 * @param {Object} options - Query options
 * @returns {Object} - { photos, isLoading, error, total, refetch }
 */
export default function useGeoPhotos(options = {}) {
  const { rollId, dateRange, limit } = options;
  
  // 注意：bounds 不参与服务端过滤——地图采用"一次拉取 + 客户端筛选"策略，
  // 避免拖动视野时重复请求（bounds 变化不产生新 queryKey）。
  const queryKey = [
    'geoPhotos',
    rollId || 'all',
    dateRange?.start || '',
    dateRange?.end || '',
  ];
  
  const query = useQuery({
    queryKey,
    queryFn: () => fetchGeoPhotos({ rollId, dateRange, limit }),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    refetchOnWindowFocus: false,
    retry: 2,
  });
  
  return {
    photos: query.data?.photos || [],
    total: query.data?.total || 0,
    returned: query.data?.returned || 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}
