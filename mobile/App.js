import React, { useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, useTheme } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import HomeScreen from './src/screens/HomeScreen';
import RollDetailScreen from './src/screens/RollDetailScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import PhotoViewScreen from './src/screens/PhotoViewScreen';
import FilmsScreen from './src/screens/FilmsScreen';
import FavoritesScreen from './src/screens/FavoritesScreen';
import ThemesScreen from './src/screens/ThemesScreen';
import NegativeScreen from './src/screens/NegativeScreen';
import TagDetailScreen from './src/screens/TagDetailScreen';
import FilmRollsScreen from './src/screens/FilmRollsScreen';
import { ApiContext } from './src/context/ApiContext';
import { configureAxios } from './src/setupAxios';
import appTheme, { appDarkTheme } from './src/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Centralized theme imported from src/theme.js

function HomeTabs() {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Rolls') iconName = focused ? 'filmstrip' : 'filmstrip-box';
          else if (route.name === 'Favorites') iconName = focused ? 'heart' : 'heart-outline';
          else if (route.name === 'Films') iconName = focused ? 'camera-iris' : 'camera-iris';
          else if (route.name === 'Themes') iconName = focused ? 'tag-multiple' : 'tag-multiple-outline';

          return <MaterialCommunityIcons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.outline, height: 65, paddingBottom: 8 },
        tabBarLabelStyle: { marginTop: -4, paddingBottom: 2 },
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.primary,
        headerTitleStyle: { fontWeight: 'bold' },
      })}
    >
      <Tab.Screen name="Rolls" component={HomeScreen} options={{ title: 'Overview', tabBarLabel: 'Overview' }} />
      <Tab.Screen name="Favorites" component={FavoritesScreen} />
      <Tab.Screen name="Themes" component={ThemesScreen} />
      <Tab.Screen name="Films" component={FilmsScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState('http://192.168.1.x:4000'); // Default placeholder
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    // Load saved API URL and theme
    Promise.all([
      AsyncStorage.getItem('api_base_url'),
      AsyncStorage.getItem('theme_dark'),
    ]).then(([url, themeDark]) => {
      if (url) setBaseUrl(url);
      if (themeDark === 'true') setDarkMode(true);
      setLoading(false);
    });
  }, []);

  // Reconfigure axios whenever baseUrl changes after initial load
  useEffect(() => {
    if (!loading && baseUrl) {
      configureAxios(baseUrl);
    }
  }, [loading, baseUrl]);

  if (loading) return null;

  const themeToUse = darkMode ? appDarkTheme : appTheme;

  return (
    <ApiContext.Provider value={{ baseUrl, setBaseUrl, darkMode, setDarkMode }}>
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
          </Stack.Navigator>
          <StatusBar style={darkMode ? 'light' : 'dark'} />
        </NavigationContainer>
        </GestureHandlerRootView>
      </PaperProvider>
    </ApiContext.Provider>
  );
}
