export const getPhotoUrl = (baseUrl, photo, type = 'full') => {
  if (!baseUrl || !photo) return null;
  
  // If photo object has a direct path property for the requested type
  if (type === 'thumb' && photo.thumb_rel_path) {
    return `${baseUrl}/uploads/${photo.thumb_rel_path}`;
  }
  if (type === 'negative' && photo.negative_rel_path) {
    return `${baseUrl}/uploads/${photo.negative_rel_path}`;
  }
  if (type === 'full' && photo.full_rel_path) {
    return `${baseUrl}/uploads/${photo.full_rel_path}`;
  }

  // Fallback for legacy or missing paths (though backend should provide rel_paths now)
  // Assuming standard structure: /uploads/rolls/<rollId>/<type>/<filename>
  // But without rollId in photo object sometimes, this is risky. 
  // Ideally backend always provides full_rel_path.
  
  if (photo.filename && photo.roll_id) {
     const folder = type === 'thumb' ? 'thumb' : (type === 'negative' ? 'negative' : 'full');
     return `${baseUrl}/uploads/rolls/${photo.roll_id}/${folder}/${photo.filename}`;
  }

  return null;
};

export const getRollCoverUrl = (baseUrl, roll) => {
  if (!baseUrl || !roll) return null;
  
  if (roll.coverPath) {
    // coverPath from DB usually starts with /uploads/ or is relative
    // If it starts with /, append to baseUrl
    if (roll.coverPath.startsWith('/')) {
        return `${baseUrl}${roll.coverPath}`;
    }
    // If it doesn't start with /, assume it's relative to uploads/
    return `${baseUrl}/uploads/${roll.coverPath}`;
  }
  
  if (roll.cover_photo) {
    return `${baseUrl}/uploads/${roll.cover_photo}`;
  }
  
  return null;
};
