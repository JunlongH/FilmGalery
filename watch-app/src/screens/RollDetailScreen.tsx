import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { Photo, Roll } from '../types';

const { width } = Dimensions.get('window');
const THUMBNAIL_SIZE = (width - 48) / 3; // 3 columns with padding

const RollDetailScreen: React.FC = () => {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const roll = route.params?.roll as Roll | undefined;

  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roll) {
      setError('Roll not found');
      setLoading(false);
      return;
    }
    loadPhotos();
  }, [roll]);

  const loadPhotos = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!roll || roll.id == null) return;
      const data = await api.getPhotosByRoll(roll.id);
      // Guard: ensure all photos belong to this roll
      const filteredPhotos = data.filter(photo => photo.roll_id === roll.id);
      setPhotos(filteredPhotos);
    } catch (err: any) {
      console.error('Failed to load photos:', err);
      setError(err.message || 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  };

  const renderPhoto = ({ item }: { item: Photo }) => {
    const thumbnailPath = item.thumb_rel_path || item.positive_thumb_rel_path;
    const imageUrl = api.getImageURL(thumbnailPath || item.full_rel_path);

    return (
      <TouchableOpacity
        style={styles.photoItem}
        onPress={() => navigation.navigate('PhotoViewer', { photo: item })}
      >
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        ) : (
          <View style={[styles.thumbnail, styles.placeholderThumb]}>
            <Text style={styles.placeholderText}>?</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.rollTitle} numberOfLines={1}>{roll?.title || 'Roll'}</Text>
      <Text style={styles.rollSubtitle} numberOfLines={1}>
        {[roll?.film_type || roll?.film_name_joined, roll?.camera, roll?.lens]
          .filter(Boolean)
          .join(' • ') || 'Details coming soon'}
      </Text>
      {roll?.start_date || roll?.end_date ? (
        <Text style={styles.rollSubtitle} numberOfLines={1}>
          {[roll?.start_date, roll?.end_date].filter(Boolean).join(' - ')}
        </Text>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </View>
    );
  }

  if (photos.length === 0) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No photos yet</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={photos}
        renderItem={renderPhoto}
        keyExtractor={item => String(item.id)}
        numColumns={3}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={renderHeader}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#000',
  },
  rollTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  rollSubtitle: {
    color: '#999',
    fontSize: 11,
  },
  grid: {
    padding: 6,
  },
  photoItem: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    margin: 3,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  placeholderThumb: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#666',
    fontSize: 24,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
});

export default RollDetailScreen;
