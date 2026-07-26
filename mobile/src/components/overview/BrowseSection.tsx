import React, { useContext, useMemo } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, FlatList } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { AppMode } from '../../context/AppModeContext';
import { ApiContext } from '../../context/ApiContext';
import { getPhotoUrl } from '../../utils/urls';
import { useT } from '../../i18n';
import CachedImage from '../CachedImage';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SIDE_PAD = 12;
const GAP = 10;
const CARD_SIZE = (SCREEN_WIDTH - SIDE_PAD * 2 - GAP) / 2;
const RECENT_THUMB = 120;

export interface BrowseSectionProps {
  mode: AppMode;
  recentPhotos: any[];
  recentLoading?: boolean;
  recentPhotosKey?: string | null;
}

interface EntryCardDef {
  key: string;
  iconName: keyof typeof MaterialCommunityIcons.glyphMap;
  color: string;
  bg: string;
  labelKey: string;
  target: string;
  params?: Record<string, any>;
}

export default function BrowseSection({
  mode,
  recentPhotos,
  recentLoading = false,
  recentPhotosKey,
}: BrowseSectionProps) {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation<any>();
  const { baseUrl } = useContext(ApiContext);

  const entries: EntryCardDef[] = useMemo(() => {
    const base: EntryCardDef[] = [
      {
        key: 'favorites',
        iconName: 'heart',
        color: '#E53935',
        bg: '#FFEBEE',
        labelKey: 'overview.entry.favorites',
        target: 'Favorites',
        params: { mode },
      },
      {
        key: 'stats',
        iconName: 'chart-bar',
        color: '#0097A7',
        bg: '#E0F7FA',
        labelKey: 'overview.entry.stats',
        target: 'Stats',
        params: { mode },
      },
    ];
    if (mode === 'digital') {
      base.push({
        key: 'albums',
        iconName: 'folder-multiple-image',
        color: '#7B1FA2',
        bg: '#F3E5F5',
        labelKey: 'overview.entry.albums',
        target: 'Albums',
      });
    } else {
      base.push({
        key: 'collections',
        iconName: 'bookmark-multiple',
        color: '#7B1FA2',
        bg: '#F3E5F5',
        labelKey: 'overview.entry.collections',
        target: 'Collections',
        params: { mode },
      });
    }
    base.push({
      key: 'map',
      iconName: 'map',
      color: '#FB8C00',
      bg: '#FFF3E0',
      labelKey: 'overview.entry.map',
      target: 'Map',
    });
    return base;
  }, [mode]);

  const onEntryPress = (entry: EntryCardDef) => {
    navigation.navigate(entry.target, entry.params);
  };

  const onRecentPress = (photo: any, index: number) => {
    navigation.navigate('PhotoView', {
      photo,
      photosKey: recentPhotosKey ?? undefined,
      initialIndex: index,
      viewMode: 'positive',
    });
  };

  const recents = useMemo(() => (Array.isArray(recentPhotos) ? recentPhotos.slice(0, 20) : []), [recentPhotos]);

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          {t('overview.browseTitle')}
        </Text>
      </View>

      <View style={styles.entryGrid}>
        {entries.map((entry) => (
          <TouchableOpacity
            key={entry.key}
            style={[styles.entryCard, { backgroundColor: theme.colors.surface }]}
            onPress={() => onEntryPress(entry)}
            activeOpacity={0.85}
            testID={`entry-${entry.key}`}
          >
            <View style={[styles.entryIconWrap, { backgroundColor: entry.bg }]}>
              <MaterialCommunityIcons name={entry.iconName} size={24} color={entry.color} />
            </View>
            <Text style={[styles.entryLabel, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {t(entry.labelKey as any)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: theme.colors.onSurface }]}>
          {t('overview.recentPhotos')}
        </Text>
      </View>

      {recents.length === 0 ? (
        <View style={[styles.recentEmpty, { backgroundColor: theme.colors.surfaceVariant }]}>
          <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 13 }}>
            {recentLoading ? '' : t('overview.recentEmpty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={recents}
          keyExtractor={(item, i) => String(item.id ?? i)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.recentList}
          renderItem={({ item, index }) => {
            const uri = getPhotoUrl(baseUrl, item, 'thumb');
            return (
              <TouchableOpacity
                style={styles.recentItem}
                onPress={() => onRecentPress(item, index)}
                activeOpacity={0.9}
                testID={`recent-${item.id}`}
              >
                {uri ? (
                  <CachedImage uri={uri} style={styles.recentThumb} contentFit="cover" />
                ) : (
                  <View
                    style={[styles.recentThumb, { backgroundColor: theme.colors.surfaceVariant }]}
                  />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 16,
    paddingHorizontal: SIDE_PAD,
  },
  sectionHeader: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  entryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -GAP / 2,
  },
  entryCard: {
    width: CARD_SIZE,
    margin: GAP / 2,
    borderRadius: 12,
    padding: 14,
    alignItems: 'flex-start',
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
  },
  entryIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  entryLabel: {
    fontSize: 14,
    fontWeight: '600' as const,
  },
  recentList: {
    paddingRight: SIDE_PAD,
  },
  recentItem: {
    marginRight: 8,
  },
  recentThumb: {
    width: RECENT_THUMB,
    height: RECENT_THUMB,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  recentEmpty: {
    height: 80,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
