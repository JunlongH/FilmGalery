/**
 * Phase 2B #1 — Mobile pairing screen.
 *
 * Flow: user enters the 6-digit code shown on the desktop server →
 * POST /api/pairing/verify → store token via SecureStore → navigate back.
 * On 401 (revoked/expired), App.tsx navigates here automatically.
 */
import React, { useState, useCallback } from 'react';
import { useT } from '../../i18n';
import { View, Text, TextInput, Button, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, saveAuthToken } from '../../api/client';
import { getDeviceFingerprint } from '../../utils/deviceFp';

export default function PairingScreen() {
  const t = useT();
  const navigation = useNavigation<any>();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = useCallback(async () => {
    if (code.length !== 6) {
      setError(t('pair.enterCode'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const fp = await getDeviceFingerprint();
      const deviceName = `${Platform.OS === 'ios' ? 'iPhone' : 'Android'} ${fp.slice(-4)}`;
      // biome-ignore lint: api-client is loosely typed
      const res: any = await api.http.post('/api/pairing/verify', {
        code,
        deviceName,
        deviceKind: 'mobile',
        deviceFp: fp,
      });
      if (res.token) {
        await saveAuthToken(res.token);
        navigation.navigate('Main');
      } else {
        setError(t('pair.noToken'));
      }
    } catch (e: any) {
      const msg = e?.body?.error || e?.message || t('pair.failed');
      const status = e?.status;
      if (status === 423) {
        setError(t('pair.locked'));
      } else if (status === 401) {
        setError(t('pair.invalid'));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [code, navigation]);

  const handleCancel = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('pair.title')}</Text>
      <Text style={styles.subtitle}>
        {t('pair.hint')}
      </Text>

      <TextInput
        style={styles.codeInput}
        value={code}
        onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
        placeholder="000000"
        keyboardType="number-pad"
        maxLength={6}
        autoFocus
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={{ marginTop: 20 }} />
      ) : (
        <View style={styles.buttonRow}>
          <Button title={t('common.cancel')} onPress={handleCancel} color="#999" />
          <Button
            title={t('pair.pair')}
            onPress={handlePair}
            disabled={code.length !== 6}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  codeInput: {
    fontSize: 36,
    fontWeight: 'bold',
    letterSpacing: 12,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 24,
    width: '100%',
    maxWidth: 300,
  },
  error: {
    color: '#FF3B30',
    fontSize: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
  },
});
