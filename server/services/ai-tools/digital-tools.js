/**
 * Digital AI Tools — MVP placeholder
 *
 * Phase 2 will add auto_album / duplicate_detect / smart_library tools here.
 * For now this module exports an empty object so the tool registry can import
 * and spread it without error, while the FILM_ONLY filter in index.js already
 * ensures film-specific tools are hidden when photography_mode='digital'.
 */

const DIGITAL_TOOLS = {};

module.exports = DIGITAL_TOOLS;
