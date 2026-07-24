// src/App.js
import React, { useCallback, useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider, useQueryClient, useQuery } from '@tanstack/react-query';
import { queryClient, prefetchCommonData, getCacheStrategy } from './lib';
import TitleBar from './components/TitleBar';
import ConflictBanner from './components/ConflictBanner';
import { getTags, bustImageCache, getAppConfig } from './api';
import FloatingRefreshButton from './components/FloatingRefreshButton';
import PageLoading from './components/common/PageLoading';
// HeroUI Provider for modern UI components
import { HeroUIProvider } from './providers';
// Modern Sidebar
import { Sidebar, SidebarProvider } from './components/Sidebar';
// AI Panel（Provider 同步加载，面板主体首次打开时才加载 chunk）
import { AIPanelProvider, useAIPanel } from './components/AIPanel/AIPanelContext';

// ============================================================================
// 路由级代码分割 —— 所有页面组件按需加载
// 重型依赖（three/leaflet/recharts/markdown/exifr）随路由 chunk 隔离，
// 不再进入主 bundle
// ============================================================================
const Overview = lazy(() => import('./components/Overview'));
const CalendarView = lazy(() => import('./components/CalendarView'));
const MapPage = lazy(() => import('./pages/MapPage'));
const Statistics = lazy(() => import('./components/Statistics'));
const RollLibrary = lazy(() => import('./components/RollLibrary'));
const NewRollForm = lazy(() => import('./components/NewRollForm'));
const RollDetail = lazy(() => import('./components/RollDetail'));
const FilmLibrary = lazy(() => import('./components/FilmLibrary'));
const Favorites = lazy(() => import('./components/Favorites'));
const TagGallery = lazy(() => import('./components/TagGallery'));
const EquipmentManager = lazy(() => import('./components/EquipmentManager'));
const LutLibrary = lazy(() => import('./components/Settings/LutLibrary'));
const Settings = lazy(() => import('./components/Settings'));
const AIPanel = lazy(() => import('./components/AIPanel/AIPanel'));

// Digital mode — lazy-loaded routes
const LibraryView = lazy(() => import('./components/digital/LibraryView'));
const AlbumLibrary = lazy(() => import('./components/digital/albums/AlbumLibrary'));
const AlbumDetail = lazy(() => import('./components/digital/albums/AlbumDetail'));
const DigitalImportWizard = lazy(() => import('./components/digital/DigitalImportWizard'));
const OnboardingModal = lazy(() => import('./components/digital/OnboardingModal'));

function LayoutInner({ tags, handleHardRefresh, appConfig, onOpenOnboarding }) {
  const { togglePanel, isOpen: isAIPanelOpen } = useAIPanel();
  // AIPanel 首次打开后才挂载（并从此保持挂载以保留会话状态与关闭动画），
  // 以此延迟其数据请求与 react-markdown 依赖链的加载
  const [aiPanelMounted, setAiPanelMounted] = useState(false);
  useEffect(() => {
    if (isAIPanelOpen) setAiPanelMounted(true);
  }, [isAIPanelOpen]);

  // Ctrl+Shift+A 打开/关闭 AI 面板
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePanel]);

  return (
    <HeroUIProvider>
      <SidebarProvider>
        <ConflictBanner />
        <div className="app-shell bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
          <TitleBar />
          <div className="app-body">
            {/* Modern Sidebar */}
            <Sidebar tags={tags} appConfig={appConfig} />

            {/* Main Content */}
            <main className="main flex-1 min-w-0 min-h-0 overflow-auto bg-transparent">
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  <Route path="/" element={<Overview />} />
                  <Route path="/calendar" element={<CalendarView />} />
                  <Route path="/map" element={<MapPage />} />
                  <Route path="/stats" element={<Statistics />} />
                  <Route path="/spending" element={<Statistics mode="spending" />} />
                  <Route path="/rolls" element={<RollLibrary />} />
                  <Route path="/rolls/new" element={<NewRollForm />} />
                  <Route path="/rolls/:id" element={<RollDetail />} />
                  <Route path="/films" element={<FilmLibrary />} />
                  <Route path="/favorites" element={<Favorites />} />
                  <Route path="/themes" element={<TagGallery />} />
                  <Route path="/themes/:tagId" element={<TagGallery />} />
                  <Route path="/equipment" element={<EquipmentManager />} />
                  <Route path="/luts" element={<LutLibrary />} />
                  <Route path="/settings" element={<Settings />} />
                  {/* Digital mode routes */}
                  <Route path="/library" element={<LibraryView />} />
                  <Route path="/albums" element={<AlbumLibrary />} />
                  <Route path="/albums/:id" element={<AlbumDetail />} />
                  <Route path="/digital-import" element={<DigitalImportWizard />} />
                </Routes>
              </Suspense>
            </main>

            {/* AI Panel — right side（首次打开时才加载） */}
            {aiPanelMounted && (
              <Suspense fallback={null}>
                <AIPanel />
              </Suspense>
            )}
          </div>
        </div>
        <FloatingRefreshButton onRefresh={handleHardRefresh} />

        {/* Onboarding modal — shown when onboarding_completed is falsy */}
        {appConfig && !appConfig.onboarding_completed && (
          <Suspense fallback={null}>
            <OnboardingModal appConfig={appConfig} />
          </Suspense>
        )}
      </SidebarProvider>
    </HeroUIProvider>
  );
}

function Layout() {
  const queryClient = useQueryClient();

  // 侧边栏 tags 统一走 React Query（['tags'] key 与 RollDetail/TagGallery 的
  // invalidate 对齐；'refresh-tags' 事件转为 invalidate 触发重取）
  const { data: tagsData } = useQuery({
    queryKey: ['tags'],
    queryFn: getTags,
    ...getCacheStrategy('tags'),
  });

  // App config (photography mode + onboarding state)
  const { data: appConfig } = useQuery({
    queryKey: ['app-config'],
    queryFn: getAppConfig,
    ...getCacheStrategy('appConfig'),
  });
  const tags = useMemo(
    () => (Array.isArray(tagsData) ? tagsData : []).filter(tag => tag.photos_count > 0),
    [tagsData]
  );

  const refreshTags = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tags'] });
  }, [queryClient]);

  useEffect(() => {
    // 启动时预取常用数据
    prefetchCommonData();
    const handler = () => refreshTags();
    window.addEventListener('refresh-tags', handler);
    return () => window.removeEventListener('refresh-tags', handler);
  }, [refreshTags]);

  const handleHardRefresh = useCallback(() => {
    console.log('[App] Hard refresh: busting image cache + clearing query cache');
    try {
      // 1. Increment global cache-buster → all subsequent buildUploadUrl calls
      //    will produce new URLs that bypass the browser's HTTP disk cache
      //    (even for resources served with max-age=1y, immutable)
      bustImageCache();

      // 2. Clear all React Query caches and re-fetch everything
      queryClient.clear();

      // 3. Refresh tags (sidebar)
      refreshTags();

      // 4. Invalidate all queries so active components re-fetch fresh data
      //    (queryClient.clear() removes cache, but invalidateQueries triggers
      //    refetch for any mounted observers)
      queryClient.invalidateQueries();
    } catch (e) {
      console.warn('Failed during hard refresh, falling back to page reload', e);
      window.location.reload();
    }
  }, [queryClient, refreshTags]);

  return (
    <AIPanelProvider>
      <LayoutInner tags={tags} handleHardRefresh={handleHardRefresh} appConfig={appConfig} />
    </AIPanelProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout />
      </Router>
    </QueryClientProvider>
  );
}

export default App;
