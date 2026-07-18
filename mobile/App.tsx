import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, useTheme } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';

// NativeWind global styles
import './global.css';

// UI Components
import { Icon } from './src/components/ui';
import { HeaderRight } from './src/components/navigation';

// Main Tab Screens (3-tab structure)
import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import LibraryScreen from './src/screens/LibraryScreen';

// Stack Screens
import RollDetailScreen from './src/screens/RollDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PhotoViewScreen from './src/screens/PhotoViewScreen';
import FilmsScreen from './src/screens/FilmsScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import ThemesScreen from './src/screens/ThemesScreen';
import NegativeScreen from './src/screens/NegativeScreen';
import TagDetailScreen from './src/screens/TagDetailScreen';
import FilmRollsScreen from './src/screens/FilmRollsScreen';
import InventoryScreen from './src/screens/InventoryScreen';
import FilmItemDetailScreen from './src/screens/FilmItemDetailScreen';
import ShotLogScreen from './src/screens/ShotLogScreen';
import StatsScreen from './src/screens/StatsScreen';
import EquipmentScreen from './src/screens/EquipmentScreen';
import EquipmentRollsScreen from './src/screens/EquipmentRollsScreen';
import LocationDiagnosticScreen from './src/screens/LocationDiagnosticScreen';
import AISettingsScreen from './src/screens/AISettingsScreen';
import { ApiContext } from './src/context/ApiContext';
import { configureApi } from './src/api/client';
import appTheme, { appDarkTheme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

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
          let iconName;
          
          switch (route.name) {
            case 'Timeline':
              iconName = focused ? 'film' : 'film';
              break;
            case 'Map':
              iconName = focused ? 'map' : 'map';
              break;
            case 'Library':
              iconName = focused ? 'grid' : 'grid';
              break;
            default:
              iconName = 'circle';
          }
          
          return <Icon name={iconName} size={size - 2} color={color} />;
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
        headerStyle: { 
          backgroundColor: theme.colors.surface,
          elevation: 0,
          shadowOpacity: 0,
          borderBottomWidth: 0,
        },
        headerTintColor: theme.colors.primary,
        headerTitleStyle: { 
          fontWeight: '600',
          fontSize: 18,
        },
      })}
    >
      <Tab.Screen 
        name="Timeline" 
        component={HomeScreen} 
        options={{ 
          title: 'Timeline',
          headerTitle: 'Film Gallery',
          headerRight: () => <HeaderRight showQuickMeter={true} showSettings={true} showAI={true} />,
        }} 
      />
      <Tab.Screen 
        name="Map" 
        component={MapScreen} 
        options={{ 
          title: 'Map',
          headerTitle: 'Photo Map',
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }} 
      />
      <Tab.Screen 
        name="Library" 
        component={LibraryScreen} 
        options={{ 
          title: 'Library',
          headerTitle: 'My Library',
          headerRight: () => <HeaderRight showQuickMeter={false} showSettings={true} />,
        }} 
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState('http://59.66.234.26:4000'); // Default: test server
  const [backupUrl, setBackupUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [mapProvider, setMapProvider] = useState('osm');
  const [amapKey, setAmapKey] = useState('');

  useEffect(() => {
    // Load saved API URL, theme, and map settings
    Promise.all([
      AsyncStorage.getItem('api_base_url'),
      AsyncStorage.getItem('api_backup_url'),
      AsyncStorage.getItem('theme_dark'),
      AsyncStorage.getItem('map_provider'),
      AsyncStorage.getItem('amap_key'),
    ]).then(([url, backup, themeDark, savedProvider, savedAmapKey]) => {
      if (url) setBaseUrl(url);
      if (backup) setBackupUrl(backup);
      if (themeDark === 'true') setDarkMode(true);
      if (savedProvider) setMapProvider(savedProvider);
      if (savedAmapKey) setAmapKey(savedAmapKey);
      setLoading(false);
    });
  }, []);

  // Reconfigure axios whenever baseUrl changes after initial load
  useEffect(() => {
    if (!loading && baseUrl) {
      configureApi(baseUrl, backupUrl);
    }
  }, [loading, baseUrl, backupUrl]);

  if (loading) return null;

  const themeToUse = darkMode ? appDarkTheme : appTheme;

  return (
    <ApiContext.Provider value={{ baseUrl, setBaseUrl, backupUrl, setBackupUrl, darkMode, setDarkMode, mapProvider, setMapProvider, amapKey, setAmapKey }}>
      <PaperProvider theme={themeToUse}>
        <GestureHandlerRootView style={{ flex: 1 }}>
        <NavigationContainer theme={themeToUse}>
          <Stack.Navigator 
            initialRouteName="Main"
            screenOptions={{
              headerStyle: { backgroundColor: themeToUse.colors.surface },
              headerTintColor: themeToUse.colors.primary,
              headerTitleStyle: { fontWeight: '600', letterSpacing: 0.3 },
              contentStyle: { backgroundColor: themeToUse.colors.background },
            }}
          >
            <Stack.Screen 
              name="Main" 
              component={HomeTabs} 
              options={{ headerShown: false }}
            />
            <Stack.Screen 
              name="RollDetail" 
              component={RollDetailScreen} 
              options={({ route }) => ({ title: route.params.rollName || 'Roll Details' })}
            />
            <Stack.Screen 
              name="TagDetail" 
              component={TagDetailScreen} 
              options={({ route }) => ({ title: route.params.tagName || 'Tag Details' })}
            />
            <Stack.Screen 
              name="FilmRolls" 
              component={FilmRollsScreen} 
              options={({ route }) => ({ title: route.params.filmName || 'Film Rolls' })}
            />
            <Stack.Screen 
              name="PhotoView" 
              component={PhotoViewScreen} 
              options={{ title: 'Photo', headerShown: false }}
            />
            <Stack.Screen 
              name="Settings" 
              component={SettingsScreen} 
              options={{ title: 'Settings' }}
            />
            <Stack.Screen 
              name="FilmItemDetail" 
              component={FilmItemDetailScreen} 
              options={{ title: 'Film Item' }}
            />
            <Stack.Screen 
              name="ShotLog" 
              component={ShotLogScreen} 
              options={{ title: 'Shot Log' }}
            />
            <Stack.Screen 
              name="EquipmentRolls" 
              component={EquipmentRollsScreen} 
              options={({ route }) => ({ title: route.params?.name || 'Equipment Rolls' })}
            />
            <Stack.Screen 
              name="LocationDiagnostic" 
              component={LocationDiagnosticScreen} 
              options={{ title: '位置诊断' }}
            />
            {/* Screens previously in Tab Navigator - now accessible from Library */}
            <Stack.Screen 
              name="Favorites" 
              component={FavoritesScreen} 
              options={{ title: 'Favorites' }}
            />
            <Stack.Screen 
              name="Themes" 
              component={ThemesScreen} 
              options={{ title: 'Collections' }}
            />
            <Stack.Screen 
              name="Equipment" 
              component={EquipmentScreen} 
              options={{ title: 'Equipment' }}
            />
            <Stack.Screen 
              name="Inventory" 
              component={InventoryScreen} 
              options={{ title: 'Inventory' }}
            />
            <Stack.Screen 
              name="Stats" 
              component={StatsScreen} 
              options={{ title: 'Statistics' }}
            />
            <Stack.Screen 
              name="AISettings" 
              component={AISettingsScreen} 
              options={{ title: 'AI 助手设置' }}
            />
          </Stack.Navigator>
          <StatusBar style={darkMode ? 'light' : 'dark'} />
        </NavigationContainer>
        </GestureHandlerRootView>
      </PaperProvider>
    </ApiContext.Provider>
  );
}
