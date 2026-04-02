// src/App.js
import React, { useCallback, useEffect, useState } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { queryClient, prefetchCommonData } from './lib';
import RollLibrary from './components/RollLibrary';
import NewRollForm from './components/NewRollForm';
import RollDetail from './components/RollDetail';
import FilmLibrary from './components/FilmLibrary';
import Overview from './components/Overview';
import CalendarView from './components/CalendarView';
import Statistics from './components/Statistics';
import Favorites from './components/Favorites';
import TagGallery from './components/TagGallery';
import Settings from './components/Settings';
import TitleBar from './components/TitleBar';
import ConflictBanner from './components/ConflictBanner';
import EquipmentManager from './components/EquipmentManager';
import LutLibrary from './components/Settings/LutLibrary';
import MapPage from './pages/MapPage';
import { getTags, bustImageCache } from './api';
import FloatingRefreshButton from './components/FloatingRefreshButton';
// HeroUI Provider for modern UI components
import { HeroUIProvider } from './providers';
// Modern Sidebar
import { Sidebar, SidebarProvider } from './components/Sidebar';
// AI Panel
import { AIPanelProvider, useAIPanel } from './components/AIPanel/AIPanelContext';
import AIPanel from './components/AIPanel/AIPanel';

// queryClient 已从 lib/queryClient.js 导入

function LayoutInner({ tags, handleHardRefresh }) {
  const { togglePanel } = useAIPanel();

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
            <Sidebar tags={tags} />

            {/* Main Content */}
            <main className="main flex-1 min-w-0 min-h-0 overflow-auto bg-transparent">
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
              </Routes>
            </main>

            {/* AI Panel — right side */}
            <AIPanel />
          </div>
        </div>
        <FloatingRefreshButton onRefresh={handleHardRefresh} />
      </SidebarProvider>
    </HeroUIProvider>
  );
}

function Layout() {
  const [tags, setTags] = useState([]);
  const queryClient = useQueryClient();

  const refreshTags = useCallback(async () => {
    try {
      const data = await getTags();
      // Filter out tags with 0 photos
      const validTags = (Array.isArray(data) ? data : []).filter(tag => tag.photos_count > 0);
      setTags(validTags);
    } catch (err) {
      console.error('Failed to load tags', err);
      setTags([]);
    }
  }, []);

  useEffect(() => {
    refreshTags();
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
      <LayoutInner tags={tags} handleHardRefresh={handleHardRefresh} />
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
