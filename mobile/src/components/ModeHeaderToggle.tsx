import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useAppMode } from '../context/AppModeContext';
import { useT } from '../i18n';
import { Icon } from './ui';

export default function ModeHeaderToggle() {
  const { mode, setMode } = useAppMode();
  const theme = useTheme();
  const t = useT();

  const renderButton = (
    value: 'film' | 'digital',
    icon: string,
    label: string,
  ) => {
    const active = mode === value;
    return (
      <TouchableOpacity
        key={value}
        onPress={() => setMode(value)}
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        style={[
          styles.segment,
          active && { backgroundColor: theme.colors.primaryContainer },
        ]}
      >
        <Icon
          name={icon}
          size={17}
          color={active ? theme.colors.primary : theme.colors.onSurfaceVariant}
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.surfaceVariant }]}>
      {renderButton('film', 'film', t('digital.modeFilm'))}
      {renderButton('digital', 'camera', t('digital.modeDigital'))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
    borderRadius: 16,
    padding: 2,
    marginRight: 6,
  },
  segment: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
