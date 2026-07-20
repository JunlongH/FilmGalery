/**
 * QuickMeterSheet
 * 
 * Bottom sheet for quick access to loaded films.
 * Replaces the modal dialog for better UX.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo} from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { Icon } from '../ui';
import { useT } from '../../i18n';
import { getFilmItems, getFilms } from '../../api/filmItems';

const { height } = Dimensions.get('window');

export default function QuickMeterSheet({ visible, onClose }: any) {
  const theme = useTheme();
  const t = useT();
  const navigation = useNavigation();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadedFilmItems, setLoadedFilmItems] = useState<any[]>([]);
  const [films, setFilms] = useState<any[]>([]);
  
  // Animation
  const slideAnim = useRef(new Animated.Value(height)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  // Animate in/out
  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: height,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  // Load film items
  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [itemsRes, filmsRes] = await Promise.all([
        getFilmItems({ status: 'loaded', limit: 50 }),
        getFilms(),
      ]);
      const items = (itemsRes as any) && Array.isArray((itemsRes as any).items) ? (itemsRes as any).items : [];
      setLoadedFilmItems(items);
      setFilms(Array.isArray(filmsRes) ? filmsRes : []);
    } catch (e) {
      console.log('Failed to load film items', e);
      setError(t('shot.loadFailed'));
      setLoadedFilmItems([]);
      setFilms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadData();
    }
  }, [visible, loadData]);

  // Get film info
  const getFilmInfo = useCallback((item: any) => {
    const film = films.find((f: any) => f.id === item.film_id);
    return {
      name: film?.name || item.film_name || item.film_type || t('home.rollFallback', { id: item.film_id || '' }),
      iso: film?.iso || item.iso || 400,
      brand: film?.brand || '',
    };
  }, [films]);

  // Handle film selection
  const handleSelect = useCallback((item: any) => {
    const filmInfo = getFilmInfo(item);
    onClose();
    navigation.navigate('ShotLog', {
      itemId: item.id,
      filmName: filmInfo.name,
      autoOpenShotMode: true,
    });
  }, [navigation, onClose, getFilmInfo]);

  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <TouchableWithoutFeedback onPress={onClose}>
          <Animated.View 
            style={[styles.backdrop, { opacity: backdropAnim }]} 
          />
        </TouchableWithoutFeedback>
        
        <Animated.View 
          style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}
        >
          <View style={styles.handle} />
          
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Icon name="gauge" size={22} color={theme.colors.primary} />
            </View>
            <Text style={styles.headerTitle}>{t('shot.quickMeter')}</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="x" size={24} color={theme.colors.onSurfaceVariant} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            {loading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text style={styles.loadingText}>{t('shot.loading')}</Text>
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <Icon name="alert-circle" size={48} color={theme.colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : loadedFilmItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Icon name="film" size={48} color={theme.colors.onSurfaceVariant} />
                <Text style={styles.emptyText}>
                  {t('shot.noLoaded')}
                </Text>
              </View>
            ) : (
              <FlatList
                data={loadedFilmItems}
                keyExtractor={(item) => item.id.toString()}
                renderItem={({ item }) => {
                  const filmInfo = getFilmInfo(item);
                  const meta = [
                    item.label,
                    item.loaded_camera ? t('common.loadedOnCam', { camera: item.loaded_camera }) : null,
                  ].filter(Boolean).join(' • ');
                  
                  return (
                    <TouchableOpacity
                      style={styles.filmItem}
                      onPress={() => handleSelect(item)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.filmIcon}>
                        <Icon name="film" size={22} color={theme.colors.primary} />
                      </View>
                      <View style={styles.filmInfo}>
                        <Text style={styles.filmName}>{filmInfo.name}</Text>
                        {meta ? <Text style={styles.filmMeta}>{meta}</Text> : null}
                      </View>
                      <View style={styles.isoBadge}>
                        <Text style={styles.isoText}>ISO {filmInfo.iso}</Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>

          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.footerButton}
              onPress={() => {
                onClose();
                navigation.navigate('Inventory');
              }}
            >
              <Icon name="package" size={18} color={theme.colors.onSurfaceVariant} />
              <Text style={styles.footerButtonText}>{t('common.manageInventory')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
backdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    container: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: height * 0.85,
      minHeight: height * 0.4,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 12,
    },
    handle: {
      width: 40,
      height: 4,
      backgroundColor: theme.colors.outline,
      borderRadius: 2,
      alignSelf: 'center',
      marginTop: 12,
      marginBottom: 8,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline + '30',
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: '700' as const,
      color: theme.colors.onSurface,
    },
    headerIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: theme.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      flex: 1,
      minHeight: 200,
    },
    loadingContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    loadingText: {
      marginTop: 12,
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
    },
    errorContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    errorText: {
      color: theme.colors.error,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 12,
    },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 40,
    },
    emptyText: {
      color: theme.colors.onSurfaceVariant,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 12,
    },
    filmItem: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      paddingHorizontal: 20,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.outline + '15',
    },
    filmIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: theme.colors.primaryContainer,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 14,
    },
    filmInfo: {
      flex: 1,
    },
    filmName: {
      fontSize: 16,
      fontWeight: '600' as const,
      color: theme.colors.onSurface,
    },
    filmMeta: {
      fontSize: 13,
      color: theme.colors.onSurfaceVariant,
      marginTop: 2,
    },
    isoBadge: {
      backgroundColor: theme.colors.secondaryContainer,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 12,
    },
    isoText: {
      fontSize: 12,
      fontWeight: '600' as const,
      color: theme.colors.secondary,
    },
    footer: {
      padding: 16,
      paddingBottom: 32,
      borderTopWidth: 1,
      borderTopColor: theme.colors.outline + '30',
    },
    footerButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 14,
      borderRadius: 12,
      backgroundColor: theme.colors.surfaceVariant,
      gap: 8,
    },
    footerButtonText: {
      fontSize: 14,
      fontWeight: '500' as const,
      color: theme.colors.onSurfaceVariant,
    },
  });
