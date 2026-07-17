/**
 * @filmgallery/libraw-native - JavaScript Wrapper
 * 
 * High-level Promise-based API for LibRaw operations
 * 
 * @module @filmgallery/libraw-native
 */

'use strict';

const path = require('path');

// Load native addon
let native = null;
let loadError = null;

try {
    // Try node-gyp-build first (for prebuilds and dev builds)
    native = require('node-gyp-build')(path.join(__dirname, '..'));
} catch (e1) {
    try {
        // Fallback to committed prebuilts in bin/<platform>-<arch>-<modules>/
        // (these ship in the repo but are not on node-gyp-build's resolution path)
        const prebuiltPath = path.join(__dirname, '..', 'bin',
            `${process.platform}-${process.arch}-${process.versions.modules}`, 'libraw-native.node');
        native = require(prebuiltPath);
    } catch (e1b) {
    try {
        // Fallback to direct build path
        native = require('../build/Release/libraw_native.node');
    } catch (e2) {
        try {
            native = require('../build/Debug/libraw_native.node');
        } catch (e3) {
            loadError = new Error(`Failed to load native addon: ${e1.message}`);
        }
    }
    }
}

// Re-export native constants
const ColorSpace = native?.ColorSpace || {
    RAW: 0,
    SRGB: 1,
    ADOBE: 2,
    WIDE: 3,
    PROPHOTO: 4,
    XYZ: 5,
    ACES: 6,
    DCIP3: 7,
    REC2020: 8
};

const DemosaicQuality = native?.DemosaicQuality || {
    LINEAR: 0,
    VNG: 1,
    PPG: 2,
    AHD: 3,
    DCB: 4,
    DHT: 11,
    AAHD: 12
};

const HighlightMode = native?.HighlightMode || {
    CLIP: 0,
    UNCLIP: 1,
    BLEND: 2,
    REBUILD_3: 3,
    REBUILD_5: 5,
    REBUILD_7: 7,
    REBUILD_9: 9
};

/**
 * Promisify a callback-based method
 * @param {Object} obj - Object with the method
 * @param {string} method - Method name
 * @param {...any} args - Arguments to pass
 * @returns {Promise<any>}
 */
function promisify(obj, method, ...args) {
    return new Promise((resolve, reject) => {
        obj[method](...args, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}

/**
 * LibRaw Processor Class
 * 
 * High-level wrapper around native LibRaw bindings with Promise API
 */
class LibRawProcessor {
    /**
     * Create a new LibRaw processor instance
     */
    constructor() {
        if (!native) {
            throw loadError || new Error('Native LibRaw module not available');
        }
        this._native = new native.LibRawProcessor();
        this._isOpen = false;
    }

    /**
     * Load a RAW file from disk
     * @param {string} filePath - Path to the RAW file
     * @returns {Promise<{success: boolean, width: number, height: number}>}
     */
    async loadFile(filePath) {
        const result = await promisify(this._native, 'loadFile', filePath);
        this._isOpen = true;
        return result;
    }

    /**
     * Load a RAW file from a Buffer
     * @param {Buffer} buffer - RAW file data
     * @returns {Promise<{success: boolean, width: number, height: number}>}
     */
    async loadBuffer(buffer) {
        const result = await promisify(this._native, 'loadBuffer', buffer);
        this._isOpen = true;
        return result;
    }

    /**
     * Unpack RAW data (prepare for processing)
     * @returns {Promise<{success: boolean}>}
     */
    async unpack() {
        return promisify(this._native, 'unpack');
    }

    /**
     * Process the RAW image (demosaicing, white balance, etc.)
     * This is the main processing step that converts RAW Bayer data to RGB
     * @returns {Promise<{success: boolean, width: number, height: number}>}
     */
    async dcrawProcess() {
        return promisify(this._native, 'dcrawProcess');
    }

    /**
     * Alias for dcrawProcess() for API compatibility
     * @returns {Promise<{success: boolean, width: number, height: number}>}
     */
    async processImage() {
        return this.dcrawProcess();
    }

    /**
     * Create an in-memory image from processed data
     * @returns {Promise<{success: boolean, data: Buffer, width: number, height: number, bits: number, colors: number}>}
     */
    async makeMemImage() {
        return promisify(this._native, 'makeMemImage');
    }

    /**
     * Unpack the embedded thumbnail
     * @returns {Promise<{success: boolean, width: number, height: number, format: number}>}
     */
    async unpackThumbnail() {
        return promisify(this._native, 'unpackThumbnail');
    }

    /**
     * Create an in-memory thumbnail
     * @returns {Promise<{success: boolean, data: Buffer, width: number, height: number}>}
     */
    async makeMemThumbnail() {
        return promisify(this._native, 'makeMemThumbnail');
    }

    /**
     * Get RAW file metadata (camera, settings, etc.)
     * @returns {Object} Metadata object
     */
    getMetadata() {
        return this._native.getMetadata();
    }

    /**
     * Get image dimensions
     * @returns {Object} Size object with width, height, rawWidth, rawHeight
     */
    getImageSize() {
        return this._native.getImageSize();
    }

    /**
     * Get lens information
     * @returns {Object} Lens info object
     */
    getLensInfo() {
        return this._native.getLensInfo();
    }

    /**
     * Get color information (white balance, black levels, etc.)
     * @returns {Object} Color info object
     */
    getColorInfo() {
        return this._native.getColorInfo();
    }

    /**
     * Set output color space
     * @param {number} colorSpace - Color space constant (use ColorSpace enum)
     */
    setOutputColorSpace(colorSpace) {
        this._native.setOutputColorSpace(colorSpace);
    }

    /**
     * Set output bits per sample (8 or 16)
     * @param {number} bits - 8 or 16
     */
    setOutputBps(bits) {
        this._native.setOutputBps(bits);
    }

    /**
     * Set gamma correction
     * @param {number} power - Gamma power (e.g., 1/2.4 for sRGB)
     * @param {number} slope - Gamma slope (e.g., 12.92 for sRGB)
     */
    setGamma(power, slope) {
        this._native.setGamma(power, slope);
    }

    /**
     * Set custom white balance multipliers
     * @param {number} r - Red multiplier
     * @param {number} g1 - Green 1 multiplier
     * @param {number} b - Blue multiplier
     * @param {number} g2 - Green 2 multiplier
     */
    setWhiteBalance(r, g1, b, g2) {
        this._native.setWhiteBalance(r, g1, b, g2);
    }

    /**
     * Enable/disable half-size output (faster, lower quality)
     * @param {boolean} halfSize - Enable half-size output
     */
    setHalfSize(halfSize) {
        this._native.setHalfSize(halfSize);
    }

    /**
     * Enable/disable auto brightness adjustment
     * @param {boolean} noAutoBright - Disable auto brightness
     */
    setNoAutoBright(noAutoBright) {
        this._native.setNoAutoBright(noAutoBright);
    }

    /**
     * Enable/disable camera white balance
     * @param {boolean} useCameraWB - Use camera white balance
     */
    setUseCameraWB(useCameraWB) {
        this._native.setUseCameraWB(useCameraWB);
    }

    /**
     * Enable/disable auto white balance
     * @param {boolean} useAutoWB - Use auto white balance
     */
    setUseAutoWB(useAutoWB) {
        this._native.setUseAutoWB(useAutoWB);
    }

    /**
     * Set demosaicing quality
     * @param {number} quality - Quality constant (use DemosaicQuality enum)
     */
    setQuality(quality) {
        this._native.setQuality(quality);
    }

    /**
     * Set highlight recovery mode
     * @param {number} mode - Highlight mode constant (use HighlightMode enum)
     */
    setHighlightMode(mode) {
        this._native.setHighlightMode(mode);
    }

    /**
     * Recycle the processor for loading a new file
     */
    recycle() {
        this._native.recycle();
        this._isOpen = false;
    }

    /**
     * Close the processor and free resources
     */
    close() {
        this._native.close();
        this._isOpen = false;
    }

    /**
     * Check if a file is loaded
     * @returns {boolean}
     */
    isLoaded() {
        return this._native.isLoaded();
    }
}

/**
 * Get LibRaw version information
 * @returns {{version: string, versionNumber: number}}
 */
function getVersion() {
    if (!native) {
        return { version: 'unavailable', versionNumber: 0 };
    }
    return native.getVersion();
}

/**
 * Get list of supported cameras
 * @returns {string[]}
 */
function getCameraList() {
    if (!native) return [];
    return native.getCameraList();
}

/**
 * Get count of supported cameras
 * @returns {number}
 */
function getCameraCount() {
    if (!native) return 0;
    return native.getCameraCount();
}

/**
 * Check if a camera model is supported
 * @param {string} model - Camera model name
 * @returns {boolean}
 */
function isSupportedCamera(model) {
    if (!native) return false;
    return native.isSupportedCamera(model);
}

/**
 * Check if the native module is available
 * @returns {boolean}
 */
function isAvailable() {
    return native !== null;
}

/**
 * Get the load error if the module failed to load
 * @returns {Error|null}
 */
function getLoadError() {
    return loadError;
}

// Export everything
module.exports = {
    // Main class
    LibRawProcessor,
    
    // Module functions
    getVersion,
    getCameraList,
    getCameraCount,
    isSupportedCamera,
    isAvailable,
    getLoadError,
    
    // Constants
    ColorSpace,
    DemosaicQuality,
    HighlightMode
};
