import { useRoute } from '@react-navigation/native';

export type LibraryMode = 'film' | 'digital';

export function useLibraryMode(): LibraryMode {
  const route = useRoute<any>();
  const raw = route?.params?.mode;
  return raw === 'digital' ? 'digital' : 'film';
}
