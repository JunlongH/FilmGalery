import React from 'react';
import { View, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Card, useTheme } from 'react-native-paper';
import CachedImage from './CachedImage';
import CoverOverlay from './CoverOverlay';

export interface FilmCardProps {
  coverUri?: string | null;
  title?: string;
  leftText?: string;
  rightText?: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}

export default function FilmCard({ coverUri, title, leftText, rightText, style, onPress }: FilmCardProps) {
  const theme = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={style} activeOpacity={0.85}>
      <Card style={[styles.card, { backgroundColor: theme.colors.surface }]} mode="elevated">
        <View style={styles.square}>
          {coverUri ? (
            <CachedImage uri={coverUri} contentFit="cover" style={styles.image} />
          ) : (
            <View style={[styles.image, { backgroundColor: theme.colors.surfaceVariant }]} />
          )}
          <CoverOverlay title={title} leftText={leftText} rightText={rightText} />
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, overflow: 'hidden' },
  square: { width: '100%', aspectRatio: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
});
