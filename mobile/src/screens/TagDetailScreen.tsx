import React, { useContext, useEffect, useState, useRef, useCallback } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, Dimensions, Animated } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { ApiContext } from '../context/ApiContext';
import { api } from '../api/client';
import CachedImage from '../components/CachedImage';
import { getPhotoUrl } from '../utils/urls';
import { Icon } from '../components/ui';

const numColumns = 3;
const screenWidth = Dimensions.get('window').width;
const tileSize = screenWidth / numColumns;

export default function TagDetailScreen({ route, navigation }: any) {
  const { tagId } = route.params;
  const { baseUrl } = useContext(ApiContext);
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPhotos = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await api.http.get(`/api/tags/${tagId}/photos`);
      setPhotos(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPhotos();
  }, [baseUrl, tagId]);

  const renderItem = ({ item, index }: any) => {
    const thumbUrl = getPhotoUrl(baseUrl, item, 'thumb');
    
    return (
      <TouchableOpacity 
        onPress={() => navigation.navigate('PhotoView', { photo: item, rollId: item.roll_id, photos, initialIndex: index, viewMode: 'positive' })}
      >
        <CachedImage
          uri={thumbUrl || ""}
          style={{ width: tileSize, height: tileSize, margin: 1 }}
          contentFit="cover"
        />
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator animating={true} size="large" style={styles.loader} color="#5a4632" />
      ) : (
        <FlatList
          data={photos}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          numColumns={numColumns}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fdfdfd' },
  loader: { marginTop: 50 },
  listContent: { paddingBottom: 20 },
});
