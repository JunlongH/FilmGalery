import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  FlatList,
  TouchableOpacity,
  type ListRenderItem,
  type ViewStyle,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import CachedImage from '../CachedImage';
import { Icon } from '../ui';
import { getPhotoUrl, type PhotoPathSource } from '../../utils/urls';

const NUM_COLUMNS = 3;
const GAP = 2;
const { width } = Dimensions.get('window');
const ITEM_SIZE = Math.floor((width - GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS);

export interface DigitalPhoto extends PhotoPathSource {
  id: number;
  [key: string]: any;
}

export interface DigitalPhotoGridProps {
  photos: DigitalPhoto[];
  baseUrl: string;
  onPhotoPress: (photo: DigitalPhoto, index: number) => void;
  onPhotoLongPress?: (photo: DigitalPhoto, index: number) => void;
  onEndReached?: (info: { distanceFromEnd: number }) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  ListHeaderComponent?: React.ReactElement | React.ComponentType<any> | null;
  ListEmptyComponent?: React.ReactElement | React.ComponentType<any> | null;
  ListFooterComponent?: React.ReactElement | React.ComponentType<any> | null;
}

export default function DigitalPhotoGrid({
  photos,
  baseUrl,
  onPhotoPress,
  onPhotoLongPress,
  onEndReached,
  refreshing,
  onRefresh,
  ListHeaderComponent,
  ListEmptyComponent,
  ListFooterComponent,
}: DigitalPhotoGridProps) {
  const theme = useTheme();

  const renderItem: ListRenderItem<DigitalPhoto> = ({ item, index }) => {
    const uri = getPhotoUrl(baseUrl, item, 'thumb');
    return (
      <TouchableOpacity
        onPress={() => onPhotoPress(item, index)}
        onLongPress={onPhotoLongPress ? () => onPhotoLongPress(item, index) : undefined}
        activeOpacity={0.85}
        style={styles.cell}
      >
        {uri ? (
          <CachedImage uri={uri} style={styles.thumb} contentFit="cover" />
        ) : (
          <View style={[styles.thumb, { backgroundColor: theme.colors.surfaceVariant, alignItems: 'center', justifyContent: 'center' }]}>
            <Icon name="image" size={28} color={theme.colors.onSurfaceVariant} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <FlatList
      data={photos}
      keyExtractor={(item) => String(item.id)}
      renderItem={renderItem}
      numColumns={NUM_COLUMNS}
      getItemLayout={(_, index) => ({
        length: ITEM_SIZE,
        offset: ITEM_SIZE * Math.floor(index / NUM_COLUMNS),
        index,
      })}
      removeClippedSubviews
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={9}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      refreshing={refreshing}
      onRefresh={onRefresh}
      columnWrapperStyle={styles.row as ViewStyle}
      ListHeaderComponent={ListHeaderComponent as any}
      ListEmptyComponent={ListEmptyComponent as any}
      ListFooterComponent={ListFooterComponent as any}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 8,
    paddingBottom: 32,
  },
  row: {
    gap: GAP,
  },
  cell: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
  },
  thumb: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
