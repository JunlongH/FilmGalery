import React, { useContext, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Button, Text, Switch, useTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from '../context/ApiContext';

export default function SettingsScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl, setBaseUrl, darkMode, setDarkMode } = useContext(ApiContext);
  const [url, setUrl] = useState(baseUrl);
  const [isDark, setIsDark] = useState(!!darkMode);

  const save = async () => {
    // Basic validation
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    
    await AsyncStorage.setItem('api_base_url', cleanUrl);
    setBaseUrl(cleanUrl);
    navigation.goBack();
  };

  const toggleDark = async (val) => {
    setIsDark(val);
    setDarkMode && setDarkMode(val);
    await AsyncStorage.setItem('theme_dark', val ? 'true' : 'false');
  };

  const testConnection = async () => {
    let cleanUrl = url.trim();
    if (cleanUrl.endsWith('/')) cleanUrl = cleanUrl.slice(0, -1);
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `http://${cleanUrl}`;
    }
    try {
      const res = await fetch(`${cleanUrl}/api/rolls`);
      if (res.ok) {
        alert('Connection Successful!');
      } else {
        alert(`Connected, but server returned ${res.status}`);
      }
    } catch (e) {
      alert(`Connection Failed: ${e.message}`);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={styles.label}>Server URL</Text>
      <Text style={styles.hint}>
        Enter the IP address of your PC running FilmGallery.
        Example: http://192.168.1.5:4000
      </Text>
      <TextInput
        mode="outlined"
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.x:4000"
        autoCapitalize="none"
        keyboardType="url"
        activeOutlineColor="#5a4632"
        style={{ backgroundColor: '#f5f0e6' }}
      />
      <Button mode="outlined" onPress={testConnection} style={styles.button} textColor="#5a4632">
        Test Connection
      </Button>
      <Button mode="contained" onPress={save} style={styles.button} buttonColor="#5a4632">
        Save
      </Button>
      <View style={{ marginTop: 24 }}>
        <Text style={styles.label}>Dark Mode</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.hint}>Reduce eye strain with a dark UI</Text>
          <Switch value={isDark} onValueChange={toggleDark} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#fdfdfd',
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#5a4632',
  },
  hint: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  button: {
    marginTop: 20,
  },
});
