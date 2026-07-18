/**
 * LibraryScreen
 * 
 * Modern dashboard combining previous tabs into organized sections.
 * Part of the 3-tab main navigation.
 * 
 * Sections:
 * - Favorites (quick access)
 * - Collections (Themes/Tags)
 * - Equipment overview
 * - Inventory summary
 * - Statistics overview
 */

import React, { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  Dimensions,
  Animated,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { api } from '../api/client';
import { Icon, Card, Badge } from '../components/ui';
import { ApiContext } from '../context/ApiContext';
import { getPhotoUrl } from '../utils/urls';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

export default function LibraryScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { baseUrl } = useContext(ApiContext);
  
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    favorites: 0,
    themes: 0,
    equipment: 0,
    inventory: 0,
    rolls: 0,
    photos: 0,
  });
  const [recentFavorites, setRecentFavorites] = useState([]);
  const [topThemes, setTopThemes] = useState([]);
  const [topEquipment, setTopEquipment] = useState([]);

  // Animation values
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  // Animate on focus
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    }, [])
  );

  // Fetch library data
  const fetchData = useCallback(async () => {
    if (!baseUrl) {
      console.log('[LibraryScreen] No baseUrl yet, skipping fetch');
      return;
    }
    try {
      // Fetch multiple endpoints in parallel
      const [favoritesRes, themesRes, gearStatsRes, statsRes] = await Promise.all([
        api.http.get('/api/photos/favorites').catch(() => []),
        api.http.get('/api/tags').catch(() => []),
        api.http.get('/api/stats/gear').catch(() => ({ cameras: [], lenses: [], films: [] })),
        api.http.get('/api/stats/summary').catch(() => ({})),
      ]);

      // Process favorites - fix thumbnail URLs
      const favoritesRaw = Array.isArray(favoritesRes) ? favoritesRes : [];
      console.log('[LibraryScreen] Favorites raw:', favoritesRaw.length, 'items');
      const favorites = favoritesRaw.map(p => {
        const thumbnailUrl = getPhotoUrl(baseUrl, p, 'thumb');
        console.log('[LibraryScreen] Photo', p.id, 'thumb:', thumbnailUrl);
        return {
          ...p,
          thumbnail_url: thumbnailUrl
        };
      });
      setRecentFavorites(favorites.slice(0, 4));

      // Process themes - use photos_count from API
      const themesRaw = Array.isArray(themesRes) ? themesRes : [];
      const themes = themesRaw.map(t => ({
        ...t,
        photo_count: t.photos_count || t.photo_count || t.count || 0
      }));
      setTopThemes(themes.slice(0, 6));

      // Process gear stats - cameras with photo counts
      const gearData = gearStatsRes || {};
      const cameras = Array.isArray(gearData.cameras) ? gearData.cameras : [];
      // Transform to equipment-like structure for display
      const equipmentWithStats = cameras.map((cam, idx) => ({
        id: idx + 1,
        name: cam.name,
        brand: cam.name.split(' ')[0] || '',
        model: cam.name.split(' ').slice(1).join(' ') || '',
        photo_count: cam.count || 0,
        type: 'camera'
      }));
      setTopEquipment(equipmentWithStats.slice(0, 4));

      // Process stats
      const statsData = statsRes || {};
      setStats({
        favorites: favorites.length,
        themes: themes.length,
        equipment: cameras.length,
        inventory: statsData.inventory_in_stock || statsData.inventory_total || 0,
        rolls: statsData.total_rolls || 0,
        photos: statsData.total_photos || 0,
      });
    } catch (error) {
      console.log('Failed to fetch library data:', error.message);
    }
  }, [baseUrl]);

  useEffect(() => {
    if (baseUrl) {
      fetchData();
    }
  }, [baseUrl, fetchData]);

  // Pull-to-refresh
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  }, [fetchData]);

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.background,
    },
    scrollView: {
      flex: 1,
    },
    contentContainer: {
      padding: 16,
      paddingBottom: 100,
    },
    section: {
      marginBottom: 24,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: '700' as const,
      color: theme.colors.onSurface,
    },
    seeAllButton: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 4,
      paddingHorizontal: 8,
    },
    seeAllText: {
      fontSize: 14,
      color: theme.colors.primary,
      marginRight: 4,
    },
    statsGrid: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 0,
    },
    statCard: {
      flex: 1,
      marginHorizontal: 4,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      padding: 12,
      alignItems: 'center',
      elevation: 1,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
    },
    statIconContainer: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 6,
    },
    statValue: {
      fontSize: 18,
      fontWeight: 'bold' as const,
      color: theme.colors.onSurface,
    },
    statLabel: {
      fontSize: 11,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    quickAccessGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -8,
    },
    quickCard: {
      width: CARD_WIDTH,
      margin: 8,
      backgroundColor: theme.colors.surface,
      borderRadius: 16,
      overflow: 'hidden',
    },
    quickCardImage: {
      width: '100%',
      height: 100,
      backgroundColor: theme.colors.surfaceVariant,
    },
    quickCardContent: {
      padding: 12,
    },
    quickCardTitle: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: theme.colors.onSurface,
    },
    quickCardSubtitle: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    // Favorite card with overlay
    favoriteCard: {
      width: CARD_WIDTH,
      margin: 8,
      borderRadius: 12,
      overflow: 'hidden',
      position: 'relative',
    },
    favoriteCardImage: {
      width: '100%',
      height: 140,
      backgroundColor: theme.colors.surfaceVariant,
    },
    favoriteCardOverlay: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      paddingHorizontal: 10,
      paddingVertical: 8,
      minHeight: 36,
    },
    favoriteCardNote: {
      fontSize: 13,
      fontWeight: '500' as const,
      color: '#FFFFFF',
      marginBottom: 4,
    },
    favoriteCardMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    favoriteCardMetaText: {
      fontSize: 11,
      color: 'rgba(255, 255, 255, 0.8)',
    },
    themesGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginHorizontal: -4,
    },
    themeChip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 20,
      margin: 4,
      borderWidth: 1,
      borderColor: theme.colors.outline + '30',
    },
    themeIcon: {
      marginRight: 6,
    },
    themeName: {
      fontSize: 14,
      color: theme.colors.onSurface,
    },
    themeCount: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginLeft: 6,
      backgroundColor: theme.colors.surfaceVariant,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    equipmentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      padding: 12,
      borderRadius: 12,
      marginBottom: 8,
    },
    equipmentIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.secondaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    equipmentInfo: {
      flex: 1,
    },
    equipmentName: {
      fontSize: 14,
      fontWeight: '600' as const,
      color: theme.colors.onSurface,
    },
    equipmentMeta: {
      fontSize: 12,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    emptyState: {
      alignItems: 'center',
      padding: 24,
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.onSurfaceVariant,
      marginTop: 8,
    },
  });

  // Render empty state for a section
  const renderEmpty = (text) => (
    <View style={styles.emptyState}>
      <Icon name="inbox" size={32} color={theme.colors.onSurfaceVariant} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        style={[styles.scrollView, { 
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        }]}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[theme.colors.primary]}
            tintColor={theme.colors.primary}
          />
        }
      >
        {/* Quick Stats */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Overview</Text>
          </View>
          <View style={styles.statsGrid}>
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => navigation.navigate('Stats')}
            >
              <View style={styles.statIconContainer}>
                <Icon name="film" size={22} color={theme.colors.primary} />
              </View>
              <Text style={styles.statValue}>{stats.rolls}</Text>
              <Text style={styles.statLabel}>Rolls</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => navigation.navigate('Stats')}
            >
              <View style={styles.statIconContainer}>
                <Icon name="image" size={22} color={theme.colors.primary} />
              </View>
              <Text style={styles.statValue}>{stats.photos}</Text>
              <Text style={styles.statLabel}>Photos</Text>
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={styles.statCard}
              onPress={() => navigation.navigate('Favorites')}
            >
              <View style={[styles.statIconContainer, { backgroundColor: '#FFE4E4' }]}>
                <Icon name="heart" size={22} color="#E53935" />
              </View>
              <Text style={styles.statValue}>{stats.favorites}</Text>
              <Text style={styles.statLabel}>Favorites</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Favorites */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Favorites</Text>
            <TouchableOpacity 
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Favorites')}
            >
              <Text style={styles.seeAllText}>See All</Text>
              <Icon name="chevron-right" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          {recentFavorites.length > 0 ? (
            <View style={styles.quickAccessGrid}>
              {recentFavorites.map((photo) => (
                <TouchableOpacity
                  key={photo.id}
                  style={styles.favoriteCard}
                  onPress={() => navigation.navigate('PhotoView', { photoId: photo.id })}
                >
                  {photo.thumbnail_url ? (
                    <Image
                      source={{ uri: photo.thumbnail_url }}
                      style={styles.favoriteCardImage}
                      resizeMode="cover"
                      onError={(e) => console.log('[LibraryScreen] Image load error:', photo.id, e.nativeEvent.error)}
                    />
                  ) : (
                    <View style={[styles.favoriteCardImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.surfaceVariant }]}>
                      <Icon name="image" size={32} color={theme.colors.onSurfaceVariant} />
                    </View>
                  )}
                  {/* Semi-transparent overlay with photo info */}
                  <View style={styles.favoriteCardOverlay}>
                    {photo.caption ? (
                      <Text style={styles.favoriteCardNote} numberOfLines={2}>
                        {photo.caption}
                      </Text>
                    ) : null}
                    <View style={styles.favoriteCardMeta}>
                      {photo.date_taken || photo.taken_at ? (
                        <Text style={styles.favoriteCardMetaText} numberOfLines={1}>
                          {new Date(photo.date_taken || photo.taken_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                        </Text>
                      ) : null}
                      {(photo.camera || photo.film_name) ? (
                        <Text style={styles.favoriteCardMetaText} numberOfLines={1}>
                          {photo.camera || photo.film_name}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : renderEmpty('No favorites yet')}
        </View>

        {/* Collections/Themes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Collections</Text>
            <TouchableOpacity 
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Themes')}
            >
              <Text style={styles.seeAllText}>See All</Text>
              <Icon name="chevron-right" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          {topThemes.length > 0 ? (
            <View style={styles.themesGrid}>
              {topThemes.map((tag) => (
                <TouchableOpacity
                  key={tag.id}
                  style={styles.themeChip}
                  onPress={() => navigation.navigate('TagDetail', { 
                    tagId: tag.id, 
                    tagName: tag.name 
                  })}
                >
                  <Icon 
                    name="tag" 
                    size={14} 
                    color={tag.color || theme.colors.primary} 
                    style={styles.themeIcon}
                  />
                  <Text style={styles.themeName}>{tag.name}</Text>
                  <Text style={styles.themeCount}>{tag.photos_count || tag.photo_count || 0}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : renderEmpty('No collections yet')}
        </View>

        {/* Equipment */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Equipment</Text>
            <TouchableOpacity 
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Equipment')}
            >
              <Text style={styles.seeAllText}>See All</Text>
              <Icon name="chevron-right" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>
          
          {topEquipment.length > 0 ? (
            <View>
              {topEquipment.map((item, index) => (
                <TouchableOpacity
                  key={item.id || index}
                  style={styles.equipmentRow}
                  onPress={() => navigation.navigate('EquipmentRolls', {
                    type: 'camera',
                    id: item.name, // Use camera name since stats/gear doesn't return equip_id
                    name: item.name
                  })}
                >
                  <View style={styles.equipmentIcon}>
                    <Icon 
                      name="camera" 
                      size={20} 
                      color={theme.colors.secondary} 
                    />
                  </View>
                  <View style={styles.equipmentInfo}>
                    <Text style={styles.equipmentName}>{item.name}</Text>
                    <Text style={styles.equipmentMeta}>
                      {item.photo_count || 0} photos
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              ))}
            </View>
          ) : renderEmpty('No equipment yet')}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Access</Text>
          </View>
          
          <View style={styles.quickAccessGrid}>
            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('Inventory')}
            >
              <View style={[styles.quickCardImage, { 
                justifyContent: 'center', 
                alignItems: 'center',
                backgroundColor: theme.colors.primaryContainer + '40',
              }]}>
                <Icon name="package" size={40} color={theme.colors.primary} />
              </View>
              <View style={styles.quickCardContent}>
                <Text style={styles.quickCardTitle}>Inventory</Text>
                <Text style={styles.quickCardSubtitle}>{stats.inventory} in stock</Text>
              </View>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('Stats')}
            >
              <View style={[styles.quickCardImage, { 
                justifyContent: 'center', 
                alignItems: 'center',
                backgroundColor: theme.colors.secondaryContainer + '40',
              }]}>
                <Icon name="bar-chart-2" size={40} color={theme.colors.secondary} />
              </View>
              <View style={styles.quickCardContent}>
                <Text style={styles.quickCardTitle}>Statistics</Text>
                <Text style={styles.quickCardSubtitle}>View insights</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  );
}
