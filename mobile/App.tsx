import React, { useState, useEffect, useMemo } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, useTheme } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// UI Components
import { HeaderRight } from './src/components/navigation';
import ApiErrorSnackbar from './src/components/ApiErrorSnackbar';

// Tab home screens
import HomeScreen from './src/screens/timeline/HomeScreen';
import MapScreen from './src/screens/map/MapScreen';
import LibraryScreen from './src/screens/library/LibraryScreen';

// Detail screens
import RollDetailScreen from './src/screens/timeline/RollDetailScreen';
import SettingsScreen from './src/screens/settings/SettingsScreen';
import PairingScreen from './src/screens/settings/PairingScreen';
import PhotoViewScreen from './src/screens/viewing/PhotoViewScreen';
import FilmsScreen from './src/screens/library/FilmsScreen';
import FavoritesScreen from './src/screens/library/FavoritesScreen';
import ThemesScreen from './src/screens/library/ThemesScreen';
import NegativeScreen from './src/screens/library/NegativeScreen';
import TagDetailScreen from './src/screens/library/TagDetailScreen';
import FilmRollsScreen from './src/screens/library/FilmRollsScreen';
import InventoryScreen from './src/screens/library/InventoryScreen';
import FilmItemDetailScreen from './src/screens/library/FilmItemDetailScreen';
import ShotLogScreen from './src/screens/shooting/ShotLogScreen';
import StatsScreen from './src/screens/library/StatsScreen';
import EquipmentScreen from './src/screens/library/EquipmentScreen';
import EquipmentRollsScreen from './src/screens/library/EquipmentRollsScreen';
import LocationDiagnosticScreen from './src/screens/settings/LocationDiagnosticScreen';
import AISettingsScreen from './src/screens/settings/AISettingsScreen';
import LocationPickerScreen from './src/screens/location/LocationPickerScreen';
import { LocationPickerProvider } from './src/context/LocationPickerContext';
import { ApiContext } from './src/context/ApiContext';
import { configureApi, loadAuthToken, setApiOnUnauthorized } from './src/api/client';
import appTheme, { appDarkTheme } from './src/theme';
import type { MapProvider } from './src/context/ApiContext';
import { initLanguage, useT } from './src/i18n';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
// Phase 2B: ref for programmatic navigation on 401 (setApiOnUnauthorized)
const navigationRef = createNavigationContainerRef<any>();
const TimelineStack = createNativeStackNavigator();
const MapStack = createNativeStackNavigator();
const LibraryStack = createNativeStackNavigator();

const stackScreenOptions = (theme: any) =>
  ({
    headerStyle: { backgroundColor: theme.colors.surface },
    headerTintColor: theme.colors.primary,
    headerTitleStyle: { fontWeight: '600' as const, letterSpacing: 0.3 },
    contentStyle: { backgroundColor: theme.colors.background },
  }) as any;

function TimelineStackScreen() {
  const theme = useTheme();
  const t = useT();
  return (
    <TimelineStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <TimelineStack.Screen
        name="TimelineHome"
        component={HomeScreen}
        options={{
          title: t('tab.timeline'),
          headerTitle: 'Film Gallery',
          headerRight: () => <HeaderRight showQuickMeter={true} showSettings={true} showAI={true} />,
        }}
      />
    </TimelineStack.Navigator>
  );
}

function MapStackScreen() {
  const theme = useTheme();
  const t = useT();
  return (
    <MapStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <MapStack.Screen
        name="MapHome"
        component={MapScreen}
        options={{
          title: t('tab.map'),
          headerTitle: t('title.photoMap'),
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }}
      />
    </MapStack.Navigator>
  );
}

function LibraryStackScreen() {
  const theme = useTheme();
  const t = useT();
  return (
    <LibraryStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{
          title: t('tab.library'),
          headerTitle: t('title.myLibrary'),
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }}
      />
      <LibraryStack.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{ title: t('title.favorites') }}
      />
      <LibraryStack.Screen
        name="Collections"
        component={ThemesScreen}
        options={{ title: t('title.collections') }}
      />
      <LibraryStack.Screen
        name="TagDetail"
        component={TagDetailScreen}
        options={({ route }) => ({ title: (route.params as any)?.tagName || t('title.tagDetails') })}
      />
      <LibraryStack.Screen
        name="Equipment"
        component={EquipmentScreen}
        options={{ title: t('title.equipment') }}
      />
      <LibraryStack.Screen
        name="EquipmentRolls"
        component={EquipmentRollsScreen}
        options={({ route }) => ({ title: (route.params as any)?.name || t('title.equipmentRolls') })}
      />
      <LibraryStack.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{ title: t('title.inventory') }}
      />
      <LibraryStack.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: t('title.stats') }}
      />
      <LibraryStack.Screen
        name="Films"
        component={FilmsScreen}
        options={{ title: t('title.filmCatalog') }}
      />
      <LibraryStack.Screen
        name="FilmRolls"
        component={FilmRollsScreen}
        options={({ route }) => ({ title: (route.params as any)?.filmName || t('title.filmRolls') })}
      />
      <LibraryStack.Screen
        name="FilmItemDetail"
        component={FilmItemDetailScreen}
        options={{ title: t('title.rollDetails') }}
      />
      <LibraryStack.Screen
        name="Negatives"
        component={NegativeScreen}
        options={{ title: t('title.negatives') }}
      />
    </LibraryStack.Navigator>
  );
}

/**
 * Main 3-Tab Navigation
 *
 * Timeline - Photo rolls in chronological order
 * Map - Geographic view of photos
 * Library - Favorites, Collections, Equipment, etc.
 */
function HomeTabs() {
  const theme = useTheme();
  const t = useT();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof MaterialCommunityIcons.glyphMap;
          switch (route.name) {
            case 'Timeline':
              iconName = focused ? 'movie-open' : 'movie-open-outline';
              break;
            case 'Map':
              iconName = focused ? 'map' : 'map-outline';
              break;
            case 'Library':
              iconName = focused ? 'view-grid' : 'view-grid-outline';
              break;
            default:
              iconName = 'circle';
          }
          return <MaterialCommunityIcons name={iconName} size={size - 2} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline + '30',
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 16,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '500',
          marginTop: 2,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Timeline" component={TimelineStackScreen} options={{ title: t('tab.timeline') }} />
      <Tab.Screen
        name="Map"
        component={MapStackScreen}
        options={{ freezeOnBlur: true, title: t('tab.map') }}
      />
      <Tab.Screen name="Library" component={LibraryStackScreen} options={{ title: t('tab.library') }} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState<string>('');
  const [backupUrl, setBackupUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [mapProvider, setMapProvider] = useState<MapProvider>('osm');
  const [amapKey, setAmapKey] = useState<string>('');

  const t = useT();

  useEffect(() => {
    // CRITICAL: configureApi must run BEFORE setLoading(false) so screens see
    // the correct baseUrl on their first fetch (fixes timing race that caused
    // "Network request failed" on initial load).
    Promise.all([
      AsyncStorage.getItem('api_base_url'),
      AsyncStorage.getItem('api_backup_url'),
      AsyncStorage.getItem('theme_dark'),
      AsyncStorage.getItem('map_provider'),
      AsyncStorage.getItem('amap_key'),
      initLanguage(),
    ]).then(async ([url, backup, themeDark, savedProvider, savedAmapKey]) => {
      configureApi(url || '', backup || '');
      // Phase 2B: restore auth token + wire 401 → pairing screen
      await loadAuthToken();
      setApiOnUnauthorized(() => {
        navigationRef.current?.navigate('Pairing');
      });
      if (url) setBaseUrl(url);
      if (backup) setBackupUrl(backup);
      if (themeDark === 'true') setDarkMode(true);
      if (savedProvider === 'osm' || savedProvider === 'amap') setMapProvider(savedProvider);
      if (savedAmapKey) setAmapKey(savedAmapKey);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!loading && baseUrl) {
      configureApi(baseUrl, backupUrl);
      // Phase 2B: re-apply auth token after client re-creation
      loadAuthToken();
    }
  }, [loading, baseUrl, backupUrl]);

  const apiContextValue = useMemo(
    () => ({
      baseUrl,
      setBaseUrl,
      backupUrl,
      setBackupUrl,
      darkMode,
      setDarkMode,
      mapProvider,
      setMapProvider,
      amapKey,
      setAmapKey,
    }),
    [baseUrl, backupUrl, darkMode, mapProvider, amapKey],
  );

  if (loading) return null;

  const themeToUse = darkMode ? appDarkTheme : appTheme;

  return (
    <ApiContext.Provider value={apiContextValue}>
      <PaperProvider theme={themeToUse as any}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer ref={navigationRef} theme={themeToUse as any}>
          <LocationPickerProvider>
          <RootStack.Navigator
            initialRouteName="Main"
            screenOptions={{
              headerStyle: { backgroundColor: themeToUse.colors.surface },
              headerTintColor: themeToUse.colors.primary,
              headerTitleStyle: { fontWeight: '600' as const, letterSpacing: 0.3 },
              contentStyle: { backgroundColor: themeToUse.colors.background },
            } as any}
          >
            <RootStack.Screen
              name="Main"
              component={HomeTabs}
              options={{ headerShown: false }}
            />
            {/* Shared detail screens (reachable from any tab) */}
            <RootStack.Screen
              name="RollDetail"
              component={RollDetailScreen}
              options={({ route }) => ({ title: (route.params as any)?.rollName || t('title.rollDetails') })}
            />
            {/* Full-screen / modal flows */}
            <RootStack.Screen
              name="PhotoView"
              component={PhotoViewScreen}
              options={{ title: t('title.photo'), headerShown: false, presentation: 'fullScreenModal' }}
            />
            <RootStack.Screen
              name="ShotLog"
              component={ShotLogScreen}
              options={{ title: t('title.shotLog'), presentation: 'fullScreenModal' }}
            />
            {/* Settings group */}
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: '设置' }}
            />
            <RootStack.Screen
              name="AISettings"
              component={AISettingsScreen}
              options={{ title: 'AI 助手' }}
            />
            <RootStack.Screen
              name="LocationDiagnostic"
              component={LocationDiagnosticScreen}
              options={{ title: '位置诊断' }}
            />
            <RootStack.Screen
              name="Pairing"
              component={PairingScreen}
              options={{ title: '设备配对' }}
            />
            <RootStack.Screen
              name="LocationPicker"
              component={LocationPickerScreen}
              options={{ presentation: 'fullScreenModal', headerShown: false }}
            />
          </RootStack.Navigator>
          </LocationPickerProvider>
          <StatusBar style={darkMode ? 'light' : 'dark'} />
          <ApiErrorSnackbar />
        </NavigationContainer>
        </GestureHandlerRootView>
      </PaperProvider>
    </ApiContext.Provider>
  );
}
