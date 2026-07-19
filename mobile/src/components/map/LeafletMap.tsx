import React, { useRef, useEffect, useState, useContext } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from 'react-native-paper';
import { getLeafletHtml } from './leafletHtml';
import { ApiContext } from '../../context/ApiContext';

const MAP_READY_TIMEOUT_MS = 15000;

const LeafletMap = ({
  photos = [],
  region,
  onMarkerPress,
  onMapReady
}: any) => {
  const theme = useTheme();
  const webViewRef = useRef<any>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const { mapProvider, darkMode }: any = useContext(ApiContext);

  // Generate HTML with initial region and map provider
  const htmlContent = React.useMemo(
    () => getLeafletHtml(region || { latitude: 31.2304, longitude: 121.4737 }, mapProvider, !!darkMode),
    [mapProvider, darkMode] // re-generate HTML when provider or theme changes
  );

  // Fail gracefully if the map never signals readiness (e.g. WebView error)
  useEffect(() => {
    if (isMapReady) return;
    setLoadFailed(false);
    const timer = setTimeout(() => setLoadFailed(true), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isMapReady, reloadNonce]);

  // Update photos when they change (only if map is ready)
  useEffect(() => {
    if (isMapReady && webViewRef.current) {
      const message = JSON.stringify({
        type: 'UPDATE_PHOTOS',
        payload: photos
      });
      webViewRef.current.postMessage(message);
    }
  }, [photos, isMapReady]);

  // Update region if changed externally
  useEffect(() => {
    if (isMapReady && webViewRef.current && region) {
       // Approximate zoom from delta
       const zoom = Math.round(Math.log2(360 / (region.longitudeDelta || 0.05))) + 1;
       const message = JSON.stringify({
         type: 'CENTER_MAP',
         payload: {
             lat: region.latitude,
             lng: region.longitude,
             zoom: Math.min(Math.max(zoom, 3), 18)
         }
       });
       webViewRef.current.postMessage(message);
    }
  }, [region, isMapReady]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsMapReady(true);
        if (onMapReady) onMapReady();

        // Initial load of photos
        if (photos.length > 0 && webViewRef.current) {
             webViewRef.current.postMessage(JSON.stringify({
                type: 'UPDATE_PHOTOS',
                payload: photos
              }));
        }
      } else if (data.type === 'MARKER_PRESS') {
        if (onMarkerPress) onMarkerPress(data.payload);
      }
    } catch (e) {
      console.error('Error parsing map message', e);
    }
  };

  return (
    <View style={styles.container}>
      <WebView
        key={reloadNonce}
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={handleMessage}
        onError={() => setLoadFailed(true)}
        androidLayerType="hardware"
        // Ensure mixture of http/https content works if thumbnails are http
        mixedContentMode="always"
      />
      {!isMapReady && !loadFailed && (
        <View style={[styles.loadingOverlay, { backgroundColor: theme.colors.surfaceVariant }]}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      )}
      {!isMapReady && loadFailed && (
        <View style={[styles.loadingOverlay, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text style={{ color: theme.colors.onSurfaceVariant, marginBottom: 12 }}>
            Map failed to load
          </Text>
          <TouchableOpacity
            onPress={() => {
              setIsMapReady(false);
              setLoadFailed(false);
              setReloadNonce((n) => n + 1);
            }}
            style={{
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 16,
              backgroundColor: theme.colors.primary,
            }}
          >
            <Text style={{ color: theme.colors.onPrimary }}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
});

export default LeafletMap;
