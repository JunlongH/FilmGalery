import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from './ApiContext';

export type AppMode = 'film' | 'digital';

interface AppModeContextValue {
  mode: AppMode;
  setMode: (mode: AppMode) => void;
}

const AppModeContext = createContext<AppModeContextValue>({
  mode: 'film',
  setMode: () => {},
});

export function AppModeProvider({ children }: { children: React.ReactNode }) {
  const { baseUrl } = useContext(ApiContext);
  const [mode, setModeState] = useState<AppMode>('film');

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;
    AsyncStorage.getItem(`library_mode@${baseUrl}`)
      .then((saved) => {
        if (cancelled) return;
        setModeState(saved === 'digital' ? 'digital' : 'film');
      })
      .catch(() => {})
      .finally(() => {});
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  const setMode = (next: AppMode) => {
    setModeState(next);
    if (baseUrl) {
      AsyncStorage.setItem(`library_mode@${baseUrl}`, next).catch(() => {});
    }
  };

  return (
    <AppModeContext.Provider value={{ mode, setMode }}>{children}</AppModeContext.Provider>
  );
}

export function useAppMode(): AppModeContextValue {
  return useContext(AppModeContext);
}
