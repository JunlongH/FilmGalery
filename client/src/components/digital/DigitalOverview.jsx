import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardBody, Skeleton, Button } from '@heroui/react';
import { motion } from 'framer-motion';
import { Image, Heart, BookMarked, Upload, Plus, ArrowRight } from 'lucide-react';
import HeroCarousel from '../Overview/HeroCarousel';
import AlbumCard from './albums/AlbumCard';
import ImageViewer from '../common/LazyImageViewer';
import { getAlbums, getApiBase } from '../../api';
import { getCacheStrategy } from '../../lib';

async function fetchDigitalStats() {
  const apiBase = getApiBase();
  const [statsRes, albumsRes, favsRes, sessionsRes] = await Promise.all([
    fetch(`${apiBase}/api/stats/summary?mode=digital`).then(r => r.json()),
    fetch(`${apiBase}/api/albums`).then(r => r.json()),
    fetch(`${apiBase}/api/photos?mode=digital&favorite=true&page=1&pageSize=1`).then(r => r.json()),
    fetch(`${apiBase}/api/digital-sessions`).then(r => r.json()),
  ]);
  const sessions = Array.isArray(sessionsRes) ? sessionsRes : [];
  return {
    photos: statsRes?.total_digital_photos || 0,
    albums: Array.isArray(albumsRes) ? albumsRes.length : 0,
    favorites: typeof favsRes?.total === 'number' ? favsRes.total : 0,
    sessions: sessions.length,
    recentSessions: sessions.slice(0, 5),
  };
}

const STAT_ITEMS = [
  { key: 'photos', icon: Image, label: 'Photos', color: 'text-sky-500', path: '/library' },
  { key: 'albums', icon: BookMarked, label: 'Albums', color: 'text-violet-500', path: '/albums' },
  { key: 'favorites', icon: Heart, label: 'Favorites', color: 'text-rose-500', path: '/library' },
  { key: 'sessions', icon: Upload, label: 'Imports', color: 'text-emerald-500', path: '/digital-import' },
];

export default function DigitalOverview() {
  const navigate = useNavigate();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['digitalOverviewStats'],
    queryFn: fetchDigitalStats,
    ...getCacheStrategy('stats'),
  });

  const { data: albums = [] } = useQuery({
    queryKey: ['albums'],
    queryFn: () => getAlbums(),
    ...getCacheStrategy('digitalAlbums'),
  });

  const recentAlbums = albums.slice(0, 6);
  const recentSessions = stats?.recentSessions || [];

  const handlePhotoClick = (photo, photos) => {
    setViewerPhotos(photos || [photo]);
    setViewerIndex(photos ? photos.findIndex(p => p.id === photo.id) : 0);
    setViewerOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-6 max-w-[1800px] mx-auto">
        {/* Hero Carousel — digital mode */}
        <HeroCarousel mode="digital" onPhotoClick={handlePhotoClick} />

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {STAT_ITEMS.map((item, index) => (
            <motion.div
              key={item.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.3 }}
              className="h-full"
            >
              <Card
                className="bg-white dark:bg-zinc-900 shadow-none hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group h-full border-none"
                isPressable
                onPress={() => item.path && navigate(item.path)}
              >
                <CardBody className="p-4 flex flex-row items-center gap-5">
                  <div className={`p-4 rounded-2xl bg-zinc-100 dark:bg-zinc-800 ${item.color} group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                    <item.icon size={28} />
                  </div>
                  <div className="flex-1">
                    {statsLoading ? (
                      <>
                        <Skeleton className="w-16 h-8 rounded-lg mb-2" />
                        <Skeleton className="w-12 h-4 rounded-lg" />
                      </>
                    ) : (
                      <div className="flex flex-col items-start">
                        <span className="text-3xl font-black text-zinc-900 dark:text-zinc-100 tracking-tight">
                          {(stats?.[item.key] || 0).toLocaleString()}
                        </span>
                        <span className="text-xs text-zinc-400 dark:text-zinc-500 font-medium uppercase tracking-wider">{item.label}</span>
                      </div>
                    )}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Recent Albums */}
        {recentAlbums.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Recent Albums</h2>
              <Button variant="flat" size="sm" onPress={() => navigate('/albums')} endContent={<ArrowRight className="w-4 h-4" />}>
                View All
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {recentAlbums.map(album => (
                <AlbumCard key={album.id} album={album} onClick={() => navigate(`/albums/${album.id}`)} />
              ))}
            </div>
          </motion.div>
        )}

        {/* 最近导入 */}
        {recentSessions.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="mb-8"
          >
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">Recent imports</h2>
            <Card className="bg-white dark:bg-zinc-900 shadow-none border-none">
              <CardBody className="p-2">
                <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {recentSessions.map(session => (
                    <li key={session.id} className="flex items-center gap-4 px-4 py-3">
                      <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-emerald-500 flex-shrink-0">
                        <Upload size={16} />
                      </div>
                      <span className="flex-1 min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {session.label || 'Untitled import'}
                      </span>
                      <span className="text-xs text-zinc-400 dark:text-zinc-500 flex-shrink-0">
                        {session.session_date || '—'}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400 flex-shrink-0 w-16 text-right">
                        {session.file_count ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </motion.div>
        )}

        {/* Empty-state CTA when no albums */}
        {albums.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="mb-8"
          >
            <Card className="bg-zinc-50 dark:bg-zinc-800/50 border border-dashed border-zinc-200 dark:border-zinc-700 shadow-none">
              <CardBody className="p-8 flex flex-col items-center justify-center text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                  <BookMarked className="w-8 h-8 text-zinc-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">No Albums Yet</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
                    Create albums to organize your digital photos by event, theme, or any grouping you like.
                  </p>
                </div>
                <div className="flex gap-3">
                  <Button color="primary" variant="flat" onPress={() => navigate('/albums')} startContent={<Plus className="w-4 h-4" />}>
                    Create Album
                  </Button>
                  <Button color="primary" variant="flat" onPress={() => navigate('/digital-import')} startContent={<Upload className="w-4 h-4" />}>
                    Import Photos
                  </Button>
                </div>
              </CardBody>
            </Card>
          </motion.div>
        )}

        {/* Import CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <Card className="bg-gradient-to-r from-sky-500/10 to-violet-500/10 border-none shadow-none">
            <CardBody className="p-6 flex flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-sky-500/10 text-sky-500">
                  <Upload size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Import New Photos</h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">Add JPEGs or RAW files from your digital camera or phone</p>
                </div>
              </div>
              <Button color="primary" onPress={() => navigate('/digital-import')} endContent={<ArrowRight className="w-4 h-4" />}>
                Start Import
              </Button>
            </CardBody>
          </Card>
        </motion.div>
      </div>

      {/* Image Viewer Modal */}
      {viewerOpen && (
        <ImageViewer
          images={viewerPhotos}
          index={viewerIndex}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}
