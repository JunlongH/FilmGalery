import React, { useContext, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions, ScrollView } from 'react-native';
import CachedImage from '../components/CachedImage';
import { colors, spacing, radius } from '../theme';
import { ActivityIndicator, Text, Surface, Divider, IconButton, useTheme, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ApiContext } from '../context/ApiContext';
import axios from 'axios';
import { format } from 'date-fns';
import { getPhotoUrl } from '../utils/urls';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
const tileSize = Math.floor((screenWidth - (spacing.sm * 2) - (numColumns * 2)) / numColumns);

export default function RollDetailScreen({ route, navigation }) {
  const theme = useTheme();
  const { rollId } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState([]);
  const [roll, setRoll] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showNegatives, setShowNegatives] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [rollRes, photosRes] = await Promise.all([
          axios.get(`${baseUrl}/api/rolls/${rollId}`),
          axios.get(`${baseUrl}/api/rolls/${rollId}/photos`)
        ]);
        setRoll(rollRes.data);
        setPhotos(photosRes.data);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [rollId, baseUrl]);

  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" onPress={() => {
          setLoading(true);
          axios.get(`${baseUrl}/api/rolls/${rollId}/photos`).then(res => setPhotos(res.data)).finally(() => setLoading(false));
        }} />
      )
    });
  }, [navigation, baseUrl, rollId]);

  const hasNegatives = photos.some(p => p.negative_rel_path);

  const renderHeader = () => {
    if (!roll) return null;
    return (
      <Surface style={styles.headerSurface} elevation={1}>
        <View style={styles.headerContent}>
          <View style={styles.headerTopRow}>
            <Text style={styles.title}>{roll.title || `Roll #${roll.id}`}</Text>
            <View style={styles.headerActions}>
                {hasNegatives && (
                    <View style={styles.toggleRow}>
                        <Text style={styles.toggleLabel}>Negatives</Text>
                        <Switch 
                            value={showNegatives} 
                            onValueChange={setShowNegatives} 
                            color={colors.primary} 
                            style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                        />
                    </View>
                )}
                <IconButton
                icon={expanded ? 'chevron-up' : 'chevron-down'}
                size={24}
                onPress={() => setExpanded(prev => !prev)}
                accessibilityLabel={expanded ? 'Collapse details' : 'Expand details'}
                color={colors.textSecondary}
                />
            </View>
          </View>

          <Text style={styles.date}>
            {roll.start_date ? format(new Date(roll.start_date), 'MMMM d, yyyy') : 'No Date'}
            {roll.end_date ? ` - ${format(new Date(roll.end_date), 'MMMM d, yyyy')}` : ''}
          </Text>

          {expanded && (
            <>
              <Divider style={styles.divider} />

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Camera</Text>
                  <Text style={styles.metaValue}>{roll.camera || '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Lens</Text>
                  <Text style={styles.metaValue}>{roll.lens || '-'}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>Film Stock</Text>
                  <Text style={styles.metaValue}>{roll.film_name_joined || roll.film_type || '-'}</Text>
                </View>
                <View style={styles.metaItem}>
                  <Text style={styles.metaLabel}>ISO</Text>
                  <Text style={styles.metaValue}>{roll.film_iso_joined || roll.iso || '-'}</Text>
                </View>
              </View>

              {roll.notes ? (
                <View style={styles.notesContainer}>
                  <Text style={styles.metaLabel}>Notes</Text>
                  <Text style={styles.notesText}>{roll.notes}</Text>
                </View>
              ) : null}
            </>
          )}
        </View>
      </Surface>
    );
  };

  const visiblePhotos = showNegatives ? photos.filter(p => p.negative_rel_path) : photos;

  const renderItem = ({ item }) => {
    let uri;
    if (showNegatives && item.negative_rel_path) {
        uri = getPhotoUrl(baseUrl, item, 'negative');
    } else {
        uri = getPhotoUrl(baseUrl, item, 'thumb');
    }

    const initialIndex = visiblePhotos.findIndex(p => p.id === item.id);

    return (
      <TouchableOpacity 
        onPress={() => navigation.navigate('PhotoView', { 
            photo: item, 
            rollId: rollId,
            viewMode: showNegatives ? 'negative' : 'positive',
            photos: visiblePhotos,
            initialIndex,
        })}
        activeOpacity={0.8}
      >
        <CachedImage
          uri={uri}
          style={styles.thumbnail}
          contentFit="cover"
        />
        {item.rating === 1 && (
          <View style={styles.favoriteBadge}>
            <MaterialCommunityIcons name="heart" size={12} color="#fff" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <ActivityIndicator animating={true} size="large" style={styles.loader} color={colors.primary} />
      ) : (
        <FlatList
          data={photos}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          numColumns={numColumns}
          contentContainerStyle={styles.list}
          ListHeaderComponent={renderHeader}
          columnWrapperStyle={styles.columnWrapper}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingBottom: spacing.xl,
  },
  columnWrapper: {
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  headerSurface: {
    backgroundColor: colors.surface,
    marginBottom: spacing.md,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  headerContent: {
    padding: spacing.lg,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  toggleLabel: {
    fontSize: 12,
    marginRight: 4,
    color: colors.textSecondary,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
  date: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.sm,
  },
  divider: {
    marginVertical: spacing.md,
    backgroundColor: '#e0e0e0',
  },
  metaRow: {
    flexDirection: 'row',
    marginBottom: spacing.sm,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  notesContainer: {
    marginTop: spacing.sm,
  },
  notesText: {
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  thumbnail: {
    width: tileSize,
    height: tileSize,
    borderRadius: radius.sm,
    backgroundColor: '#eee',
  },
  favoriteBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: 10,
    padding: 2,
  },
  loader: {
    marginTop: 50,
  },
});
