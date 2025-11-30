import React from 'react';
import { View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useCachedImage } from '../hooks/useCachedImage';

/*
 * Unified cached image component.
 * Props:
 *  - uri: string (image URL)
 *  - style: RN style
 *  - contentFit: expo-image contentFit (default 'cover')
 *  - transition: ms fade (reduced to 0 if already cached)
 *  - placeholderColor: background while not loaded
 *  - showLoadedIndicator: boolean (if true, adds tiny green dot when cached)
 *  - ...rest forwarded to ExpoImage
 */
export default function CachedImage({
  uri,
  style,
  contentFit = 'cover',
  transition = 150,
  placeholderColor = '#eee',
  showLoadedIndicator = false,
  ...rest
}) {
  const { source, loaded, onLoadEnd, onError } = useCachedImage(uri);
  const effectiveTransition = loaded ? 0 : transition;

  return (
    <View style={style}>
      <ExpoImage
        {...rest}
        source={source}
        style={[{ width: '100%', height: '100%' }, style]}
        contentFit={contentFit}
        cachePolicy="disk"
        transition={effectiveTransition}
        onLoadEnd={onLoadEnd}
        onError={onError}
        placeholder={{
          blurhash: undefined,
          color: placeholderColor,
        }}
      />
      {showLoadedIndicator && loaded && (
        <View style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: '#4caf50'
        }} />
      )}
    </View>
  );
}

  // Simple cache helper to clear react-native-expo-image cache if exposed
  export async function clearImageCache() {
    try {
      const mod = require('expo-image');
      if (mod?.clearMemoryCache) mod.clearMemoryCache();
      if (mod?.clearDiskCache) await mod.clearDiskCache();
    } catch (e) {
      // silent
    }
  }
