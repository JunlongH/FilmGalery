import type { TranslationKey } from './zh';

const en: Record<TranslationKey, string> = {
  // Tabs
  'tab.timeline': 'Timeline',
  'tab.map': 'Map',
  'tab.library': 'Library',

  // Screen titles
  'title.app': 'Film Gallery',
  'title.photoMap': 'Photo Map',
  'title.myLibrary': 'My Library',
  'title.settings': 'Settings',
  'title.rollDetails': 'Roll Details',
  'title.favorites': 'Favorites',
  'title.collections': 'Collections',
  'title.tagDetails': 'Tag Details',
  'title.equipment': 'Equipment',
  'title.equipmentRolls': 'Equipment Rolls',
  'title.inventory': 'Inventory',
  'title.stats': 'Statistics',
  'title.filmCatalog': 'Film Catalog',
  'title.filmRolls': 'Film Rolls',
  'title.filmItem': 'Film Item',
  'title.negatives': 'Negatives',
  'title.shotLog': 'Shot Log',
  'title.aiAssistant': 'AI Assistant',
  'title.locationDiagnostics': 'Location Diagnostics',
  'title.photo': 'Photo',

  // Common
  'common.retry': 'Retry',
  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.add': 'Add',
  'common.close': 'Close',
  'common.clear': 'Clear',
  'common.loading': 'Loading…',
  'common.all': 'All',
  'common.seeAll': 'See All',
  'common.noDate': 'No Date',
  'common.connectionError': 'Connection error: {message}',
  'common.mapLoadFailed': 'Map failed to load',
  'common.inStock': '{count} in stock',
  'common.rollsCount': '{count} rolls',
  'common.rollsInYear': '{count} rolls in {year}',
  'common.photosCount': '{count} photos',

  // Home / Timeline
  'home.emptyTitle': 'No rolls yet',
  'home.emptySubtitle': 'Your film rolls will appear here once the server is connected.',
  'home.error': 'Failed to connect to server. Check Settings.',
  'home.logShot': 'Log a shot',

  // Library
  'library.overview': 'Overview',
  'library.rolls': 'Rolls',
  'library.photos': 'Photos',
  'library.favorites': 'Favorites',
  'library.recentFavorites': 'Recent Favorites',
  'library.collections': 'Collections',
  'library.equipment': 'Equipment',
  'library.quickAccess': 'Quick Access',
  'library.inventory': 'Inventory',
  'library.statistics': 'Statistics',
  'library.viewInsights': 'View insights',
  'library.filmCatalog': 'Film Catalog',
  'library.browseFilmStocks': 'Browse film stocks',
  'library.negatives': 'Negatives',
  'library.allNegatives': 'All scanned negatives',
  'library.noFavorites': 'No favorites yet',
  'library.noCollections': 'No collections yet',
  'library.noEquipment': 'No equipment yet',

  // RollDetail
  'roll.negatives': 'Negatives',
  'roll.camera': 'Camera',
  'roll.lens': 'Lens',
  'roll.filmStock': 'Film Stock',
  'roll.notes': 'Notes',
  'roll.expand': 'Expand details',
  'roll.collapse': 'Collapse details',

  // Favorites
  'favorites.count': '{count} favorites',
  'favorites.emptyTitle': 'No favorites yet',
  'favorites.emptySubtitle': 'Add photos to your favorites to see them here',

  // Collections
  'collections.count': '{count} collections',
  'collections.emptyTitle': 'No collections yet',
  'collections.emptySubtitle': 'Create tags to organize your photos',
  'collections.photosCount': '{count} photos',

  // TagDetail
  'tag.empty': 'No photos under this tag',

  // Films
  'films.empty': 'No films yet',
  'films.noRolls': 'No rolls found for this film.',

  // Negatives
  'negatives.loadFailed': 'Failed to load negatives',

  // Equipment
  'equipment.cameras': 'Cameras',
  'equipment.lenses': 'Lenses',
  'equipment.flashes': 'Flashes',
  'equipment.films': 'Films',
  'equipment.search': 'Search equipment…',
  'equipment.empty': 'No {what} found',
  'equipment.emptyHint': 'Tap + to add one',
  'equipment.addCamera': 'Add Camera',
  'equipment.addLens': 'Add Lens',
  'equipment.addFlash': 'Add Flash',
  'equipment.addFilm': 'Add Film',
  'equipment.deleteTitle': 'Delete {what}?',
  'equipment.deleteBody': 'Are you sure you want to delete {name}?',
  'equipment.brand': 'Brand',
  'equipment.model': 'Model',
  'equipment.mount': 'Mount (e.g., Nikon F, Canon EF)',
  'equipment.fixedLens': 'Fixed Lens',
  'equipment.loadFailed': 'Failed to load equipment',
  'equipment.noRolls': 'No rolls found for this {what}',
  'equipment.noRollsHint': 'Rolls using this equipment will appear here',

  // Inventory
  'inventory.loadFailed': 'Failed to load inventory',
  'inventory.empty': 'No film items match this filter',

  // Stats
  'stats.loadFailed': 'Failed to load statistics',
  'stats.overview': 'Overview',
  'stats.totalRolls': 'Total rolls',
  'stats.totalPhotos': 'Total photos',
  'stats.totalSpending': 'Total spending',
  'stats.avgPerRoll': 'Avg / roll',
  'stats.inventory': 'Inventory',
  'stats.inStock': 'In stock',
  'stats.inventoryValue': 'Inventory value',
  'stats.activity': 'Activity (Last 6 Months)',
  'stats.topFilms': 'Top Films',
  'stats.topCameras': 'Top Cameras',
  'stats.noActivity': 'No activity data',
  'stats.noFilmData': 'No film data',
  'stats.noCameraData': 'No camera data',

  // Map
  'map.photos': 'Photos',
  'map.locations': 'Locations',
  'map.loading': 'Loading map data…',
  'map.empty': 'No photos with GPS data found.\nTake some photos with location enabled!',
  'map.loadFailed': 'Map failed to load',
  'map.locationsCount': '{count} Locations',

  // PhotoView
  'photo.loading': 'Loading photo…',
  'photo.notFound': 'Photo not found',
  'photo.loadFailed': 'Failed to load photo',
  'photo.saved': 'Saved with metadata: {name}',
  'photo.saveFailed': 'Save failed: {message}',
  'photo.downloadError': 'Download error',
  'photo.processFailed': 'Failed to process image',
  'photo.permissionDenied': 'MediaLibrary permission denied',
  'photo.editNote': 'Edit Note',
  'photo.editTags': 'Edit Tags',
  'photo.addTag': 'Add a tag…',
  'photo.noMatchingTags': 'No matching tags',
  'photo.chooseExisting': 'Choose from existing',

  // ShotLog / metering
  'shot.quickMeter': 'Quick Meter',
  'shot.loadedFilms': 'Loaded films',
  'shot.loadFailed': 'Failed to load films',
  'shot.noLoaded': 'No loaded film.\nLoad a roll to start metering!',
  'shot.loading': 'Loading films…',
  'shot.missingItem': 'Missing film item.',

  // Settings
  'settings.autoDiscovery': 'Auto Discovery',
  'settings.autoDiscoveryHint': 'Discover FilmGallery servers on the LAN, or scan ports by IP',
  'settings.modeAuto': 'Auto',
  'settings.modeMdns': 'LAN (mDNS)',
  'settings.modePortScan': 'Port Scan',
  'settings.autoMode': 'Auto mode: mDNS discovery first, then port scan',
  'settings.serverIp': 'Server IP address',
  'settings.startDiscovery': 'Start Discovery',
  'settings.scanning': 'Scanning…',
  'settings.discovered': 'Discovered services:',
  'settings.manualConfig': 'Manual Configuration',
  'settings.primaryUrl': 'Primary Server URL',
  'settings.primaryHint': 'Full server address (auto-filled after discovery)',
  'settings.backupUrl': 'Backup Server URL (Optional)',
  'settings.backupHint': 'Alternative IP address if primary is unreachable.',
  'settings.swap': 'Swap Primary & Backup',
  'settings.testPrimary': 'Test Primary',
  'settings.testBackup': 'Test Backup',
  'settings.saveSettings': 'Save Settings',
  'settings.darkMode': 'Dark Mode',
  'settings.darkModeHint': 'Reduce eye strain with a dark UI',
  'settings.language': 'Language / 语言',
  'settings.languageHint': 'Choose UI language / 选择界面语言',
  'settings.locationDiag': 'Location Diagnostics',
  'settings.locationDiagHint': 'Debug location issues on HyperOS/MIUI devices',
  'settings.openLocationDiag': 'Open Location Diagnostics',
  'settings.mapSettings': 'Map Settings',
  'settings.mapProvider': 'Map Provider',
  'settings.saved': 'Settings saved',
  'settings.testOk': 'Connection OK',
  'settings.testFailed': 'Connection failed',

  // Empty/error generic
  'empty.generic': 'Nothing here yet',
};

export default en;
