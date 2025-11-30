import { MD3LightTheme as PaperLightTheme, MD3DarkTheme as PaperDarkTheme } from 'react-native-paper';

// Centralized design tokens
export const colors = {
  primary: '#5A4632',
  primaryContainer: '#E9DCCF',
  secondary: '#3E6B64',
  secondaryContainer: '#CCE5E1',
  accent: '#FF9E9E',
  background: '#FAF9F7',
  surface: '#F5F0E6',
  surfaceVariant: '#EBE3D8',
  outline: '#D6CFC4',
  error: '#B00020',
  success: '#4CAF50',
  warning: '#FFB347',
  textPrimary: '#3B3024',
  textSecondary: '#6A6258',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
};

export const elevation = {
  card: 2,
  overlay: 6,
};

export const appTheme = {
  ...PaperLightTheme,
  roundness: radius.md,
  colors: {
    ...PaperLightTheme.colors,
    primary: colors.primary,
    secondary: colors.secondary,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceVariant,
    outline: colors.outline,
    onSurface: colors.textPrimary,
    onSurfaceVariant: colors.textSecondary,
    error: colors.error,
  },
  fonts: {
    ...PaperLightTheme.fonts,
    titleLarge: { ...PaperLightTheme.fonts.titleLarge, fontWeight: '600' },
    titleMedium: { ...PaperLightTheme.fonts.titleMedium, fontWeight: '600' },
    labelLarge: { ...PaperLightTheme.fonts.labelLarge, letterSpacing: 0.3 },
  },
};

export default appTheme;

// Dark theme variant
export const appDarkTheme = {
  ...PaperDarkTheme,
  roundness: radius.md,
  colors: {
    ...PaperDarkTheme.colors,
    primary: '#D7C5B8',
    secondary: '#8FB4A9',
    background: '#0F1112',
    surface: '#121315',
    surfaceVariant: '#1E1E20',
    outline: '#2A2A2A',
    onSurface: '#EDEBE9',
    onSurfaceVariant: '#A8A29E',
    error: colors.error,
  },
};
