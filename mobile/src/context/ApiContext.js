import React from 'react';

export const ApiContext = React.createContext({
  baseUrl: '',
  setBaseUrl: () => {},
  backupUrl: '',
  setBackupUrl: () => {},
  darkMode: false,
  setDarkMode: () => {},
});
