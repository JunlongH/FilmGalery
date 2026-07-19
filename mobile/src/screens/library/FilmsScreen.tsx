import React, { useContext, useRef, useMemo } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Animated, TouchableOpacity } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../../components/ui';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import FilmCard from '../../components/FilmCard';
import SkeletonBox from '../../components/SkeletonBox';
import { useApiQuery } from '../../hooks/useApiQuery';

const numColumns = 2;
const screenWidth = Dimensions.get('window').width;
const itemSize = Math.floor((screenWidth - 16*2 - 8) / numColumns); // padding 16, gap ~8

export default function FilmsScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);

  const { data, loading, refresh } = useApiQuery<any[]>(
    baseUrl ? `films@${baseUrl}` : null,
    () => api.http.get('/api/films'),
  );
  const films = useMemo(() => data ?? [], [data]);

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

  // Header refresh button
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          style={{ marginRight: 16, padding: 4 }}
          onPress={refresh}
        >
          <Icon name="refresh-cw" size={20} color={theme.colors.primary} />
        </TouchableOpacity>
      )
    });
  }, [navigation, theme, refresh]);

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
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBox key={i} width={itemSize} height={itemSize} style={styles.skeletonItem} />
          ))}
        </View>
      ) : (
        <FlatList
          data={films}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={styles.list}
          numColumns={numColumns}
          columnWrapperStyle={styles.columnWrapper}
          initialNumToRender={8}
          windowSize={7}
          maxToRenderPerBatch={8}
          removeClippedSubviews={true}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { padding: 16 },
  columnWrapper: { justifyContent: 'space-between' },
  gridItem: { width: itemSize, marginBottom: 12 },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 16, justifyContent: 'space-between' },
  skeletonItem: { marginBottom: 12, borderRadius: 12 },
});
