/**
 * EquipmentScreen - Mobile equipment management
 * Manage cameras, lenses, and flashes
 */
import React, { useState, useCallback, useContext, useRef, useMemo } from 'react';
import { View, FlatList, StyleSheet, RefreshControl, TouchableOpacity, Animated } from 'react-native';
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
import { getCameras, getLenses, getFlashes, createCamera, createLens, createFlash, deleteCamera, deleteLens, deleteFlash } from '../../api/equipment';
import { getFilms } from '../../api/filmItems';
import { spacing, radius } from '../../theme';
import { ApiContext } from '../../context/ApiContext';
import CachedImage from '../../components/CachedImage';
import { Icon } from '../../components/ui';
import { buildUploadUrl } from '../../utils/urlHelper';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useT } from '../../i18n';
import { setQueryData } from '../../api/queryCache';

export default function EquipmentScreen({ navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl } = useContext(ApiContext);
  const [tab, setTab] = useState('camera');
  const tabLabel = t(('equipment.' + tab) as any);
  const [search, setSearch] = useState('');

  const listKey = baseUrl
    ? tab === 'film'
      ? `films@${baseUrl}`
      : `equipment:${tab}@${baseUrl}`
    : null;

  const { data, loading, refreshing, refresh } = useApiQuery<any[]>(
    listKey,
    async () => {
      let res;
      if (tab === 'camera') res = await getCameras();
      else if (tab === 'lens') res = await getLenses();
      else if (tab === 'flash') res = await getFlashes();
      else res = await getFilms();
      return Array.isArray(res) ? res : [];
    },
  );
  const items = useMemo(() => data ?? [], [data]);
  
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

  React.useEffect(() => {
    navigation.setOptions({ title: t('title.equipment') });
  }, [navigation]);

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
      
      if (newItem && listKey) {
        setQueryData(listKey, [...items, newItem]);
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
      
      if (listKey) {
        setQueryData(listKey, items.filter((i: any) => i.id !== deleteTarget.id));
      }
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
      if (item.has_fixed_lens) tags.push(t('equipment.fixedLensTag'));
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
      if (item.is_macro) tags.push(t('equipment.macro'));
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
          { value: 'camera', label: t('equipment.cameras'), icon: 'camera' },
          { value: 'lens', label: t('equipment.lenses'), icon: 'camera-iris' },
          { value: 'flash', label: t('equipment.flashes'), icon: 'flash' },
          { value: 'film', label: t('equipment.films'), icon: 'filmstrip' },
        ]}
        style={styles.tabs}
        density="small"
      />

      {/* Search */}
      <Searchbar
        placeholder={t('equipment.search')}
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
            <RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[theme.colors.primary]} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text variant="bodyLarge">{t('equipment.emptyOf', { what: tabLabel })}</Text>
              <Text variant="bodyMedium" style={{ opacity: 0.6, marginTop: 4 }}>
                {t('equipment.emptyHint')}
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
          <Dialog.Title>{t('equipment.addOf', { what: tabLabel })}</Dialog.Title>
          <Dialog.ScrollArea style={styles.dialogScrollArea}>
            <View style={styles.dialogContent}>
              <TextInput
                label={t('equipment.brand')}
                mode="outlined"
                value={addBrand}
                onChangeText={setAddBrand}
                style={styles.dialogInput}
              />
              <TextInput
                label={t('equipment.model')}
                mode="outlined"
                value={addModel}
                onChangeText={setAddModel}
                style={styles.dialogInput}
              />
              {(tab === 'camera' || tab === 'lens') && (
                <TextInput
                  label={t('equipment.mount')}
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
                    { value: 'SLR', label: t('equipment.slr') },
                    { value: 'Rangefinder', label: t('equipment.rangefinder') },
                    { value: 'Point-and-Shoot', label: t('equipment.pointShoot') },
                  ]}
                  style={{ marginTop: spacing.sm }}
                />
              )}
              {/* Lens-specific fields */}
              {tab === 'lens' && (
                <>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label={t('equipment.focalMin')}
                      mode="outlined"
                      value={addFocalMin}
                      onChangeText={setAddFocalMin}
                      keyboardType="numeric"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                    <TextInput
                      label={t('equipment.focalMax')}
                      mode="outlined"
                      value={addFocalMax}
                      onChangeText={setAddFocalMax}
                      keyboardType="numeric"
                      placeholder={t('equipment.primeHint')}
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                  </View>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label={t('equipment.maxAperture')}
                      mode="outlined"
                      value={addMaxAperture}
                      onChangeText={setAddMaxAperture}
                      keyboardType="decimal-pad"
                      placeholder="e.g., 2.8"
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                    <TextInput
                      label={t('equipment.teleAperture')}
                      mode="outlined"
                      value={addMaxApertureTele}
                      onChangeText={setAddMaxApertureTele}
                      keyboardType="decimal-pad"
                      placeholder={t('equipment.variableHint')}
                      style={[styles.dialogInput, styles.dialogInputHalf]}
                    />
                  </View>
                  <View style={styles.dialogRow}>
                    <TextInput
                      label={t('equipment.filterSize')}
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
                      <Text style={[styles.checkboxLabel, { color: theme.colors.onSurface }]}>{t('equipment.macro')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setShowAddDialog(false)}>{t('common.cancel')}</Button>
            <Button onPress={handleAdd}>{t('common.add')}</Button>
          </Dialog.Actions>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog visible={!!deleteTarget} onDismiss={() => setDeleteTarget(null)}>
          <Dialog.Title>{t('equipment.deleteOf', { what: tabLabel })}</Dialog.Title>
          <Dialog.Content>
            <Text>
              {t('equipment.deleteBody', { name: `${deleteTarget?.brand || ''} ${deleteTarget?.model || ''}` })}
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button onPress={handleDelete} textColor={theme.colors.error}>{t('common.delete')}</Button>
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
