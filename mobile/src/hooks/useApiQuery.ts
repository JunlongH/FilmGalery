import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchQuery, getQueryData, getQueryError, subscribeQuery } from '../api/queryCache';

export interface UseApiQueryResult<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
  refreshing: boolean;
  refresh: () => void;
}

export function useQueryData<T>(key: string | null): T | undefined {
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!key) return;
    return subscribeQuery(key, () => forceRender((n) => n + 1));
  }, [key]);

  return key ? getQueryData<T>(key) : undefined;
}

export function useApiQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  ttl?: number,
): UseApiQueryResult<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [, forceRender] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!key) return;
    return subscribeQuery(key, () => forceRender((n) => n + 1));
  }, [key]);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetchQuery(key, () => fetcherRef.current(), ttl).catch(() => {
      if (!cancelled) forceRender((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key, ttl]);

  const data = key ? getQueryData<T>(key) : undefined;
  const error = key ? getQueryError(key) : undefined;

  // Refetch when data is missing without an error — covers the post-invalidation
  // case where invalidateQueries() wiped the cached entry. fetchQuery dedupes
  // via its in-flight promise cache, so this never doubles up with the mount
  // effect above.
  // Note: `data !== undefined` deliberately treats `null` as "loaded" — callers
  // that explicitly `setQueryData(key, null)` (e.g. to signal an empty result)
  // will NOT trigger a refetch, and `loading` stays false.
  useEffect(() => {
    if (!key || data !== undefined || error) return;
    let cancelled = false;
    fetchQuery(key, () => fetcherRef.current(), ttl).catch(() => {
      if (!cancelled) forceRender((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [key, data, error, ttl]);

  const refresh = useCallback(() => {
    if (!key) return;
    setRefreshing(true);
    fetchQuery(key, () => fetcherRef.current(), 0)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [key]);

  return {
    data,
    error: data === undefined ? error : undefined,
    loading: data === undefined && !error,
    refreshing,
    refresh,
  };
}
