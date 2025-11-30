import React, { useContext, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Dimensions } from 'react-native';
import { ActivityIndicator, useTheme, IconButton } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import axios from 'axios';
import TagCard from '../components/TagCard';
import SkeletonBox from '../components/SkeletonBox';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const cardWidth = (screenWidth - 32 - 10) / numColumns; // 32 padding, 10 gap

export default function ThemesScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchTags = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await axios.get(`${baseUrl}/api/tags`);
      // Filter out tags with 0 photos if desired, or keep them
      setTags(res.data.filter(t => t.photos_count > 0));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTags();
  }, [baseUrl]);

  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" onPress={async () => { const { clearImageCache } = await import('../components/CachedImage'); await clearImageCache(); fetchTags(); }} />
      )
    });
  }, [navigation, baseUrl]);

  const renderItem = ({ item }) => {
    let coverUrl = null;
    if (item.cover_thumb) {
      coverUrl = `${baseUrl}/uploads/${item.cover_thumb}`;
    } else if (item.cover_full) {
      coverUrl = `${baseUrl}/uploads/${item.cover_full}`;
    }
    return (
      <TagCard
        coverUri={coverUrl}
        title={item.name}
        subtitle={`${item.photos_count} photos`}
        style={styles.cardContainer}
        onPress={() => navigation.navigate('TagDetail', { tagId: item.id, tagName: item.name })}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <View style={styles.list}>
          <View style={styles.columnWrapper}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: 8 }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: 8 }} />
          </View>
          <View style={[styles.columnWrapper, { marginTop: 12 }]}>
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: 8 }} />
            <SkeletonBox width={cardWidth} height={cardWidth} style={{ borderRadius: 8 }} />
          </View>
        </View>
      ) : (
        <FlatList
          data={tags}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          numColumns={numColumns}
          contentContainerStyle={styles.list}
          columnWrapperStyle={styles.columnWrapper}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fdfdfd' },
  list: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between' },
  cardContainer: { width: cardWidth, marginBottom: 12 },
  loader: { marginTop: 50 },
});
