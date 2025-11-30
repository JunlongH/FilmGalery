import { useState, useEffect, useRef } from 'react';

// Simple in-memory set to remember which URIs finished at least once.
const loadedCache = new Set();

export function useCachedImage(uri) {
  const [loaded, setLoaded] = useState(loadedCache.has(uri));
  const [error, setError] = useState(null);
  const startTimeRef = useRef(Date.now());

  const onLoadEnd = () => {
    loadedCache.add(uri);
    setLoaded(true);
  };

  const onError = (e) => {
    setError(e?.nativeEvent || e);
  };

  // Expose simple metrics: first load duration
  const loadDuration = loaded ? Date.now() - startTimeRef.current : null;

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

export function isImageCached(uri) {
  return loadedCache.has(uri);
}
