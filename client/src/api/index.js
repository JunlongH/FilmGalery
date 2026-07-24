/**
 * API Module - Unified Export
 * 
 * This is the new modular API structure. All functions are re-exported
 * for backward compatibility with existing imports from 'api.js'.
 * 
 * New code should import from specific modules:
 *   import { getRolls } from './api/rolls';
 *   import { getCameras } from './api/equipment';
 * 
 * Legacy imports still work:
 *   import { getRolls, getCameras } from './api';
 */

// Core utilities
export { 
  API_BASE,
  getApiBase,
  buildUploadUrl,
  bustImageCache,
  jsonFetch,
  postJson,
  putJson,
  deleteRequest,
  uploadTmpFiles,
  uploadWithProgress,
  buildQueryString
} from './core';

// Rolls
export {
  getRolls,
  getRoll,
  getRollLocations,
  updateRoll,
  deleteRoll,
  createRollMultipart,
  createRollWithTmp,
  createRollUnified,
  setRollCover,
  getRollPreset,
  setRollPreset,
  clearRollPreset,
  generateContactSheet
} from './rolls';

// Photos
export {
  getPhotos,
  searchPhotos,
  updatePhoto,
  deletePhoto,
  getFavoritePhotos,
  uploadPhotoToRoll,
  uploadPhotosToRoll,
  updatePositiveFromNegative,
  exportPositive,
  renderPositive,
  filmlabPreview
} from './photos';

// Films
export {
  getFilms,
  getFilmConstants,
  createFilm,
  updateFilm,
  deleteFilm,
  uploadFilmImage,
  getFilmItems,
  getFilmItem,
  updateFilmItem,
  deleteFilmItem,
  createFilmItemsBatch,
  exportShotLogsCsv,
  getFilmCurveProfiles,
  createFilmCurveProfile,
  updateFilmCurveProfile,
  deleteFilmCurveProfile
} from './films';

// Equipment
export {
  getEquipmentConstants,
  getEquipmentSuggestions,
  getCompatibleLenses,
  getEquipmentRelatedRolls,
  getFilmFormats,
  createFilmFormat,
  getCameras,
  getCamera,
  createCamera,
  updateCamera,
  deleteCamera,
  uploadCameraImage,
  getLenses,
  getLens,
  createLens,
  updateLens,
  deleteLens,
  uploadLensImage,
  getFlashes,
  getFlash,
  createFlash,
  updateFlash,
  deleteFlash,
  uploadFlashImage,
  getScanners,
  getScanner,
  createScanner,
  updateScanner,
  deleteScanner,
  uploadScannerImage,
  getFilmBacks,
  getFilmBack,
  createFilmBack,
  updateFilmBack,
  deleteFilmBack,
  uploadFilmBackImage
} from './equipment';

// Batch Export/Render
export {
  createBatchExport,
  getExportJobs,
  getExportJob,
  cancelExportJob,
  pauseExportJob,
  resumeExportJob,
  createBatchRenderLibrary,
  createBatchRenderDownload,
  getBatchRenderProgress,
  cancelBatchRender,
  pauseBatchRender,
  resumeBatchRender,
  getBatchRenderJobs,
  getExportHistory
} from './exports';

// Metadata (Locations, Tags, Presets)
export {
  getLocations,
  searchLocations,
  getLocation,
  getCountries,
  createLocation,
  getTags,
  getTagPhotos,
  listPresets,
  createPreset,
  updatePreset,
  deletePreset,
  getMetadataOptions
} from './metadata';

// LUTs
export {
  listLuts,
  uploadLut,
  deleteLut,
  loadLutFromLibrary,
  parseCubeLUT
} from './luts';

// Downloads & Import
export {
  createBatchDownload,
  getBatchDownloadProgress,
  cancelBatchDownload,
  checkDownloadAvailability,
  getSingleDownloadUrl,
  getImportStrategies,
  previewImport,
  updateManualMatch,
  executeImport,
  getImportProgress,
  cancelImport
} from './downloads';

// AI Assistant
export {
  getAIConfig,
  updateAIConfig,
  testAIConnection,
  getAIModels,
  getConversations,
  getConversation,
  deleteConversation,
  sendChatMessage,
} from './ai';

// RAW & Edge Detection
export {
  getRawDecoderStatus,
  getSupportedRawFormats,
  decodeRawFile,
  previewRawFile,
  extractRawMetadata,
  importRawFile,
  detectEdges,
  detectEdgesBatch,
  applyEdgeDetection,
  applyEdgeDetectionToRoll
} from './processing';

// Export Stats
export async function getExportStats() {
  const { jsonFetch } = await import('./core');
  return jsonFetch('/api/export-history/stats');
}

export async function cleanupExportHistory(keepCount = 100) {
  const { getApiBase } = await import('./core');
  const apiBase = getApiBase();
  const resp = await fetch(`${apiBase}/api/export-history/cleanup?keepCount=${keepCount}`, {
    method: 'DELETE'
  });
  return resp.json();
}

// ─── Digital mode APIs ───

export {
  getAlbums, getAlbum, getAlbumPhotos,
  createAlbum, updateAlbum, deleteAlbum, restoreAlbum,
  setAlbumCover, addAlbumPhotos, removeAlbumPhoto, sortAlbumPhotos,
} from './albums';

export {
  digitalPreviewImport, digitalExecuteImport, getDigitalImportProgress, cancelDigitalImport, checkDigitalImportHash,
} from './digital-import';

export {
  developPreview, developSave, developExport, getDevelopParams,
} from './digital-develop';

export {
  getAppConfig, updateAppConfig, setOnboardingChoice,
} from './app-config';
