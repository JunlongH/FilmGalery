/**
 * MapScreen
 * 
 * Interactive map view showing all photo locations.
 * Part of the 3-tab main navigation.
 * 
 * Features:
 * - Photo clusters on map
 * - Location-based photo browsing
 * - OpenStreetMap tiles
 * - Map style toggle
 * - Location list bottom sheet
 */

import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Dimensions,
  Animated,
  FlatList,
  Platform,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Icon, Badge } from '../components/ui';
import { ApiContext } from '../context/ApiContext';
import { getPhotoUrl } from '../utils/urls';
import LeafletMap from '../components/map/LeafletMap';
import { wgs84ToGcj02 } from '@filmgallery/shared/coordTransform';

const { width, height } = Dimensions.get('window');

// Initial region (centered on a default location)
const INITIAL_REGION = {
  latitude: 31.2304,  // Shanghai as default
  longitude: 121.4737,
  latitudeDelta: 5,
  longitudeDelta: 5,
};

export default function MapScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { baseUrl, mapProvider } = useContext(ApiContext);
  const mapRef = useRef(null);
  
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState([]);
  const [mapRegion, setMapRegion] = useState(INITIAL_REGION);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [showList, setShowList] = useState(false);

  // Animation values
  const listAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;

  // Fetch photos with GPS data
  const fetchPhotos = useCallback(async () => {
    if (!baseUrl) {
      console.log('[MapScreen] No baseUrl yet, skipping fetch');
      return;
    }
    try {
      setLoading(true);
      console.log('[MapScreen] Fetching photos from:', `${baseUrl}/api/photos/geo`);
      const data = await api.http.get('/api/photos/geo');
      console.log('[MapScreen] Response data:', JSON.stringify(data).slice(0, 200));

      // Handle response format: { photos: [...], total: N, returned: N }
      let photoData = [];
      if (data) {
        if (Array.isArray(data)) {
          photoData = data;
        } else if (data.photos && Array.isArray(data.photos)) {
          photoData = data.photos;
        }
      }
      
      console.log('[MapScreen] Parsed photos:', photoData.length);
      
      if (photoData.length > 0) {
        // Convert coordinates to numbers and fix thumbnail URLs
        const processedPhotos = photoData.map(p => {
          const thumbnailUrl = getPhotoUrl(baseUrl, p, 'thumb');
          const lat = parseFloat(p.latitude);
          const lng = parseFloat(p.longitude);
          // When using Amap, convert WGS-84 (DB) → GCJ-02 (display)
          const displayCoords = mapProvider === 'amap'
            ? wgs84ToGcj02(lat, lng)
            : { lat, lng };
          return {
            ...p,
            latitude: displayCoords.lat,
            longitude: displayCoords.lng,
            thumbnailUrl: thumbnailUrl,
            // Generate location name from available fields
            location_name: p.detail_location || p.city || p.country || null,
          };
        }).filter(p => !isNaN(p.latitude) && !isNaN(p.longitude));
        
        console.log('[MapScreen] Processed photos with valid coords:', processedPhotos.length);
        setPhotos(processedPhotos);
        
        // Auto-fit map to show all photos
        const lats = processedPhotos.map(p => p.latitude).filter(v => v != null && v !== 0);
        const lngs = processedPhotos.map(p => p.longitude).filter(v => v != null && v !== 0);
        
        console.log('[MapScreen] Valid coords:', lats.length, 'lats,', lngs.length, 'lngs');
        
        if (lats.length > 0 && lngs.length > 0) {
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs);
          const maxLng = Math.max(...lngs);
          
          setMapRegion({
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2,
            latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.2),
            longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.2),
          });
        }
      } else {
        setPhotos([]);
      }
    } catch (error) {
      console.log('Failed to fetch photos with GPS:', error.message);
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => {
    if (baseUrl) {
      fetchPhotos();
    }
  }, [baseUrl, fetchPhotos]);

  // Handle marker press
  const handleMarkerPress = useCallback((photo) => {
    setSelectedPhoto(photo);
    // Animate card in
    Animated.spring(cardAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start();
  }, [cardAnim]);

  // Close selected card
  const closeSelectedCard = useCallback(() => {
    Animated.timing(cardAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setSelectedPhoto(null));
  }, [cardAnim]);

  // Toggle location list
  const toggleList = useCallback(() => {
    const toValue = showList ? 0 : 1;
    setShowList(!showList);
    Animated.spring(listAnim, {
      toValue,
      useNativeDriver: true,
      friction: 8,
    }).start();
  }, [showList, listAnim]);

  // Navigate to photo view
  const handlePhotoPress = useCallback(() => {
    if (selectedPhoto) {
      navigation.navigate('PhotoView', { 
        photoId: selectedPhoto.id,
        rollId: selectedPhoto.roll_id,
      });
    }
  }, [selectedPhoto, navigation]);

  // Navigate to cluster location
  // Handle cluster press - zoom in to expand cluster, or show photo if single
  const handleClusterPress = useCallback((cluster) => {
    if (cluster.count === 1) {
      // Single photo - show details
      handleMarkerPress(cluster.representative);
    } else {
       // Set region to center on cluster
      setMapRegion({
        latitude: cluster.latitude,
        longitude: cluster.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    }
  }, [handleMarkerPress]);

  // Dynamic clustering based on zoom level
  const clusters = useMemo(() => {
    // Calculate cluster radius based on current zoom (latitudeDelta)
    // At high zoom (small delta), use smaller radius to show individual photos
    // At low zoom (large delta), use larger radius to group more photos
    const delta = mapRegion?.latitudeDelta || 0.05;
    
    // More aggressive clustering at lower zoom levels
    let clusterRadius;
    if (delta > 5) {
      clusterRadius = 1.0; // World view - cluster by country/region
    } else if (delta > 1) {
      clusterRadius = 0.3; // Continental view
    } else if (delta > 0.3) {
      clusterRadius = 0.08; // Country view
    } else if (delta > 0.1) {
      clusterRadius = 0.02; // City view
    } else if (delta > 0.02) {
      clusterRadius = 0.005; // Neighborhood view
    } else {
      clusterRadius = 0.001; // Street view - minimal clustering
    }
    
    const result = [];
    const used = new Set();

    photos.forEach((photo, i) => {
      if (used.has(i) || !photo.latitude || !photo.longitude) return;

      const cluster = [photo];
      used.add(i);

      photos.forEach((other, j) => {
        if (used.has(j) || !other.latitude || !other.longitude) return;
        
        const dist = Math.sqrt(
          Math.pow(photo.latitude - other.latitude, 2) + 
          Math.pow(photo.longitude - other.longitude, 2)
        );
        
        if (dist < clusterRadius) {
          cluster.push(other);
          used.add(j);
        }
      });

      result.push({
        id: photo.id,
        latitude: cluster.reduce((sum, p) => sum + p.latitude, 0) / cluster.length,
        longitude: cluster.reduce((sum, p) => sum + p.longitude, 0) / cluster.length,
        count: cluster.length,
        photos: cluster.slice(0, 4), // Keep up to 4 photos for mosaic display
        representative: cluster[0],
      });
    });

    return result;
  }, [photos, mapRegion?.latitudeDelta]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    map: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
    },
    loadingText: {
      marginTop: 12,
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
    },
    clusterMarker: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 3,
      borderColor: 'white',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.4,
      shadowRadius: 6,
      elevation: 8,
    },
    clusterText: {
      color: 'white',
      fontWeight: 'bold',
      fontSize: 16,
    },
    markerContainer: {
      position: 'relative',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Single photo marker - large prominent size
    singleMarker: {
      width: 80,
      height: 80,
      borderRadius: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 10,
      backgroundColor: theme.colors.surface,
      borderWidth: 3,
      borderColor: 'white',
    },
    // Mosaic cluster marker for multiple photos - larger with better spacing
    mosaicMarker: {
      width: 88,
      height: 88,
      borderRadius: 16,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 10,
      backgroundColor: theme.colors.surfaceVariant,
      borderWidth: 3,
      borderColor: 'white',
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    mosaicImage: {
      width: '50%',
      height: '50%',
    },
    // Large count badge positioned at bottom right - gradient-like amber color
    clusterBadge: {
      position: 'absolute',
      bottom: -8,
      right: -8,
      minWidth: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#F59E0B', // Amber/orange for visibility
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 3,
      borderColor: 'white',
      paddingHorizontal: 8,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.35,
      shadowRadius: 4,
      elevation: 8,
    },
    clusterBadgeText: {
      color: '#000',
      fontWeight: 'bold',
      fontSize: 14,
    },
    markerImage: {
      width: '100%',
      height: '100%',
      resizeMode: 'cover',
    },
    selectedCard: {
      position: 'absolute',
      bottom: 100,
      left: 16,
      right: 16,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 12,
      flexDirection: 'row',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
      elevation: 8,
    },
    selectedImage: {
      width: 72,
      height: 72,
      borderRadius: 10,
    },
    selectedInfo: {
      flex: 1,
      marginLeft: 12,
      justifyContent: 'center',
    },
    selectedTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.colors.onSurface,
      lineHeight: 20,
    },
    selectedRollName: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.colors.primary,
      marginTop: 2,
      lineHeight: 18,
    },
    selectedMeta: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 3,
      lineHeight: 16,
    },
    closeButton: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceVariant,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      padding: 24,
    },
    emptyText: {
      fontSize: 16,
      color: theme.colors.onSurfaceVariant,
      textAlign: 'center',
      marginTop: 16,
    },
    statsContainer: {
      position: 'absolute',
      top: 16,
      left: 16,
      right: 16,
      backgroundColor: theme.colors.surface + 'E6',
      borderRadius: 12,
      padding: 12,
      flexDirection: 'row',
      justifyContent: 'space-around',
    },
    statItem: {
      alignItems: 'center',
    },
    statValue: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.colors.primary,
    },
    statLabel: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    // Control buttons
    controlsContainer: {
      position: 'absolute',
      right: 16,
      top: 80,
      gap: 8,
    },
    controlButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.surface,
      justifyContent: 'center',
      alignItems: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
      elevation: 4,
      marginBottom: 8,
    },
    controlButtonActive: {
      backgroundColor: theme.colors.primary,
    },
    // Location list panel
    listPanel: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      height: height * 0.4,
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 10,
    },
    listHandle: {
      width: 40,
      height: 4,
      backgroundColor: theme.colors.outline,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 12,
      marginBottom: 8,
    },
    listHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 12,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline + '30',
    },
    listTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.colors.onSurface,
    },
    listItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 12,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline + '15',
    },
    listItemImage: {
      width: 56,
      height: 56,
      borderRadius: 8,
      backgroundColor: theme.colors.surfaceVariant,
    },
    listItemInfo: {
      flex: 1,
      marginLeft: 12,
    },
    listItemTitle: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.colors.onSurface,
    },
    listItemSubtitle: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <Text style={styles.loadingText}>Loading map data...</Text>
      </View>
    );
  }

  if (photos.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Icon name="map-pin-off" size={64} color={theme.colors.onSurfaceVariant} />
        <Text style={styles.emptyText}>
          No photos with GPS data found.{'\n'}
          Take some photos with location enabled!
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LeafletMap 
        photos={photos}
        region={mapRegion}
        onMarkerPress={handleMarkerPress}
        onMapReady={() => console.log('Leaflet Map Ready')}
      />

      {/* Stats overlay */}
      <View style={styles.statsContainer}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{photos.length}</Text>
          <Text style={styles.statLabel}>Photos</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{clusters.length}</Text>
          <Text style={styles.statLabel}>Locations</Text>
        </View>
      </View>

      {/* Control buttons */}
      <View style={styles.controlsContainer}>
        {/* Location list toggle */}
        <TouchableOpacity 
          style={[styles.controlButton, showList && styles.controlButtonActive]}
          onPress={toggleList}
        >
          <Icon 
            name="list" 
            size={20} 
            color={showList ? 'white' : theme.colors.primary} 
          />
        </TouchableOpacity>
        
        {/* Fit all markers */}
        <TouchableOpacity 
          style={styles.controlButton}
          onPress={fetchPhotos}
        >
          <Icon name="maximize" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Selected photo card */}
      {selectedPhoto && (
        <Animated.View 
          style={[styles.selectedCard, {
            opacity: cardAnim,
            transform: [{
              translateY: cardAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              }),
            }],
          }]}
        >
          <TouchableOpacity 
            onPress={handlePhotoPress}
            activeOpacity={0.9}
            style={{ flexDirection: 'row', flex: 1 }}
          >
            {selectedPhoto.thumbnailUrl && (
              <Image
                source={{ uri: selectedPhoto.thumbnailUrl }}
                style={styles.selectedImage}
              />
            )}
            <View style={styles.selectedInfo}>
              {/* Line 1: Location */}
              <Text style={styles.selectedTitle} numberOfLines={1}>
                {selectedPhoto.detail_location || selectedPhoto.city || selectedPhoto.country || selectedPhoto.filename || 'Photo'}
              </Text>
              {/* Line 2: Roll name */}
              {selectedPhoto.roll_name ? (
                <Text style={styles.selectedRollName} numberOfLines={1}>
                  {selectedPhoto.roll_name}
                </Text>
              ) : null}
              {/* Line 3: Meta info with · separator */}
              <Text style={styles.selectedMeta} numberOfLines={1}>
                {[
                  selectedPhoto.date_taken || selectedPhoto.taken_at
                    ? (() => {
                        const raw = selectedPhoto.date_taken || selectedPhoto.taken_at;
                        try { 
                          const d = new Date(raw);
                          if (!isNaN(d.getTime())) {
                            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                          }
                        } catch(e) {}
                        return String(raw).slice(0, 10);
                      })()
                    : null,
                  selectedPhoto.camera || null,
                  selectedPhoto.lens || null,
                ].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={closeSelectedCard}
          >
            <Icon name="x" size={14} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Location list panel */}
      {showList && (
        <Animated.View 
          style={[styles.listPanel, {
            transform: [{
              translateY: listAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [height * 0.4, 0],
              }),
            }],
          }]}
        >
          <View style={styles.listHandle} />
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>{clusters.length} Locations</Text>
            <TouchableOpacity onPress={toggleList}>
              <Icon name="x" size={20} color={theme.colors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>
          <FlatList
            data={clusters}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <TouchableOpacity 
                style={styles.listItem}
                onPress={() => {
                  handleClusterPress(item);
                  toggleList();
                }}
              >
                <Image
                  source={{ uri: item.representative.thumbnailUrl }}
                  style={styles.listItemImage}
                />
                <View style={styles.listItemInfo}>
                  <Text style={styles.listItemTitle} numberOfLines={1}>
                    {item.representative.location_name || item.representative.detail_location || item.representative.city || item.representative.country || `${item.representative.latitude.toFixed(4)}, ${item.representative.longitude.toFixed(4)}`}
                  </Text>
                  <Text style={styles.listItemSubtitle}>
                    {item.count} {item.count === 1 ? 'photo' : 'photos'}
                  </Text>
                </View>
                <Badge variant="primary">{item.count}</Badge>
              </TouchableOpacity>
            )}
          />
        </Animated.View>
      )}
    </View>
  );
}
