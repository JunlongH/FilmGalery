import { MD3LightTheme as PaperLightTheme, MD3DarkTheme as PaperDarkTheme, type MD3Theme } from 'react-native-paper';

export const colors = {
  primary: '#0097A7',
  primaryDark: '#00838F',
  primaryContainer: '#E0F7FA',
  secondary: '#7B1FA2',
  secondaryDark: '#6A1B9A',
  secondaryContainer: '#F3E5F5',
  accent: '#FF5722',
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceVariant: '#F5F5F5',
  surfaceElevated: '#FFFFFF',
  outline: '#E0E0E0',
  outlineVariant: '#BDBDBD',
  error: '#D32F2F',
  success: '#388E3C',
  warning: '#F57C00',
  textPrimary: '#212121',
  textSecondary: '#616161',
  textTertiary: '#9E9E9E',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const elevation = {
  card: 2,
  overlay: 8,
};

export const appTheme: MD3Theme = {
  ...PaperLightTheme,
  roundness: radius.md,
  dark: false,
  colors: {
    ...PaperLightTheme.colors,
    primary: colors.primary,
    primaryContainer: colors.primaryContainer,
    secondary: colors.secondary,
    secondaryContainer: colors.secondaryContainer,
    background: colors.background,
    surface: colors.surface,
    surfaceVariant: colors.surfaceVariant,
    surfaceDisabled: colors.surfaceElevated,
    outline: colors.outline,
    outlineVariant: colors.outlineVariant,
    onSurface: colors.textPrimary,
    onSurfaceVariant: colors.textSecondary,
    error: colors.error,
  },
  fonts: {
    ...PaperLightTheme.fonts,
    titleLarge: { ...PaperLightTheme.fonts.titleLarge, fontWeight: '700' },
    titleMedium: { ...PaperLightTheme.fonts.titleMedium, fontWeight: '600' },
    labelLarge: { ...PaperLightTheme.fonts.labelLarge, letterSpacing: 0.2 },
  },
};

export default appTheme;

export const appDarkTheme: MD3Theme = {
  ...PaperDarkTheme,
  roundness: radius.md,
  dark: true,
  colors: {
    ...PaperDarkTheme.colors,
    primary: '#4DD0E1',
    primaryContainer: '#004D5C',
    secondary: '#CE93D8',
    secondaryContainer: '#311B92',
    background: '#121212',
    surface: '#1E1E1E',
    surfaceVariant: '#2D2D2D',
    outline: '#424242',
    onSurface: '#FAFAFA',
    onSurfaceVariant: '#BDBDBD',
    error: '#EF5350',
  },
};

export const appLightTheme = appTheme;
