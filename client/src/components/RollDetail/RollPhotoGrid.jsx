/**
 * RollPhotoGrid - Modern photo grid component for roll detail view
 * 
 * Uses HeroUI Card + LazyImage for beautiful photo thumbnails with:
 * - Hover effects
 * - Selection mode
 * - Quick actions (favorite, set cover, delete)
 * - Optimized lazy loading with CSS transitions
 */
import React, { useMemo, useCallback, memo } from 'react';
import { Card, CardBody, CardFooter, Button, Checkbox, Chip, Skeleton } from '@heroui/react';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, Star, Trash2, Tag, FileText, Check } from 'lucide-react';
import LazyImage from '../common/LazyImage';
import { resolveThumbUrl, resolveFullUrl } from '../../utils/thumbResolver';

/**
 * 缩略图/全尺寸 URL（统一走 thumbResolver：回退链 + updated_at 缓存键，
 * 避免手写 `+ '?v='` 在 URL 已带查询参数时产生双问号 bug）
 */
function getPhotoUrls(photo, viewMode) {
  const mode = viewMode === 'negative' ? 'negative' : 'positive';
  return {
    thumb: resolveThumbUrl(photo, mode),
    full: resolveFullUrl(photo, mode)
  };
}

/**
 * Single photo card component
 */
function PhotoCard({ 
  photo, 
  index,
  viewMode,
  multiSelect,
  selected,
  onSelect,
  onToggleSelect,
  onToggleFavorite,
  onSetCover,
  onDelete,
  onEditTags
}) {
  const urls = useMemo(() => getPhotoUrls(photo, viewMode), [photo, viewMode]);
  const isFavorite = photo.rating === 1;
  const tags = Array.isArray(photo.tags) ? photo.tags : [];
  const hasCaption = photo.caption && photo.caption.trim().length > 0;

  const handleClick = useCallback((e) => {
    if (multiSelect) {
      e.preventDefault();
      onToggleSelect?.(photo);
    } else {
      onSelect?.(index);
    }
  }, [multiSelect, onToggleSelect, onSelect, photo, index]);

  const handleFavoriteClick = useCallback((e) => {
    e.stopPropagation();
    onToggleFavorite?.(photo.id, !isFavorite);
  }, [onToggleFavorite, photo.id, isFavorite]);

  const handleSetCoverClick = useCallback((e) => {
    e.stopPropagation();
    onSetCover?.(photo.id);
  }, [onSetCover, photo.id]);

  const handleDeleteClick = useCallback((e) => {
    e.stopPropagation();
    onDelete?.(photo.id);
  }, [onDelete, photo.id]);

  const handleTagsClick = useCallback((e) => {
    e.stopPropagation();
    onEditTags?.(photo);
  }, [onEditTags, photo]);

  if (!urls.thumb) {
    return (
      <Card className="aspect-square bg-zinc-100 dark:bg-zinc-800">
        <CardBody className="flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm">
          No image
        </CardBody>
      </Card>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: Math.min(index * 0.02, 0.5), duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
      className="relative group"
    >
      <Card 
        isPressable
        onPress={handleClick}
        className={`
          aspect-square overflow-hidden transition-all duration-200
          ${selected ? 'ring-3 ring-primary ring-offset-2 ring-offset-background' : ''}
          ${multiSelect ? 'cursor-pointer' : ''}
        `}
        shadow="sm"
      >
        <CardBody className="p-0 overflow-hidden relative">
          {/* Photo Image - 使用优化的 LazyImage */}
          <LazyImage
            src={urls.thumb}
            alt={photo.caption || `Photo ${photo.frame_number || index + 1}`}
            aspectRatio="1"
            className="w-full h-full"
            objectFit="cover"
            fadeInDuration={0.3}
          />
          
          {/* Selection checkbox overlay */}
          {multiSelect && (
            <div className="absolute top-2 left-2 z-20">
              <div className={`
                w-6 h-6 rounded-full flex items-center justify-center transition-all
                ${selected 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-black/40 backdrop-blur-sm border-2 border-white/60'
                }
              `}>
                {selected && <Check size={14} strokeWidth={3} />}
              </div>
            </div>
          )}

          {/* Favorite indicator */}
          {isFavorite && !multiSelect && (
            <div className="absolute top-2 left-2 z-10">
              <Heart size={18} className="text-red-500 fill-red-500 drop-shadow-md" />
            </div>
          )}

          {/* Frame number badge */}
          {photo.frame_number && (
            <div className="absolute top-2 right-2 z-10">
              <Chip 
                size="sm" 
                variant="flat" 
                className="bg-black/50 backdrop-blur-sm text-white text-xs font-mono h-5 min-w-5"
              >
                #{photo.frame_number}
              </Chip>
            </div>
          )}

          {/* Tags indicator */}
          {tags.length > 0 && !multiSelect && (
            <div className="absolute bottom-2 left-2 z-10 flex gap-1">
              <Chip size="sm" variant="flat" className="bg-black/50 backdrop-blur-sm text-white h-5">
                <Tag size={10} className="mr-1" />
                {tags.length}
              </Chip>
            </div>
          )}

          {/* Caption indicator */}
          {hasCaption && !multiSelect && (
            <div className="absolute bottom-2 right-2 z-10">
              <FileText size={14} className="text-white drop-shadow-md" />
            </div>
          )}

          {/* Hover overlay with actions */}
          {!multiSelect && (
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
              <div className="absolute bottom-0 left-0 right-0 p-2 flex items-center justify-between gap-1">
                {/* Left actions */}
                <div className="flex gap-1">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm hover:bg-white/40 min-w-8 w-8 h-8"
                    onPress={handleFavoriteClick}
                  >
                    <Heart 
                      size={16} 
                      className={isFavorite ? 'text-red-400 fill-red-400' : 'text-white'} 
                    />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm hover:bg-white/40 min-w-8 w-8 h-8"
                    onPress={handleTagsClick}
                  >
                    <Tag size={16} className="text-white" />
                  </Button>
                </div>

                {/* Right actions */}
                <div className="flex gap-1">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm hover:bg-white/40 min-w-8 w-8 h-8"
                    onPress={handleSetCoverClick}
                  >
                    <Star size={16} className="text-white" />
                  </Button>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm hover:bg-red-500/80 min-w-8 w-8 h-8"
                    onPress={handleDeleteClick}
                  >
                    <Trash2 size={16} className="text-white" />
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </motion.div>
  );
}

/**
 * Loading skeleton for photo grid
 */
function PhotoGridSkeleton({ count = 12 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </div>
  );
}

/**
 * Empty state component
 */
function EmptyState({ viewMode, hasOtherPhotos, onSwitchView }) {
  return (
    <Card className="border-2 border-dashed border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-800/50">
      <CardBody className="py-16 flex flex-col items-center justify-center gap-4 text-center">
        <div className="text-4xl">📷</div>
        <div className="space-y-1">
          <p className="text-lg font-medium text-zinc-600 dark:text-zinc-300">
            {viewMode === 'positive' ? 'No positive photos' : 'No negative scans'}
          </p>
          <p className="text-sm text-zinc-400 dark:text-zinc-500">
            {viewMode === 'positive' 
              ? 'Upload processed photos or switch to negative view' 
              : 'Upload negative scans or switch to positive view'}
          </p>
        </div>
        {hasOtherPhotos && (
          <Button 
            color="primary" 
            variant="flat"
            onPress={onSwitchView}
          >
            Switch to {viewMode === 'positive' ? 'Negative' : 'Positive'} View
          </Button>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * Main photo grid component
 */
export default function RollPhotoGrid({
  photos = [],
  viewMode = 'positive',
  multiSelect = false,
  selectedPhotos = [],
  onPhotoSelect,
  onTogglePhotoSelect,
  onToggleFavorite,
  onSetCover,
  onDelete,
  onEditTags,
  onSwitchViewMode,
  isLoading = false
}) {
  // Filter photos based on view mode
  const filteredPhotos = useMemo(() => {
    return photos.filter(p => {
      if (viewMode === 'positive') {
        return p.full_rel_path || p.positive_rel_path;
      }
      if (viewMode === 'negative') {
        return p.negative_rel_path;
      }
      return true;
    });
  }, [photos, viewMode]);

  // Check if other view has photos
  const otherViewHasPhotos = useMemo(() => {
    if (viewMode === 'positive') {
      return photos.some(p => p.negative_rel_path);
    }
    return photos.some(p => p.full_rel_path || p.positive_rel_path);
  }, [photos, viewMode]);

  // Create selected IDs set for O(1) lookup
  const selectedIds = useMemo(() => {
    return new Set(selectedPhotos.map(p => p.id));
  }, [selectedPhotos]);

  if (isLoading) {
    return <PhotoGridSkeleton />;
  }

  if (filteredPhotos.length === 0) {
    return (
      <EmptyState 
        viewMode={viewMode}
        hasOtherPhotos={otherViewHasPhotos}
        onSwitchView={() => onSwitchViewMode?.(viewMode === 'positive' ? 'negative' : 'positive')}
      />
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
    >
      <AnimatePresence mode="popLayout">
        {filteredPhotos.map((photo, index) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            index={index}
            viewMode={viewMode}
            multiSelect={multiSelect}
            selected={selectedIds.has(photo.id)}
            onSelect={onPhotoSelect}
            onToggleSelect={onTogglePhotoSelect}
            onToggleFavorite={onToggleFavorite}
            onSetCover={onSetCover}
            onDelete={onDelete}
            onEditTags={onEditTags}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
