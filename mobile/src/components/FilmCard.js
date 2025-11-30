import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Card } from 'react-native-paper';
import CachedImage from './CachedImage';
import CoverOverlay from './CoverOverlay';

/*
 * FilmCard: square card with center-cropped cover and overlay.
 * Props:
 *  - coverUri: string | null
 *  - title: string
 *  - leftText: string
 *  - rightText: string
 *  - style: container style (width/height)
 *  - onPress: handler
 */
export default function FilmCard({ coverUri, title, leftText, rightText, style, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={style} activeOpacity={0.85}>
      <Card style={styles.card} mode="elevated">
        <View style={styles.square}>
          {coverUri ? (
            <CachedImage uri={coverUri} contentFit="cover" style={styles.image} placeholderColor="#e9e4da" />
          ) : (
            <View style={[styles.image, styles.placeholder]} />
          )}
          <CoverOverlay title={title} leftText={leftText} rightText={rightText} />
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#f5f0e6', borderRadius: 8, overflow: 'hidden' },
  square: { width: '100%', aspectRatio: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
  placeholder: { backgroundColor: '#d7d2c7' },
});
