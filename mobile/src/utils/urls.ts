export interface PhotoPathSource {
  positive_thumb_rel_path?: string;
  thumb_rel_path?: string;
  negative_thumb_rel_path?: string;
  negative_rel_path?: string;
  positive_rel_path?: string;
  full_rel_path?: string;
  filename?: string;
  roll_id?: number | string;
}

export interface RollCoverSource {
  coverPath?: string;
  cover_photo?: string;
}

export type PhotoUrlType = 'thumb' | 'negative' | 'full';

export const getPhotoUrl = (
  baseUrl: string | null | undefined,
  photo: PhotoPathSource | null | undefined,
  type: PhotoUrlType = 'full'
): string | null => {
  if (!baseUrl || !photo) return null;

  if (type === 'thumb') {
    if (photo.positive_thumb_rel_path) return `${baseUrl}/uploads/${photo.positive_thumb_rel_path}`;
    if (photo.thumb_rel_path) return `${baseUrl}/uploads/${photo.thumb_rel_path}`;
  }

  if (type === 'negative') {
    if (photo.negative_thumb_rel_path) return `${baseUrl}/uploads/${photo.negative_thumb_rel_path}`;
    if (photo.negative_rel_path) return `${baseUrl}/uploads/${photo.negative_rel_path}`;
  }

  if (type === 'full') {
    if (photo.positive_rel_path) return `${baseUrl}/uploads/${photo.positive_rel_path}`;
    if (photo.full_rel_path) return `${baseUrl}/uploads/${photo.full_rel_path}`;
  }

  if (photo.filename && photo.roll_id) {
    const folder = type === 'thumb' ? 'thumb' : type === 'negative' ? 'negative' : 'full';
    return `${baseUrl}/uploads/rolls/${photo.roll_id}/${folder}/${photo.filename}`;
  }

  return null;
};

export const getRollCoverUrl = (
  baseUrl: string | null | undefined,
  roll: RollCoverSource | null | undefined
): string | null => {
  if (!baseUrl || !roll) return null;

  if (roll.coverPath) {
    if (roll.coverPath.startsWith('/')) {
      return `${baseUrl}${roll.coverPath}`;
    }
    return `${baseUrl}/uploads/${roll.coverPath}`;
  }

  if (roll.cover_photo) {
    return `${baseUrl}/uploads/${roll.cover_photo}`;
  }

  return null;
};
