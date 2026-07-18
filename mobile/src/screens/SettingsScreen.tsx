import React, { useContext, useState, useRef, useCallback } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, ScrollView, Animated } from 'react-native';
import { TextInput, Button, Text, Switch, useTheme, Chip, SegmentedButtons } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from '../context/ApiContext';
import { Icon } from '../components/ui';
import { 
  discoverPort, 
  discoverServices, 
  discoverByMdns,
  cleanIpAddress, 
  validateServer,
  isPrivateIp,
  DISCOVERY_MODE 
} from '../utils/portDiscovery';

export default function SettingsScreen({ navigation }: any) {
  const theme = useTheme();
  const { baseUrl, setBaseUrl, backupUrl, setBackupUrl, darkMode, setDarkMode, mapProvider, setMapProvider, amapKey, setAmapKey } = useContext(ApiContext);
  const [url, setUrl] = useState(baseUrl);
  const [backup, setBackup] = useState(backupUrl || '');
  const [isDark, setIsDark] = useState(!!darkMode);
  const [ipAddress, setIpAddress] = useState(''); // For auto-discovery
  const [discovering, setDiscovering] = useState(false);
  const [discoveredServices, setDiscoveredServices] = useState([]);
  const [discoveryMode, setDiscoveryMode] = useState('auto');
  const [discoveryStatus, setDiscoveryStatus] = useState('');
  const [localMapProvider, setLocalMapProvider] = useState(mapProvider || 'osm');
  const [localAmapKey, setLocalAmapKey] = useState(amapKey || '');

  // Animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    }, [])
  );

  const cleanUrlString = (input: any) => {
    let clean = input.trim();
    if (!clean) return '';
    if (clean.endsWith('/')) clean = clean.slice(0, -1);
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      clean = `http://${clean}`;
    }
    return clean;
  };

  // LAN auto-discover using mDNS + port scan
  const handleAutoDiscover = async () => {
    setDiscovering(true);
    setDiscoveredServices([]);
    setDiscoveryStatus('正在扫描局域网...');
    
    try {
      const options = {
        mode: discoveryMode,
        ip: cleanIpAddress(ipAddress) || undefined,
        timeout: 5000,
        onProgress: (progress: any) => {
          if (progress.step === 'mdns') {
            setDiscoveryStatus(progress.status === 'scanning' ? '正在通过 mDNS 发现服务...' : `mDNS 发现完成`);
          } else if (progress.step === 'portscan') {
            setDiscoveryStatus(progress.status === 'scanning' ? `正在扫描端口 (${progress.ip})...` : '端口扫描完成');
          }
        }
      };
      
      const result = await discoverServices(options);
      
      if (result.services.length > 0) {
        setDiscoveredServices(result.services);
        setDiscoveryStatus(`发现 ${result.services.length} 个服务`);
        
        // 自动选择第一个服务
        if (result.primaryService) {
          setUrl(result.primaryService.fullUrl);
        }
        
        Alert.alert(
          '发现服务',
          `已找到 ${result.services.length} 个 FilmGallery 服务\n` +
          result.services.map((s: any) => `• ${s.device || s.ip}: ${s.fullUrl}`).join('\n')
        );
      } else {
        setDiscoveryStatus('未找到服务');
        Alert.alert(
          '未找到服务',
          '在局域网内未发现 FilmGallery 服务。\n\n请检查:\n1. 电脑上的 FilmGallery 是否已启动\n2. 手机和电脑是否在同一网络\n3. 防火墙是否允许连接\n\n如果是公网服务器，请输入 IP 地址后使用"端口扫描"模式'
        );
      }
    } catch (e) {
      setDiscoveryStatus('发现失败');
      Alert.alert('错误', e.message || '发现过程出错');
    } finally {
      setDiscovering(false);
    }
  };

  // 选择已发现的服务
  const selectService = (service: any) => {
    setUrl(service.fullUrl);
    Alert.alert('已选择', `服务器地址已设为: ${service.fullUrl}`);
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

  const saveMapSettings = async () => {
    await AsyncStorage.setItem('map_provider', localMapProvider);
    if (localMapProvider === 'amap') {
      await AsyncStorage.setItem('amap_key', localAmapKey.trim());
      setAmapKey(localAmapKey.trim());
    }
    setMapProvider(localMapProvider);
    Alert.alert('已保存', '地图设置已保存，重新进入地图页即可生效');
  };

  const toggleDark = async (val: any) => {
    setIsDark(val);
    setDarkMode && setDarkMode(val);
    await AsyncStorage.setItem('theme_dark', val ? 'true' : 'false');
  };

  const testConnection = async (targetUrl: any) => {
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
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {/* Auto Discovery Section */}
      <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>🔍 自动发现</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        自动发现局域网内的 FilmGallery 服务，或通过 IP 地址扫描端口
      </Text>
      
      {/* Discovery Mode Selection */}
      <View style={{ marginBottom: 12 }}>
        <SegmentedButtons
          value={discoveryMode}
          onValueChange={setDiscoveryMode}
          buttons={[
            { value: 'auto', label: '自动' },
            { value: 'mdns', label: '局域网 (mDNS)' },
            { value: 'portscan', label: '端口扫描' },
          ]}
          style={{ marginBottom: 8 }}
        />
        <Text style={[styles.modeHint, { color: theme.colors.onSurfaceVariant }]}>
          {discoveryMode === 'auto' && '自动模式：优先使用 mDNS 发现，然后端口扫描'}
          {discoveryMode === 'mdns' && 'mDNS 模式：零配置发现局域网内的服务'}
          {discoveryMode === 'portscan' && '端口扫描：输入 IP 地址扫描常用端口（适用于公网）'}
        </Text>
      </View>
      
      {/* IP Address Input (for portscan mode) */}
      {(discoveryMode === 'auto' || discoveryMode === 'portscan') && (
        <View style={{ marginBottom: 12 }}>
          <TextInput
            mode="outlined"
            value={ipAddress}
            onChangeText={setIpAddress}
            placeholder="192.168.1.100 (可选)"
            autoCapitalize="none"
            keyboardType="numeric"
            activeOutlineColor={theme.colors.primary}
            style={{ backgroundColor: theme.colors.surface }}
            label="服务器 IP 地址"
          />
        </View>
      )}
      
      {/* Discover Button */}
      <Button 
        mode="contained" 
        onPress={handleAutoDiscover} 
        loading={discovering}
        disabled={discovering}
        buttonColor="#5a4632"
        icon="magnify"
        style={{ marginBottom: 12 }}
      >
        {discovering ? discoveryStatus : '开始发现'}
      </Button>
      
      {/* Discovered Services List */}
      {discoveredServices.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.label, { color: theme.colors.primary }]}>发现的服务:</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {discoveredServices.map((service, index) => (
              <Chip
                key={index}
                icon={service.method === 'mdns' ? 'wifi' : 'magnify'}
                onPress={() => selectService(service)}
                selected={url === service.fullUrl}
                style={{ marginRight: 8, marginBottom: 8 }}
              >
                {service.device || service.ip}:{service.port}
              </Chip>
            ))}
          </View>
        </View>
      )}
      
      {/* Manual Configuration Section */}
      <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>手动配置</Text>
      <Text style={[styles.label, { color: theme.colors.primary }]}>Primary Server URL</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        完整服务器地址（自动发现后会自动填入）
      </Text>
      <TextInput
        mode="outlined"
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.x:4000"
        autoCapitalize="none"
        keyboardType="url"
        activeOutlineColor={theme.colors.primary}
        style={{ backgroundColor: theme.colors.surface, marginBottom: 10 }}
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
      
      <Text style={[styles.label, { color: theme.colors.primary }]}>Backup Server URL (Optional)</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        Alternative IP address if primary is unreachable.
      </Text>
      <TextInput
        mode="outlined"
        value={backup}
        onChangeText={setBackup}
        placeholder="http://192.168.1.y:4000"
        autoCapitalize="none"
        keyboardType="url"
        activeOutlineColor={theme.colors.primary}
        style={{ backgroundColor: theme.colors.surface, marginBottom: 10 }}
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
        <Text style={[styles.label, { color: theme.colors.primary }]}>Dark Mode</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant, marginBottom: 0 }]}>Reduce eye strain with a dark UI</Text>
          <Switch value={isDark} onValueChange={toggleDark} />
        </View>
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>Equipment Library</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>Manage your cameras, lenses, and flashes</Text>
        <Button 
          mode="outlined" 
          onPress={() => navigation.navigate('Equipment')} 
          icon="camera"
          textColor="#5a4632"
          style={{ marginTop: 8 }}
        >
          Open Equipment Library
        </Button>
      </View>
      
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>Location Diagnostic (位置诊断)</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>Debug location issues on HyperOS/MIUI devices</Text>
        <Button 
          mode="outlined" 
          onPress={() => navigation.navigate('LocationDiagnostic')} 
          icon="crosshairs-gps"
          textColor="#f59e0b"
          style={{ marginTop: 8 }}
        >
          Open Location Diagnostic
        </Button>
      </View>

      {/* Map Settings */}
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>地图设置</Text>
        <Text style={[styles.label, { color: theme.colors.primary }]}>地图服务商</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          选择地图底图和地理编码服务
        </Text>
        <SegmentedButtons
          value={localMapProvider}
          onValueChange={setLocalMapProvider as any}
          buttons={[
            { value: 'osm', label: '开源地图', icon: 'map-outline' },
            { value: 'amap', label: '高德地图', icon: 'map' },
          ]}
          style={{ marginBottom: 12 }}
        />
        {localMapProvider === 'osm' && (
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            使用 CartoDB 底图，无需 API Key，全球覆盖
          </Text>
        )}
        {localMapProvider === 'amap' && (
          <View>
            <Text style={[styles.label, { color: theme.colors.primary }]}>高德 Web 服务 API Key</Text>
            <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
              在高德开放平台创建「Web 服务」应用获取 Key，用于地图底图和地址搜索
            </Text>
            <TextInput
              mode="outlined"
              value={localAmapKey}
              onChangeText={setLocalAmapKey}
              placeholder="请输入高德 Web 服务 Key（32位）"
              autoCapitalize="none"
              autoCorrect={false}
              activeOutlineColor={theme.colors.primary}
              style={{ backgroundColor: theme.colors.surface, marginBottom: 8, fontFamily: 'monospace' }}
            />
          </View>
        )}
        <Button
          mode="contained"
          onPress={saveMapSettings}
          buttonColor="#3E6B64"
          style={{ marginTop: 4 }}
        >
          保存地图设置
        </Button>
      </View>
      
      {/* AI 助手 */}
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>AI 助手</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>配置 AI 助手 API Key 和模型，支持 OpenAI / DeepSeek / 本地 Ollama</Text>
        <Button
          mode="outlined"
          onPress={() => navigation.navigate('AISettings')}
          icon="robot"
          textColor={theme.colors.primary}
          style={{ marginTop: 8 }}
        >
          AI 助手设置
        </Button>
      </View>

      {/* Bottom padding for scroll */}
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold' as const,
    marginBottom: 8,
    marginTop: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    marginBottom: 16,
  },
  modeHint: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  button: {
    marginTop: 20,
  },
});
