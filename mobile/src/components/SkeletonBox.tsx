import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle, type DimensionValue } from 'react-native';

export interface SkeletonBoxProps {
  width?: DimensionValue;
  height?: DimensionValue;
  style?: StyleProp<ViewStyle>;
}

export default function SkeletonBox({ width = '100%', height = 16, style }: SkeletonBoxProps) {
  return <View style={[styles.base, { width, height }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#e6e6e6',
    borderRadius: 6,
  },
});
