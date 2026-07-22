/**
 * Server Capabilities Module
 * 
 * Defines what each server mode can do.
 * Used by /api/discover endpoint and compute guard middleware.
 */

// Server modes
const SERVER_MODES = {
  STANDALONE: 'standalone',  // Full server with compute (PC)
  NAS: 'nas',                // Data-only server (NAS/Docker)
  DEV: 'dev'                 // Development mode
};

// API categories
const API_CATEGORIES = {
  DATA: 'data',       // CRUD operations, always available
  COMPUTE: 'compute', // Heavy processing, may be disabled
  STORAGE: 'storage'  // File storage, always available
};

// Compute-intensive routes that should be disabled in NAS mode
const COMPUTE_ROUTES = [
  '/api/filmlab/process',
  '/api/filmlab/preview',
  '/api/filmlab/export',
  '/api/raw/decode',
  '/api/raw/preview',
  '/api/batch-render',
  '/api/edge-detection/detect',
  '/api/edge-detection/auto-crop'
];

// 参数化 compute 路由（无法用前缀表达，前缀 /api/photos 属于 DATA 类）
const COMPUTE_ROUTE_PATTERNS = [
  /^\/api\/photos\/[^/]+\/render-positive$/
];

// Data routes available in all modes
const DATA_ROUTES = [
  '/api/rolls',
  '/api/photos',
  '/api/films',
  '/api/film-items',
  '/api/equipment',
  '/api/presets',
  '/api/luts',
  '/api/uploads',
  '/api/metadata',
  '/api/search',
  '/api/conflicts',
  '/api/health',
  '/api/discover',
  '/api/export-history',
  '/api/import'
];

/**
 * Get current server mode from environment
 */
function getServerMode() {
  const mode = (process.env.SERVER_MODE || 'standalone').toLowerCase();
  if (Object.values(SERVER_MODES).includes(mode)) {
    return mode;
  }
  return SERVER_MODES.STANDALONE;
}

/**
 * Check if compute is enabled for current mode
 */
function isComputeEnabled() {
  const mode = getServerMode();
  return mode === SERVER_MODES.STANDALONE || mode === SERVER_MODES.DEV;
}

/**
 * Check if a route requires compute capability
 */
function isComputeRoute(path) {
  return COMPUTE_ROUTES.some(route => path.startsWith(route)) ||
         COMPUTE_ROUTE_PATTERNS.some(re => re.test(path));
}

/**
 * Get server capabilities for /api/discover
 */
function getCapabilities() {
  const mode = getServerMode();
  const computeEnabled = isComputeEnabled();
  
  return {
    mode,
    capabilities: {
      data: true,
      compute: computeEnabled,
      storage: true
    },
    endpoints: {
      data: DATA_ROUTES,
      compute: computeEnabled ? COMPUTE_ROUTES : []
    },
    limits: {
      maxUploadSize: computeEnabled ? '500mb' : '100mb',
      batchLimit: computeEnabled ? 100 : 0
    }
  };
}

export { SERVER_MODES, API_CATEGORIES, COMPUTE_ROUTES, COMPUTE_ROUTE_PATTERNS, DATA_ROUTES, getServerMode, isComputeEnabled, isComputeRoute, getCapabilities };