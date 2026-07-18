/**
 * PhotoCard - 照片卡片组件
 * 
 * 使用 HeroUI Card + LazyImage 展示单张照片
 * 支持 hover 效果、喜欢按钮、快捷操作
 */

import React, { useState, memo } from 'react';
import { Card, Button, Tooltip } from '@heroui/react';
import { motion } from 'framer-motion';
import { Heart, Trash2, Tag, Eye, MoreHorizontal, Star } from 'lucide-react';
import LazyImage from '../common/LazyImage';
import { resolveThumbUrl } from '../../utils/thumbResolver';

// 使用 memo 包装以避免不必要的重渲染
const PhotoCard = memo(function PhotoCard({
  photo,
  onSelect,
  onToggleFavorite,
  onDelete,
  onEditTags,
  showActions = true,
  aspectRatio = '1', // '1' for square, '4/3', '16/9', etc.
  size = 'md' // 'sm' | 'md' | 'lg'
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [imageError, setImageError] = useState(false);
  
  const isFavorite = (photo.rating | 0) === 1;
  const imageUrl = resolveThumbUrl(photo, 'positive');

  const sizeClasses = {
    sm: 'min-w-[120px]',
    md: 'min-w-[160px]',
    lg: 'min-w-[200px]'
  };

  const handleFavoriteClick = (e) => {
    e.stopPropagation();
    onToggleFavorite?.(photo, isFavorite);
  };

  const handleDeleteClick = (e) => {
    e.stopPropagation();
    onDelete?.(photo);
  };

  const handleTagsClick = (e) => {
    e.stopPropagation();
    onEditTags?.(photo);
  };

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        isPressable
        onPress={() => onSelect?.(photo)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`
          group overflow-hidden border border-zinc-200/50 dark:border-zinc-700/50
          hover:border-primary/30 hover:shadow-lg
          transition-all duration-300
          ${sizeClasses[size]}
        `}
      >
        <div className="relative" style={{ aspectRatio }}>
          {/* Image - 使用 LazyImage 组件实现懒加载和渐进式加载 */}
          {imageUrl && !imageError ? (
            <LazyImage
              src={imageUrl}
              alt={photo.title || `Photo ${photo.id}`}
              aspectRatio={aspectRatio}
              className="w-full h-full"
              objectFit="cover"
              fadeInDuration={0.3}
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="w-full h-full bg-default-100 flex items-center justify-center">
              <Eye className="w-8 h-8 text-default-300" />
            </div>
          )}
          
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          
          {/* Favorite indicator (always visible if favorited) */}
          {isFavorite && (
            <div className="absolute top-2 right-2">
              <div className="w-7 h-7 rounded-full bg-danger/90 flex items-center justify-center shadow-lg">
                <Heart className="w-4 h-4 text-white fill-white" />
              </div>
            </div>
          )}
          
          {/* Hover actions */}
          {showActions && isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute bottom-2 left-2 right-2 flex justify-between items-center"
            >
              {/* Left actions */}
              <div className="flex gap-1">
                <Tooltip content={isFavorite ? 'Unlike' : 'Like'}>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm text-white hover:bg-white/30"
                    onPress={handleFavoriteClick}
                  >
                    <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current text-danger' : ''}`} />
                  </Button>
                </Tooltip>
                
                {onEditTags && (
                  <Tooltip content="Edit Tags">
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="bg-white/20 backdrop-blur-sm text-white hover:bg-white/30"
                      onPress={handleTagsClick}
                    >
                      <Tag className="w-4 h-4" />
                    </Button>
                  </Tooltip>
                )}
              </div>
              
              {/* Right actions */}
              {onDelete && (
                <Tooltip content="Remove" color="danger">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="bg-white/20 backdrop-blur-sm text-white hover:bg-danger/80"
                    onPress={handleDeleteClick}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </Tooltip>
              )}
            </motion.div>
          )}
        </div>
      </Card>
    </motion.div>
  );
});

export default PhotoCard;
