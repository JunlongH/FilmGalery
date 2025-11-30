import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function SkeletonBox({ width='100%', height=16, style }) {
  return <View style={[styles.base, { width, height }, style]} />;
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#e6e6e6',
    borderRadius: 6,
  },
});
