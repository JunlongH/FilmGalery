import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Card } from 'react-native-paper';
import CachedImage from './CachedImage';
import CoverOverlay from './CoverOverlay';
import TouchScale from './TouchScale';
import SkeletonBox from './SkeletonBox';

export interface TagCardProps {
  coverUri?: string | null;
  title?: string;
  subtitle?: string;
  style?: StyleProp<ViewStyle>;
  loading?: boolean;
  onPress?: () => void;
}

export default function TagCard({ coverUri, title, subtitle, style, loading = false, onPress }: TagCardProps) {
  return (
    <TouchScale style={style} onPress={onPress} disabled={loading}>
      <Card style={styles.card} mode="elevated">
        <View style={styles.square}>
          {loading ? (
            <SkeletonBox width={'100%'} height={'100%'} />
          ) : coverUri ? (
            <CachedImage uri={coverUri} contentFit="cover" style={styles.image} placeholderColor="#e9e4da" />
          ) : (
            <View style={[styles.image, styles.placeholder]} />
          )}
          <CoverOverlay title={title} leftText={subtitle} rightText={''} />
        </View>
      </Card>
    </TouchScale>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#f5f0e6', borderRadius: 8, overflow: 'hidden' },
  square: { width: '100%', aspectRatio: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: '#d7d2c7' },
});
