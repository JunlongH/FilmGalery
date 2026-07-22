/**
 * Equipment Constants
 * 
 * Shared constants for camera, lens, scanner, and other equipment types.
 * Used by both server and client applications.
 * 
 * @module @filmgallery/shared/constants/equipment
 */

/**
 * Camera types enum - Display-friendly names
 */
const CAMERA_TYPES = [
  'SLR',           // Single Lens Reflex (单反)
  'Rangefinder',   // Rangefinder (旁轴)
  'P&S',           // Point & Shoot / PS机/傻瓜机
  'TLR',           // Twin Lens Reflex (双反)
  'Medium Format', // Medium Format (中画幅)
  'Large Format',  // Large Format (大画幅)
  'Instant',       // Instant Camera (拍立得)
  'Half Frame',    // Half Frame (半格)
  'Other'
];

/**
 * Film formats enum
 */
const FILM_FORMATS = [
  { name: '135', description: '35mm film (standard)', frame_size: '24x36mm' },
  { name: '120', description: 'Medium format roll film', frame_size: 'varies' },
  { name: '220', description: 'Medium format (double length)', frame_size: 'varies' },
  { name: '110', description: 'Pocket Instamatic', frame_size: '13x17mm' },
  { name: '127', description: 'Vest Pocket', frame_size: '40x40mm' },
  { name: 'Large Format 4x5', description: '4x5 inch sheet film', frame_size: '4x5 inch' },
  { name: 'Large Format 8x10', description: '8x10 inch sheet film', frame_size: '8x10 inch' },
  { name: 'Instant', description: 'Polaroid/Instax', frame_size: 'varies' },
  { name: 'APS', description: 'Advanced Photo System', frame_size: '16.7x30.2mm' },
  { name: 'Half Frame', description: '35mm half frame', frame_size: '18x24mm' }
];

/**
 * Common lens mounts
 */
const LENS_MOUNTS = [
  'M42', 'Pentax K', 'Nikon F', 'Canon FD', 'Canon EF', 
  'Minolta MD', 'Minolta A', 'Leica M', 'Leica R', 'Leica L',
  'Contax/Yashica', 'Olympus OM', 'Sony A', 'Sony E',
  'Micro Four Thirds', 'Fuji X', 'Hasselblad V', 'Mamiya 645',
  'Mamiya RB/RZ', 'Pentax 645', 'Pentax 67', 'Fixed'
];

/**
 * Scanner types
 */
const SCANNER_TYPES = [
  'Flatbed',           // 平板扫描仪
  'Film Scanner',      // 专用底片扫描仪 (Nikon Coolscan, Plustek)
  'Drum Scanner',      // 滚筒扫描仪 (专业高端)
  'DSLR Scan Rig',     // 数码翻拍 (相机+翻拍架)
  'Virtual Drum',      // 虚拟滚筒 (Hasselblad Flextight/Imacon)
  'Lab Scanner',       // 冲洗店/专业实验室设备
  'Other'
];

/**
 * Flash types
 */
const FLASH_TYPES = [
  'Hot Shoe',          // 热靴闪光灯
  'Studio Strobe',     // 影室闪光灯
  'Built-in',          // 内置闪光灯
  'Ring Flash',        // 环形闪光灯
  'Bare Bulb',         // 裸灯头
  'Other'
];

/**
 * Film back sub-formats (medium format frame sizes)
 */
const FILM_BACK_SUB_FORMATS = [
  { value: '645', label: '6x4.5 (645)', width_mm: 56, height_mm: 41.5, frames: 15 },
  { value: '6x6', label: '6x6', width_mm: 56, height_mm: 56, frames: 12 },
  { value: '6x7', label: '6x7', width_mm: 56, height_mm: 70, frames: 10 },
  { value: '6x8', label: '6x8', width_mm: 56, height_mm: 76, frames: 9 },
  { value: '6x9', label: '6x9', width_mm: 56, height_mm: 84, frames: 8 },
  { value: '6x12', label: '6x12', width_mm: 56, height_mm: 112, frames: 6 },
  { value: '6x17', label: '6x17', width_mm: 56, height_mm: 168, frames: 4 }
];

/**
 * Film back mount types
 */
const FILM_BACK_MOUNTS = [
  'Hasselblad V',
  'Mamiya RB67',
  'Mamiya RZ67',
  'Mamiya 645',
  'Pentax 645',
  'Pentax 67',
  'Bronica ETR',
  'Bronica SQ',
  'Bronica GS-1',
  'Rollei SL66',
  'Graflex',
  'Universal'
];

/**
 * Film categories (color vs B&W)
 */
const FILM_CATEGORIES = [
  'color_negative',
  'color_positive',
  'bw_negative',
  'bw_positive',
  'instant'
];

/**
 * Film development processes
 */
const FILM_PROCESSES = [
  'C-41',       // Color Negative
  'E-6',        // Color Positive (Slide)
  'B&W',        // Black & White standard
  'C-22',       // Older color negative
  'K-14',       // Kodachrome
  'ECN-2',      // Motion picture negative
  'Cross'       // Cross processing
];

/**
 * Focus types (for lenses)
 * value: lowercase for database, label: display text
 */
const FOCUS_TYPES = [
  { value: 'manual', label: 'Manual' },
  { value: 'auto', label: 'Auto' },
  { value: 'hybrid', label: 'Hybrid' }
];

/**
 * Equipment condition options
 */
const CONDITIONS = [
  { value: 'mint', label: 'Mint' },
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'for_parts', label: 'For Parts' }
];

/**
 * Equipment ownership status
 */
const STATUSES = [
  { value: 'owned', label: 'Owned' },
  { value: 'sold', label: 'Sold' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'borrowed', label: 'Borrowed' },
  { value: 'lab', label: 'Lab' }
];

/**
 * Camera meter types
 */
const METER_TYPES = [
  { value: 'none', label: 'None' },
  { value: 'match-needle', label: 'Match-Needle' },
  { value: 'center-weighted', label: 'Center-Weighted' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'spot', label: 'Spot' },
  { value: 'evaluative', label: 'Evaluative' }
];

/**
 * Shutter types
 */
const SHUTTER_TYPES = [
  { value: 'focal-plane', label: 'Focal-Plane' },
  { value: 'leaf', label: 'Leaf' },
  { value: 'electronic', label: 'Electronic' },
  { value: 'hybrid', label: 'Hybrid' }
];

const _sharedExports = {
  CAMERA_TYPES,
  FILM_FORMATS,
  LENS_MOUNTS,
  SCANNER_TYPES,
  FLASH_TYPES,
  FILM_BACK_SUB_FORMATS,
  FILM_BACK_MOUNTS,
  FILM_CATEGORIES,
  FILM_PROCESSES,
  FOCUS_TYPES,
  CONDITIONS,
  STATUSES,
  METER_TYPES,
  SHUTTER_TYPES
};
const _e_CAMERA_TYPES = _sharedExports.CAMERA_TYPES;
export { _e_CAMERA_TYPES as CAMERA_TYPES };
const _e_FILM_FORMATS = _sharedExports.FILM_FORMATS;
export { _e_FILM_FORMATS as FILM_FORMATS };
const _e_LENS_MOUNTS = _sharedExports.LENS_MOUNTS;
export { _e_LENS_MOUNTS as LENS_MOUNTS };
const _e_SCANNER_TYPES = _sharedExports.SCANNER_TYPES;
export { _e_SCANNER_TYPES as SCANNER_TYPES };
const _e_FLASH_TYPES = _sharedExports.FLASH_TYPES;
export { _e_FLASH_TYPES as FLASH_TYPES };
const _e_FILM_BACK_SUB_FORMATS = _sharedExports.FILM_BACK_SUB_FORMATS;
export { _e_FILM_BACK_SUB_FORMATS as FILM_BACK_SUB_FORMATS };
const _e_FILM_BACK_MOUNTS = _sharedExports.FILM_BACK_MOUNTS;
export { _e_FILM_BACK_MOUNTS as FILM_BACK_MOUNTS };
const _e_FILM_CATEGORIES = _sharedExports.FILM_CATEGORIES;
export { _e_FILM_CATEGORIES as FILM_CATEGORIES };
const _e_FILM_PROCESSES = _sharedExports.FILM_PROCESSES;
export { _e_FILM_PROCESSES as FILM_PROCESSES };
const _e_FOCUS_TYPES = _sharedExports.FOCUS_TYPES;
export { _e_FOCUS_TYPES as FOCUS_TYPES };
const _e_CONDITIONS = _sharedExports.CONDITIONS;
export { _e_CONDITIONS as CONDITIONS };
const _e_STATUSES = _sharedExports.STATUSES;
export { _e_STATUSES as STATUSES };
const _e_METER_TYPES = _sharedExports.METER_TYPES;
export { _e_METER_TYPES as METER_TYPES };
const _e_SHUTTER_TYPES = _sharedExports.SHUTTER_TYPES;
export { _e_SHUTTER_TYPES as SHUTTER_TYPES };
export default _sharedExports;
