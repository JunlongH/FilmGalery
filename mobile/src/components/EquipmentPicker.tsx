/**
 * EquipmentPicker - Mobile equipment selector component
 * Supports camera, lens, and flash selection with search and quick-add
 */
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, FlatList, TouchableOpacity, Modal } from 'react-native';
import { Text, Searchbar, Button, TextInput, ActivityIndicator, useTheme } from 'react-native-paper';
import { getCameras, getLenses, getFlashes, getCompatibleLenses, createCamera, createLens } from '../api/equipment';
import { spacing } from '../theme';

export default function EquipmentPicker({
  type = 'camera',
  value,
  cameraId,
  onChange,
  disabled = false,
  placeholder = 'Select...',
  label
}: any) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [fixedLensInfo, setFixedLensInfo] = useState<any>(null);
  const [useAdapter, setUseAdapter] = useState(false);
  const [cameraMount, setCameraMount] = useState<any>(null);
  
  // Quick add state
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddBrand, setQuickAddBrand] = useState('');
  const [quickAddModel, setQuickAddModel] = useState('');

  // Load selected item on mount
  useEffect(() => {
    if (value && items.length > 0) {
      const found = items.find((i: any) => i.id === value);
      if (found) setSelectedItem(found);
    }
  }, [value, items]);

  // Fetch items when modal opens
  const fetchItems = async () => {
    setLoading(true);
    try {
      let data;
      if (type === 'camera') {
        data = await getCameras();
        setCameraMount(null);
      } else if (type === 'lens') {
        if (cameraId) {
          // Get compatible lenses for this camera
          const result = await getCompatibleLenses(cameraId);
          if (result.fixed_lens) {
            // Camera has fixed lens, show info instead of list
            setFixedLensInfo(result);
            setCameraMount(null);
            setItems([]);
            setLoading(false);
            return;
          }
          setFixedLensInfo(null);
          setCameraMount(result.camera_mount || null);
          
          if (useAdapter) {
            // Adapter mode: fetch all lenses
            data = await getLenses();
          } else {
            // Normal mode: only compatible lenses
            data = result.lenses || [];
          }
        } else {
          data = await getLenses();
        }
      } else if (type === 'flash') {
        data = await getFlashes();
      }
      setItems(Array.isArray(data) ? data : []);
      setFixedLensInfo(null);
    } catch (err) {
      console.error('Failed to fetch equipment:', err);
      setItems([]);
    }
    setLoading(false);
  };

  const handleOpen = () => {
    if (disabled) return;
    setVisible(true);
    setSearch('');
    fetchItems();
  };

  const handleSelect = (item: any) => {
    setSelectedItem(item);
    onChange?.(item.id, item);
    setVisible(false);
  };

  const handleClear = () => {
    setSelectedItem(null);
    onChange?.(null, null);
    setVisible(false);
  };

  const handleQuickAdd = async () => {
    if (!quickAddBrand.trim() || !quickAddModel.trim()) return;
    
    try {
      let newItem: any;
      if (type === 'camera') {
        newItem = await createCamera({ brand: quickAddBrand.trim(), model: quickAddModel.trim() });
      } else if (type === 'lens') {
        newItem = await createLens({ brand: quickAddBrand.trim(), model: quickAddModel.trim() });
      }
      
      if (newItem) {
        setItems(prev => [...prev, newItem]);
        handleSelect(newItem);
      }
    } catch (err) {
      console.error('Failed to create equipment:', err);
    }
    
    setShowQuickAdd(false);
    setQuickAddBrand('');
    setQuickAddModel('');
  };

  // Filter items by search
  const filteredItems = items.filter((item: any) => {
    const text = `${item.brand || ''} ${item.model || ''}`.toLowerCase();
    return text.includes(search.toLowerCase());
  });

  // Display text
  const displayText = selectedItem 
    ? `${selectedItem.brand} ${selectedItem.model}`
    : placeholder;

  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <TouchableOpacity 
        style={[
          styles.selector, 
          { 
            borderColor: theme.colors.outline,
            backgroundColor: disabled ? theme.colors.surfaceDisabled : theme.colors.surface 
          }
        ]}
        onPress={handleOpen}
        disabled={disabled}
      >
        <Text 
          style={[
            styles.selectorText,
            { color: selectedItem ? theme.colors.onSurface : theme.colors.onSurfaceVariant }
          ]}
          numberOfLines={1}
        >
          {displayText}
        </Text>
        <Text style={styles.chevron}>▼</Text>
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
            {/* Header */}
            <View style={styles.modalHeader}>
              <Text variant="titleMedium">
                Select {type === 'camera' ? 'Camera' : type === 'lens' ? 'Lens' : 'Flash'}
              </Text>
              <TouchableOpacity onPress={() => setVisible(false)}>
                <Text style={{ fontSize: 24 }}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Search */}
            <Searchbar
              placeholder="Search..."
              value={search}
              onChangeText={setSearch}
              style={styles.searchbar}
            />

            {/* Adapter toggle for lens selection with camera */}
            {type === 'lens' && cameraId && cameraMount && !fixedLensInfo && (
              <View style={styles.adapterToggle}>
                <TouchableOpacity 
                  style={styles.adapterCheckbox}
                  onPress={() => {
                    setUseAdapter(!useAdapter);
                    // Refetch with new adapter setting
                    setTimeout(fetchItems, 0);
                  }}
                >
                  <View style={[styles.checkbox, useAdapter && styles.checkboxChecked]}>
                    {useAdapter && <Text style={{ color: '#fff', fontSize: 12 }}>✓</Text>}
                  </View>
                  <Text style={styles.adapterLabel}>Use Adapter (show all lenses)</Text>
                </TouchableOpacity>
                <Text style={styles.mountInfo}>Camera mount: {cameraMount}</Text>
              </View>
            )}

            {/* Fixed lens info */}
            {fixedLensInfo && (
              <View style={[styles.fixedLensInfo, { backgroundColor: theme.colors.primaryContainer }]}>
                <Text variant="titleSmall" style={{ marginBottom: 4 }}>Fixed Lens Camera</Text>
                <Text>
                  {fixedLensInfo.focal_length ? `${fixedLensInfo.focal_length}mm` : 'Built-in'} 
                  {fixedLensInfo.max_aperture ? ` f/${fixedLensInfo.max_aperture}` : ''}
                </Text>
              </View>
            )}

            {/* Loading */}
            {loading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" />
              </View>
            )}

            {/* Items list */}
            {!loading && !fixedLensInfo && (
              <FlatList
                data={filteredItems}
                keyExtractor={item => String(item.id)}
                style={styles.list}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <Text>No {type}s found</Text>
                    {!showQuickAdd && (
                      <Button 
                        mode="outlined" 
                        onPress={() => setShowQuickAdd(true)}
                        style={{ marginTop: spacing.md }}
                      >
                        Add New
                      </Button>
                    )}
                  </View>
                }
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.listItem,
                      item.id === value && { backgroundColor: theme.colors.primaryContainer },
                      type === 'lens' && useAdapter && item.mount && item.mount !== cameraMount && styles.adaptedItem
                    ]}
                    onPress={() => handleSelect(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyLarge">{item.brand} {item.model}</Text>
                      {type === 'camera' && item.camera_type && (
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {item.camera_type} • {item.mount || 'No mount'}
                          {item.has_fixed_lens ? ' • Fixed lens' : ''}
                        </Text>
                      )}
                      {type === 'lens' && (
                        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
                          {item.mount || 'Universal'}
                          {item.focal_length_min ? ` • ${item.focal_length_min === item.focal_length_max || !item.focal_length_max ? `${item.focal_length_min}mm` : `${item.focal_length_min}-${item.focal_length_max}mm`}` : ''}
                        </Text>
                      )}
                    </View>
                    {type === 'lens' && useAdapter && item.mount && item.mount !== cameraMount && (
                      <View style={styles.adapterBadge}>
                        <Text style={styles.adapterBadgeText}>Adapter</Text>
                      </View>
                    )}
                    {item.id === value && <Text style={{ color: theme.colors.primary }}>✓</Text>}
                  </TouchableOpacity>
                )}
              />
            )}

            {/* Quick add form */}
            {showQuickAdd && (
              <View style={styles.quickAddForm}>
                <TextInput
                  label="Brand"
                  mode="outlined"
                  value={quickAddBrand}
                  onChangeText={setQuickAddBrand}
                  style={styles.quickAddInput}
                />
                <TextInput
                  label="Model"
                  mode="outlined"
                  value={quickAddModel}
                  onChangeText={setQuickAddModel}
                  style={styles.quickAddInput}
                />
                <View style={styles.quickAddButtons}>
                  <Button mode="outlined" onPress={() => setShowQuickAdd(false)}>Cancel</Button>
                  <Button mode="contained" onPress={handleQuickAdd}>Add</Button>
                </View>
              </View>
            )}

            {/* Footer buttons */}
            <View style={styles.modalFooter}>
              <Button mode="outlined" onPress={handleClear}>Clear</Button>
              {!showQuickAdd && filteredItems.length > 0 && (
                <Button mode="text" onPress={() => setShowQuickAdd(true)}>+ Add New</Button>
              )}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 12,
    marginBottom: 4,
    opacity: 0.7,
  },
  selector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  selectorText: {
    flex: 1,
    fontSize: 16,
  },
  chevron: {
    fontSize: 10,
    marginLeft: 8,
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '80%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.md,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  searchbar: {
    marginBottom: spacing.md,
  },
  list: {
    maxHeight: 300,
  },
  listItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingContainer: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  fixedLensInfo: {
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
  },
  adapterToggle: {
    backgroundColor: '#fefce8',
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde047',
  },
  adapterCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#854d0e',
    borderRadius: 4,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: '#854d0e',
  },
  adapterLabel: {
    color: '#854d0e',
    fontSize: 14,
  },
  mountInfo: {
    color: '#a16207',
    fontSize: 12,
    marginLeft: 28,
  },
  adaptedItem: {
    backgroundColor: '#fffbeb',
  },
  adapterBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 8,
  },
  adapterBadgeText: {
    color: '#92400e',
    fontSize: 10,
    fontWeight: '500' as const,
  },
  quickAddForm: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  quickAddInput: {
    marginBottom: spacing.sm,
  },
  quickAddButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  modalFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
});
