import React, { useContext, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { TextInput, Button, Text, Switch, useTheme } from 'react-native-paper';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from '../context/ApiContext';

export default function SettingsScreen({ navigation }) {
  const theme = useTheme();
  const { baseUrl, setBaseUrl, backupUrl, setBackupUrl, darkMode, setDarkMode } = useContext(ApiContext);
  const [url, setUrl] = useState(baseUrl);
  const [backup, setBackup] = useState(backupUrl || '');
  const [isDark, setIsDark] = useState(!!darkMode);

  const cleanUrlString = (input) => {
    let clean = input.trim();
    if (!clean) return '';
    if (clean.endsWith('/')) clean = clean.slice(0, -1);
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }
    return clean;
  };

  const save = async () => {
    const cleanUrl = cleanUrlString(url);
    const cleanBackup = cleanUrlString(backup);
    
    await AsyncStorage.setItem('api_base_url', cleanUrl);
    if (cleanBackup) {
      await AsyncStorage.setItem('api_backup_url', cleanBackup);
    } else {
      await AsyncStorage.removeItem('api_backup_url');
    }

    setBaseUrl(cleanUrl);
    setBackupUrl(cleanBackup);
    navigation.goBack();
  };

  const toggleDark = async (val) => {
    setIsDark(val);
    setDarkMode && setDarkMode(val);
    await AsyncStorage.setItem('theme_dark', val ? 'true' : 'false');
  };

  const testConnection = async (targetUrl) => {
    const clean = cleanUrlString(targetUrl);
    if (!clean) {
      alert('Please enter a URL');
      return;
    }
    try {
      const res = await fetch(`${clean}/api/rolls`);
      if (res.ok) {
        alert(`Connection Successful to ${clean}!`);
      } else {
        alert(`Connected to ${clean}, but server returned ${res.status}`);
      }
    } catch (e) {
      alert(`Connection Failed to ${clean}: ${e.message}`);
    }
  };

  const handleSwap = () => {
    setUrl(backup);
    setBackup(url);
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <Text style={styles.label}>Primary Server URL</Text>
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
        style={{ backgroundColor: '#f5f0e6', marginBottom: 10 }}
      />

      <View style={{ alignItems: 'center', marginBottom: 10 }}>
        <Button 
          mode="text" 
          compact 
          onPress={handleSwap} 
          icon="swap-vertical" 
          textColor="#5a4632"
        >
          Swap Primary & Backup
        </Button>
      </View>
      
      <Text style={styles.label}>Backup Server URL (Optional)</Text>
      <Text style={styles.hint}>
        Alternative IP address if primary is unreachable.
      </Text>
      <TextInput
        mode="outlined"
        value={backup}
        onChangeText={setBackup}
        placeholder="http://192.168.1.y:4000"
        autoCapitalize="none"
        keyboardType="url"
        activeOutlineColor="#5a4632"
        style={{ backgroundColor: '#f5f0e6', marginBottom: 10 }}
      />

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Button mode="outlined" onPress={() => testConnection(url)} style={[styles.button, { flex: 1, marginRight: 8 }]} textColor="#5a4632">
          Test Primary
        </Button>
        <Button mode="outlined" onPress={() => testConnection(backup)} style={[styles.button, { flex: 1, marginLeft: 8 }]} textColor="#5a4632">
          Test Backup
        </Button>
      </View>

      <Button mode="contained" onPress={save} style={styles.button} buttonColor="#5a4632">
        Save Settings
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
