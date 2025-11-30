import React from 'react';

export const ApiContext = React.createContext({
  baseUrl: '',
  setBaseUrl: () => {},
  darkMode: false,
  setDarkMode: () => {},
});
