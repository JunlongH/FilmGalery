/**
 * Mobile access-key screen — shared-secret auth.
 *
 * Flow: user enters/pastes the secret shown on the desktop server →
 * validate via GET /api/auth/check → store via SecureStore → navigate back.
 * On 401 (invalid/rotated secret), App.tsx navigates here automatically.
 */
import React, { useState, useCallback } from 'react';
import { useT } from '../../i18n';
import { View, Text, TextInput, Button, ActivityIndicator, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, saveAuthToken } from '../../api/client';

export default function PairingScreen() {
  const t = useT();
  const navigation = useNavigation<any>();
  const [secret, setSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    const trimmed = secret.trim();
    if (!trimmed) {
      setError(t('pair.enterCode'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Store the secret as the auth token, then validate via /api/auth/check.
      await saveAuthToken(trimmed);
      // biome-ignore lint: api-client is loosely typed
      const res: any = await api.http.get('/api/auth/check');
      if (res && res.authenticated) {
        navigation.navigate('Main');
      } else {
        setError(t('pair.invalid'));
      }
    } catch (e: any) {
      const status = e?.status;
      if (status === 401 || status === 403) {
        setError(t('pair.invalid'));
      } else {
        setError(e?.body?.error || e?.message || t('pair.failed'));
      }
    } finally {
      setLoading(false);
    }
  }, [secret, navigation, t]);

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
        style={styles.secretInput}
        value={secret}
        onChangeText={setSecret}
        placeholder={t('pair.enterCode')}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="default"
        multiline
        numberOfLines={2}
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
            onPress={handleConnect}
            disabled={!secret.trim()}
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
  secretInput: {
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    borderWidth: 2,
    borderColor: '#007AFF',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    width: '100%',
    maxWidth: 320,
    minHeight: 56,
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
