import { createContext } from 'react';
import type { MapProvider } from '@filmgallery/types';

// Re-export so existing imports (e.g. `import type { MapProvider } from
// './context/ApiContext'` in App.tsx) continue to work while the type now
// lives once in @filmgallery/types.
export type { MapProvider };

export interface ApiContextValue {
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  backupUrl: string;
  setBackupUrl: (v: string) => void;
  darkMode: boolean;
  setDarkMode: (v: boolean) => void;
  mapProvider: MapProvider;
  setMapProvider: (v: MapProvider) => void;
  amapKey: string;
  setAmapKey: (v: string) => void;
}

export const ApiContext = createContext<ApiContextValue>({
  baseUrl: '',
  setBaseUrl: () => {},
  backupUrl: '',
  setBackupUrl: () => {},
  darkMode: false,
  setDarkMode: () => {},
  mapProvider: 'osm',
  setMapProvider: () => {},
  amapKey: '',
  setAmapKey: () => {},
});
