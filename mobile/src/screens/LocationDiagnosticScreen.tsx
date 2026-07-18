/**
 * Location Diagnostic Screen
 * For debugging location issues on HyperOS/MIUI devices
 */

import React, { useState, useRef, useCallback } from 'react';
import { View, ScrollView, StyleSheet, Animated } from 'react-native';
import { Text, Button, Card, Divider, useTheme } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { Icon } from '../components/ui';
import locationService from '../services/locationService.native';

export default function LocationDiagnosticScreen() {
  const theme = useTheme();
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [locationResult, setLocationResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  
  // Animation refs
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  
  useFocusEffect(
    useCallback(() => {
      fadeAnim.setValue(0);
      slideAnim.setValue(20);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }, [])
  );
  
  const runDiagnostics = async () => {
    setTesting(true);
    setDiagnostics(null);
    setLocationResult(null);
    
    try {
      // Step 1: Get diagnostics
      const diag: any = await locationService.getDiagnostics();
      setDiagnostics(diag);
      
      // Step 2: Request permissions if needed
      if (diag.permissionStatus !== 'granted') {
        await locationService.requestPermissions();
        const updatedDiag = await locationService.getDiagnostics();
        setDiagnostics(updatedDiag);
      }
      
      // Step 3: Try to get location
      const result = await locationService.getLocation();
      setLocationResult(result);
      
      // Get log
      setLog(locationService.getLog());
    } catch (e) {
      setLocationResult({ success: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };
  
  const getStatusColor = (status: any) => {
    if (status === 'granted' || status === true || status === 'ON') return '#4ade80';
    if (status === 'denied' || status === false || status === 'OFF') return '#f87171';
    return '#fbbf24';
  };
  
  return (
    <ScrollView style={styles.container}>
      <Card style={styles.card}>
        <Card.Title title="位置服务诊断工具" subtitle="HyperOS/MIUI 调试" />
        <Card.Content>
          <Button 
            mode="contained" 
            onPress={runDiagnostics}
            loading={testing}
            disabled={testing}
          >
            {testing ? '测试中...' : '开始测试'}
          </Button>
          
          {diagnostics && (
            <>
              <Divider style={styles.divider} />
              <Text style={styles.sectionTitle}>权限状态</Text>
              
              <View style={styles.row}>
                <Text style={styles.label}>前台位置权限:</Text>
                <Text style={[styles.value, { color: getStatusColor(diagnostics.permissionStatus) }]}>
                  {diagnostics.permissionStatus}
                </Text>
              </View>
              
              <View style={styles.row}>
                <Text style={styles.label}>后台位置权限:</Text>
                <Text style={[styles.value, { color: getStatusColor(diagnostics.backgroundPermission) }]}>
                  {diagnostics.backgroundPermission}
                </Text>
              </View>
              
              <View style={styles.row}>
                <Text style={styles.label}>位置服务:</Text>
                <Text style={[styles.value, { color: getStatusColor(diagnostics.servicesEnabled) }]}>
                  {diagnostics.servicesEnabled ? '已开启' : '已关闭'}
                </Text>
              </View>
              
              {diagnostics.providerStatus && (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>GPS可用:</Text>
                    <Text style={[styles.value, { color: getStatusColor(diagnostics.providerStatus.gpsAvailable) }]}>
                      {diagnostics.providerStatus.gpsAvailable ? '是' : '否'}
                    </Text>
                  </View>
                  
                  <View style={styles.row}>
                    <Text style={styles.label}>网络定位可用:</Text>
                    <Text style={[styles.value, { color: getStatusColor(diagnostics.providerStatus.networkAvailable) }]}>
                      {diagnostics.providerStatus.networkAvailable ? '是' : '否'}
                    </Text>
                  </View>
                  
                  <View style={styles.row}>
                    <Text style={styles.label}>后台模式:</Text>
                    <Text style={[styles.value, { color: getStatusColor(diagnostics.providerStatus.backgroundModeEnabled) }]}>
                      {diagnostics.providerStatus.backgroundModeEnabled ? '已启用' : '未启用'}
                    </Text>
                  </View>
                </>
              )}
            </>
          )}
          
          {locationResult && (
            <>
              <Divider style={styles.divider} />
              <Text style={styles.sectionTitle}>定位结果</Text>
              
              <View style={styles.row}>
                <Text style={styles.label}>状态:</Text>
                <Text style={[styles.value, { color: locationResult.success ? '#4ade80' : '#f87171' }]}>
                  {locationResult.success ? '✓ 成功' : '✗ 失败'}
                </Text>
              </View>
              
              {locationResult.success ? (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>来源:</Text>
                    <Text style={styles.value}>{locationResult.source}</Text>
                  </View>
                  
                  <View style={styles.row}>
                    <Text style={styles.label}>纬度:</Text>
                    <Text style={styles.value}>{locationResult.coords.latitude.toFixed(6)}</Text>
                  </View>
                  
                  <View style={styles.row}>
                    <Text style={styles.label}>经度:</Text>
                    <Text style={styles.value}>{locationResult.coords.longitude.toFixed(6)}</Text>
                  </View>
                  
                  {locationResult.coords.accuracy && (
                    <View style={styles.row}>
                      <Text style={styles.label}>精度:</Text>
                      <Text style={styles.value}>±{locationResult.coords.accuracy.toFixed(0)}米</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={styles.row}>
                    <Text style={styles.label}>错误:</Text>
                    <Text style={[styles.value, { color: '#f87171' }]}>{locationResult.error}</Text>
                  </View>
                  
                  {locationResult.errors && (
                    <View style={styles.errorBox}>
                      <Text style={styles.errorTitle}>详细错误信息:</Text>
                      <Text style={styles.errorText}>Watch: {locationResult.errors.watch}</Text>
                      <Text style={styles.errorText}>Current: {locationResult.errors.current}</Text>
                    </View>
                  )}
                  
                  <Button 
                    mode="outlined" 
                    onPress={() => locationService.showGuidance(locationResult.error)}
                    style={{ marginTop: 12 }}
                  >
                    查看解决方案
                  </Button>
                </>
              )}
            </>
          )}
          
          {log.length > 0 && (
            <>
              <Divider style={styles.divider} />
              <Text style={styles.sectionTitle}>详细日志</Text>
              <View style={styles.logBox}>
                {log.map((entry, idx) => (
                  <Text key={idx} style={styles.logEntry}>{entry}</Text>
                ))}
              </View>
            </>
          )}
        </Card.Content>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5'
  },
  card: {
    margin: 16
  },
  divider: {
    marginVertical: 16
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold' as const,
    marginBottom: 12
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6
  },
  label: {
    fontSize: 14,
    color: '#666'
  },
  value: {
    fontSize: 14,
    fontWeight: '600' as const
  },
  errorBox: {
    backgroundColor: '#fee',
    padding: 12,
    borderRadius: 8,
    marginTop: 12
  },
  errorTitle: {
    fontSize: 14,
    fontWeight: 'bold' as const,
    marginBottom: 6,
    color: '#c00'
  },
  errorText: {
    fontSize: 12,
    color: '#c00',
    fontFamily: 'monospace'
  },
  logBox: {
    backgroundColor: '#000',
    padding: 12,
    borderRadius: 8,
    maxHeight: 300
  },
  logEntry: {
    fontSize: 11,
    color: '#0f0',
    fontFamily: 'monospace',
    marginBottom: 2
  }
});
