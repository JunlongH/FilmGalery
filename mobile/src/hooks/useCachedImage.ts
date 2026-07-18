import { useState, useEffect, useRef } from 'react';

const loadedCache = new Set<string>();

export interface CachedImageSource {
  uri: string;
}

export interface UseCachedImageResult {
  source: CachedImageSource | undefined;
  loaded: boolean;
  error: any;
  onLoadEnd: () => void;
  onError: (e: any) => void;
  loadDuration: number | null;
}

export function useCachedImage(uri: string): UseCachedImageResult {
  const [loaded, setLoaded] = useState<boolean>(loadedCache.has(uri));
  const [error, setError] = useState<any>(null);
  const startTimeRef = useRef<number>(Date.now());

  const onLoadEnd = () => {
    loadedCache.add(uri);
    setLoaded(true);
  };

  const onError = (e: any) => {
    setError(e?.nativeEvent || e);
  };

  const loadDuration: number | null = loaded ? Date.now() - startTimeRef.current : null;

  useEffect(() => {
    if (uri && loadedCache.has(uri) && !loaded) {
      setLoaded(true);
    }
  }, [uri]);

  return {
    source: uri ? { uri } : undefined,
    loaded,
    error,
    onLoadEnd,
    onError,
    loadDuration,
  };
}

export function isImageCached(uri: string): boolean {
  return loadedCache.has(uri);
}
