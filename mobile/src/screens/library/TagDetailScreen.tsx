import React, { useContext, useMemo } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useTheme } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import CachedImage from '../../components/CachedImage';
import SkeletonBox from '../../components/SkeletonBox';
import { getPhotoUrl } from '../../utils/urls';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useLibraryMode } from '../../hooks/useLibraryMode';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
const tileSize = screenWidth / numColumns;
const ROW_HEIGHT = tileSize + 2; // tile + 2*margin(1)

export default function TagDetailScreen({ route, navigation }: any) {
  const theme = useTheme();
  const { tagId } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const mode = useLibraryMode();

  const photosKey = baseUrl ? `tagPhotos:${tagId}@${baseUrl}#${mode}` : null;
  const { data, loading } = useApiQuery<any[]>(
    photosKey,
    () => api.http.get(`/api/tags/${tagId}/photos`, { mode }),
  );
  const photos = useMemo(() => data ?? [], [data]);

  const renderItem = ({ item, index }: any) => {
    const thumbUrl = getPhotoUrl(baseUrl, item, 'thumb');

    return (
      <TouchableOpacity
        onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photosKey, initialIndex: index, viewMode: 'positive' })}
      >
        <CachedImage
          uri={thumbUrl || ""}
          style={{ width: tileSize, height: tileSize, margin: 1 }}
          contentFit="cover"
        />
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonBox key={i} width={tileSize - 2} height={tileSize - 2} style={styles.skeletonTile} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <FlatList
        data={photos}
        renderItem={renderItem}
        keyExtractor={item => item.id.toString()}
        numColumns={numColumns}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        windowSize={7}
        maxToRenderPerBatch={15}
        removeClippedSubviews={true}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * Math.floor(index / numColumns),
          index,
        })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: { paddingBottom: 20 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  skeletonTile: { margin: 1 },
});
