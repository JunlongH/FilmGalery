// src/App.js
import React, { useCallback, useEffect, useState, useMemo, lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { QueryClientProvider, useQueryClient, useQuery } from '@tanstack/react-query';
import { queryClient, prefetchCommonData, getCacheStrategy } from './lib';
import TitleBar from './components/TitleBar';
import ConflictBanner from './components/ConflictBanner';
import { getTags, bustImageCache } from './api';
import FloatingRefreshButton from './components/FloatingRefreshButton';
import PageLoading from './components/common/PageLoading';
import { HeroUIProvider } from './providers';
import { Sidebar, SidebarProvider } from './components/Sidebar';
import { AIPanelProvider, useAIPanel } from './components/AIPanel/AIPanelContext';
import Onboarding, { WORKSPACE_EVENT } from './components/Onboarding';

// ============================================================================
// 路由级代码分割
// ============================================================================
// 胶片页面
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

// 数码页面
const DigitalOverview = lazy(() => import('./components/digital/DigitalOverview'));
const LibraryView = lazy(() => import('./components/digital/LibraryView'));
const AlbumLibrary = lazy(() => import('./components/digital/albums/AlbumLibrary'));
const AlbumDetail = lazy(() => import('./components/digital/albums/AlbumDetail'));
const DigitalImportWizard = lazy(() => import('./components/digital/DigitalImportWizard'));

const MODE_KEY = 'fg-workspace-mode';
const ROUTE_KEYS = { film: 'fg-last-route-film', digital: 'fg-last-route-digital' };

function getRememberedRoute(m) {
  try { return localStorage.getItem(ROUTE_KEYS[m]) || '/'; } catch { return '/'; }
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

function FilmRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/calendar" element={<CalendarView mode="film" />} />
      <Route path="/map" element={<MapPage mode="film" />} />
      <Route path="/stats" element={<Statistics workspace="film" />} />
      <Route path="/spending" element={<Statistics workspace="film" view="spending" />} />
      <Route path="/rolls" element={<RollLibrary />} />
      <Route path="/rolls/new" element={<NewRollForm />} />
      <Route path="/rolls/:id" element={<RollDetail />} />
      <Route path="/films" element={<FilmLibrary />} />
      <Route path="/favorites" element={<Favorites mode="film" />} />
      <Route path="/themes" element={<TagGallery mode="film" />} />
      <Route path="/themes/:tagId" element={<TagGallery mode="film" />} />
      <Route path="/equipment" element={<EquipmentManager />} />
      <Route path="/luts" element={<LutLibrary />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Overview />} />
    </Routes>
  );
}

function DigitalRoutes() {
  return (
    <Routes>
      <Route path="/" element={<DigitalOverview />} />
      <Route path="/library" element={<LibraryView />} />
      <Route path="/albums" element={<AlbumLibrary />} />
      <Route path="/albums/:id" element={<AlbumDetail />} />
      <Route path="/digital-import" element={<DigitalImportWizard />} />
      <Route path="/calendar" element={<CalendarView mode="digital" />} />
      <Route path="/map" element={<MapPage mode="digital" />} />
      <Route path="/favorites" element={<Favorites mode="digital" />} />
      <Route path="/themes" element={<TagGallery mode="digital" />} />
      <Route path="/themes/:tagId" element={<TagGallery mode="digital" />} />
      <Route path="/stats" element={<Statistics workspace="digital" />} />
      <Route path="/equipment" element={<EquipmentManager />} />
      <Route path="/settings" element={<Settings />} />
      {/* 数码模式下的兜底路由 → 跳转到 Overview */}
      <Route path="*" element={<DigitalOverview />} />
    </Routes>
  );
}

function LayoutInner({ handleHardRefresh }) {
  const { togglePanel, isOpen: isAIPanelOpen } = useAIPanel();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState(() => localStorage.getItem(MODE_KEY) || 'film');
  const [aiPanelMounted, setAiPanelMounted] = useState(false);

  // 标签列表跟随工作区模式（胶片/数码各自独立计数）
  const { data: tagsData } = useQuery({
    queryKey: ['tags', mode],
    queryFn: () => getTags(mode),
    ...getCacheStrategy('tags'),
  });
  const tags = useMemo(
    () => (Array.isArray(tagsData) ? tagsData : []).filter(tag => tag.photos_count > 0),
    [tagsData]
  );

  useEffect(() => {
    if (isAIPanelOpen) setAiPanelMounted(true);
  }, [isAIPanelOpen]);

  // 路由记忆：每种工作区模式记住各自最后访问的路径
  useEffect(() => {
    try { localStorage.setItem(ROUTE_KEYS[mode] || ROUTE_KEYS.film, location.pathname); } catch { /* ignore */ }
  }, [mode, location.pathname]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'film' ? 'digital' : 'film';
      localStorage.setItem(MODE_KEY, next);
      navigate(getRememberedRoute(next));
      return next;
    });
  }, [navigate]);

  // Onboarding / 设置页切换工作区时同步 App 状态
  useEffect(() => {
    const handler = (e) => {
      const next = e.detail === 'digital' ? 'digital' : 'film';
      setMode(next);
    };
    window.addEventListener(WORKSPACE_EVENT, handler);
    return () => window.removeEventListener(WORKSPACE_EVENT, handler);
  }, []);

  // Ctrl+Shift+A 打开/关闭 AI 面板；Ctrl+Shift+M 切换胶片/数码工作区
  useEffect(() => {
    const handler = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 'a') {
        e.preventDefault();
        togglePanel();
      } else if (key === 'm' && !isTypingTarget(e.target)) {
        e.preventDefault();
        toggleMode();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePanel, toggleMode]);

  return (
    <HeroUIProvider>
      <SidebarProvider>
        <ConflictBanner />
        <div className="app-shell bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors duration-300">
          <TitleBar />
          <div className="app-body">
            <Sidebar tags={tags} mode={mode} onToggleMode={toggleMode} />

            <main className="main flex-1 min-w-0 min-h-0 overflow-auto bg-transparent">
              <Suspense fallback={<PageLoading />}>
                {mode === 'film' ? <FilmRoutes /> : <DigitalRoutes />}
              </Suspense>
            </main>

            {aiPanelMounted && (
              <Suspense fallback={null}>
                <AIPanel />
              </Suspense>
            )}
          </div>
        </div>
        <FloatingRefreshButton onRefresh={handleHardRefresh} />
        <Onboarding />
      </SidebarProvider>
    </HeroUIProvider>
  );
}

function Layout() {
  const queryClient = useQueryClient();

  const refreshTags = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tags'] });
  }, [queryClient]);

  useEffect(() => {
    prefetchCommonData();
    const handler = () => refreshTags();
    window.addEventListener('refresh-tags', handler);
    return () => window.removeEventListener('refresh-tags', handler);
  }, [refreshTags]);

  const handleHardRefresh = useCallback(() => {
    console.log('[App] Hard refresh: busting image cache + invalidating queries');
    try {
      bustImageCache();
      refreshTags();
      queryClient.invalidateQueries();
    } catch (e) {
      console.warn('Failed during hard refresh, falling back to page reload', e);
      window.location.reload();
    }
  }, [queryClient, refreshTags]);

  return (
    <AIPanelProvider>
      <LayoutInner handleHardRefresh={handleHardRefresh} />
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
