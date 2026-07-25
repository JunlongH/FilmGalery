import React, { useContext, useState, useRef, useCallback, useEffect } from 'react';
import { View, StyleSheet, Alert, ActivityIndicator, ScrollView, Animated } from 'react-native';
import { TextInput, Button, Text, Switch, useTheme, Chip, SegmentedButtons, Card } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiContext } from '../../context/ApiContext';
import { api } from '../../api/client';
import { useT, getLanguage, setLanguage as saveLanguage } from '../../i18n';
import { Icon } from '../../components/ui';
import { 
  discoverPort, 
  discoverServices, 
  discoverByMdns,
  cleanIpAddress, 
  validateServer,
  isPrivateIp,
  DISCOVERY_MODE 
} from '../../utils/portDiscovery';

export default function SettingsScreen({ navigation }: any) {
  const theme = useTheme();
  const t = useT();
  const { baseUrl, setBaseUrl, backupUrl, setBackupUrl, darkMode, setDarkMode, mapProvider, setMapProvider, amapKey, setAmapKey } = useContext(ApiContext);
  const [url, setUrl] = useState(baseUrl);
  const [backup, setBackup] = useState(backupUrl || '');
  const [isDark, setIsDark] = useState(!!darkMode);
  const [language, setLanguageState] = useState(getLanguage());
  const [ipAddress, setIpAddress] = useState(''); // For auto-discovery
  const [discovering, setDiscovering] = useState(false);
  const [discoveredServices, setDiscoveredServices] = useState<any[]>([]);
  const [discoveryMode, setDiscoveryMode] = useState('auto');
  const [discoveryStatus, setDiscoveryStatus] = useState('');
  const [localMapProvider, setLocalMapProvider] = useState(mapProvider || 'osm');
  const [localAmapKey, setLocalAmapKey] = useState(amapKey || '');
  const [digitalEnabled, setDigitalEnabled] = useState(false);

  useEffect(() => {
    if (!baseUrl) {
      setDigitalEnabled(false);
      return;
    }
    let cancelled = false;
    api.http.get('/api/discover')
      .then((data: any) => {
        if (cancelled) return;
        setDigitalEnabled(!!data?.capabilities?.digital);
      })
      .catch(() => {
        if (!cancelled) setDigitalEnabled(false);
      });
    return () => { cancelled = true; };
  }, [baseUrl]);

  const goToDigitalLibrary = async () => {
    if (baseUrl) {
      try {
        await AsyncStorage.setItem(`library_mode@${baseUrl}`, 'digital');
      } catch { /* best-effort */ }
    }
    navigation.navigate('Main', { screen: 'Library' });
  };

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
    setDiscoveryStatus(t('settings.scanningLan'));
    
    try {
      const options = {
        mode: discoveryMode,
        ip: cleanIpAddress(ipAddress) || undefined,
        timeout: 5000,
        onProgress: (progress: any) => {
          if (progress.step === 'mdns') {
            setDiscoveryStatus(progress.status === 'scanning' ? t('settings.mdnsScanning') : t('settings.mdnsDone'));
          } else if (progress.step === 'portscan') {
            setDiscoveryStatus(progress.status === 'scanning' ? t('settings.portScanning', { ip: progress.ip }) : t('settings.portScanDone'));
          }
        }
      };
      
      const result = await discoverServices(options);
      
      if (result.services.length > 0) {
        setDiscoveredServices(result.services);
        setDiscoveryStatus(t('settings.foundCount', { count: result.services.length }));
        
        // 自动选择第一个服务
        if (result.primaryService) {
          setUrl(result.primaryService.fullUrl);
        }
        
        Alert.alert(
          t('settings.foundTitle'),
          t('settings.foundBody', { count: result.services.length }) + '\n' +
          result.services.map((s: any) => `• ${s.device || s.ip}: ${s.fullUrl}`).join('\n')
        );
      } else {
        setDiscoveryStatus(t('settings.noneFound'));
        Alert.alert(
          t('settings.noneFound'),
          t('settings.noneFoundBody')
        );
      }
    } catch (e) {
      setDiscoveryStatus(t('settings.discoverFailed'));
      Alert.alert(t('settings.error'), (e as Error).message || t('settings.discoverFailed'));
    } finally {
      setDiscovering(false);
    }
  };

  // 选择已发现的服务
  const selectService = (service: any) => {
    setUrl(service.fullUrl);
    Alert.alert(t('settings.selected'), t('settings.urlSetTo', { url: service.fullUrl }));
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
    Alert.alert(t('settings.savedTitle'), t('settings.mapSaved'));
  };

  const toggleDark = async (val: any) => {
    setIsDark(val);
    setDarkMode && setDarkMode(val);
    await AsyncStorage.setItem('theme_dark', val ? 'true' : 'false');
  };

  const testConnection = async (targetUrl: any) => {
    const clean = cleanUrlString(targetUrl);
    if (!clean) {
      alert(t('settings.enterUrl'));
      return;
    }
    try {
      const res = await validateServer(clean);
      if (res.valid) {
        // Auto-correct the scheme if the server answered on a different one.
        if (res.url && res.url !== clean) {
          setUrl(res.url);
        }
        alert(t('settings.connectOk', { url: res.url || clean }));
      } else {
        alert(t('settings.connectFail', { url: clean, message: 'unreachable' }));
      }
    } catch (e) {
      alert(t('settings.connectFail', { url: clean, message: (e as Error).message }));
    }
  };

  const handleSwap = () => {
    setUrl(backup);
    setBackup(url);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.colors.background }]}>
      {digitalEnabled && (
        <Card
          mode="elevated"
          style={[styles.digitalCard, { backgroundColor: theme.colors.primaryContainer }]}
        >
          <Card.Title
            title={t('digital.enabledTitle')}
            titleStyle={[styles.digitalCardTitle, { color: theme.colors.onPrimaryContainer }]}
            titleNumberOfLines={2}
            left={() => (
              <View style={[styles.digitalCardIcon, { backgroundColor: theme.colors.primary }]}>
                <Icon name="camera" size={20} color={theme.colors.onPrimary} />
              </View>
            )}
          />
          <Card.Content>
            <Text style={[styles.digitalCardBody, { color: theme.colors.onPrimaryContainer }]}>
              {t('digital.enabledBody')}
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button
              mode="contained"
              onPress={goToDigitalLibrary}
              icon="arrow-right"
              contentStyle={{ flexDirection: 'row-reverse' }}
            >
              {t('digital.goToDigital')}
            </Button>
          </Card.Actions>
        </Card>
      )}

      {/* Auto Discovery Section */}
      <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>🔍 {t('settings.autoDiscovery')}</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        {t('settings.autoDiscoveryHint')}
      </Text>
      
      {/* Discovery Mode Selection */}
      <View style={{ marginBottom: 12 }}>
        <SegmentedButtons
          value={discoveryMode}
          onValueChange={setDiscoveryMode}
          buttons={[
            { value: 'auto', label: t('settings.modeAuto') },
            { value: 'mdns', label: t('settings.modeMdns') },
            { value: 'portscan', label: t('settings.modePortScan') },
          ]}
          style={{ marginBottom: 8 }}
        />
        <Text style={[styles.modeHint, { color: theme.colors.onSurfaceVariant }]}>
          {discoveryMode === 'auto' && t('settings.autoMode')}
          {discoveryMode === 'mdns' && t('settings.mdnsMode')}
          {discoveryMode === 'portscan' && t('settings.portscanMode')}
        </Text>
      </View>
      
      {/* IP Address Input (for portscan mode) */}
      {(discoveryMode === 'auto' || discoveryMode === 'portscan') && (
        <View style={{ marginBottom: 12 }}>
          <TextInput
            mode="outlined"
            value={ipAddress}
            onChangeText={setIpAddress}
            placeholder={t('settings.ipOptional')}
            autoCapitalize="none"
            keyboardType="numeric"
            activeOutlineColor={theme.colors.primary}
            style={{ backgroundColor: theme.colors.surface }}
            label={t('settings.serverIp')}
          />
        </View>
      )}
      
      {/* Discover Button */}
      <Button 
        mode="contained" 
        onPress={handleAutoDiscover} 
        loading={discovering}
        disabled={discovering}
        icon="magnify"
        style={{ marginBottom: 12 }}
      >
        {discovering ? discoveryStatus : t('settings.startDiscovery')}
      </Button>
      
      {/* Discovered Services List */}
      {discoveredServices.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.discovered')}</Text>
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
      <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>{t('settings.manualConfig')}</Text>
      <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.primaryUrl')}</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        {t('settings.primaryHint')}
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
        >
          {t('settings.swap')}
        </Button>
      </View>
      
      <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.backupUrl')}</Text>
      <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
        {t('settings.backupHint')}
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
        <Button mode="outlined" onPress={() => testConnection(url)} style={[styles.button, { flex: 1, marginRight: 8 }]}>
          {t('settings.testPrimary')}
        </Button>
        <Button mode="outlined" onPress={() => testConnection(backup)} style={[styles.button, { flex: 1, marginLeft: 8 }]}>
          {t('settings.testBackup')}
        </Button>
      </View>

      <Button mode="contained" onPress={save} style={styles.button}>
        {t('settings.saveSettings')}
      </Button>
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.darkMode')}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant, marginBottom: 0 }]}>{t('settings.darkModeHint')}</Text>
          <Switch value={isDark} onValueChange={toggleDark} />
        </View>
      </View>

      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>语言 / Language</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>选择界面语言 / Choose UI language</Text>
        <SegmentedButtons
          value={language}
          onValueChange={(v) => {
            setLanguageState(v as any);
            saveLanguage(v as any);
          }}
          buttons={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
          ]}
        />
      </View>

      
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.locationDiag')}</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>{t('settings.locationDiagHint')}</Text>
        <Button 
          mode="outlined" 
          onPress={() => navigation.navigate('LocationDiagnostic')} 
          icon="crosshairs-gps"
          textColor="#f59e0b"
          style={{ marginTop: 8 }}
        >
          {t('settings.openLocationDiag')}
        </Button>
      </View>

      {/* Map Settings */}
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.sectionTitle, { color: theme.colors.primary }]}>{t('settings.mapSettings')}</Text>
        <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.mapProvider')}</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          {t('settings.mapProviderHint')}
        </Text>
        <SegmentedButtons
          value={localMapProvider}
          onValueChange={setLocalMapProvider as any}
          buttons={[
            { value: 'osm', label: t('settings.osm'), icon: 'map-outline' },
            { value: 'amap', label: t('settings.amap'), icon: 'map' },
          ]}
          style={{ marginBottom: 12 }}
        />
        {localMapProvider === 'osm' && (
          <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
            {t('settings.osmHint')}
          </Text>
        )}
        {localMapProvider === 'amap' && (
          <View>
            <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.amapKeyLabel')}</Text>
            <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
              {t('settings.amapKeyHint')}
            </Text>
            <TextInput
              mode="outlined"
              value={localAmapKey}
              onChangeText={setLocalAmapKey}
              placeholder={t('settings.amapKeyPlaceholder')}
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
          {t('settings.saveMap')}
        </Button>
      </View>
      
      {/* AI 助手 */}
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.aiAssistant')}</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>{t('settings.aiHint')}</Text>
        <Button
          mode="outlined"
          onPress={() => navigation.navigate('AISettings')}
          icon="robot"
          textColor={theme.colors.primary}
          style={{ marginTop: 8 }}
        >
          {t('settings.aiSettings')}
        </Button>
      </View>

      {/* 设备配对 */}
      <View style={{ marginTop: 24 }}>
        <Text style={[styles.label, { color: theme.colors.primary }]}>{t('settings.pairing')}</Text>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>{t('settings.pairingHint')}</Text>
        <Button
          mode="outlined"
          onPress={() => navigation.navigate('Pairing')}
          icon="cellphone-key"
          textColor={theme.colors.primary}
          style={{ marginTop: 8 }}
        >
          {t('settings.pairing')}
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
  digitalCard: {
    marginBottom: 16,
    marginTop: 4,
    borderRadius: 16,
  },
  digitalCardTitle: {
    fontSize: 16,
    fontWeight: '700' as const,
  },
  digitalCardBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  digitalCardIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
