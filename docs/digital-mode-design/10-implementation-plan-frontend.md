# 10 — 实施计划:前端

> 基于 2026-07-24 实际代码审计。**所有新组件严格遵循现有 FilmGallery 风格与基础**(JSX 非 TSX、HeroUI+Tailwind、React Query、lucide-react 图标、`.fg-*` CSS 命名、lazyModal 懒加载)。
> 前置:数据层 [08](./08-implementation-plan-data.md) + 后端 [09](./09-implementation-plan-backend.md)。

## 10.0 前端总览

```
路由层(App.jsx)
├── 新增路由:/library, /albums, /albums/:id, /albums/new, /digital-import, /onboarding
├── 现有路由复用:/photos/:id (Library 点进 ImageViewer)、/stats(内嵌 mode tabs)
└── 统一布局:HeroUIProvider + SidebarProvider + AIPanelProvider 不变

导航层(Sidebar)
├── 重构 SidebarSection 分组:Library | Film | Digital | Browse | Tools
├── 模式感知:Digital 首次启用前隐藏(AppConfig.digital_enabled)
└── 新增 lucide-react 图标:Images/Library, FolderPlus/Import, BookMarked/Album

新增组件(11 个 JSX 文件)
├── FilterChips.jsx                通用源类型过滤器(film/digital/all)——核心复用件
├── LibraryView.jsx                全部照片时序网格(mode 过滤)
├── DigitalImport/DigitalImportWizard.jsx  导入向导(3 步)
├── DigitalImport/ImportPreviewTable.jsx   预览去重表格
├── DigitalImport/ImportProgressBar.jsx    进度条(轮询 jobId)
├── AlbumLibrary.jsx               相册网格(封面+计数+日期范围)
├── AlbumDetail.jsx                相册详情(照片网格,复用 PhotoGrid)
├── AlbumEditModal.jsx             新建/编辑相册(标题/描述/位置/父级)
├── DigitalDevelop.jsx             数码调色(精简版,复用 FilmLab 底层)
├── OnboardingModal.jsx            首次运行选择(胶片/数码/都拍)
└── SourceModeToggle.jsx           Statistics 内嵌的 Film/Digital/Combined tab

修改现有组件(6 个)
├── Sidebar/Sidebar.jsx            分组重构
├── App.jsx                        路由 + lazy import
├── ImageViewer.jsx                FilmLab 入口按 source_type 分流(→ FilmLab 或 DigitalDevelop)
├── PhotoDetailsSidebar.jsx        FIELD_GROUPS 加 digital 分组 + scanning 条件渲染
├── Statistics.jsx                 Overview 内嵌 SourceModeToggle
└── EquipmentManager 子组件         camera 表单加数码传感器字段

样式与缓存
├── styles/digital.css             新增样式(沿用 .fg-* 命名)
└── lib/queryClient.js             DATA_CACHE_MAP 加 digitalPhotos/albums/sessions
```

---

## 10.1 路由层(`client/src/App.jsx`)

### 10.1.1 新增 lazy import(lines 23-36 区域追加)

```jsx
const LibraryView         = lazy(() => import('./components/LibraryView'));
const AlbumLibrary        = lazy(() => import('./components/AlbumLibrary'));
const AlbumDetail         = lazy(() => import('./components/AlbumDetail'));
const DigitalImportWizard = lazy(() => import('./components/DigitalImport/DigitalImportWizard'));
const OnboardingModal     = lazy(() => import('./components/OnboardingModal'));
```

### 10.1.2 新增 Routes(lines 72-88 区域追加)

```jsx
<Route path="/library"          element={<LibraryView />} />
<Route path="/albums"           element={<AlbumLibrary />} />
<Route path="/albums/new"       element={<AlbumEditModal mode="create" />} />
<Route path="/albums/:id"       element={<AlbumDetail />} />
<Route path="/albums/:id/edit"  element={<AlbumEditModal mode="edit" />} />
<Route path="/digital-import"   element={<DigitalImportWizard />} />
```

**注意**:`/albums/new` 和 `/albums/:id/edit` 实际用 Modal 实现(参照现有 NewRollForm 模式),Route 仅用于深链。AlbumDetail 是全页视图(参照 RollDetail)。

### 10.1.3 Onboarding 守卫

在 `<Layout>` 内顶层加:

```jsx
function AppShell() {
  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    ...getCacheStrategy('appConfig'),
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  useEffect(() => {
    if (appConfig && !appConfig.onboarding_completed) setShowOnboarding(true);
  }, [appConfig]);
  return (
    <>
      {/* ...existing layout... */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingModal onClose={() => setShowOnboarding(false)} />
        </Suspense>
      )}
    </>
  );
}
```

---

## 10.2 导航层(Sidebar 重构)

### 10.2.1 新分组结构

`client/src/components/Sidebar/Sidebar.jsx` lines 110-198 改造。现有三组(Main/Browse/Tools)→ 五组:

| 分组 | label | divider | 项 | 图标(lucide-react) |
|---|---|---|---|---|
| **Library** | 图库 | — | Library | `Images` 或 `LayoutGrid` |
| **Film** | 胶片 | yes | Overview, Rolls, Films | `Home`, `Camera`(roll), `Film` |
| **Digital** | 数码 | yes | Albums, Import | `BookMarked`, `FolderPlus` |
| **Browse** | 浏览 | yes | Calendar, Map, Favorites, Themes | `Calendar`, `Map`, `Heart`, `Tag` |
| **Tools** | 工具 | yes | Statistics, Equipment, LUT, Settings | `BarChart2`, `Aperture`, `Palette`, `Settings` |

**实现**:

```jsx
// Sidebar.jsx — 重构后的 render 区域
<>
  <SidebarSection label="图库 Library">
    <SidebarItem to="/library" icon={Images} label="图库" />
  </SidebarSection>

  {/* review C5: 侧边栏按 app_config 的 show_* 字段控制分组可见性 */}
  {appConfig?.show_film_section !== 0 && (
    <SidebarSection label="胶片 Film" divider>
      <SidebarItem to="/" icon={Home} label="总览" exact />
      <SidebarItem to="/rolls" icon={Camera} label="胶卷" />
      <SidebarItem to="/films" icon={Film} label="胶片库存" />
    </SidebarSection>
  )}

  {appConfig?.digital_enabled !== 0 && appConfig?.show_digital_section !== 0 && (
    <SidebarSection label="数码 Digital" divider>
      <SidebarItem to="/albums" icon={BookMarked} label="相册" />
      <SidebarItem to="/digital-import" icon={FolderPlus} label="导入" />
    </SidebarSection>
  )}

  <SidebarSection label="浏览 Browse" divider>
    <SidebarItem to="/calendar" icon={Calendar} label="日历" />
    <SidebarItem to="/map" icon={Map} label="地图" />
    <SidebarItem to="/favorites" icon={Heart} label="收藏" />
    <SidebarItem to="/themes" icon={Tag} label="主题" />
    {tags?.map(t => <SidebarSubItem key={t.id} to={`/themes/${t.id}`} label={t.name} />)}
  </SidebarSection>

  <SidebarSection label="工具 Tools" divider>
    <SidebarItem to="/stats" icon={BarChart2} label="统计" />
    <SidebarItem to="/equipment" icon={Aperture} label="器材" />
    <SidebarItem to="/luts" icon={Palette} label="LUT" />
    <SidebarItem to="/settings" icon={Settings} label="设置" />
  </SidebarSection>
</>
```

`appConfig` 通过上层 Context 或 useQuery 注入。`digital_enabled` 未启用时整组隐藏(但 Library/Browse/Tools 仍可见——胶片用户也能看 Library,只是过滤默认 film)。

### 10.2.2 图标导入

文件顶部追加:`import { Images, BookMarked, FolderPlus, Palette } from 'lucide-react';`(其余已存在)。

---

## 10.3 核心复用件:FilterChips

**这是 D1(过滤器芯片)的落地件**,被 Library/Calendar/Map/Favorites/Themes 共用。

> **⚠ review W6**:HeroUI 当前版本**无 `ChipGroup` 组件**(只有独立 `Chip`)。以下改为参照 `StatsModeToggle.jsx` 的 hand-rolled tabs 模式(审计 §14),用普通 `button` + CSS 实现,不依赖 `ChipGroup`。

```jsx
// client/src/components/FilterChips.jsx
import { Film, Camera, Layers } from 'lucide-react';
import { useIsDarkMode } from '../hooks/useIsDarkMode';  // 现有 hook

const MODES = [
  { key: 'film',    label: '胶片', icon: Film },
  { key: 'digital', label: '数码', icon: Camera },
  { key: 'all',     label: '全部', icon: Layers },
];

export default function FilterChips({ value = 'all', onChange, className = '' }) {
  const isDark = useIsDarkMode();
  return (
    <div className={`fg-filter-chips ${className}`}>
      {MODES.map(m => {
        const active = value === m.key;
        return (
          <button
            key={m.key}
            onClick={() => onChange(m.key)}
            className={`fg-filter-chip ${active ? 'fg-filter-chip-active' : ''}`}
            style={{
              padding: '4px 12px', borderRadius: 16, cursor: 'pointer',
              border: active ? 'none' : `1px solid ${isDark ? '#444' : '#ddd'}`,
              background: active ? (isDark ? '#3b82f6' : '#3b82f6') : 'transparent',
              color: active ? '#fff' : (isDark ? '#ccc' : '#555'),
              fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4,
            }}
          >
            <m.icon size={14} /> {m.label}
          </button>
        );
      })}
    </div>
  );
}
```

**用法**(LibraryView 示例):

```jsx
const [mode, setMode] = useState(appConfig?.default_source_filter || 'all');
const { data: photos } = useQuery({
  queryKey: ['library-photos', mode],
  queryFn: () => getPhotos({ mode, limit: 100 }),
  ...getCacheStrategy('photos'),
});
return (
  <div className="fg-page">
    <header className="fg-page-header">
      <h1 className="fg-page-title">图库 Library</h1>
      <FilterChips value={mode} onChange={setMode} />
    </header>
    <PhotoGrid photos={photos || []} />  {/* 见 §10.4 说明 */}
  </div>
);
```

**记忆**:`mode` 状态持久化到 localStorage(`localStorage.setItem('library.mode', mode)`),下次进入恢复。每个视图独立记忆(key:`library.mode`、`calendar.mode`、`map.mode`...)。

---

## 10.4 LibraryView(全部照片时序网格)

**这是设计文档提出的新视图**——当前 FilmGallery 缺少"全部照片"网格(胶片照片都在 Roll 内)。数码照片无 roll 容器,LibraryView 是数码照片的主要浏览入口。

> **⚠ review C2 修正**:原计划直接用 `VirtualPhotoGrid`,但实际 `VirtualPhotoGrid` 的签名是 `{ items, render, itemSize, gap }`——它**不接收 `photos`,不接收 `emptyHint`,且 `render` 是必填回调**(审计 C2 验证)。**正确做法是复用 `PhotoGrid.jsx`**(现有包装件),它已经:
> - 接收 `photos` 数组(line 7)
> - 内部判断 `photos.length > 400` 时委托 `VirtualPhotoGrid` + 传入 `renderThumb`(line 42-50)
> - 处理空状态("No photos found.",line 21-23)
> - 集成 `ImageViewer`(line 36)
>
> 因此 LibraryView 和 AlbumDetail **都用 `PhotoGrid`**,不直接碰 `VirtualPhotoGrid`。

```jsx
// client/src/components/LibraryView.jsx
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPhotos } from '../api';
import { getCacheStrategy } from '../lib';
import FilterChips from './FilterChips';
import PhotoGrid from './PhotoGrid';  // ← 复用包装件,非 VirtualPhotoGrid
import { getAppConfig } from '../api/app-config';

export default function LibraryView() {
  const { data: appConfig } = useQuery({ queryKey: ['app-config'], queryFn: getAppConfig });
  const [mode, setMode] = useState(
    () => localStorage.getItem('library.mode') || appConfig?.default_source_filter || 'all'
  );
  const handleModeChange = (m) => { setMode(m); localStorage.setItem('library.mode', m); };

  const { data: photos, isLoading } = useQuery({
    queryKey: ['library-photos', mode],
    queryFn: () => getPhotos({ mode, limit: 500 }),
    ...getCacheStrategy('photos'),
  });

  return (
    <div className="fg-page fg-library">
      <header className="fg-page-header">
        <h1 className="fg-page-title">图库</h1>
        <FilterChips value={mode} onChange={handleModeChange} />
      </header>
      {isLoading ? (
        <div className="fg-loading">加载中…</div>
      ) : (
        <PhotoGrid photos={photos || []} />
      )}
    </div>
  );
}
```

**复用** `PhotoGrid.jsx`——它内部 `>400` 张时自动切换虚拟滚动,否则普通网格,已含空状态和 ImageViewer 集成。点开照片触发 `ImageViewer`(见 10.8)。

---

## 10.5 相册组件

### 10.5.1 AlbumLibrary(网格)

**参照** `RollLibrary.jsx` 的网格布局(封面+标题+计数+日期范围)。这是 FilmGallery 风格一致性的关键——AlbumLibrary 看起来像 RollLibrary 的数码兄弟。

```jsx
// client/src/components/AlbumLibrary.jsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getAlbums } from '../api';
import { getCacheStrategy } from '../lib';
import { BookMarked, Plus } from 'lucide-react';

export default function AlbumLibrary() {
  const { data: albums, isLoading } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums({ parent_id: 'null' }),
    ...getCacheStrategy('digitalAlbums'),
  });

  return (
    <div className="fg-page fg-albums">
      <header className="fg-page-header">
        <h1 className="fg-page-title">相册</h1>
        <Link to="/albums/new" className="fg-btn fg-btn-primary">
          <Plus size={16} /> 新建相册
        </Link>
      </header>

      {isLoading ? <div className="fg-loading">加载中…</div> : (
        albums?.length === 0 ? (
          <div className="fg-empty-state">
            <BookMarked size={48} className="fg-empty-icon" />
            <p>还没有相册</p>
            <Link to="/albums/new" className="fg-btn fg-btn-primary">创建第一个相册</Link>
          </div>
        ) : (
          <div className="fg-roll-grid"> {/* 复用现有 roll-grid 样式类 */}
            {albums.map(album => <AlbumCard key={album.id} album={album} />)}
          </div>
        )
      )}
    </div>
  );
}

function AlbumCard({ album }) {
  return (
    <Link to={`/albums/${album.id}`} className="fg-roll-card"> {/* 复用 roll-card 样式 */}
      <div className="fg-roll-cover">
        {album.cover_thumb ? (
          <img src={buildUploadUrl(album.cover_thumb)} alt={album.title} />  {/* review N16:buildUploadUrl 已含 /uploads/ 前缀 */}
        ) : <BookMarked size={32} className="fg-roll-cover-placeholder" />}
      </div>
      <div className="fg-roll-info">
        <h3 className="fg-roll-title">{album.title}</h3>
        <span className="fg-roll-meta">{album.photo_count} 张{album.date_start ? ` · ${album.date_start}` : ''}</span>
      </div>
    </Link>
  );
}
```

### 10.5.2 AlbumDetail(详情页)

**参照** `RollDetail/`(RollHeader + RollPhotoGrid + RollToolbar)。结构:

```jsx
// client/src/components/AlbumDetail.jsx
// - AlbumHeader(标题/描述/日期范围/编辑/删除按钮)
// - PhotoGrid(复用现有 PhotoGrid 或 VirtualPhotoGrid,数据来自 getAlbumPhotos(id))
// - 点照片 → ImageViewer(同胶片)
// - 工具栏:添加照片(从 Library 选)、批量操作、排序
```

复用 `PhotoGrid.jsx`(不关心 source_type)或 `VirtualPhotoGrid.jsx`。

### 10.5.3 AlbumEditModal(新建/编辑)

**参照** `NewRollForm.jsx`(Modal 表单)。字段:title, description, parent_album_id(下拉,排除自身防环), location_id(LocationInput 复用)。

---

## 10.6 DigitalImport 导入向导

**3 步向导**(设计文档 §4.6),参照现有 `RawImport/RawImportWizard.jsx` 的分步模式。

### 10.6.1 DigitalImportWizard.jsx

```jsx
// client/src/components/DigitalImport/DigitalImportWizard.jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Step1DropZone from './Step1DropZone';
import Step2Preview from './Step2Preview';
import Step3Progress from './Step3Progress';

export default function DigitalImportWizard() {
  const [step, setStep] = useState(1);
  const [files, setFiles] = useState([]);          // File[]
  const [preview, setPreview] = useState(null);    // preview API 返回
  const [jobId, setJobId] = useState(null);
  const navigate = useNavigate();

  return (
    <div className="fg-page fg-import-wizard">
      <header className="fg-page-header">
        <h1 className="fg-page-title">导入数码照片</h1>
      </header>

      <div className="fg-wizard-steps">
        <StepIndicator current={step} steps={['选择文件', '预览确认', '导入中']} />
      </div>

      {step === 1 && <Step1DropZone onFiles={async (fs) => {
        setFiles(fs);
        const result = await previewDigitalImport(fs);  // POST /api/digital/import/preview
        setPreview(result); setStep(2);
      }} />}
      {step === 2 && preview && <Step2Preview preview={preview} onConfirm={async ({ sessionTitle, albumId }) => {
        const { jobId } = await executeDigitalImport({ files_meta: preview.items, session_title: sessionTitle, album_id: albumId });
        setJobId(jobId); setStep(3);
      }} onBack={() => setStep(1)} />}
      {step === 3 && jobId && <Step3Progress jobId={jobId} onComplete={(result) => {
        navigate(result.albumId ? `/albums/${result.albumId}` : `/library`);
      }} />}
    </div>
  );
}
```

### 10.6.2 Step2Preview(去重表格)

```jsx
// client/src/components/DigitalImport/ImportPreviewTable.jsx
// 表格列:缩略图 | 文件名 | 类型(JPEG/RAW) | 拍摄日期 | 相机 | 状态(新/重复)
// 重复行灰色 + "已存在" 标签 + 取消勾选
// 底部:session_title 输入 + album_id 下拉(可选,选"新建相册"弹 AlbumEditModal)
// 确认按钮显示"导入 N 张(跳过 M 张重复)"
```

### 10.6.3 Step3Progress(进度轮询)

```jsx
// client/src/components/DigitalImport/ImportProgressBar.jsx
const { data: job } = useQuery({
  queryKey: ['import-job', jobId],
  queryFn: () => getImportProgress(jobId),
  refetchInterval: (data) => data?.status === 'running' ? 500 : false,  // 500ms 轮询直到完成
  ...getCacheStrategy('uploadProgress'),  // REALTIME
});
// 显示:进度条(done/total) + 当前文件名 + 错误列表 + 取消按钮
```

### 10.6.4 API 调用(preview 多文件上传)

```jsx
// Step1 用 uploadWithProgress 上传到 /api/digital/import/preview
const fd = new FormData();
files.forEach(f => fd.append('files', f));  // 字段名 'files',匹配 multer
const result = await uploadWithProgress('/api/digital/import/preview', fd, onProgress);
```

---

## 10.7 DigitalDevelop(数码调色)

**D6/D10 的落地**:复用 FilmLab 底层模块(RenderCore + filmLab*.js pure functions),新建精简 UI(~32KB)。

### 10.7.1 设计原则

- **不 fork FilmLab.jsx**(2862 行太重)
- 复用 `packages/shared/render/RenderCore.js`(实例化时 `inverted:false, filmCurveEnabled:false`)
- 复用 `FilmLabCanvas.jsx`(画布+裁剪+缩放)、`SliderControl.jsx`、`ToneCurveEditor.jsx`、`HSLPanel.jsx`、`SplitToningPanel.jsx` 作为子组件
- **新建**轻量容器 `DigitalDevelop.jsx` 管理状态 + 调用 RenderCore + 与 `/api/digital-develop/*` 通信

### 10.7.2 DigitalDevelop.jsx(签名)

```jsx
// client/src/components/DigitalDevelop/DigitalDevelop.jsx
import { useState, useRef, useCallback } from 'react';
import { RenderCore, getEffectiveInverted } from '@filmgallery/shared';
// 复用纯 UI 控件(简单 props,自包含):
import SliderControl from '../FilmLab/SliderControl';        // ✅ 复用
import ToneCurveEditor from '../FilmLab/ToneCurveEditor';    // ✅ 复用
import HSLPanel from '../FilmLab/HSLPanel';                  // ✅ 复用
import SplitToningPanel from '../FilmLab/SplitToningPanel';  // ✅ 复用
import LutSelectorModal from '../FilmLab/LutSelectorModal';  // ✅ 复用
// 新建轻量画布(不复用 FilmLabCanvas — 见下方 ⚠ 说明):
import DigitalDevelopCanvas from './DigitalDevelopCanvas';
import { digitalDevelopPreview, saveDevelopParams, getDevelopParams } from '../../api';

export default function DigitalDevelop({ photoId, imageUrl, onClose, onSave, onPhotoUpdate }) {
  // 9 类核心参数 + 裁剪/旋转(D10)
  const [exposure, setExposure] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [highlights, setHighlights] = useState(0);
  const [shadows, setShadows] = useState(0);
  const [whites, setWhites] = useState(0);
  const [blacks, setBlacks] = useState(0);
  const [temp, setTemp] = useState(0);       // 白平衡
  const [tint, setTint] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [curves, setCurves] = useState({ rgb: [], red: [], green: [], blue: [] });
  const [hslParams, setHslParams] = useState({});
  const [splitToning, setSplitToning] = useState({});
  const [lutName, setLutName] = useState(null);
  const [crop, setCrop] = useState(null);    // {x,y,width,height,rotation,flip_h,flip_v}
  const [rotation, setRotation] = useState(0);

  const canvasRef = useRef(null);
  const [debouncedParams, setDebouncedParams] = useState(null);

  // 构造 RenderCore params(SSOT,类比 FilmLab buildRenderCoreParams)
  const buildParams = useCallback(() => ({
    inverted: false,                    // 数码永不反转
    filmCurveEnabled: false,            // 无胶片曲线
    exposure, contrast, highlights, shadows, whites, blacks,
    temp, tint,
    saturation,
    curves,
    hsl: hslParams,
    splitTone: splitToning,
    lut: lutName,
    cropRect: crop || DEFAULT_CROP_RECT,
    rotation,
  }), [/* deps */]);

  // 预览:debounce 后 POST /api/digital-develop/preview(服务端渲染)或本地 WebGL
  useEffect(() => {
    const t = setTimeout(async () => {
      const params = buildParams();
      const jpegBuf = await digitalDevelopPreview(photoId, JSON.stringify(params));
      drawToCanvas(canvasRef.current, jpegBuf);
    }, 200);  // 200ms debounce
    return () => clearTimeout(t);
  }, [buildParams]);

  const handleSave = async () => {
    const params = buildParams();
    await saveDevelopParams(photoId, JSON.stringify(params));
    onSave?.(params);
    onPhotoUpdate?.({ develop_params_json: JSON.stringify(params) });
  };

  // 首次加载读取已保存参数
  useEffect(() => {
    getDevelopParams(photoId).then(({ params }) => {
      if (params) { /* setState 批量恢复 */ }
    });
  }, [photoId]);

  return (
    <div className="fg-digital-develop">
      <div className="fg-dd-canvas-area">
        <DigitalDevelopCanvas
          canvasRef={canvasRef}
          imageUrl={imageUrl}
          crop={crop} setCrop={setCrop}
          rotation={rotation} setRotation={setRotation}
        />
      </div>
      <aside className="fg-dd-controls">
        <DigitalDevelopControls
          exposure={[exposure, setExposure]} /* ...其余 9 类 */
          crop={[crop, setCrop]} rotation={[rotation, setRotation]}
          onSave={handleSave} onClose={onClose}
        />
      </aside>
    </div>
  );
}

// DigitalDevelopControls.jsx —— 精简版 FilmLabControls
// 只暴露 9 类核心滑块 + 裁剪/旋转 + LUT 选择 + 曲线 + HSL + SplitTone
// 无:反转模式、胶片曲线、密度计、base correction、auto-crop(胶片专用)
```

> **⚠ review C3 修正:为什么不能直接复用 `FilmLabCanvas`**
>
> `FilmLabCanvas.jsx` 的实际签名有 **25+ 个必填 props**(`canvasRef, origCanvasRef, zoom, setZoom, pan, setPan, isPanning, handleWheel, handlePanStart, isCropping, rotation, setRotation, onRotateStart, onRotateEnd, pushToHistory, handleCanvasClick, isPicking, cropRect, setCropRect, image, orientation, rotationOffset, ratioMode, ratioSwap, compareMode, compareSlider, setCompareSlider, expectedWidth`)。这些 props 在渲染体内被直接读取——传入 `undefined` 会崩溃(`setZoom` 被调用、`zoom` 参与计算等)。
>
> **结论**:DigitalDevelop 不能仅传 `canvasRef` 复用 FilmLabCanvas。方案:
> 1. **新建** `DigitalDevelopCanvas.jsx`(~80 行):一个 `<canvas>` + 简易 zoom/pan(wheel + drag)+ 裁剪框叠加层。Props 仅需 `canvasRef, imageUrl, crop, setCrop, rotation, setRotation`。
> 2. 可复用的 FilmLab 子组件是**纯 UI 控件**:`SliderControl`、`ToneCurveEditor`、`HSLPanel`、`SplitToningPanel`、`LutSelectorModal`——这些 props 简单、自包含,直接 import 即可。
> 3. 若后续需要 FilmLabCanvas 的高级功能(对比模式、RGB 取色器),可在 Phase 2 考虑提取共享的 `SharedCanvas` 基类。MVP 保持简单。

### 10.7.3 控件清单(D10 锁定)

| # | 控件 | 复用件 | 范围 |
|---|---|---|---|
| 1 | 曝光 Exposure | SliderControl | -100..100 |
| 2 | 对比度 Contrast | SliderControl | -100..100 |
| 3 | 高光 Highlights | SliderControl | -100..100 |
| 4 | 阴影 Shadows | SliderControl | -100..100 |
| 5 | 白色 Whites | SliderControl | -100..100 |
| 6 | 黑色 Blacks | SliderControl | -100..100 |
| 7 | 白平衡 Temp/Tint | SliderControl ×2 | -100..100 |
| 8 | 曲线 Tone Curve | ToneCurveEditor | rgb/r/g/b |
| 9 | HSL | HSLPanel | 8 色相 |
| — | 色调分离 Split Tone | SplitToningPanel | highlights/shadows |
| — | 饱和度 Saturation | SliderControl | -100..100 |
| — | LUT | LutSelectorModal | .cube |
| — | 裁剪/旋转/翻转 | FilmLabCanvas crop | 0-1 归一化 |

**不包含**:local adjustments、AI auto、spot healing、HDR 合成、全景拼接(D10 明确排除)。

---

## 10.8 ImageViewer 分流(D11 入口)

**审计关键发现**(§12):无 PhotoView,FilmLab 从 `ImageViewer.jsx:436` 的 "Film Lab" 按钮触发。数码照片只有 `positive_rel_path`(1 个源),`handleFilmLabClick`(240-252)已自动检测:≤1 源 → 直接打开。

**改造**:`handleFilmLabClick` 按 `photo.source_type` 分流:

```jsx
// ImageViewer.jsx handleFilmLabClick 改造(line 240-252)
const handleFilmLabClick = () => {
  const availableSources = getSourceAvailability(photo);  // 现有逻辑
  const sourceType = photo.source_type;

  if (sourceType === 'digital') {
    // 数码 → DigitalDevelop(精简调色,无反转)
    setShowDigitalDevelop(true);
    return;
  }
  // 胶片 → 现有 FilmLab 流程(不变)
  if (availableSources.size <= 1) {
    const first = getFirstAvailableSourceType();
    openFilmLabWithSource(first);
  } else {
    setShowSourceSelector(true);
  }
};
```

新增状态 + 渲染:

```jsx
const [showDigitalDevelop, setShowDigitalDevelop] = useState(false);
// ...
{showDigitalDevelop && (
  <ErrorBoundary name="DigitalDevelop">
    <DigitalDevelop
      photoId={photo.id}
      imageUrl={positiveUrl}
      onClose={() => setShowDigitalDevelop(false)}
      onPhotoUpdate={onPhotoUpdate}
    />
  </ErrorBoundary>
)}
```

**按钮文案**:胶片显示 "Film Lab",数码显示 "调色"(或统一 "Film Lab"——取决于是否区分)。建议保持 "Film Lab" 不变(减少改动),行为内部分流。

---

## 10.9 PhotoDetailsSidebar 分支

**审计 §13**:`FIELD_GROUPS`(line 16-24)是中心扩展点。

```jsx
// PhotoDetailsSidebar.jsx FIELD_GROUPS 改造(line 16)
const FIELD_GROUPS = {
  caption:   ['caption'],
  tags:      ['tags'],
  time:      ['date_taken', 'time_taken'],
  equipment: ['camera', 'lens', 'camera_equip_id', 'lens_equip_id', 'photographer'],
  params:    ['aperture', 'shutter_speed', 'iso', 'focal_length'],
  location:  ['location_id', 'country', 'city', 'detail_location', 'latitude', 'longitude'],
  scanning:  ['scanner_equip_id', 'scan_resolution', 'scan_software', 'scan_lab', 'scan_date', 'scan_cost', 'scan_notes'],
  digital:   ['source_make', 'source_model', 'source_software', 'source_lens', 'color_space', 'white_balance'],  // 新增
};
```

**渲染改造**(scanning 条件 + digital 条件):

```jsx
// 现有 scanning section(line ~700 区域)包裹条件
{photo.source_type !== 'digital' && (
  <section className="fg-sidepanel-section">
    <SectionHeader title="Scanning" sectionKey="scanning" />
    {/* ...现有 scanning 字段... */}
  </section>
)}

// 新增 digital section(在 scanning 之后或替换位置)
{photo.source_type === 'digital' && (
  <section className="fg-sidepanel-section">
    <SectionHeader title="数码源信息 Digital Source" sectionKey="digital" />
    <div className="fg-separator" />
    <div className="fg-sidepanel-groupGrid cols-2">
      <div className="fg-field"><label className="fg-label">相机 Make</label>
        <input className="fg-input" value={base?.source_make || ''} disabled /></div>
      <div className="fg-field"><label className="fg-label">相机 Model</label>
        <input className="fg-input" value={base?.source_model || ''} disabled /></div>
      <div className="fg-field"><label className="fg-label">软件</label>
        <input className="fg-input" value={base?.source_software || ''} disabled /></div>
      <div className="fg-field"><label className="fg-label">镜头</label>
        <input className="fg-input" value={base?.source_lens || ''} disabled /></div>
      <div className="fg-field"><label className="fg-label">色彩空间</label>
        <input className="fg-input" value={base?.color_space || ''} disabled /></div>
      <div className="fg-field"><label className="fg-label">白平衡</label>
        <input className="fg-input" value={base?.white_balance || ''} disabled /></div>
    </div>
  </section>
)}
```

**digital 字段为只读**(EXIF 提取,不允许手改);caption/tags/time/equipment/params/location 两组通用。

---

## 10.10 Statistics 内嵌 SourceModeToggle

**审计 §14 关键修正**:Statistics 现有 `mode` prop 是 stats/spending 视图切换(路径驱动 `/stats` vs `/spending`),**与** source filter(film/digital)**是不同概念**。

**方案**:不冲突——source filter 作为 Overview **内部**的二级 tab。

```jsx
// Statistics.jsx 的 Overview 子组件内
function Overview({ appConfig }) {
  const [sourceMode, setSourceMode] = useState(
    () => localStorage.getItem('stats.sourceMode') || appConfig?.default_source_filter || 'all'
  );

  const { data: summary } = useQuery({
    queryKey: ['stats-summary', sourceMode],
    queryFn: () => fetch(`${API}/api/stats/summary?mode=${sourceMode}`).then(r => r.json()),
    ...getCacheStrategy('stats'),
  });

  return (
    <div className="fg-stats-overview">
      <SourceModeToggle value={sourceMode} onChange={(m) => {
        setSourceMode(m); localStorage.setItem('stats.sourceMode', m);
      }} />
      {/* StatCard 网格 */}
    </div>
  );
}
```

```jsx
// client/src/components/Statistics/SourceModeToggle.jsx(新建)
// 参照 StatsModeToggle.jsx(hand-rolled tabs,非 HeroUI Tabs)
// 三选项:胶片 Film / 数码 Digital / 综合 Combined
// 图标:Film / Camera / Layers
```

---

## 10.11 OnboardingModal(首次运行)

```jsx
// client/src/components/OnboardingModal.jsx
// 模态卡片:3 个大选项(review C5: 字段名与 doc 08 迁移 schema 一致)
// 🎞️ 只拍胶片   → {active_mode:'film', default_source_filter:'film', show_digital_section:0, onboarding_completed:1}
// 📷 只拍数码   → {active_mode:'digital', default_source_filter:'digital', show_film_section:0, digital_enabled:1, onboarding_completed:1}
// 🎞️📷 都拍     → {active_mode:'film', default_source_filter:'all', digital_enabled:1, onboarding_completed:1}
// "跳过"         → {onboarding_completed:1}  (保持默认:digital_enabled=0,胶片体验不变)
// 调用 PUT /api/app-config/onboarding
```

**样式**:全屏 Modal,三张卡片横排,每张含图标+标题+描述。参照现有 ModalDialog 包装。

---

## 10.12 EquipmentManager 数码字段

`EquipmentManager/EquipmentEditModal.jsx` 的 camera 表单加字段:

| 字段 | 控件 | 条件 |
|---|---|---|
| is_digital | Switch/Checkbox | 始终显示 |
| sensor_type | Select(CMOS/CCD/BSI-CMOS/X-Trans/Foveon) | is_digital=1 |
| sensor_format | Select(full-frame/APS-C/APS-H/M4/3/1"/medium-format/phone) | is_digital=1 |
| megapixels | Number input | is_digital=1 |
| crop_factor | Number input | is_digital=1 |
| sensor_width_mm / height_mm | Number input | is_digital=1 |
| format_id | Select(现有胶片画幅) | is_digital=0(互斥) |

**应用层校验**(与后端一致):`is_digital=1` 时清空 `format_id`,反之亦然。

---

## 10.13 缓存策略更新

**文件**:`client/src/lib/queryClient.js` DATA_CACHE_MAP(line 70-93)追加:

```javascript
const DATA_CACHE_MAP = {
  // ...existing...
  appConfig: CACHE_STRATEGIES.SEMI_STATIC,    // 配置变更不频繁
  digitalPhotos: CACHE_STRATEGIES.DYNAMIC,    // 同 photos
  digitalAlbums: CACHE_STRATEGIES.SEMI_STATIC, // 类似 locations/tags
  digitalSessions: CACHE_STRATEGIES.DYNAMIC,
  importJobs: CACHE_STRATEGIES.REALTIME,      // 进度轮询
};
```

---

## 10.14 样式规范

**新增** `client/src/styles/digital.css`(沿用 `.fg-*` 命名前缀,与 forms.css/sidebar.css 一致):

```css
/* FilterChips */
.fg-filter-chips { display: flex; gap: 8px; }
.fg-filter-chip { cursor: pointer; }

/* Library */
.fg-library .fg-page-header { /* 复用现有 */ }

/* Album card(复用 .fg-roll-card 系列,微调) */
.fg-albums .fg-roll-card { /* 同 roll-card */ }

/* DigitalDevelop */
.fg-digital-develop { display: flex; height: 100vh; }
.fg-dd-canvas-area { flex: 1; }
.fg-dd-controls { width: 340px; overflow-y: auto; }

/* Import wizard */
.fg-import-wizard .fg-wizard-steps { /* step indicator */ }
```

**原则**:优先复用现有 `.fg-roll-*`、`.fg-page-*`、`.fg-sidepanel-*` 类;仅数码特有布局加新类。保持深色/浅色主题兼容(用 CSS 变量,不自硬编码颜色)。

---

## 10.15 前端验证清单

| # | 验证项 |
|---|---|
| 1 | OnboardingModal 首次显示,选择后不再显示 |
| 2 | 选"只拍胶片" → Digital sidebar 隐藏,Library 默认 film 过滤 |
| 3 | 选"都拍" → 所有分组可见,Library 默认 all |
| 4 | FilterChips 在 Library/Calendar/Map/Favorites/Themes 切换后数据正确刷新 |
| 5 | FilterChips 模式 localStorage 持久化(刷新后保持) |
| 6 | LibraryView 显示胶片+数码混合照片 |
| 7 | AlbumLibrary 空状态显示 CTA |
| 8 | AlbumLibrary → AlbumDetail → 点照片 → ImageViewer |
| 9 | AlbumEditModal 创建/编辑/删除/恢复 |
| 10 | DigitalImport 三步流程完整(preview 去重 → execute 进度 → 完成跳转) |
| 11 | 导入取消后 tmp 文件清理(后端验证 + 前端 UI 回退) |
| 12 | DigitalDevelop 9 类控件实时预览(debounce 200ms) |
| 13 | DigitalDevelop 保存后 develop_params_json 持久化,重开参数恢复 |
| 14 | DigitalDevelop 裁剪/旋转应用后 positive 覆盖 + thumb 重生成 |
| 15 | ImageViewer 对数码照片点 "Film Lab" → 打开 DigitalDevelop(不是 FilmLab) |
| 16 | ImageViewer 对胶片照片点 "Film Lab" → 仍打开 FilmLab(零回归) |
| 17 | PhotoDetailsSidebar 数码照片显示 digital section、隐藏 scanning |
| 18 | PhotoDetailsSidebar 胶片照片显示 scanning、隐藏 digital(零回归) |
| 19 | Statistics Overview 的 Film/Digital/Combined tab 切换数据正确 |
| 20 | EquipmentManager camera 表单 is_digital 切换时字段联动 |
| 21 | 深色/浅色主题下所有新组件样式正确 |
| 22 | 窗口缩放/窄屏下布局不破(RollGrid 已有响应式,复用) |

## 10.16 前端文件改动清单

| 文件 | 操作 | 行数 |
|---|---|---|
| `components/FilterChips.jsx` | 新建 | ~50 |
| `components/LibraryView.jsx` | 新建 | ~70 |
| `components/AlbumLibrary.jsx` | 新建 | ~120 |
| `components/AlbumDetail.jsx` | 新建 | ~180 |
| `components/AlbumEditModal.jsx` | 新建 | ~150 |
| `components/DigitalImport/DigitalImportWizard.jsx` | 新建 | ~120 |
| `components/DigitalImport/Step1DropZone.jsx` | 新建 | ~80 |
| `components/DigitalImport/ImportPreviewTable.jsx` | 新建 | ~150 |
| `components/DigitalImport/ImportProgressBar.jsx` | 新建 | ~100 |
| `components/DigitalDevelop/DigitalDevelop.jsx` | 新建 | ~350 |
| `components/DigitalDevelop/DigitalDevelopControls.jsx` | 新建 | ~250 |
| `components/DigitalDevelop/DigitalDevelopCanvas.jsx` | 新建(review C3) | ~80 |
| `components/OnboardingModal.jsx` | 新建 | ~120 |
| `components/Statistics/SourceModeToggle.jsx` | 新建 | ~60 |
| `components/Sidebar/Sidebar.jsx` | 重构分组 | ~60 diff |
| `App.jsx` | 路由 + lazy + onboarding | ~40 diff |
| `components/ImageViewer.jsx` | 分流 + DigitalDevelop 挂载 | ~30 diff |
| `components/PhotoDetailsSidebar.jsx` | FIELD_GROUPS + 条件渲染 | ~50 diff |
| `components/Statistics.jsx` | Overview 内嵌 SourceModeToggle | ~30 diff |
| `components/EquipmentManager/EquipmentEditModal.jsx` | 数码字段 | ~80 diff |
| `api/albums.js` | 新建 | ~60 |
| `api/digital-import.js` | 新建 | ~50 |
| `api/digital-develop.js` | 新建 | ~30 |
| `api/app-config.js` | 新建 | ~20 |
| `api/index.js` | barrel | +12 |
| `lib/queryClient.js` | DATA_CACHE_MAP | +5 |
| `styles/digital.css` | 新建 | ~150 |
| **合计** | | **~2390 行** |

前端预估 16-18 人天(含 UI 打磨与调试,是工作量最大的层)。
