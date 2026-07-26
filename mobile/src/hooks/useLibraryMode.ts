import { useRoute } from '@react-navigation/native';
import { useAppMode } from '../context/AppModeContext';

export type LibraryMode = 'film' | 'digital';

export function useLibraryMode(): LibraryMode {
  const route = useRoute<any>();
  const { mode: globalMode } = useAppMode();
  const raw = route?.params?.mode;
  if (raw === 'film' || raw === 'digital') return raw;
  return globalMode;
}
