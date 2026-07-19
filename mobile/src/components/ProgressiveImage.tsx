import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator, type ImageStyle, type StyleProp } from 'react-native';
import { Image as ExpoImage, type ImageContentFit } from 'expo-image';
import CachedImage from './CachedImage';

export interface ProgressiveImageProps {
  thumbUri?: string | null;
  fullUri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
}

export default function ProgressiveImage({
  thumbUri,
  fullUri,
  style,
  contentFit = 'contain',
}: ProgressiveImageProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <View style={style}>
      {thumbUri ? (
        <CachedImage
          uri={thumbUri}
          style={StyleSheet.absoluteFill as StyleProp<ImageStyle>}
          contentFit={contentFit}
          transition={0}
        />
      ) : null}
      <ExpoImage
        source={{ uri: fullUri }}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy="disk"
        transition={200}
        onLoad={() => setLoaded(true)}
      />
      {!loaded && (
        <ActivityIndicator size="large" color="#fff" style={styles.spinner} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  spinner: {
    ...StyleSheet.absoluteFillObject,
  },
});
