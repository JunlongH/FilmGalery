const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const sharp = require('sharp');
const db = require('./db');
// Disable sharp cache to prevent file locking on Windows
sharp.cache(false);
const { uploadsDir, tmpUploadDir, rollsDir } = require('./config/paths');
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
  // Keep server alive if possible, but this is risky. 
  // For debugging "flashback", logging is key.
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION:', reason);
});

const app = express();
app.use(bodyParser.json({ limit: '10mb' }));
// CORS: reflect origin (including 'null' from file://) and allow private network
// Important: preflightContinue=true so we can add Access-Control-Allow-Private-Network on OPTIONS
app.use(cors({ origin: true, credentials: false, preflightContinue: true }));
app.use((req, res, next) => {
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	next();
});
// Ensure OPTIONS preflight includes the Private-Network header
app.options('*', (req, res) => {
	res.setHeader('Access-Control-Allow-Private-Network', 'true');
	res.sendStatus(204);
});

// --- storage directories ---
// Cache static files for 1 year (immutable) since filenames usually don't change or are unique
const staticOptions = {
  maxAge: '1y',
  immutable: true,
  etag: true,
  lastModified: true
};

app.use('/uploads', express.static(uploadsDir, staticOptions));
app.use('/uploads/tmp', express.static(tmpUploadDir)); // tmp files don't need long cache
app.use('/uploads/rolls', express.static(rollsDir, staticOptions));

// --- Routes (mount after schema is ensured just before listen) ---
const mountRoutes = () => {
	app.use('/api/rolls', require('./routes/rolls'));
	app.use('/api/photos', require('./routes/photos'));
	app.use('/api/films', require('./routes/films'));
	app.use('/api/tags', require('./routes/tags'));
	app.use('/api/uploads', require('./routes/uploads'));
	app.use('/api/metadata', require('./routes/metadata'));
	app.use('/api/search', require('./routes/search'));
	app.use('/api/presets', require('./routes/presets'));
	app.use('/api/locations', require('./routes/locations'));
	app.use('/api/stats', require('./routes/stats'));
	app.use('/api/filmlab', require('./routes/filmlab'));
	app.use('/api/conflicts', require('./routes/conflicts'));
};

// Ensure database schema exists before accepting requests (first-run install)
const schemaSQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS films (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	iso INTEGER NOT NULL,
	category TEXT NOT NULL,
	thumbPath TEXT,
	createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
	updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rolls (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	title TEXT,
	start_date TEXT,
	end_date TEXT,
	camera TEXT,
	lens TEXT,
	photographer TEXT,
	filmId INTEGER,
	film_type TEXT,
	exposures INTEGER,
	cover_photo TEXT,
	coverPath TEXT,
	folderName TEXT,
	iso INTEGER,
	notes TEXT,
	develop_lab TEXT,
	develop_process TEXT,
	develop_date TEXT,
	purchase_cost REAL,
	develop_cost REAL,
	purchase_channel TEXT,
	batch_number TEXT,
	develop_note TEXT,
	preset_json TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (filmId) REFERENCES films(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS photos (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	roll_id INTEGER NOT NULL,
	frame_number TEXT,
	filename TEXT,
	full_rel_path TEXT,
	thumb_rel_path TEXT,
	original_rel_path TEXT,
	positive_rel_path TEXT,
	positive_thumb_rel_path TEXT,
	negative_thumb_rel_path TEXT,
	is_negative_source INTEGER DEFAULT 0,
	caption TEXT,
	taken_at TEXT,
	rating INTEGER,
	negative_rel_path TEXT,
	date_taken TEXT,
	time_taken TEXT,
	location_id INTEGER,
	detail_location TEXT,
	latitude REAL,
	longitude REAL,
	camera TEXT,
	lens TEXT,
	photographer TEXT,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (roll_id) REFERENCES rolls(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tags (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photo_tags (
	photo_id INTEGER NOT NULL,
	tag_id INTEGER NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (photo_id, tag_id),
	FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
	FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS roll_files (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	rollId INTEGER NOT NULL,
	filename TEXT NOT NULL,
	relPath TEXT NOT NULL,
	createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (rollId) REFERENCES rolls(id) ON DELETE CASCADE
);
 
CREATE TABLE IF NOT EXISTS presets (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL,
	category TEXT,
	description TEXT,
	params_json TEXT NOT NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	country_code TEXT,
	country_name TEXT,
	city_name TEXT NOT NULL,
	city_lat REAL,
	city_lng REAL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roll_locations (
	roll_id INTEGER NOT NULL,
	location_id INTEGER NOT NULL,
	PRIMARY KEY (roll_id, location_id),
	FOREIGN KEY (roll_id) REFERENCES rolls(id) ON DELETE CASCADE,
	FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);
`;

function ensureSchema() {
	return new Promise((resolve, reject) => {
		db.exec(schemaSQL, (err) => {
			if (err) return reject(err);
			resolve(true);
		});
	});
}

async function verifySchemaTables() {
	return new Promise((resolve) => {
		db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, rows) => {
			if (err) { console.error('Schema check failed', err.message); return resolve(false); }
			const existing = new Set(rows.map(r => r.name));
			const required = ['films','rolls','photos','tags','photo_tags','roll_files','presets'];
			const missing = required.filter(t => !existing.has(t));
			if (missing.length === 0) return resolve(true);
			console.warn('Missing tables detected, creating:', missing.join(', '));
			ensureSchema().then(() => resolve(true)).catch(e => { console.error('Recreate schema failed', e.message); resolve(false); });
		});
	});
}

// Ensure additional columns (non-breaking migrations) without separate migration files.
async function ensureExtraColumns() {
	// This now covered by schemaSQL explicit columns. Keep defensive checks for existing deployments.
	return new Promise((resolve) => {
		db.all("PRAGMA table_info(rolls)", async (err, cols) => {
			if (err) { console.error('Inspect rolls failed', err.message); return resolve(); }
			
			// Check if we need to rename shooter to photographer
			const hasShooter = cols.some(c => c.name === 'shooter');
			const hasPhotographer = cols.some(c => c.name === 'photographer');
			
			if (hasShooter && !hasPhotographer) {
				console.log('[MIGRATION] Renaming shooter to photographer in rolls table...');
				try {
					const migration = require('./migrations/2025-11-30-rename-shooter-to-photographer');
					await migration.up();
					console.log('[MIGRATION] Successfully renamed shooter to photographer');
				} catch (e) {
					console.error('[MIGRATION] Failed to rename shooter to photographer:', e.message);
				}
			}
			
			// Ensure other roll columns
			const needed = ['develop_lab','develop_process','develop_date','purchase_cost','develop_cost','purchase_channel','batch_number','develop_note','preset_json'];
			for (const col of needed) {
				if (!cols.some(c => c.name === col)) {
					db.run(`ALTER TABLE rolls ADD COLUMN ${col} TEXT`, (e) => {
						if (e) console.error('Add column failed', col, e.message); else console.log('[MIGRATION] Added column', col);
					});
				}
			}
			
			// Ensure photo columns
			db.all("PRAGMA table_info(photos)", (err2, photoCols) => {
				if (err2) { console.error('Inspect photos failed', err2.message); return resolve(); }
				const photoNeeded = ['date_taken','time_taken','location_id','detail_location','latitude','longitude','camera','lens','photographer'];
				for (const col of photoNeeded) {
					if (!photoCols.some(c => c.name === col)) {
						db.run(`ALTER TABLE photos ADD COLUMN ${col} TEXT`, (e) => {
							if (e) console.error('Add photo column failed', col, e.message); else console.log('[MIGRATION] Added photo column', col);
						});
					}
				}
				resolve();
			});
		});
	});
}


const { seedLocations } = require('./seed-locations');
const { recomputeRollSequence } = require('./services/roll-service');

async function cleanOrphanedPhotos() {
	return new Promise((resolve) => {
		db.run(`DELETE FROM photos WHERE roll_id NOT IN (SELECT id FROM rolls)`, function(err) {
			if (err) {
				console.error('[CLEANUP] Failed to remove orphaned photos:', err.message);
			} else if (this.changes > 0) {
				console.log(`[CLEANUP] Removed ${this.changes} orphaned photo(s)`);
			}
			resolve();
		});
	});
}

async function cleanInvalidRollGear() {
	return new Promise((resolve) => {
		db.run(`DELETE FROM roll_gear WHERE roll_id NOT IN (SELECT id FROM rolls)`, function(err) {
			if (err) {
				console.error('[CLEANUP] Failed to remove invalid roll_gear entries:', err.message);
			} else if (this.changes > 0) {
				console.log(`[CLEANUP] Removed ${this.changes} invalid roll_gear entry(ies)`);
			}
			resolve();
		});
	});
}

(async () => {
	try {
		await verifySchemaTables();
		await ensureExtraColumns();
		// Clean orphaned photos before migrations
		await cleanOrphanedPhotos();
		// Run roll_gear migration once on startup
		try {
			const addGear = require('./migrations/2025-11-30-add-roll-gear');
			await addGear.up();
			console.log('[MIGRATION] roll_gear ensured and backfilled');
		} catch(e){ console.error('[MIGRATION] roll_gear migration failed', e.message); }
		// Clean invalid roll_gear entries after migration
		await cleanInvalidRollGear();
		// Ensure display_seq column exists and compute initial sequence
		try {
			await recomputeRollSequence();
			console.log('[MIGRATION] display_seq column ensured and sequence computed');
		} catch(e){ console.error('[MIGRATION] display_seq initialization failed', e.message); }
		await seedLocations();
		mountRoutes();
		
		// Add graceful shutdown endpoint
		app.post('/api/shutdown', (req, res) => {
			console.log('[SERVER] Shutdown requested');
			res.json({ ok: true, message: 'Shutting down...' });
			// Close DB and exit after sending response
			setTimeout(() => {
				if (db.closeDB) {
					db.closeDB('shutdown_endpoint');
				} else {
					process.exit(0);
				}
			}, 100);
		});
		
		const PORT = process.env.PORT || 4000;
		// Listen on all interfaces (0.0.0.0) to allow mobile access
		const server = app.listen(PORT, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${PORT}`));
		
		// Graceful shutdown on signals
		const gracefulShutdown = (signal) => {
			console.log(`[SERVER] Received ${signal}, closing HTTP server...`);
			server.close(() => {
				console.log('[SERVER] HTTP server closed');
				if (db.closeDB) {
					db.closeDB(signal);
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
