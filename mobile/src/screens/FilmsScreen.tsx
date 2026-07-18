import React, { useContext, useEffect, useState, useRef } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Animated, TouchableOpacity } from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../components/ui';
import { ApiContext } from '../context/ApiContext';
import { api } from '../api/client';
import FilmCard from '../components/FilmCard';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const itemSize = Math.floor((screenWidth - 16*2 - 8) / numColumns); // padding 16, gap ~8

export default function FilmsScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [films, setFilms] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFilms = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await api.http.get('/api/films');
      setFilms(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilms();
  }, [baseUrl]);

  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  
  useFocusEffect(
    React.useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );
  
  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity 
          style={{ marginRight: 16, padding: 4 }} 
          onPress={async () => { const { clearImageCache } = await import('../components/CachedImage'); await clearImageCache(); fetchFilms(); }}
        >
          <Icon name="refresh-cw" size={20} color="#5a4632" />
        </TouchableOpacity>
      )
    });
  }, [navigation, baseUrl]);

  const renderItem = ({ item }: any) => {
    const coverUri = item.thumbPath ? `${baseUrl}${item.thumbPath}` : null;
    // Film name already contains full information (brand + model)
    const displayTitle = item.name || '';
    // Build right text with format and category
    const rightText = item.format && item.format !== '135' 
      ? `${item.format} • ${item.category}` 
      : item.category;
    return (
      <FilmCard
        coverUri={coverUri}
        title={displayTitle}
        leftText={`ISO ${item.iso}`}
        rightText={rightText}
        style={styles.gridItem}
        onPress={() => navigation.navigate('FilmRolls', { filmId: item.id, filmName: displayTitle })}
      />
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {loading ? (
        <ActivityIndicator animating={true} size="large" style={styles.loader} color="#5a4632" />
      ) : (
        <FlatList
          data={films}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.list}
          numColumns={numColumns}
          columnWrapperStyle={styles.columnWrapper}
        />
      )}
      {/* Removed unused add FAB */}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fdfdfd' },
  list: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between' },
  gridItem: { width: itemSize, marginBottom: 12 },
  fab: { position: 'absolute', margin: 16, right: 0, bottom: 0, backgroundColor: '#f5f0e6' },
  loader: { marginTop: 50 },
});
