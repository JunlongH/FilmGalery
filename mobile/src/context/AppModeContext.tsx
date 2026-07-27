import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from './ApiContext';

export type AppMode = 'film' | 'digital';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
  hydrated: boolean;
}

const AppModeContext = createContext<AppModeContextValue>({
  mode: 'film',
  setMode: () => {},
  hydrated: false,
});

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useContext(ApiContext);
  const [mode, setModeState] = useState<AppMode>('film');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!baseUrl) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    setHydrated(false);
    // NOTE: changing baseUrl orphans the saved mode under the old key;
    // user silently resets to 'film' and self-heals on re-toggle.
    // Accepted per audit D-P3-4 option (b).
    AsyncStorage.getItem(`library_mode@${baseUrl}`)
      .then((saved) => {
        if (cancelled) return;
        setModeState(saved === 'digital' ? 'digital' : 'film');
        setHydrated(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[AppMode] Failed to load persisted mode:', err);
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const setMode = (next: AppMode) => {
    setModeState(next);
    if (baseUrl) {
      AsyncStorage.setItem(`library_mode@${baseUrl}`, next).catch((err) =>
        console.warn('[AppMode] Failed to persist mode:', err),
      );
    }
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode, hydrated }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  return useContext(AppModeContext);
}
