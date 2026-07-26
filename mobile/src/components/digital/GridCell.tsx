import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from 'react-native-paper';
import CachedImage from '../CachedImage';
import { Icon } from '../ui';
import { getPhotoUrl, type PhotoPathSource } from '../../utils/urls';

export const CELL_SIZE_SOURCE: 'window' = 'window';

export interface GridCellProps {
  photo: PhotoPathSource & { id: number; [key: string]: any };
  baseUrl: string;
  size: number;
  onPress: (photo: GridCellProps['photo']) => void;
  onLongPress?: (photo: GridCellProps['photo']) => void;
}

export default function GridCell({ photo, baseUrl, size, onPress, onLongPress }: GridCellProps) {
  const theme = useTheme();
  const uri = getPhotoUrl(baseUrl, photo, 'thumb');
  return (
    <TouchableOpacity
      onPress={() => onPress(photo)}
      onLongPress={onLongPress ? () => onLongPress(photo) : undefined}
      activeOpacity={0.85}
      style={[styles.cell, { width: size, height: size }]}
    >
      {uri ? (
        <CachedImage uri={uri} style={styles.thumb} contentFit="cover" />
      ) : (
        <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
          <Icon name="image" size={28} color={theme.colors.onSurfaceVariant} />
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  cell: {
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
