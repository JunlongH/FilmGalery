# 4. 前端开发

## 4.1 桌面端 (React)

### 4.1.1 项目结构
```
client/src/
├── components/          # React 组件
│   ├── RollLibrary.jsx   # 胶卷库主界面
│   ├── RollDetail.jsx    # 胶卷详情
│   ├── PhotoGrid.jsx     # 照片网格
│   ├── Statistics.jsx    # 统计页面
│   ├── FilmInventory.jsx # 库存管理
│   ├── TagEditModal.jsx  # 标签编辑弹窗
│   └── ...
├── data/               # 静态数据
│   └── cities.json      # 城市数据
├── styles/             # CSS 样式
│   └── global.css
├── api.js              # API 客户端
├── App.js              # 主应用组件
└── index.js            # 入口文件
```

### 4.1.2 核心组件

#### RollLibrary.jsx
胶卷库主界面，显示胶卷网格和筛选功能。

**功能：**
- 胶卷网格展示（封面、标题、日期、设备）
- 排序（日期/序号）
- 搜索和筛选
- 创建新胶卷

**关键代码：**
```jsx
const { data: rolls, isLoading } = useQuery({
  queryKey: ['rolls'],
  queryFn: async () => {
    const res = await fetch(`${baseUrl}/api/rolls`);
    return res.json();
  }
});
```

#### RollDetail.jsx
胶卷详情页，展示照片、元数据、地图。

**功能：**
- 照片瀑布流/网格展示
- 照片快速评分
- 批量编辑标签
- 地理位置展示
- 设备信息

**React Query 使用：**
```jsx
const { data: rollData, refetch } = useQuery({
  queryKey: ['roll', id],
  queryFn: () => fetch(`${baseUrl}/api/rolls/${id}`).then(r => r.json())
});

const updatePhotoMutation = useMutation({
  mutationFn: (data) => updatePhoto(data.photoId, data),
  onSuccess: () => {
    queryClient.invalidateQueries(['roll', id]);
  }
});
```

#### PhotoGrid.jsx
虚拟滚动照片网格，优化大量照片性能。

**使用 react-window：**
```jsx
import { FixedSizeGrid } from 'react-window';

<FixedSizeGrid
  columnCount={columnCount}
  columnWidth={220}
  height={window.innerHeight - 200}
  rowCount={rowCount}
  rowHeight={220}
  width={window.innerWidth - 40}
>
  {Cell}
</FixedSizeGrid>
```

#### Statistics.jsx
统计仪表板，包含图表和数据可视化。

**使用 Recharts：**
```jsx
import { BarChart, LineChart, PieChart } from 'recharts';

const formatStat = (num) => {
  if (!num && num !== 0) return '-';
  return Number.isInteger(num) ? num.toString() : num.toFixed(2);
};

<LineChart data={rollsByMonth}>
  <XAxis dataKey="month" />
  <YAxis />
  <Line type="monotone" dataKey="count" stroke="#8884d8" />
</LineChart>
```

#### TagEditModal.jsx
标签编辑弹窗，支持添加/删除标签。

**标签规范化（小写存储）：**
```jsx
const handleSave = async () => {
  const normalizedTags = tags.map(t => t.toLowerCase());
  await onSave(normalizedTags);
};
```

### 4.1.3 API 客户端 (api.js)

封装所有 API 调用：

```javascript
const baseUrl = process.env.REACT_APP_API_BASE || 'http://localhost:4000';

export async function getRolls() {
  const res = await fetch(`${baseUrl}/api/rolls`);
  if (!res.ok) throw new Error('Failed to fetch rolls');
  return res.json();
}

export async function updatePhoto(id, data) {
  const res = await fetch(`${baseUrl}/api/photos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || 'Update failed');
  }
  return res.json();
}
```

### 4.1.4 React Query 配置

在 `App.js` 中配置：

```jsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 分钟
      cacheTime: 10 * 60 * 1000, // 10 分钟
      refetchOnWindowFocus: false
    }
  }
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* 应用内容 */}
    </QueryClientProvider>
  );
}
```

### 4.1.5 懒加载优化

使用 `react-lazy-load-image-component`：

```jsx
import { LazyLoadImage } from 'react-lazy-load-image-component';

<LazyLoadImage
  src={`${baseUrl}${photo.thumb_rel_path}`}
  alt={photo.caption}
  effect="blur"
  placeholderSrc="/placeholder.jpg"
/>
```

## 4.2 移动端 (React Native)

### 4.2.1 项目结构
```
mobile/src/
├── api/                # API 客户端
│   └── client.js
├── components/         # 可复用组件
│   ├── PhotoCard.js
│   ├── RollCard.js
│   └── TagEditModal.js
├── context/            # Context Providers
│   └── ApiContext.js
├── hooks/              # 自定义 Hooks
│   └── usePhotos.js
├── screens/            # 页面组件
│   ├── HomeScreen.js
│   ├── RollDetailScreen.js
│   ├── FilmsScreen.js
│   ├── InventoryScreen.js
│   ├── StatsScreen.js
│   └── SettingsScreen.js
├── utils/              # 工具函数
│   └── fileSystem.js
├── setupAxios.js       # Axios 配置（自动切换 IP）
└── theme.js            # 主题配置
```

### 4.2.2 核心屏幕

#### HomeScreen.js
首页，显示概览统计和最近胶卷。

**使用 React Native Paper：**
```jsx
import { Card, List, FAB } from 'react-native-paper';

<Card>
  <Card.Title title="最近胶卷" />
  <Card.Content>
    <FlatList
      data={recentRolls}
      renderItem={({ item }) => <RollCard roll={item} />}
    />
  </Card.Content>
</Card>
```

#### RollDetailScreen.js
胶卷详情，照片列表和操作。

**使用 FlatList 优化：**
```jsx
<FlatList
  data={photos}
  keyExtractor={item => item.id.toString()}
  renderItem={({ item }) => <PhotoCard photo={item} />}
  numColumns={2}
  initialNumToRender={10}
  maxToRenderPerBatch={10}
  windowSize={5}
/>
```

#### SettingsScreen.js
设置页面，包含主备 IP 配置。

**IP 切换功能：**
```jsx
const [apiUrl, setApiUrl] = useState('');
const [backupUrl, setBackupUrl] = useState('');

const handleSwapUrls = async () => {
  await AsyncStorage.setItem('api_base_url', backupUrl);
  await AsyncStorage.setItem('api_backup_url', apiUrl);
  setApiUrl(backupUrl);
  setBackupUrl(apiUrl);
};

const testConnection = async (url) => {
  try {
    const res = await axios.get(`${url}/api/health`, { timeout: 3000 });
    Alert.alert('成功', `连接 ${url} 成功`);
  } catch (err) {
    Alert.alert('失败', err.message);
  }
};
```

### 4.2.3 Axios 自动切换 (setupAxios.js)

**核心逻辑：**
```javascript
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

let primaryUrl = '';
let secondaryUrl = '';
let currentUrl = 'primary';

export const setupAxios = async () => {
  primaryUrl = await AsyncStorage.getItem('api_base_url');
  secondaryUrl = await AsyncStorage.getItem('api_backup_url');
  axios.defaults.baseURL = primaryUrl;
  axios.defaults.timeout = 5000;
};

// 响应拦截器：自动切换 IP
axios.interceptors.response.use(
  response => response,
  async error => {
    const isNetworkError = 
      error.code === 'ECONNABORTED' ||
      error.message.includes('Network Error') ||
      error.message.includes('timeout');

    if (isNetworkError && secondaryUrl && currentUrl === 'primary') {
      console.log('[Axios] 切换到备用 URL:', secondaryUrl);
      currentUrl = 'secondary';
      axios.defaults.baseURL = secondaryUrl;
      
      // 重试原请求
      return axios.request(error.config);
    }
    
    return Promise.reject(error);
  }
);
```

### 4.2.4 Context API

**ApiContext.js：**
```jsx
import React, { createContext, useState, useEffect } from 'react';
import { setupAxios } from '../setupAxios';

export const ApiContext = createContext();

export const ApiProvider = ({ children }) => {
  const [baseUrl, setBaseUrl] = useState('');
  const [backupUrl, setBackupUrl] = useState('');

  useEffect(() => {
    setupAxios();
    loadUrls();
  }, []);

  const loadUrls = async () => {
    const primary = await AsyncStorage.getItem('api_base_url');
    const backup = await AsyncStorage.getItem('api_backup_url');
    setBaseUrl(primary);
    setBackupUrl(backup);
  };

  return (
    <ApiContext.Provider value={{ baseUrl, backupUrl, setBaseUrl, setBackupUrl }}>
      {children}
    </ApiContext.Provider>
  );
};
```

### 4.2.5 文件系统工具 (fileSystem.js)

适配 Expo SDK 54 新 API：

```javascript
import * as FileSystem from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';

export async function downloadImageAsync(url, options = {}) {
  const { fileName = 'photo.jpg', saveToLibrary = false } = options;
  
  try {
    // 使用新 API
    const fileUri = `${FileSystem.documentDirectory}${fileName}`;
    const file = await FileSystem.File.createAsync(fileUri);
    await file.downloadFileAsync(url);
    
    if (saveToLibrary) {
      await ensureMediaPermissionsAsync();
      await MediaLibrary.saveToLibraryAsync(fileUri);
    }
    
    return fileUri;
  } catch (err) {
    // 回退到旧 API
    const legacy = require('expo-file-system/legacy');
    return legacy.downloadAsync(url, fileName);
  }
}
```

### 4.2.6 导航配置

使用 React Navigation：

```jsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabNavigator() {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Films" component={FilmsScreen} />
      <Tab.Screen name="Stats" component={StatsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Main" component={TabNavigator} />
        <Stack.Screen name="RollDetail" component={RollDetailScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

## 4.3 共同最佳实践

### 4.3.1 错误处理
```javascript
try {
  const data = await api.updatePhoto(id, changes);
  Alert.alert('成功', '保存成功');
} catch (err) {
  console.error('Update failed:', err);
  Alert.alert('错误', err.message || '保存失败');
}
```

### 4.3.2 加载状态
```jsx
{isLoading && <ActivityIndicator />}
{error && <Text>加载失败：{error.message}</Text>}
{data && <ContentView data={data} />}
```

### 4.3.3 图片 URL 处理
```javascript
// 桌面端：相对路径
const imageUrl = `${baseUrl}${photo.thumb_rel_path}`;

// 移动端：绝对路径（避免跨域问题）
const imageUrl = `${baseUrl}${photo.thumb_rel_path}`.replace('//', '/');
```

### 4.3.4 性能优化
- 使用 `React.memo` 避免不必要的重渲染
- 虚拟滚动处理长列表
- 图片懒加载和压缩
- React Query 缓存减少网络请求
