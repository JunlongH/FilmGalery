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

import React, { useCallback, useRef, useContext, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  Animated,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { api } from '../../api/client';
import { Icon } from '../../components/ui';
import CachedImage from '../../components/CachedImage';
import { ApiContext } from '../../context/ApiContext';
import { getPhotoUrl } from '../../utils/urls';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

interface LibraryStats {
  gear: { cameras: any[]; lenses: any[]; films: any[] };
  summary: any;
}

export default function LibraryScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const { baseUrl } = useContext(ApiContext);
  const t = useT();

  const favoritesKey = baseUrl ? `favorites@${baseUrl}` : null;
  const tagsKey = baseUrl ? `tags@${baseUrl}` : null;
  const statsKey = baseUrl ? `libraryStats@${baseUrl}` : null;

  const favoritesQuery = useApiQuery<any[]>(
    favoritesKey,
    () => api.http.get('/api/photos/favorites'),
  );
  const tagsQuery = useApiQuery<any[]>(
    tagsKey,
    () => api.http.get('/api/tags'),
  );
  const statsQuery = useApiQuery<LibraryStats>(
    statsKey,
    async () => {
      const [gear, summary] = await Promise.all([
        api.http.get('/api/stats/gear').catch(() => ({ cameras: [], lenses: [], films: [] })),
        api.http.get('/api/stats/summary').catch(() => ({})),
      ]);
      return { gear, summary };
    },
  );

  const recentFavorites = useMemo(
    () => (favoritesQuery.data ?? []).slice(0, 4),
    [favoritesQuery.data],
  );
  const topThemes = useMemo(() => (tagsQuery.data ?? []).slice(0, 6), [tagsQuery.data]);
  const topEquipment = useMemo(() => {
    const cameras = statsQuery.data?.gear?.cameras;
    return (Array.isArray(cameras) ? cameras : []).slice(0, 4).map((cam: any, idx: number) => ({
      id: idx + 1,
      name: cam.name,
      photo_count: cam.count || 0,
    }));
  }, [statsQuery.data]);

  const stats = useMemo(() => {
    const summary = statsQuery.data?.summary ?? {};
    const cameras = statsQuery.data?.gear?.cameras;
    return {
      favorites: favoritesQuery.data?.length ?? 0,
      themes: tagsQuery.data?.length ?? 0,
      equipment: Array.isArray(cameras) ? cameras.length : 0,
      inventory: summary.inventory_in_stock || summary.inventory_total || 0,
      rolls: summary.total_rolls || 0,
      photos: summary.total_photos || 0,
    };
  }, [statsQuery.data, favoritesQuery.data, tagsQuery.data]);

  const refreshing =
    favoritesQuery.refreshing || tagsQuery.refreshing || statsQuery.refreshing;
  const onRefresh = useCallback(() => {
    favoritesQuery.refresh();
    tagsQuery.refresh();
    statsQuery.refresh();
  }, [favoritesQuery.refresh, tagsQuery.refresh, statsQuery.refresh]);

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

  const styles = useMemo(() => createStyles(theme), [theme]);

  // Render empty state for a section
  const renderEmpty = (text: any) => (
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
            <Text style={styles.sectionTitle}>概览</Text>
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
              <Text style={styles.statLabel}>胶卷</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => navigation.navigate('Stats')}
            >
              <View style={styles.statIconContainer}>
                <Icon name="image" size={22} color={theme.colors.primary} />
              </View>
              <Text style={styles.statValue}>{stats.photos}</Text>
              <Text style={styles.statLabel}>照片</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statCard}
              onPress={() => navigation.navigate('Favorites')}
            >
              <View style={[styles.statIconContainer, { backgroundColor: '#FFE4E4' }]}>
                <Icon name="heart" size={22} color="#E53935" />
              </View>
              <Text style={styles.statValue}>{stats.favorites}</Text>
              <Text style={styles.statLabel}>收藏</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Recent Favorites */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>最近收藏</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Favorites')}
            >
              <Text style={styles.seeAllText}>查看全部</Text>
              <Icon name="chevron-right" size={16} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          {recentFavorites.length > 0 ? (
            <View style={styles.quickAccessGrid}>
              {recentFavorites.map((photo, index) => (
                <TouchableOpacity
                  key={photo.id}
                  style={styles.favoriteCard}
                  onPress={() => navigation.navigate('PhotoView', { photo, photosKey: favoritesKey ?? undefined, initialIndex: index, viewMode: 'positive' })}
                >
                  {getPhotoUrl(baseUrl, photo, 'thumb') ? (
                    <CachedImage
                      uri={getPhotoUrl(baseUrl, photo, 'thumb')!}
                      style={styles.favoriteCardImage}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={[styles.favoriteCardImage, { justifyContent: 'center', alignItems: 'center' }]}>
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
          ) : renderEmpty('暂无收藏')}
        </View>

        {/* Collections/Themes */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>合集</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Collections')}
            >
              <Text style={styles.seeAllText}>查看全部</Text>
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
          ) : renderEmpty('暂无合集')}
        </View>

        {/* Equipment */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>器材</Text>
            <TouchableOpacity
              style={styles.seeAllButton}
              onPress={() => navigation.navigate('Equipment')}
            >
              <Text style={styles.seeAllText}>查看全部</Text>
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
                      {item.photo_count || 0} 张照片
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
                </TouchableOpacity>
              ))}
            </View>
          ) : renderEmpty('暂无器材')}
        </View>

        {/* Quick Actions */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>快速入口</Text>
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
                <Text style={styles.quickCardTitle}>库存</Text>
                <Text style={styles.quickCardSubtitle}>{stats.inventory} 件库存</Text>
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
                <Text style={styles.quickCardTitle}>统计</Text>
                <Text style={styles.quickCardSubtitle}>查看数据洞察</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('Films')}
            >
              <View style={[styles.quickCardImage, {
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: theme.colors.tertiaryContainer + '40',
              }]}>
                <Icon name="film" size={40} color={theme.colors.tertiary} />
              </View>
              <View style={styles.quickCardContent}>
                <Text style={styles.quickCardTitle}>胶卷目录</Text>
                <Text style={styles.quickCardSubtitle}>浏览胶卷型号</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.quickCard}
              onPress={() => navigation.navigate('Negatives')}
            >
              <View style={[styles.quickCardImage, {
                justifyContent: 'center',
                alignItems: 'center',
                backgroundColor: theme.colors.primaryContainer + '40',
              }]}>
                <Icon name="contrast" size={40} color={theme.colors.primary} />
              </View>
              <View style={styles.quickCardContent}>
                <Text style={styles.quickCardTitle}>底片</Text>
                <Text style={styles.quickCardSubtitle}>全部已扫描底片</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </Animated.ScrollView>
    </View>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
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
