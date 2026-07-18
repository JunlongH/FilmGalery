/**
 * LifeLogDayModal - Modal for viewing a day's photos
 * Shows photo grid with tags, ratings, and captions
 */
import React, { useState } from 'react';
import { format } from 'date-fns';
import { 
  Button,
  Chip 
} from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import LazyImage from '../common/LazyImage';
import { X, Heart, MapPin } from 'lucide-react';
import ImageViewer from '../common/LazyImageViewer';
import { useLifeLog } from './LifeLogContext';

const photoVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: { delay: i * 0.05 }
  })
};

export default function LifeLogDayModal() {
  const { selectedDay, setSelectedDay, selectedPhotos, getPhotoUrl } = useLifeLog();
  const [viewerIndex, setViewerIndex] = useState(null);

  if (!selectedDay) return null;

  // Handle photo update (refresh if needed)
  const handlePhotoUpdate = () => {
    // Could trigger a refresh here if needed
  };

  return (
    <>
      {/* Custom Modal Implementation for Electron Compatibility */}
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedDay(null);
        }}
      >
        <div 
          className="border border-zinc-200 dark:border-zinc-700 shadow-2xl rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col bg-white dark:bg-zinc-800"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 p-4 border-b border-zinc-200 dark:border-zinc-700">
            <div className="flex items-center gap-3">
              <span className="text-xl font-semibold">
                {format(selectedDay, 'MMMM d, yyyy')}
              </span>
              <Chip size="sm" variant="flat" color="primary">
                {selectedPhotos.length} {selectedPhotos.length === 1 ? 'photo' : 'photos'}
              </Chip>
            </div>
            <Button 
              isIconOnly
              variant="light"
              onPress={() => setSelectedDay(null)}
            >
              <X size={18} />
            </Button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-auto p-6 custom-scrollbar">
            <AnimatePresence>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {selectedPhotos.map((photo, idx) => (
                      <motion.div
                        key={photo.id}
                        custom={idx}
                        variants={photoVariants}
                        initial="hidden"
                        animate="visible"
                        whileHover={{ scale: 1.02 }}
                        className="relative aspect-square rounded-xl overflow-hidden cursor-pointer group shadow-md"
                        onClick={() => setViewerIndex(idx)}
                      >
                        <LazyImage
                          src={getPhotoUrl(photo)}
                          alt=""
                          className="w-full h-full"
                          objectFit="cover"
                        />

                        {/* Tags (top left) */}
                        {Array.isArray(photo.tags) && photo.tags.length > 0 && (
                          <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-40px)]">
                            {photo.tags.slice(0, 3).map((tag, i) => (
                              <Chip
                                key={i}
                                size="sm"
                                variant="flat"
                                classNames={{
                                  base: "bg-black/50 backdrop-blur-sm",
                                  content: "text-white text-[10px]"
                                }}
                              >
                                {tag.name || tag}
                              </Chip>
                            ))}
                            {photo.tags.length > 3 && (
                              <Chip
                                size="sm"
                                variant="flat"
                                classNames={{
                                  base: "bg-black/50 backdrop-blur-sm",
                                  content: "text-white text-[10px]"
                                }}
                              >
                                +{photo.tags.length - 3}
                              </Chip>
                            )}
                          </div>
                        )}

                        {/* Rating Heart (top right) */}
                        {Number(photo.rating) > 0 && (
                          <div className="absolute top-2 right-2">
                            <Heart 
                              size={18} 
                              className="text-red-400 fill-red-400 drop-shadow-lg" 
                            />
                          </div>
                        )}

                        {/* Location & Caption (bottom) */}
                        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 pt-8 translate-y-full group-hover:translate-y-0 transition-transform">
                          {(photo.city_name || photo.country_name) && (
                            <div className="flex items-center gap-1 text-white/80 text-xs mb-1">
                              <MapPin size={12} />
                              <span className="truncate">
                                {photo.city_name || photo.country_name}
                              </span>
                            </div>
                          )}
                          {photo.caption && (
                            <p className="text-white text-sm truncate">
                              {photo.caption}
                            </p>
                          )}
                        </div>

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      </motion.div>
                    ))}
                  </div>
                </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-zinc-200 dark:border-zinc-700 flex justify-end">
            <Button 
              color="default" 
              variant="flat" 
              onPress={() => setSelectedDay(null)}
              startContent={<X size={16} />}
            >
              Close
            </Button>
          </div>
        </div>
      </div>

      {/* Image Viewer */}
      {viewerIndex !== null && (
        <ImageViewer
          images={selectedPhotos}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onPhotoUpdate={handlePhotoUpdate}
        />
      )}
    </>
  );
}
