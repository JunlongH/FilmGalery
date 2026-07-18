/**
 * EquipmentScreen - Mobile equipment management
 * Manage cameras, lenses, and flashes
 */
import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Image, Animated } from 'react-native';
import { 
  Text, 
  FAB, 
  Searchbar, 
  SegmentedButtons, 
  ActivityIndicator,
  useTheme,
  Portal,
  Dialog,
  Button,
  TextInput
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { getCameras, getLenses, getFlashes, createCamera, createLens, createFlash, deleteCamera, deleteLens, deleteFlash } from '../api/equipment';
import { getFilms } from '../api/filmItems';
import { spacing, radius } from '../theme';
import { ApiContext } from '../context/ApiContext';
import CachedImage from '../components/CachedImage';
import { Icon } from '../components/ui';
import { buildUploadUrl } from '../utils/urlHelper';

export default function EquipmentScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);
  const [tab, setTab] = useState('camera');
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  
  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  
  // Animate on focus
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );
  
  // Add dialog - common fields
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addBrand, setAddBrand] = useState('');
  const [addModel, setAddModel] = useState('');
  const [addMount, setAddMount] = useState('');
  const [addType, setAddType] = useState('SLR');
  
  // Add dialog - lens-specific fields
  const [addFocalMin, setAddFocalMin] = useState('');
  const [addFocalMax, setAddFocalMax] = useState('');
  const [addMaxAperture, setAddMaxAperture] = useState('');
  const [addMaxApertureTele, setAddMaxApertureTele] = useState('');
  const [addFilterSize, setAddFilterSize] = useState('');
  const [addIsMacro, setAddIsMacro] = useState(false);

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  useEffect(() => {
    navigation.setOptions({ title: 'Equipments' });
  }, [navigation]);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      let data;
      if (tab === 'camera') {
        data = await getCameras();
      } else if (tab === 'lens') {
        data = await getLenses();
      } else if (tab === 'flash') {
        data = await getFlashes();
      } else if (tab === 'film') {
        data = await getFilms();
      }
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch equipment:', err);
      setItems([]);
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchItems();
    setRefreshing(false);
  };

  const handleAdd = async () => {
    if (!addBrand.trim() || !addModel.trim()) return;
    
    try {
      let newItem: any;
      if (tab === 'camera') {
        newItem = await createCamera({ 
          name: `${addBrand.trim()} ${addModel.trim()}`,
          brand: addBrand.trim(), 
          model: addModel.trim(),
          type: addType,
          mount: addMount.trim() || undefined
        });
      } else if (tab === 'lens') {
        const focalMin = parseFloat(addFocalMin) || null;
        const focalMax = parseFloat(addFocalMax) || focalMin; // Default to min if not specified
        const maxAp = parseFloat(addMaxAperture) || undefined;
        const maxApTele = parseFloat(addMaxApertureTele) || null;
        
        newItem = await createLens({ 
          name: `${addBrand.trim()} ${addModel.trim()}`,
          brand: addBrand.trim(), 
          model: addModel.trim(),
          mount: addMount.trim() || undefined,
          focal_length_min: focalMin,
          focal_length_max: focalMax,
          max_aperture: maxAp,
          max_aperture_tele: maxApTele,
          filter_size: parseFloat(addFilterSize) || undefined,
          is_macro: addIsMacro ? 1 : 0
        });
      } else if (tab === 'flash') {
        newItem = await createFlash({ 
          name: `${addBrand.trim()} ${addModel.trim()}`,
          brand: addBrand.trim(), 
          model: addModel.trim()
        });
      }
      
      if (newItem) {
        setItems(prev => [...prev, newItem]);
      }
    } catch (err) {
      console.error('Failed to create equipment:', err);
    }
    
    // Reset all fields
    setShowAddDialog(false);
    setAddBrand('');
    setAddModel('');
    setAddMount('');
    setAddFocalMin('');
    setAddFocalMax('');
    setAddMaxAperture('');
    setAddMaxApertureTele('');
    setAddFilterSize('');
    setAddIsMacro(false);
    setAddMount('');
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    
    try {
      if (tab === 'camera') {
        await deleteCamera(deleteTarget.id);
      } else if (tab === 'lens') {
        await deleteLens(deleteTarget.id);
      } else if (tab === 'flash') {
        await deleteFlash(deleteTarget.id);
      }
      
      setItems(prev => prev.filter((i: any) => i.id !== deleteTarget.id));
    } catch (err) {
      console.error('Failed to delete equipment:', err);
    }
    
    setDeleteTarget(null);
  };

  // Filter items by search
  const filteredItems = items.filter((item: any) => {
    const text = `${item.brand || ''} ${item.model || ''} ${item.name || ''}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  const renderItem = ({ item }: any) => {
    // Display title: films use name only (already contains full info), equipment uses brand+model
    const displayTitle = tab === 'film' 
      ? item.name || '' 
      : `${item.brand || ''} ${item.model || ''}`.trim();
    
    // Build subtitle and tags
    let subtitle = '';
    let tags = [];
    
    if (tab === 'camera') {
      subtitle = item.camera_type || item.type || '';
      if (item.mount) tags.push(item.mount);
      if (item.has_fixed_lens) tags.push('Fixed Lens');
      if (item.meter_type && item.meter_type !== 'none') tags.push(item.meter_type);
      if (item.production_year_start) tags.push(`${item.production_year_start}`);
    } else if (tab === 'lens') {
      // Focal length display
      if (item.focal_length_min) {
        const isZoom = item.focal_length_max && item.focal_length_min !== item.focal_length_max;
        subtitle = isZoom
          ? `${item.focal_length_min}-${item.focal_length_max}mm`
          : `${item.focal_length_min}mm`;
      }
      // Aperture display (show variable if applicable)
      if (item.max_aperture) {
        const isVariable = item.max_aperture_tele && item.max_aperture !== item.max_aperture_tele;
        tags.push(isVariable ? `f/${item.max_aperture}-${item.max_aperture_tele}` : `f/${item.max_aperture}`);
      }
      if (item.mount) tags.push(item.mount);
      if (item.is_macro) tags.push('Macro');
      if (item.image_stabilization) tags.push('IS');
      if (item.filter_size) tags.push(`⌀${item.filter_size}`);
    } else if (tab === 'flash') {
      if (item.guide_number) subtitle = `GN${item.guide_number}`;
      if (item.ttl_compatible) tags.push('TTL');
    } else if (tab === 'film') {
      subtitle = item.iso ? `ISO ${item.iso}` : '';
      if (item.format) tags.push(item.format);
      if (item.category) tags.push(item.category);
    }
    
    // Get thumbnail URL - use buildUploadUrl for proper path handling
    const thumbUrl = buildUploadUrl(item.image_path || item.thumbPath, baseUrl);
    
    // Debug: log first item to verify data
    if (filteredItems.indexOf(item) === 0) {
      console.log(`[${tab}] First item:`, {
        name: displayTitle,
        image_path: item.image_path,
        thumbPath: item.thumbPath,
        baseUrl,
        thumbUrl
      });
    }
    
    return (
      <TouchableOpacity
        style={styles.cardWrapper}
        onPress={() => navigation.navigate('EquipmentRolls', { 
          type: tab, 
          id: item.id, 
          name: displayTitle
        })}
        onLongPress={() => tab !== 'film' && setDeleteTarget(item)}
        activeOpacity={0.7}
      >
        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
          {/* Thumbnail */}
          <View style={[styles.thumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
            {thumbUrl ? (
              <CachedImage uri={thumbUrl} style={styles.thumbImage} contentFit="cover" />
            ) : (
              <View style={[styles.thumbPlaceholder, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Icon 
                  name={tab === 'camera' ? 'camera' : tab === 'lens' ? 'aperture' : tab === 'flash' ? 'zap' : 'film'} 
                  size={32} 
                  color={theme.colors.onSurfaceVariant} 
                />
              </View>
            )}
          </View>
          
          {/* Content */}
          <View style={styles.cardContent}>
            <Text variant="titleMedium" style={[styles.cardTitle, { color: theme.colors.onSurface }]} numberOfLines={1}>
              {displayTitle}
            </Text>
            {subtitle ? (
              <Text variant="bodySmall" style={[styles.cardSubtitle, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
            {tags.length > 0 && (
              <View style={styles.tagRow}>
                {tags.map((tag, idx) => (
                  <View key={idx} style={[styles.tag, { backgroundColor: theme.colors.surfaceVariant }]}>
                    <Text style={[styles.tagText, { color: theme.colors.onSurfaceVariant }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          
          {/* Arrow */}
          <Icon name="chevron-right" size={24} color={theme.colors.onSurfaceVariant} style={styles.arrow} />
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Tabs */}
      <SegmentedButtons
        value={tab}
        onValueChange={setTab}
        buttons={[
          { value: 'camera', label: 'Cameras', icon: 'camera' },
          { value: 'lens', label: 'Lenses', icon: 'camera-iris' },
          { value: 'flash', label: 'Flashes', icon: 'flash' },
          { value: 'film', label: 'Films', icon: 'filmstrip' },
        ]}
        style={styles.tabs}
        density="small"
      />

      {/* Search */}
      <Searchbar
        placeholder="Search equipment..."
        value={search}
        onChangeText={setSearch}
        style={styles.searchbar}
      />

      {/* List */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text variant="bodyLarge">No {tab}s found</Text>
              <Text variant="bodyMedium" style={{ opacity: 0.6, marginTop: 4 }}>
                Tap + to add one
              </Text>
            </View>
          }
        />
      )}

      {/* FAB */}
      <FAB
        icon="plus"
        style={[styles.fab, { backgroundColor: theme.colors.primary }]}
        onPress={() => setShowAddDialog(true)}
      />

      {/* Add Dialog */}
      <Portal>
        <Dialog visible={showAddDialog} onDismiss={() => setShowAddDialog(false)} style={styles.addDialog}>
          <Dialog.Title>Add {tab === 'camera' ? 'Camera' : tab === 'lens' ? 'Lens' : tab === 'flash' ? 'Flash' : 'Film'}</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScrollArea}>
            <View style={styles.dialogContent}>
              <TextInput
                label="Brand"
                mode="outlined"
                value={addBrand}
                onChangeText={setAddBrand}
                style={styles.dialogInput}
              />
              <TextInput
                label="Model"
                mode="outlined"
                value={addModel}
                onChangeText={setAddModel}
                style={styles.dialogInput}
              />
              {(tab === 'camera' || tab === 'lens') && (
                <TextInput
                  label="Mount (e.g., Nikon F, Canon EF)"
                  mode="outlined"
                  value={addMount}
                  onChangeText={setAddMount}
                  style={styles.dialogInput}
                />
              )}
              {tab === 'camera' && (
                <SegmentedButtons
                  value={addType}
                  onValueChange={setAddType}
                  buttons={[
                    { value: 'SLR', label: 'SLR' },
                    { value: 'Rangefinder', label: 'RF' },
                    { value: 'Point-and-Shoot', label: 'P&S' },
                  ]}
                  style={{ marginTop: spacing.sm }}
                />
              )}
              {/* Lens-specific fields */}
              {tab === 'lens' && (
                <>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label="Focal Min (mm)"
                      mode="outlined"
                      value={addFocalMin}
                      onChangeText={setAddFocalMin}
                      keyboardType="numeric"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                    <TextInput
                      label="Focal Max (mm)"
                      mode="outlined"
                      value={addFocalMax}
                      onChangeText={setAddFocalMax}
                      keyboardType="numeric"
                      placeholder="Same for prime"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                  </View>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label="Max Aperture (f/)"
                      mode="outlined"
                      value={addMaxAperture}
                      onChangeText={setAddMaxAperture}
                      keyboardType="decimal-pad"
                      placeholder="e.g., 2.8"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                    <TextInput
                      label="@ Tele (f/)"
                      mode="outlined"
                      value={addMaxApertureTele}
                      onChangeText={setAddMaxApertureTele}
                      keyboardType="decimal-pad"
                      placeholder="For variable"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                  </View>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label="Filter ⌀ (mm)"
                      mode="outlined"
                      value={addFilterSize}
                      onChangeText={setAddFilterSize}
                      keyboardType="numeric"
                      placeholder="e.g., 52"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                    <TouchableOpacity 
                      style={[styles.checkboxRow, styles.dialogInputHalf]}
                      onPress={() => setAddIsMacro(!addIsMacro)}
                    >
                      <Icon 
                        name={addIsMacro ? 'check-square' : 'square'} 
                        size={24} 
                        color={theme.colors.primary} 
                      />
                      <Text style={[styles.checkboxLabel, { color: theme.colors.onSurface }]}>Macro</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setShowAddDialog(false)}>Cancel</Button>
            <Button onPress={handleAdd}>Add</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog visible={!!deleteTarget} onDismiss={() => setDeleteTarget(null)}>
          <Dialog.Title>Delete {tab === 'camera' ? 'Camera' : tab === 'lens' ? 'Lens' : tab === 'flash' ? 'Flash' : 'Film'}?</Dialog.Title>
          <Dialog.Content>
            <Text>
              Are you sure you want to delete {deleteTarget?.brand} {deleteTarget?.model}?
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteTarget(null)}>Cancel</Button>
            <Button onPress={handleDelete} textColor={theme.colors.error}>Delete</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    margin: spacing.md,
  },
  searchbar: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 80,
  },
  cardWrapper: {
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    overflow: 'hidden',
    flexShrink: 0,
  },
  thumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    marginLeft: spacing.sm,
    marginRight: spacing.sm,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600' as const,
    marginBottom: 2,
  },
  cardSubtitle: {
    fontSize: 13,
    marginBottom: 4,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '500' as const,
  },
  arrow: {
    flexShrink: 0,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  fab: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
  },
  dialogInput: {
    marginBottom: spacing.sm,
  },
  addDialog: {
    maxHeight: '80%',
  },
  dialogScrollArea: {
    paddingHorizontal: 0,
  },
  dialogContent: {
    paddingHorizontal: 24,
  },
  dialogRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dialogInputHalf: {
    flex: 1,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  checkboxLabel: {
    fontSize: 14,
  },
});
