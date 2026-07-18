/**
 * TagGallery - 主题/标签画廊页面
 * 
 * 使用 HoverPhotoCard 共享组件展示照片标签
 * 支持标签云、照片浏览、收藏、从主题中移除
 */

import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import ImageViewer from './common/LazyImageViewer';
import { AnimatedContainer, HoverPhotoCard, ActionButton } from './ui';
import { buildUploadUrl, getTagPhotos, getTags, updatePhoto } from '../api';
import { getCacheStrategy } from '../lib';
import { Heart, Tag, ArrowLeft, Trash2, ImageIcon } from 'lucide-react';

export default function TagGallery() {
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const [viewerIndex, setViewerIndex] = useState(null);

  const { data: tags = [] } = useQuery({
    queryKey: ['tags'],
    queryFn: async () => {
      const t = await getTags();
      return (Array.isArray(t) ? t : []).filter(tag => tag.photos_count > 0);
    },
    ...getCacheStrategy('tags'),
  });

  const selectedTag = params.tagId ? tags.find(t => String(t.id) === String(params.tagId)) : null;

  const { data: photos = [], isLoading: loadingPhotos } = useQuery({
    queryKey: ['tagPhotos', params.tagId],
    queryFn: () => getTagPhotos(params.tagId),
    enabled: !!params.tagId,
    ...getCacheStrategy('photos'),
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tagPhotos', params.tagId] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
    }
  });

  // View: List of all tags (Tag Cloud)
  if (!selectedTag) {
    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight">Themes</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{tags.length} themes with photos</p>
        </div>
        
        {/* Tags Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {tags.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center text-center py-20">
              <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
                <Tag className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Themes Yet</h3>
              <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
                Add tags to your photos to organize them into themes. Tags will appear here once you create them.
              </p>
            </div>
          ) : (
            tags.map((tag, idx) => (
              <AnimatedContainer key={tag.id} delay={idx * 0.03}>
                <ThemeCard 
                  tag={tag} 
                  onSelect={() => navigate(`/themes/${tag.id}`)} 
                />
              </AnimatedContainer>
            ))
          )}
        </div>
      </div>
    );
  }

  // View: Single Tag Gallery
  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      {/* Header with Back Button */}}
      <div className="flex items-center gap-4 mb-8">
        <Button 
          isIconOnly
          variant="flat"
          onPress={() => navigate('/themes')} 
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{selectedTag.name}</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{photos.length} photos</p>
        </div>
      </div>

      {/* Photos Grid */}
      {loadingPhotos ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <ImageIcon className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Photos</h3>
          <p className="text-zinc-500 dark:text-zinc-400">No photos in this theme yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {photos.map((photo, idx) => (
            <AnimatedContainer key={photo.id} delay={idx * 0.02}>
              <TagPhotoCard 
                photo={photo} 
                index={idx} 
                onOpenViewer={(i) => setViewerIndex(i)} 
                onToggleFavorite={async (p, prevLiked) => {
                  try { 
                    await updatePhotoMutation.mutateAsync({ 
                      photoId: p.id, 
                      data: { rating: prevLiked ? 0 : 1 } 
                    });
                  } catch (err) { 
                    console.error(err); 
                  }
                }}
                onRemoveFromTheme={async (p) => {
                  if (!window.confirm(`Remove this photo from theme "${selectedTag.name}"?`)) return;
                  const currentTags = p.tags || [];
                  const newTags = currentTags.filter(t => t.id !== selectedTag.id).map(t => t.name);
                  try {
                    await updatePhotoMutation.mutateAsync({ photoId: p.id, data: { tags: newTags } });
                    window.dispatchEvent(new Event('refresh-tags'));
                  } catch (err) {
                    console.error(err);
                    alert('Failed to remove from theme');
                  }
                }}
              />
            </AnimatedContainer>
          ))}
        </div>
      )}

      {/* Image Viewer */}
      {viewerIndex !== null && (
        <ImageViewer images={photos} index={viewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </div>
  );
}

/**
 * ThemeCard - 主题卡片 (始终显示标题信息)
 */
function ThemeCard({ tag, onSelect }) {
  const coverUrl = tag.cover_thumb || tag.cover_full;
  // Build URL - ensure path is properly prefixed
  const imageUrl = coverUrl 
    ? buildUploadUrl(coverUrl.startsWith('/uploads/') ? coverUrl : `/uploads/${coverUrl}`)
    : null;
  const [loaded, setLoaded] = useState(false);
  
  return (
    <div
      onClick={onSelect}
      className="group cursor-pointer overflow-hidden rounded-lg transition-all duration-300 hover:shadow-xl hover:scale-[1.02] bg-white dark:bg-zinc-800"
    >
      {/* Use padding-bottom trick for reliable aspect ratio */}
      <div className="relative w-full" style={{ paddingBottom: '100%' }}>
        <div className="absolute inset-0">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={tag.name}
              onLoad={() => setLoaded(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'center',
                opacity: loaded ? 1 : 0,
                transition: 'opacity 0.3s ease, transform 0.5s ease',
              }}
              className="group-hover:scale-110"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-secondary/20">
              <Tag className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
            </div>
          )}
        </div>
        
        {/* Dark Overlay - subtle always, stronger on hover */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-80 group-hover:opacity-100 transition-opacity" />
        
        {/* Tag Info - always visible at bottom */}
        <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
          <h3 className="text-white text-lg font-bold truncate drop-shadow-lg">{tag.name}</h3>
          <p className="text-white/80 text-xs mt-1">{tag.photos_count} photos</p>
        </div>
      </div>
    </div>
  );
}

/**
 * TagPhotoCard - 使用共享的 HoverPhotoCard 组件
 */
function TagPhotoCard({ photo, index, onOpenViewer, onToggleFavorite, onRemoveFromTheme }) {
  const navigate = useNavigate();
  const [liked, setLiked] = useState((photo.rating | 0) === 1);

  const toggleFavorite = async () => {
    const prev = liked;
    setLiked(!prev);
    try {
      await onToggleFavorite(photo, prev);
    } catch (err) {
      setLiked(prev);
    }
  };

  const subtitle = [
    photo.roll_title,
    photo.film_name || 'Unknown Film'
  ].filter(Boolean).join(' • ');

  return (
    <HoverPhotoCard
      photo={photo}
      alt={photo.caption || ''}
      onPress={() => onOpenViewer(index)}
      topLeftAction={
        <ActionButton
          icon={<Trash2 className="w-4 h-4" />}
          onClick={() => onRemoveFromTheme(photo)}
          variant="danger"
        />
      }
      topRightAction={
        <ActionButton
          icon={<Heart className={`w-4 h-4 ${liked ? 'fill-danger text-danger' : ''}`} />}
          onClick={toggleFavorite}
        />
      }
      title={photo.caption}
      subtitle={subtitle}
      onSubtitleClick={photo.roll_id ? () => navigate(`/rolls/${photo.roll_id}`) : undefined}
    />
  );
}
