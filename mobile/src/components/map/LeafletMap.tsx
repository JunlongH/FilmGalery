import React, { useRef, useEffect, useState, useContext } from 'react';
import { View, StyleSheet, ActivityIndicator, TouchableOpacity, Text } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from 'react-native-paper';
import { getLeafletHtml } from './leafletHtml';
import { ApiContext } from '../../context/ApiContext';
import { wgs84ToGcj02, gcj02ToWgs84 } from '@filmgallery/shared/coordTransform';

const MAP_READY_TIMEOUT_MS = 15000;

interface LeafletMapProps {
  photos?: any[];
  region?: any;
  onMarkerPress?: (photo: any) => void;
  onMapReady?: () => void;
  mode?: 'view' | 'pick';
  onPick?: (lat: number, lng: number) => void;
  initialLatLng?: [number, number] | null;
}

const LeafletMap = ({
  photos = [],
  region,
  onMarkerPress,
  onMapReady,
  mode = 'view',
  onPick,
  initialLatLng = null,
}: LeafletMapProps) => {
  const theme = useTheme();
  const webViewRef = useRef<any>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const { mapProvider, darkMode }: any = useContext(ApiContext);

  // For pick mode, convert WGS-84 initialLatLng to GCJ-02 for display on
  // AMap tiles (coordTransform returns { lat, lng } objects, not arrays).
  // IMPORTANT: only capture the FIRST initialLatLng value. If this changed
  // on every pick, the useMemo below would regenerate HTML and the WebView
  // would reload on every tap. The WebView's own JS manages the marker
  // after initial load via click/drag events. (Review finding C3)
  const displayInitialLatLngRef = useRef<[number, number] | null>(null);
  if (displayInitialLatLngRef.current === null && initialLatLng) {
    const init = initialLatLng;
    displayInitialLatLngRef.current = mapProvider === 'amap'
      ? (() => { const c = wgs84ToGcj02(init[0], init[1]); return [c.lat, c.lng]; })()
      : init;
  }
  const displayInitialLatLng = displayInitialLatLngRef.current;

  // Generate HTML with initial region, map provider, mode, and initial marker.
  // displayInitialLatLng is intentionally excluded from deps — it's captured
  // once via ref to avoid WebView reloads on every pick.
  const htmlContent = React.useMemo(
    () => getLeafletHtml(
      region || { latitude: 31.2304, longitude: 121.4737 },
      mapProvider,
      !!darkMode,
      mode,
      displayInitialLatLng
    ),
    [mapProvider, darkMode, mode] // re-generate when config changes
  );

  // Fail gracefully if the map never signals readiness (e.g. WebView error)
  useEffect(() => {
    if (isMapReady) return;
    setLoadFailed(false);
    const timer = setTimeout(() => setLoadFailed(true), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isMapReady, reloadNonce]);

  // Update photos when they change (only if map is ready, view mode only)
  useEffect(() => {
    if (mode === 'view' && isMapReady && webViewRef.current) {
      const message = JSON.stringify({
        type: 'UPDATE_PHOTOS',
        payload: photos
      });
      webViewRef.current.postMessage(message);
    }
  }, [photos, isMapReady, mode]);

  // Update region if changed externally (view mode only)
  useEffect(() => {
    if (mode === 'view' && isMapReady && webViewRef.current && region) {
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
  }, [region, isMapReady, mode]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'MAP_READY') {
        setIsMapReady(true);
        if (onMapReady) onMapReady();

        // Initial load of photos (view mode only)
        if (mode === 'view' && photos.length > 0 && webViewRef.current) {
             webViewRef.current.postMessage(JSON.stringify({
                type: 'UPDATE_PHOTOS',
                payload: photos
              }));
        }
      } else if (data.type === 'MARKER_PRESS') {
        if (onMarkerPress) onMarkerPress(data.payload);
      } else if (data.type === 'MAP_PICK') {
        // In pick mode, the WebView reports GCJ-02 coordinates when using
        // AMap tiles (the click event is in tile coordinate space). Convert
        // back to WGS-84 so the caller always receives WGS-84.
        if (onPick) {
          const { lat, lng } = data.payload;
          if (mapProvider === 'amap') {
            const wgs = gcj02ToWgs84(lat, lng);
            onPick(wgs.lat, wgs.lng);
          } else {
            onPick(lat, lng);
          }
        }
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
