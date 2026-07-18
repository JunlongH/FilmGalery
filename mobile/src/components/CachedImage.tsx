import React from 'react';
import { View, type ImageStyle, type StyleProp } from 'react-native';
import { Image as ExpoImage, type ImageContentFit } from 'expo-image';
import { useCachedImage } from '../hooks/useCachedImage';

export interface CachedImageProps extends Omit<React.ComponentProps<typeof ExpoImage>, 'source' | 'style' | 'contentFit' | 'transition' | 'placeholder' | 'onLoadEnd' | 'onError'> {
  uri: string;
  style?: StyleProp<ImageStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
  placeholderColor?: string;
  showLoadedIndicator?: boolean;
}

export default function CachedImage({
  uri,
  style,
  contentFit = 'cover',
  transition = 150,
  placeholderColor = '#eee',
  showLoadedIndicator = false,
  ...rest
}: CachedImageProps) {
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
        } as any}
      />
      {showLoadedIndicator && loaded && (
        <View style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: '#4caf50',
        }} />
      )}
    </View>
  );
}

export async function clearImageCache(): Promise<void> {
  try {
    const mod: any = require('expo-image');
    if (mod?.clearMemoryCache) mod.clearMemoryCache();
    if (mod?.clearDiskCache) await mod.clearDiskCache();
  } catch (e) {
    // silent
  }
}
