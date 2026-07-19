/**
 * Film Gallery Watch App
 * Android Wear OS Application
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { api } from './src/services/api';
import { startLocationWatch } from './src/services/location';
import type { RootStackParamList } from './src/types/navigation';

// Screens
import HomeScreen from './src/screens/HomeScreen';
import MainMenuScreen from './src/screens/MainMenuScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ShotLogScreen from './src/screens/ShotLogScreen';
import MyRollsScreen from './src/screens/MyRollsScreen';
import RollDetailScreen from './src/screens/RollDetailScreen';
import PhotoViewerScreen from './src/screens/PhotoViewerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Load server URL before any screen can fire a request
    api.loadServerURL().finally(() => setReady(true));

    // Start location watch in background - so position is ready when user needs it
    startLocationWatch().catch(err => {
      console.log('[App] Location preload failed:', err);
    });
  }, []);

  if (!ready) {
    return (
      <GestureHandlerRootView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4CAF50" />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Home"
          screenOptions={{
            headerStyle: {
              backgroundColor: '#000',
            },
            headerTintColor: '#fff',
            headerTitleStyle: {
              fontWeight: 'bold',
            },
            contentStyle: {
              backgroundColor: '#000',
            },
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            fullScreenGestureEnabled: true,
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="MainMenu"
            component={MainMenuScreen}
            options={{ title: 'Menu' }}
          />
          <Stack.Screen
            name="Settings"
            component={SettingsScreen}
            options={{ title: 'Settings' }}
          />
          <Stack.Screen
            name="ShotLog"
            component={ShotLogScreen}
            options={{ title: 'Shot Log' }}
          />
          <Stack.Screen
            name="MyRolls"
            component={MyRollsScreen}
            options={{ title: 'My Rolls' }}
          />
          <Stack.Screen
            name="RollDetail"
            component={RollDetailScreen}
            options={{ title: 'Roll Detail' }}
          />
          <Stack.Screen
            name="PhotoViewer"
            component={PhotoViewerScreen}
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default App;
