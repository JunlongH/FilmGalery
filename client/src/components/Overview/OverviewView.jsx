/**
 * OverviewView - Main dashboard container
 * 
 * Combines:
 * - HeroCarousel: Featured photos
 * - QuickStats: Key metrics
 * - BrowseSection: Rolls/Photos browsing
 */
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import HeroCarousel from './HeroCarousel';
import QuickStats from './QuickStats';
import BrowseSection from './BrowseSection';
import ImageViewer from '../common/LazyImageViewer';

export default function OverviewView() {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPhotos, setViewerPhotos] = useState([]);
  const [viewerIndex, setViewerIndex] = useState(0);

  const handlePhotoClick = (photo, photos) => {
    setViewerPhotos(photos || [photo]);
    setViewerIndex(photos ? photos.findIndex(p => p.id === photo.id) : 0);
    setViewerOpen(true);
  };

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-6 max-w-[1800px] mx-auto">
        {/* Hero Carousel */}
        <HeroCarousel mode="film" onPhotoClick={handlePhotoClick} />

        {/* Quick Stats */}
        <QuickStats />

        {/* Browse Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-4">
            Browse Your Collection
          </h2>
          <BrowseSection />
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
