/**
 * Equipment Management API Routes (Refactored)
 * 
 * Thin controller layer - business logic delegated to equipment-service.js
 * 
 * Handles CRUD operations for:
 * - Cameras, Lenses, Flashes, Scanners, Film Backs, Film Formats
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { uploadsDir } = require('../config/paths');
const { CAMERA_TYPES, LENS_MOUNTS, SCANNER_TYPES, FILM_BACK_SUB_FORMATS, FILM_BACK_MOUNTS, FILM_FORMATS } = require('../utils/equipment-migration');
const { FOCUS_TYPES, CONDITIONS, STATUSES, METER_TYPES, SHUTTER_TYPES } = require('../../packages/shared/constants/equipment');
const { asyncHandler } = require('../utils/async-handler');

// Service layer
const equipmentService = require('../services/equipment-service');

// Ensure equipment images directory exists
const equipImagesDir = path.join(uploadsDir, 'equipment');
if (!fs.existsSync(equipImagesDir)) {
  fs.mkdirSync(equipImagesDir, { recursive: true });
}

// Multer config for equipment images
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, equipImagesDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${req.params.type || 'equip'}_${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// ========================================
// CONSTANTS
// ========================================

router.get('/constants', (req, res) => {
  res.json({
    cameraTypes: CAMERA_TYPES,
    lensMounts: LENS_MOUNTS,
    scannerTypes: SCANNER_TYPES,
    filmFormats: FILM_FORMATS,
    focusTypes: FOCUS_TYPES,
    conditions: CONDITIONS,
    statuses: STATUSES,
    meterTypes: METER_TYPES,
    shutterTypes: SHUTTER_TYPES,
    magnificationRatios: ['1:1', '1:2', '1:3', '1:4', '1:5', '1:10'],
    sensorTypes: ['CCD', 'CMOS', 'PMT'],
    bitDepths: [8, 12, 14, 16, 24, 48],
    filmBackSubFormats: FILM_BACK_SUB_FORMATS,
    filmBackMounts: FILM_BACK_MOUNTS
  });
});

// ========================================
// GENERIC CRUD FACTORY
// ========================================

/**
 * Create standard CRUD routes for an equipment type
 */
function createCrudRoutes(type, extraRoutes = {}) {
  const typePath = type;
  
  // LIST
  router.get(`/${typePath}`, asyncHandler(async (req, res) => {
    const { includeDeleted, ...filters } = req.query;
    
    // Convert string 'true'/'false' to boolean
    const parsedFilters = {};
    for (const [key, value] of Object.entries(filters)) {
      parsedFilters[key] = value;
    }
    parsedFilters.includeDeleted = includeDeleted === 'true';
    
    let items = await equipmentService.listEquipment(type, parsedFilters);
    
    // Apply extra filtering if provided
    if (extraRoutes.listFilter) {
      items = await extraRoutes.listFilter(req, items);
    }
    
    res.json(items);
  }));

  // GET BY ID
  router.get(`/${typePath}/:id`, asyncHandler(async (req, res) => {
    const item = await equipmentService.getEquipmentById(type, req.params.id);
    if (!item) {
      return res.status(404).json({ error: `${type} not found` });
    }
    res.json(item);
  }));

  // CREATE
  router.post(`/${typePath}`, asyncHandler(async (req, res) => {
    const item = await equipmentService.createEquipment(type, req.body);
    res.status(201).json(item);
  }));

  // UPDATE
  router.put(`/${typePath}/:id`, asyncHandler(async (req, res) => {
    const item = await equipmentService.updateEquipment(type, req.params.id, req.body);
    res.json(item);
  }));

  // DELETE
  router.delete(`/${typePath}/:id`, asyncHandler(async (req, res) => {
    const hard = req.query.hard === 'true' || req.query.permanent === 'true';
    const result = await equipmentService.deleteEquipment(type, req.params.id, hard);
    res.json(result);
  }));

  // IMAGE UPLOAD (if supported)
  if (type !== 'formats') {
    router.post(`/${typePath}/:id/image`, upload.single('image'), asyncHandler(async (req, res) => {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const relativePath = `equipment/${req.file.filename}`;
      const result = await equipmentService.updateEquipmentImage(type, req.params.id, relativePath);
      res.json(result);
    }));
  }
}

// ========================================
// REGISTER ROUTES FOR EACH EQUIPMENT TYPE
// ========================================

// Film Formats (simple CRUD)
createCrudRoutes('formats');

// Cameras (with digital mode filter)
createCrudRoutes('cameras', {
  listFilter: async (req, items) => {
    if (req.query.type) {
      items = items.filter(c => c.type === req.query.type);
    }
    if (req.query.mode === 'digital') {
      items = items.filter(c => c.is_digital === 1);
    }
    return items;
  }
});

// Lenses (with camera compatibility filtering)
createCrudRoutes('lenses', {
  listFilter: async (req, items) => {
    if (req.query.camera_id) {
      return equipmentService.getLensesByCamera(req.query.camera_id, items);
    }
    return items;
  }
});

// Flashes
createCrudRoutes('flashes');

// Scanners
createCrudRoutes('scanners');

// Film Backs
createCrudRoutes('film-backs');

// ========================================
// SPECIALIZED ENDPOINTS
// ========================================

// Equipment suggestions (for dropdowns)
router.get('/suggestions', asyncHandler(async (req, res) => {
  const suggestions = await equipmentService.getEquipmentSuggestions();
  res.json(suggestions);
}));

// Compatible lenses for a camera
router.get('/compatible-lenses/:cameraId', asyncHandler(async (req, res) => {
  const result = await equipmentService.getCompatibleLenses(req.params.cameraId);
  if (!result) {
    return res.status(404).json({ error: 'Camera not found' });
  }
  res.json(result);
}));

// Get rolls related to equipment (via photos or roll assignment)
router.get('/related-rolls/:type/:id', asyncHandler(async (req, res) => {
  const { type, id } = req.params;
  const limit = parseInt(req.query.limit) || 20;
  const rolls = await equipmentService.getRelatedRolls(type, parseInt(id), limit);
  res.json(rolls);
}));

module.exports = router;
