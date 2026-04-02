---
description: "Use when writing or modifying Wear OS watch app screens, components, or API integration. Covers React Native for Wear OS, TypeScript, and compact UI patterns."
applyTo: "watch-app/**"
---
# Watch 手表端开发规范

## 技术栈

- React Native 0.83 + TypeScript
- React Navigation 7（Native Stack）
- React Native Paper 5.12
- axios 1.7

## 代码规范

- 所有文件使用 TypeScript（.tsx / .ts）
- 类型定义在 `src/types/`
- 样式使用 `StyleSheet.create()`，不使用 NativeWind
- 黑色背景主题（`backgroundColor: '#000'`）

## 屏幕模板

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { api } from '../services/api';

interface Props {
  navigation: any;
  route: any;
}

export default function FeatureScreen({ navigation, route }: Props) {
  const [data, setData] = useState<DataType[]>([]);

  const loadData = useCallback(async () => {
    try {
      const result = await api.getData();
      setData(result);
    } catch (err) {
      console.log('[FeatureScreen] Error:', err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Feature</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000', padding: 8 },
  title: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
```

## 关键约束

- 手表屏幕极小，UI 必须精简（大字体、大按钮、少层级）
- 导航使用 `slide_from_right` 动画
- API 服务通过 `src/services/api.ts` 统一管理
- 新增屏幕须在 `App.tsx` 的 Stack.Navigator 注册
- 启动时预加载位置信息（`startLocationWatch()`）
- 9 个核心屏幕：Home, MainMenu, Settings, ShotLog (3), MyRolls, RollDetail, PhotoViewer
