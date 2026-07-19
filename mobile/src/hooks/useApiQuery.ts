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

  const refresh = useCallback(() => {
    if (!key) return;
    setRefreshing(true);
    fetchQuery(key, () => fetcherRef.current(), 0)
      .catch(() => {})
      .finally(() => setRefreshing(false));
  }, [key]);

  const data = key ? getQueryData<T>(key) : undefined;
  const error = key ? getQueryError(key) : undefined;

  return {
    data,
    error: data === undefined ? error : undefined,
    loading: data === undefined && !error,
    refreshing,
    refresh,
  };
}
