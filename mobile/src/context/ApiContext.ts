import { createContext } from 'react';

export type MapProvider = 'osm' | 'amap';

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
