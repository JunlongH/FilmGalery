import React, { useContext } from 'react';
import { SegmentedButtons } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from '../../context/ApiContext';
import { useT } from '../../i18n';

export type LibraryMode = 'film' | 'digital';

export interface LibraryModeToggleProps {
  value: LibraryMode;
  onChange: (mode: LibraryMode) => void;
}

export default function LibraryModeToggle({ value, onChange }: LibraryModeToggleProps) {
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const handleChange = async (next: string) => {
    if (next !== 'film' && next !== 'digital') return;
    onChange(next);
    if (baseUrl) {
      try {
        await AsyncStorage.setItem(`library_mode@${baseUrl}`, next);
      } catch { /* best-effort */ }
    }
  };

  return (
    <SegmentedButtons
      value={value}
      onValueChange={handleChange}
      buttons={[
        { value: 'film', label: t('digital.modeFilm'), icon: 'movie' },
        { value: 'digital', label: t('digital.modeDigital'), icon: 'camera-burst' },
      ]}
      style={{ marginBottom: 12 }}
    />
  );
}
