import React, { useCallback, useContext, useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Chip, Text, TextInput, useTheme } from 'react-native-paper';
import { ApiContext } from '../../context/ApiContext';
import { getAIConfig, getAIModels, testAIConnection, updateAIConfig } from '../../api/aiApi';

export default function AISettingsScreen() {
  const theme = useTheme();
  const { baseUrl } = useContext(ApiContext);

  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null); // null | 'ok' | 'fail'
  const [models, setModels] = useState<any[]>([]);

  // 本地编辑状态
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [textModel, setTextModel] = useState('');
  const [visionModel, setVisionModel] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const data: any = await getAIConfig(baseUrl);
      setConfig(data);
      setApiBaseUrl(data.api_base_url || '');
      setTextModel(data.text_model || '');
      setVisionModel(data.vision_model || '');
      setApiKey(''); // 不回显
    } catch (err) {
      Alert.alert('加载失败', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const patch: any = { api_base_url: apiBaseUrl, text_model: textModel, vision_model: visionModel };
      if (apiKey) patch.api_key = apiKey;
      await updateAIConfig(baseUrl, patch);
      Alert.alert('已保存', 'AI 配置已更新');
      setApiKey('');
    } catch (err) {
      Alert.alert('保存失败', (err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [baseUrl, apiBaseUrl, apiKey, textModel, visionModel]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await testAIConnection(baseUrl);
      setTestResult('ok');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  }, [baseUrl]);

  const handleRefreshModels = useCallback(async () => {
    try {
      const list = await getAIModels(baseUrl);
      setModels(Array.isArray(list?.models) ? list.models : []);
    } catch (err) {
      Alert.alert('获取模型失败', (err as Error).message);
    }
  }, [baseUrl]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  const labelStyle = { fontSize: 14, fontWeight: '600' as const, color: theme.colors.primary, marginBottom: 4, marginTop: 16 };
  const hintStyle = { fontSize: 12, color: theme.colors.onSurfaceVariant, marginBottom: 8 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.background }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>

      {/* API 连接 */}
      <Text style={{ fontSize: 16, fontWeight: 'bold' as const, color: theme.colors.primary, marginBottom: 4 }}>API 连接</Text>
      <Text style={hintStyle}>填写兼容 OpenAI 格式的 API 地址（支持 DeepSeek、本地 Ollama 等）</Text>

      <Text style={labelStyle}>API 地址</Text>
      <TextInput
        mode="outlined"
        value={apiBaseUrl}
        onChangeText={setApiBaseUrl}
        placeholder="https://api.openai.com/v1"
        autoCapitalize="none"
        autoCorrect={false}
        dense
      />

      <Text style={labelStyle}>API Key</Text>
      <Text style={hintStyle}>{config?.api_key_set ? '已设置（留空表示不修改）' : '未设置'}</Text>
      <TextInput
        mode="outlined"
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={config?.api_key_set ? '留空不修改' : '输入 API Key'}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        dense
      />

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <Button
          mode="outlined"
          onPress={handleTest}
          loading={testing}
          style={{ flex: 1 }}
          textColor={theme.colors.primary}
        >
          测试连接
        </Button>
        {testResult && (
          <Chip
            icon={testResult === 'ok' ? 'check-circle' : 'close-circle'}
            style={{ backgroundColor: testResult === 'ok' ? theme.colors.primaryContainer : theme.colors.errorContainer }}
          >
            {testResult === 'ok' ? '连接成功' : '连接失败'}
          </Chip>
        )}
      </View>

      {/* 模型选择 */}
      <Text style={{ fontSize: 16, fontWeight: 'bold' as const, color: theme.colors.primary, marginTop: 24, marginBottom: 4 }}>模型选择</Text>

      <Button mode="text" onPress={handleRefreshModels} compact style={{ alignSelf: 'flex-start' }}>
        刷新模型列表
      </Button>

      <Text style={labelStyle}>文本模型</Text>
      <TextInput
        mode="outlined"
        value={textModel}
        onChangeText={setTextModel}
        placeholder="gpt-4o-mini"
        autoCapitalize="none"
        autoCorrect={false}
        dense
      />
      {models.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {models.slice(0, 10).map((m: any) => (
            <Chip key={m.id} compact onPress={() => setTextModel(m.id)}>{m.id}</Chip>
          ))}
        </View>
      )}

      <Text style={labelStyle}>视觉模型</Text>
      <TextInput
        mode="outlined"
        value={visionModel}
        onChangeText={setVisionModel}
        placeholder="gpt-4o"
        autoCapitalize="none"
        autoCorrect={false}
        dense
      />
      {models.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {models.slice(0, 10).map((m: any) => (
            <Chip key={m.id} compact onPress={() => setVisionModel(m.id)}>{m.id}</Chip>
          ))}
        </View>
      )}

      {/* 保存 */}
      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        buttonColor={theme.colors.primary}
        style={{ marginTop: 28 }}
      >
        保存配置
      </Button>

    </ScrollView>
  );
}
