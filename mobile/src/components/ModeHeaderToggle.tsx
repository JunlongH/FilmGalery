import React from 'react';
import { StyleSheet } from 'react-native';
import { SegmentedButtons } from 'react-native-paper';
import { useAppMode } from '../context/AppModeContext';
import { useT } from '../i18n';

export default function ModeHeaderToggle() {
  const { mode, setMode } = useAppMode();
  const t = useT();

  return (
    <SegmentedButtons
      value={mode}
      onValueChange={(v) => {
        if (v === 'film' || v === 'digital') setMode(v);
      }}
      density="small"
      buttons={[
        { value: 'film', label: t('digital.modeFilm'), icon: 'movie' },
        { value: 'digital', label: t('digital.modeDigital'), icon: 'camera-burst' },
      ]}
      style={styles.toggle}
    />
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 130,
    marginRight: 6,
  },
});
