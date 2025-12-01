const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
// const db = require('./db'); // MOVED: Loaded after migration
// Disable sharp cache to prevent file locking on Windows
sharp.cache(false);
const { uploadsDir, tmpUploadDir, rollsDir } = require('./config/paths');
const { runMigration } = require('./utils/migration');
const { runSchemaMigration } = require('./utils/schema-migration');
const { cacheSeconds } = require('./utils/cache');
const { requestProfiler, getProfilerStats, scheduleProfilerLog } = require('./utils/profiler');

console.log('[PATHS]', {
	DATA_ROOT: process.env.DATA_ROOT,
	UPLOADS_ROOT: process.env.UPLOADS_ROOT,
	USER_DATA: process.env.USER_DATA,
	uploadsDir,
	tmpUploadDir,
	rollsDir
});

// Global error handlers to prevent crash and log the cause
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
// lightweight request profiler for API
app.use(requestProfiler());
app.use(bodyParser.json({ limit: '10mb' }));
// gzip/deflate for API JSON responses (not applied to static uploads)
app.use(compression({ threshold: 1024 }));
// CORS: reflect origin (including 'null' from file://) and allow private network
app.use(cors({ origin: true, credentials: false, preflightContinue: true }));
app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	next();
});
app.options('*', (req, res) => {
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	res.sendStatus(204);
});

// --- storage directories ---
const staticOptions = {
  maxAge: '1y',
  immutable: true,
  etag: true,
  lastModified: true
};

// Middleware to handle case-insensitive file serving on Windows/Linux mismatch
const caseInsensitiveStatic = (root) => {
  return (req, res, next) => {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch (e) {
      decodedPath = req.path;
    }
    
    const filePath = path.join(root, decodedPath);
    
    // 1. Try exact match first
    if (fs.existsSync(filePath)) {
      // Check if it's a directory to avoid EISDIR
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) return next();
      } catch (e) { return next(); }

      return res.sendFile(filePath, (err) => {
        if (err) {
          // If headers sent, we can't do anything. Otherwise pass to next.
          if (res.headersSent) return;
          console.error('[STATIC] Error serving exact file:', filePath, err.message);
          next();
        }
      });
    }

    // 2. Try case-insensitive match
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.toLowerCase() === base.toLowerCase());
        if (match) {
          const matchedPath = path.join(dir, match);
          return res.sendFile(matchedPath, (err) => {
             if (err) {
               if (res.headersSent) return;
               console.error('[STATIC] Error serving matched file:', matchedPath, err.message);
               next();
             }
          });
        }
      } catch (e) {
        console.error('[STATIC] Readdir error:', dir, e.message);
      }
    }
    next();
  };
};

app.use('/uploads', caseInsensitiveStatic(uploadsDir));
app.use('/uploads', express.static(uploadsDir, staticOptions));
app.use('/uploads/tmp', express.static(tmpUploadDir)); // tmp files don't need long cache
app.use('/uploads/rolls', caseInsensitiveStatic(rollsDir));
app.use('/uploads/rolls', express.static(rollsDir, staticOptions));

// --- Routes (mount after schema is ensured just before listen) ---
const mountRoutes = () => {
  // short-lived response caching for relatively static endpoints
  app.use('/api/films', cacheSeconds(120), require('./routes/films'));
  app.use('/api/tags', cacheSeconds(120), require('./routes/tags'));
  app.use('/api/locations', cacheSeconds(300), require('./routes/locations'));
  app.use('/api/stats', cacheSeconds(60), require('./routes/stats'));
  // rolls/photos change more often; keep very short cache to help bursts
  app.use('/api/rolls', cacheSeconds(10), require('./routes/rolls'));
  app.use('/api/photos', cacheSeconds(10), require('./routes/photos'));
  // functional endpoints: no caching
  app.use('/api/uploads', require('./routes/uploads'));
  app.use('/api/metadata', require('./routes/metadata'));
  app.use('/api/search', require('./routes/search'));
  app.use('/api/presets', require('./routes/presets'));
  app.use('/api/filmlab', require('./routes/filmlab'));
  app.use('/api/conflicts', require('./routes/conflicts'));
  app.get('/api/_profiler', (req, res) => res.json(getProfilerStats()));
};

// Ensure database schema exists before accepting requests (first-run install)
const schemaSQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS films (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  iso INTEGER,
  format TEXT,
  type TEXT,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  film_id INTEGER,
  camera_id INTEGER,
  date_loaded DATE,
  date_finished DATE,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(film_id) REFERENCES films(id)
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id INTEGER,
  filename TEXT NOT NULL,
  path TEXT,
  aperture REAL,
  shutter_speed TEXT,
  iso INTEGER,
  focal_length REAL,
  rating INTEGER DEFAULT 0,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(roll_id) REFERENCES rolls(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS photo_tags (
  photo_id INTEGER,
  tag_id INTEGER,
  PRIMARY KEY (photo_id, tag_id),
  FOREIGN KEY(photo_id) REFERENCES photos(id),
  FOREIGN KEY(tag_id) REFERENCES tags(id)
);

CREATE TABLE IF NOT EXISTS presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  params TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

// Seed locations if needed
const seedLocations = async () => {
	// ... (implementation if needed, or keep empty if handled elsewhere)
};

(async () => {
	try {
		// 1. Run Migration BEFORE loading DB
		console.log('[SERVER] Starting migration check...');
		await runMigration();
		console.log('[SERVER] Migration check complete.');

        // 2. Run Schema Migration (Systematic Update)
        console.log('[SERVER] Starting schema migration...');
        await runSchemaMigration();
        console.log('[SERVER] Schema migration complete.');

		// 3. Load DB now that file is ready
		const db = require('./db');

		// 4. Ensure Schema (Legacy check, kept for safety but mostly handled by schema-migration)
		await new Promise((resolve, reject) => {
			db.exec(schemaSQL, (err) => {
				if (err) reject(err);
				else resolve();
			});
		});
		console.log('DB schema ensured');

        // 5. Recompute roll sequence on startup
        console.log('[SERVER] Recomputing roll sequence...');
        const { recomputeRollSequence } = require('./services/roll-service');
        await recomputeRollSequence();
        console.log('[SERVER] Roll sequence recomputed.');

        // (Removed old ad-hoc ALTER TABLE blocks as they are now in schema-migration.js)
		
		mountRoutes();
		
		// Add graceful shutdown endpoint
		app.post('/api/shutdown', (req, res) => {
			console.log('[SERVER] Shutdown requested');
			res.json({ ok: true, message: 'Shutting down...' });
			// Close DB and exit after sending response
			setTimeout(() => {
				if (db.close) {
					db.close();
				} else {
					process.exit(0);
				}
			}, 100);
		});
		
		const PORT = process.env.PORT || 4000;
		// Listen on all interfaces (0.0.0.0) to allow mobile access
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
      scheduleProfilerLog();
    });
		
		// Graceful shutdown on signals
		const gracefulShutdown = (signal) => {
			console.log(`[SERVER] Received ${signal}, closing HTTP server...`);
			server.close(() => {
				console.log('[SERVER] HTTP server closed');
				if (db.close) {
					db.close();
				} else {
					process.exit(0);
				}
			});
			// Force exit if graceful shutdown takes too long
			setTimeout(() => {
				console.error('[SERVER] Forced exit after timeout');
				process.exit(1);
			}, 5000);
		};
		
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		
	} catch (e) {
		console.error('Failed to ensure DB schema', e);
		process.exit(1);
	}
})();
