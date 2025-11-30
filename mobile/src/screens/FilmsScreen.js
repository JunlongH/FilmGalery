import React, { useContext, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, Dimensions } from 'react-native';
import { ActivityIndicator, useTheme, IconButton } from 'react-native-paper';
import { ApiContext } from '../context/ApiContext';
import axios from 'axios';
import FilmCard from '../components/FilmCard';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const itemSize = Math.floor((screenWidth - 16*2 - 8) / numColumns); // padding 16, gap ~8

export default function FilmsScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [films, setFilms] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchFilms = async () => {
    if (!baseUrl) return;
    setLoading(true);
    try {
      const res = await axios.get(`${baseUrl}/api/films`);
      setFilms(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilms();
  }, [baseUrl]);

  // Add header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <IconButton icon="refresh" onPress={async () => { const { clearImageCache } = await import('../components/CachedImage'); await clearImageCache(); fetchFilms(); }} />
      )
    });
  }, [navigation, baseUrl]);

  const renderItem = ({ item }) => {
    const coverUri = item.thumbPath ? `${baseUrl}${item.thumbPath}` : null;
    return (
      <FilmCard
        coverUri={coverUri}
        title={item.name}
        leftText={`ISO ${item.iso}`}
        rightText={item.category}
        style={styles.gridItem}
        onPress={() => navigation.navigate('FilmRolls', { filmId: item.id, filmName: item.name })}
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
