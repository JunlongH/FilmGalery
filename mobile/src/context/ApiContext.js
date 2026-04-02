import React from 'react';

export const ApiContext = React.createContext({
  baseUrl: '',
  setBaseUrl: () => {},
  backupUrl: '',
  setBackupUrl: () => {},
  darkMode: false,
  setDarkMode: () => {},
  mapProvider: 'osm',      // 'osm' | 'amap'
  setMapProvider: () => {},
  amapKey: '',             // 高德 Web 服务 API Key
  setAmapKey: () => {},
});
