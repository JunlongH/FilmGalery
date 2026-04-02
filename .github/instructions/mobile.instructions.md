---
description: "Use when writing or modifying React Native mobile app screens, components, navigation, or API integration. Covers Expo, NativeWind, React Navigation, and axios failover patterns."
applyTo: "mobile/**"
---
# Mobile 手机端开发规范

## 技术栈

- React Native 0.81 + Expo 54
- React Navigation 6（Bottom Tabs + Native Stack）
- React Native Paper 5 + NativeWind 4.2
- Vision Camera 4.7（帧处理 / 测光）
- axios + failover 机制

## 导航结构

```
BottomTab (3 tabs)
├── Timeline (HomeScreen → stack screens)
├── Map (MapScreen → stack screens)
└── Library (LibraryScreen → stack screens)
     └── Stack: RollDetail, PhotoView, Films, Favorites,
                Inventory, ShotLog, Equipment, Settings...
```

## 屏幕模板

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { View, FlatList, RefreshControl } from 'react-native';
import { Text, Card, useTheme } from 'react-native-paper';
import { useApiContext } from '../context/ApiContext';
import axios from 'axios';

export default function ResourceScreen({ navigation }) {
  const { apiBase } = useApiContext();
  const theme = useTheme();
  const [data, setData] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const res = await axios.get(`${apiBase}/api/resource`);
      setData(res.data);
    } catch (err) {
      console.error('[ResourceScreen] Load error:', err);
    }
  }, [apiBase]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={data}
        keyExtractor={item => String(item.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        renderItem={({ item }) => (
          <Card className="mx-4 mb-3" onPress={() => navigation.navigate('Detail', { id: item.id })}>
            <Card.Title title={item.name} />
          </Card>
        )}
      />
    </View>
  );
}
```

## API 集成

- 服务器地址通过 `ApiContext` 管理，用户可在设置中配置
- axios failover 逻辑在 `setupAxios.js`：主 URL 失败自动切换备用 URL
- 超时设置 5000ms，网络错误自动重试一次
- 清文本流量已在 app.json 中启用（`usesCleartextTraffic: true`）

## 主题色

```
primary: #5A4632 (暖棕)    secondary: #3E6B64 (青绿)
background: #FAF9F7         surface: #F5F0E6
```

## 关键约束

- NativeWind className 用于样式，复杂布局可用 StyleSheet
- 新增屏幕须在 `App.js` 注册到 Stack.Navigator
- 图标使用 Lucide React Native
- 文件名 PascalCase（屏幕）或 camelCase（工具）
- Expo 插件需在 `app.json` 的 plugins 数组注册
