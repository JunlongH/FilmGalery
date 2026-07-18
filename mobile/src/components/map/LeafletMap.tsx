import React, { useRef, useEffect, useState, useContext } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { getLeafletHtml } from './leafletHtml';
import { ApiContext } from '../../context/ApiContext';

const LeafletMap = ({
  photos = [],
  region,
  onMarkerPress,
  onMapReady
}: any) => {
  const webViewRef = useRef<any>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const { mapProvider, darkMode }: any = useContext(ApiContext);

  // Generate HTML with initial region and map provider
  const htmlContent = React.useMemo(
    () => getLeafletHtml(region || { latitude: 31.2304, longitude: 121.4737 }, mapProvider, !!darkMode),
    [mapProvider, darkMode] // re-generate HTML when provider or theme changes
  );

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
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: htmlContent }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onMessage={handleMessage}
        androidLayerType="hardware"
        // Ensure mixture of http/https content works if thumbnails are http
        mixedContentMode="always" 
      />
      {!isMapReady && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#0000ff" />
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
