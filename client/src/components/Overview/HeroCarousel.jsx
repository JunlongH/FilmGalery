/**
 * HeroCarousel - Random photos showcase with auto-rotation
 * 
 * Features:
 * - Auto-advances every 6 seconds
 * - Manual navigation with arrows
 * - Click to open full viewer
 * - Smooth crossfade transitions (CSS-based for Electron compatibility)
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardBody, Button, Spinner } from '@heroui/react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { getApiBase } from '../../api';
import { resolveFullUrl } from '../../utils/thumbResolver';


export default function HeroCarousel({ onPhotoClick, mode }) {
  const [photos, setPhotos] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const loadRandom = useCallback(async () => {
    try {
      setIsRefreshing(true);
      const apiBase = getApiBase();
      const modeParam = mode ? `&mode=${mode}` : '';
      const r = await fetch(`${apiBase}/api/photos/random?limit=8${modeParam}`);
      const data = await r.json();
      if (Array.isArray(data)) {
        // Filter out photos with no path
        const validPhotos = data.filter(p => p.positive_rel_path || p.full_rel_path);
        setPhotos(validPhotos);
        setCurrentIndex(0);
      }
    } catch (e) {
      console.error('Failed to load random photos:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [mode]);

  useEffect(() => {
    loadRandom();
  }, [loadRandom]);

  useEffect(() => {
    if (photos.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % photos.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [photos.length]);

  const goToPrev = (e) => {
    setCurrentIndex(prev => (prev - 1 + photos.length) % photos.length);
  };

  const goToNext = (e) => {
    setCurrentIndex(prev => (prev + 1) % photos.length);
  };

  const getPhotoUrl = (photo) => {
    // 头图使用全尺寸正片（hero 展示需要清晰度），统一走 resolver 附带 updated_at 缓存键
    if (!photo) return '';
    return resolveFullUrl(photo, 'positive') || '';
  };

  if (isLoading) {
    return (
      <Card className="w-full aspect-[3/2] max-h-[75vh] mb-8 bg-default-100 border-none">
        <CardBody className="flex items-center justify-center">
          <Spinner size="lg" color="primary" />
        </CardBody>
      </Card>
    );
  }

  if (photos.length === 0) {
    return (
      <Card className="w-full aspect-[3/2] max-h-[75vh] mb-8 bg-default-100 border-none">
        <CardBody className="flex flex-col items-center justify-center gap-4 text-default-400">
          <p>No photos available</p>
          <Button 
            variant="flat" 
            color="primary" 
            onPress={loadRandom}
            startContent={<RefreshCw size={16} />}
          >
            Retry
          </Button>
        </CardBody>
      </Card>
    );
  }

  const current = photos[currentIndex];
  const isDigitalPhoto = mode === 'digital' || current.source_type === 'digital' || current.roll_id == null;
  const heroTitle = isDigitalPhoto
    ? (current.caption || '')
    : (current.roll_title || current.caption || (current.original_filename && current.original_filename.replace(/\.[^.]+$/, '')) || 'Untitled');
  // Preload next image
  const nextIndex = (currentIndex + 1) % photos.length;
  const prevIndex = (currentIndex - 1 + photos.length) % photos.length;

  return (
    <Card 
      className="w-full aspect-[3/2] max-h-[75vh] mb-8 overflow-hidden group shadow-2xl border-none bg-black relative isolate"
    >
      <CardBody className="p-0 relative w-full h-full overflow-hidden">
        {/* Main Click Area - Replaces isPressable to avoid button nesting issues */}
        <div 
           className="absolute inset-0 z-30 cursor-pointer"
           onClick={() => onPhotoClick?.(current, photos)}
           role="button"
           aria-label="View photo details"
        />

        {/* Photos - CSS crossfade for Electron stability */}
        {photos.map((photo, idx) => (
          <img
            key={photo.id}
            src={getPhotoUrl(photo)}
            alt={photo.caption || photo.roll_title || ''}
            className="absolute inset-0 w-full h-full object-cover z-0"
            style={{
              opacity: idx === currentIndex ? 1 : 0,
              transition: 'opacity 0.8s ease-in-out',
              willChange: idx === currentIndex || idx === nextIndex || idx === prevIndex ? 'opacity' : 'auto'
            }}
            draggable={false}
          />
        ))}

        {/* Cinematic Gradient Overlay - Always Visible */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 z-0 pointer-events-none" />

        {/* Photo Info (bottom) - CSS transition for stability */}
        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 z-20 pointer-events-none">
          <div 
            className="transition-opacity duration-500"
            style={{ opacity: 1 }}
          >
            {heroTitle && (
              <h2 className="text-white text-3xl md:text-4xl font-bold mb-3 tracking-tight drop-shadow-lg">
                {heroTitle}
              </h2>
            )}
            
            {/* Photo Details - Simple inline text */}
            <p className="text-white/70 text-xs md:text-sm drop-shadow-lg">
              {[
                current.date && new Date(current.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
                current.city,
                current.album_names,
                current.camera_name,
                current.lens_name,
                current.film_name
              ].filter(Boolean).join(' · ')}
            </p>
            
            {/* Exposure Info - Aperture, Shutter, ISO */}
            {(() => {
              const aperture = current.aperture;
              const shutter = current.shutter_speed;
              // ISO fallback: photo -> roll -> film
              const iso = current.iso || current.roll_iso || current.film_iso;
              // Only show this line if aperture or shutter exists
              const hasExposureData = aperture || shutter;
              if (!hasExposureData) return null;
              
              const exposureParts = [];
              if (aperture) exposureParts.push(`ƒ/${aperture}`);
              if (shutter) exposureParts.push(shutter);
              if (iso) exposureParts.push(`ISO ${iso}`);
              
              return (
                <p className="text-white/60 text-xs md:text-sm drop-shadow-lg mt-1">
                  {exposureParts.join(' · ')}
                </p>
              );
            })()}
            
            {/* Photo Caption - if exists (digital photos already show it as the title) */}
            {!isDigitalPhoto && current.caption && (
              <p className="text-white/60 text-xs md:text-sm drop-shadow-lg mt-2 max-w-2xl line-clamp-2">
                {current.caption}
              </p>
            )}
          </div>
        </div>

        {/* Navigation Arrows - Show on Hover - High Z-index */}
        {photos.length > 1 && (
          <>
            <Button
              isIconOnly
              variant="flat"
              radius="full"
              className="absolute left-6 top-1/2 -translate-y-1/2 bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-all hover:bg-black/50 backdrop-blur-sm z-50"
              onPress={goToPrev}
            >
              <ChevronLeft size={28} />
            </Button>
            <Button
              isIconOnly
              variant="flat"
              radius="full"
              className="absolute right-6 top-1/2 -translate-y-1/2 bg-black/30 text-white opacity-0 group-hover:opacity-100 transition-all hover:bg-black/50 backdrop-blur-sm z-50"
              onPress={goToNext}
            >
              <ChevronRight size={28} />
            </Button>
          </>
        )}

        {/* Top Right Actions - High Z-index to capture clicks */}
        <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 z-50">
          <Button
            isIconOnly
            variant="flat"
            radius="full"
            className="bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
            isLoading={isRefreshing}
            onPress={loadRandom}
          >
            <RefreshCw size={18} />
          </Button>
        </div>

        {/* Dots Indicator - High Z-index */}
        {photos.length > 1 && (
          <div className="absolute bottom-6 right-1/2 translate-x-1/2 md:right-12 md:translate-x-0 flex gap-2 z-50">
            {photos.map((_, idx) => (
              <button
                key={idx}
                onClick={(e) => { e.stopPropagation(); setCurrentIndex(idx); }}
                className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                  idx === currentIndex 
                    ? 'bg-white w-8 opacity-100' 
                    : 'bg-white/40 w-2 hover:bg-white/60'
                }`}
              />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
