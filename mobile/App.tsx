import React, { useState, useEffect, useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
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
import { ApiContext } from './src/context/ApiContext';
import { configureApi } from './src/api/client';
import appTheme, { appDarkTheme } from './src/theme';
import type { MapProvider } from './src/context/ApiContext';

const RootStack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
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
  return (
    <TimelineStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <TimelineStack.Screen
        name="TimelineHome"
        component={HomeScreen}
        options={{
          title: 'Timeline',
          headerTitle: 'Film Gallery',
          headerRight: () => <HeaderRight showQuickMeter={true} showSettings={true} showAI={true} />,
        }}
      />
    </TimelineStack.Navigator>
  );
}

function MapStackScreen() {
  const theme = useTheme();
  return (
    <MapStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <MapStack.Screen
        name="MapHome"
        component={MapScreen}
        options={{
          title: 'Map',
          headerTitle: 'Photo Map',
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }}
      />
    </MapStack.Navigator>
  );
}

function LibraryStackScreen() {
  const theme = useTheme();
  return (
    <LibraryStack.Navigator screenOptions={stackScreenOptions(theme)}>
      <LibraryStack.Screen
        name="LibraryHome"
        component={LibraryScreen}
        options={{
          title: 'Library',
          headerTitle: 'My Library',
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }}
      />
      <LibraryStack.Screen
        name="Favorites"
        component={FavoritesScreen}
        options={{ title: 'Favorites' }}
      />
      <LibraryStack.Screen
        name="Collections"
        component={ThemesScreen}
        options={{ title: 'Collections' }}
      />
      <LibraryStack.Screen
        name="TagDetail"
        component={TagDetailScreen}
        options={({ route }) => ({ title: (route.params as any)?.tagName || 'Tag Details' })}
      />
      <LibraryStack.Screen
        name="Equipment"
        component={EquipmentScreen}
        options={{ title: 'Equipment' }}
      />
      <LibraryStack.Screen
        name="EquipmentRolls"
        component={EquipmentRollsScreen}
        options={({ route }) => ({ title: (route.params as any)?.name || 'Equipment Rolls' })}
      />
      <LibraryStack.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{ title: 'Inventory' }}
      />
      <LibraryStack.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: 'Statistics' }}
      />
      <LibraryStack.Screen
        name="Films"
        component={FilmsScreen}
        options={{ title: 'Film Catalog' }}
      />
      <LibraryStack.Screen
        name="FilmRolls"
        component={FilmRollsScreen}
        options={({ route }) => ({ title: (route.params as any)?.filmName || 'Film Rolls' })}
      />
      <LibraryStack.Screen
        name="FilmItemDetail"
        component={FilmItemDetailScreen}
        options={{ title: 'Film Item' }}
      />
      <LibraryStack.Screen
        name="Negatives"
        component={NegativeScreen}
        options={{ title: 'Negatives' }}
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
      <Tab.Screen name="Timeline" component={TimelineStackScreen} />
      <Tab.Screen
        name="Map"
        component={MapStackScreen}
        options={{ freezeOnBlur: true }}
      />
      <Tab.Screen name="Library" component={LibraryStackScreen} />
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
    ]).then(([url, backup, themeDark, savedProvider, savedAmapKey]) => {
      configureApi(url || '', backup || '');
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
        <NavigationContainer theme={themeToUse as any}>
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
              options={({ route }) => ({ title: (route.params as any)?.rollName || 'Roll Details' })}
            />
            {/* Full-screen / modal flows */}
            <RootStack.Screen
              name="PhotoView"
              component={PhotoViewScreen}
              options={{ title: 'Photo', headerShown: false, presentation: 'fullScreenModal' }}
            />
            <RootStack.Screen
              name="ShotLog"
              component={ShotLogScreen}
              options={{ title: 'Shot Log', presentation: 'fullScreenModal' }}
            />
            {/* Settings group */}
            <RootStack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ title: 'Settings' }}
            />
            <RootStack.Screen
              name="AISettings"
              component={AISettingsScreen}
              options={{ title: 'AI Assistant' }}
            />
            <RootStack.Screen
              name="LocationDiagnostic"
              component={LocationDiagnosticScreen}
              options={{ title: 'Location Diagnostics' }}
            />
          </RootStack.Navigator>
          <StatusBar style={darkMode ? 'light' : 'dark'} />
          <ApiErrorSnackbar />
        </NavigationContainer>
        </GestureHandlerRootView>
      </PaperProvider>
    </ApiContext.Provider>
  );
}
