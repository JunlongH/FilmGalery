/**
 * Favorites - 收藏照片页面
 * 
 * 使用 HoverPhotoCard 共享组件展示收藏的照片
 * 支持取消收藏、查看详情、跳转到胶卷
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { getFavoritePhotos, updatePhoto } from '../api';
import { getCacheStrategy } from '../lib';
import ImageViewer from './common/LazyImageViewer';
import { AnimatedContainer, HoverPhotoCard, ActionButton } from './ui';
import { Heart } from 'lucide-react';

export default function Favorites() {
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: photos = [], isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: async () => {
      const p = await getFavoritePhotos();
      return Array.isArray(p) ? p : [];
    },
    ...getCacheStrategy('photos'),
  });

  const updatePhotoMutation = useMutation({
    mutationFn: ({ photoId, data }) => updatePhoto(photoId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['favorites'] })
  });

  async function onUnlike(photoId) {
    try {
      await updatePhotoMutation.mutateAsync({ photoId, data: { rating: 0 } });
    } catch (err) {
      console.error(err);
    }
  }

  // Empty state
  if (!isLoading && photos.length === 0) {
    return (
      <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
        <h2 className="text-3xl font-bold mb-8 tracking-tight">Favorites</h2>
        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="w-24 h-24 rounded-full bg-zinc-100/50 dark:bg-zinc-800/50 flex items-center justify-center mb-6">
            <Heart className="w-12 h-12 text-zinc-300 dark:text-zinc-600" />
          </div>
          <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 mb-2">No Favorites Yet</h3>
          <p className="text-zinc-500 dark:text-zinc-400 max-w-md">
            Photos you mark as favorites will appear here. Click the heart icon on any photo to add it to your collection.
          </p>
          <Button
            color="primary"
            variant="flat"
            className="mt-6"
            onPress={() => navigate('/')}
          >
            Browse Photos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 p-6 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Favorites</h2>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">{photos.length} photos</p>
        </div>
      </div>
      
      {/* Photo Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {photos.map((photo, idx) => (
          <AnimatedContainer key={photo.id} delay={idx * 0.02}>
            <FavoriteCard
              photo={photo}
              onSelect={() => setSelectedPhotoIndex(idx)}
              onUnlike={() => onUnlike(photo.id)}
              onGoToRoll={() => navigate(`/rolls/${photo.roll_id}`)}
            />
          </AnimatedContainer>
        ))}
      </div>

      {/* Image Viewer */}
      {selectedPhotoIndex !== null && (
        <ImageViewer
          images={photos}
          index={selectedPhotoIndex}
          onClose={() => setSelectedPhotoIndex(null)}
        />
      )}
    </div>
  );
}

/**
 * FavoriteCard - 使用共享的 HoverPhotoCard 组件
 */
function FavoriteCard({ photo, onSelect, onUnlike, onGoToRoll }) {
  const subtitle = [
    photo.roll_title || 'Untitled Roll',
    photo.film_name || 'Unknown Film'
  ].filter(Boolean).join(' • ');

  return (
    <HoverPhotoCard
      photo={photo}
      alt={photo.filename}
      onPress={onSelect}
      topRightAction={
        <ActionButton
          icon={<Heart className="w-4 h-4 fill-danger text-danger" />}
          onClick={onUnlike}
        />
      }
      title={photo.caption}
      subtitle={subtitle}
      onSubtitleClick={onGoToRoll}
    />
  );
}
