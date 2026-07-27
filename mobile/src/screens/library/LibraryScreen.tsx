/**
 * LibraryScreen — "More" tab.
 *
 * Mode-aware entry list (ListItem rows) driven by AppModeContext. The previous
 * dashboard layout + LibraryModeToggle + fadeAnim branches were retired in N5
 * when the global ModeHeaderToggle took over mode switching.
 *
 * Film entries:    Favorites / Collections / Stats / Films / Equipment /
 *                  Inventory / ShotLog
 * Digital entries: Favorites / Stats / Map
 *
 * W5: Tapping ShotLog no longer drops the user into an empty ShotLogScreen
 * (Library has no itemId in scope). Instead we query loaded film items first:
 *   0 → Alert ("no loaded film")
 *   1 → navigate directly with that itemId
 *   many → open QuickMeterSheet as a "pick loaded roll" sheet (reused as-is,
 *         with an onSelectItem override so we don't auto-open the metering
 *         modal the way the FAB quick-meter flow does).
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { useNavigation } from '@react-navigation/native';
import { useAppMode } from '../../context/AppModeContext';
import { useT } from '../../i18n';
import { Icon } from '../../components/ui';
import { getFilmItems } from '../../api/filmItems';
import QuickMeterSheet from '../../components/metering/QuickMeterSheet';

interface EntryDef {
  key: string;
  icon: string;
  color: string;
  bg: string;
  labelKey: string;
  target: string;
  params?: Record<string, any>;
}

const FILM_ENTRIES: EntryDef[] = [
  {
    key: 'favorites',
    icon: 'heart',
    color: '#E53935',
    bg: '#FFEBEE',
    labelKey: 'library.favorites',
    target: 'Favorites',
    params: { mode: 'film' },
  },
  {
    key: 'collections',
    icon: 'tags',
    color: '#7B1FA2',
    bg: '#F3E5F5',
    labelKey: 'library.collections',
    target: 'Collections',
    params: { mode: 'film' },
  },
  {
    key: 'stats',
    icon: 'bar-chart-2',
    color: '#0097A7',
    bg: '#E0F7FA',
    labelKey: 'library.statistics',
    target: 'Stats',
    params: { mode: 'film' },
  },
  {
    key: 'films',
    icon: 'film',
    color: '#388E3C',
    bg: '#E8F5E9',
    labelKey: 'library.filmCatalog',
    target: 'Films',
  },
  {
    key: 'equipment',
    icon: 'camera',
    color: '#1976D2',
    bg: '#E3F2FD',
    labelKey: 'library.equipment',
    target: 'Equipment',
  },
  {
    key: 'inventory',
    icon: 'package',
    color: '#F57C00',
    bg: '#FFF3E0',
    labelKey: 'library.inventory',
    target: 'Inventory',
  },
  {
    key: 'shotlog',
    icon: 'calendar',
    color: '#5D4037',
    bg: '#EFEBE9',
    labelKey: 'library.shotLog',
    target: 'ShotLog',
  },
];

const DIGITAL_ENTRIES: EntryDef[] = [
  {
    key: 'favorites',
    icon: 'heart',
    color: '#E53935',
    bg: '#FFEBEE',
    labelKey: 'library.favorites',
    target: 'Favorites',
    params: { mode: 'digital' },
  },
  {
    key: 'stats',
    icon: 'bar-chart-2',
    color: '#0097A7',
    bg: '#E0F7FA',
    labelKey: 'library.statistics',
    target: 'Stats',
    params: { mode: 'digital' },
  },
  {
    key: 'map',
    icon: 'map',
    color: '#FB8C00',
    bg: '#FFF3E0',
    labelKey: 'library.map',
    target: 'Map',
  },
];

export default function LibraryScreen() {
  const theme = useTheme();
  const navigation = useNavigation<any>();
  const { mode } = useAppMode();
  const t = useT();

  const [resolvingShotLog, setResolvingShotLog] = useState(false);
  const [showLoadedPicker, setShowLoadedPicker] = useState(false);

  const entries = useMemo<EntryDef[]>(
    () => (mode === 'digital' ? DIGITAL_ENTRIES : FILM_ENTRIES),
    [mode],
  );

  const styles = useMemo(() => createStyles(theme), [theme]);

  // W5: Resolve which loaded film item to open the ShotLog for, then navigate.
  //   0 loaded → Alert. 1 → straight to ShotLog. many → open picker sheet.
  const openShotLog = useCallback(async () => {
    setResolvingShotLog(true);
    try {
      const res: any = await getFilmItems({ status: 'loaded', limit: 50 });
      const items = res && Array.isArray(res.items) ? res.items : [];
      if (items.length === 0) {
        Alert.alert(t('library.shotLog'), t('shot.noLoaded'));
        return;
      }
      if (items.length === 1) {
        const item = items[0];
        const filmName =
          item.film_name || item.film_type || t('home.rollFallback', { id: item.id });
        navigation.navigate('ShotLog', { itemId: item.id, filmName });
        return;
      }
      // Multiple loaded: defer to the picker sheet (rendered below). It calls
      // onSelectItem with the chosen item + resolved film name.
      setShowLoadedPicker(true);
    } catch (err) {
      console.warn('[LibraryScreen] Failed to resolve loaded films for ShotLog', err);
      Alert.alert(t('library.shotLog'), t('shot.loadFailed'));
    } finally {
      setResolvingShotLog(false);
    }
  }, [navigation, t]);

  const onPress = (entry: EntryDef) => {
    if (entry.key === 'shotlog') {
      openShotLog();
      return;
    }
    navigation.navigate(entry.target as any, entry.params);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={styles.content}
    >
      <View style={styles.list}>
        {entries.map((entry) => (
          <TouchableOpacity
            key={entry.key}
            style={[styles.row, { backgroundColor: theme.colors.surface }]}
            onPress={() => onPress(entry)}
            activeOpacity={0.85}
            disabled={entry.key === 'shotlog' && resolvingShotLog}
            testID={`entry-${entry.key}`}
          >
            <View style={[styles.iconWrap, { backgroundColor: entry.bg }]}>
              {entry.key === 'shotlog' && resolvingShotLog ? (
                <ActivityIndicator color={entry.color} />
              ) : (
                <Icon name={entry.icon as any} size={22} color={entry.color} />
              )}
            </View>
            <Text style={[styles.label, { color: theme.colors.onSurface }]}>
              {t(entry.labelKey as any)}
            </Text>
            <Icon name="chevron-right" size={20} color={theme.colors.onSurfaceVariant} />
          </TouchableOpacity>
        ))}
      </View>
      <QuickMeterSheet
        visible={showLoadedPicker}
        onClose={() => setShowLoadedPicker(false)}
        onSelectItem={(item, filmName) => {
          setShowLoadedPicker(false);
          navigation.navigate('ShotLog', { itemId: item.id, filmName });
        }}
      />
    </ScrollView>
  );
}

const createStyles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    content: {
      padding: 12,
      paddingBottom: 100,
    },
    list: {
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      borderRadius: 12,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    label: {
      flex: 1,
      fontSize: 15,
      fontWeight: '500' as const,
    },
  });
