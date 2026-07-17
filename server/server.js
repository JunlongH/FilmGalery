const express = require('express');
const bodyParser = require('body-parser');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
// const db = require('./db'); // MOVED: Loaded after migration
// Disable sharp cache to prevent file locking on Windows
sharp.cache(false);
const { uploadsDir, tmpUploadDir, localTmpDir, rollsDir } = require('./config/paths');
const { getDbPath } = require('./config/db-config');
const { runMigration } = require('./utils/migration');
const { runSchemaMigration } = require('./utils/schema-migration');
const { runEquipmentMigration } = require('./utils/equipment-migration');
const { runFilmStructMigration } = require('./utils/film-struct-migration');
const { cacheSeconds } = require('./utils/cache');
const { isPathConfined } = require('./utils/path-security');
const { requestProfiler, getProfilerStats, scheduleProfilerLog } = require('./utils/profiler');
const PreparedStmt = require('./utils/prepared-statements');
const { computeGuard } = require('./middleware/compute-guard');
const { getServerMode, getCapabilities, isComputeEnabled } = require('../packages/shared/serverCapabilities');

// Log server mode
const serverMode = getServerMode();
console.log(`[SERVER MODE] Running in ${serverMode.toUpperCase()} mode`);
console.log(`[SERVER MODE] Compute enabled: ${isComputeEnabled()}`);

console.log('[STORAGE CONFIG]', {
	DATA_ROOT: process.env.DATA_ROOT,
	UPLOADS_ROOT: process.env.UPLOADS_ROOT,
	USER_DATA: process.env.USER_DATA,
	resolvedDbPath: getDbPath(),
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
// Security headers. CSP is managed by the Electron shell; the server is an
// API + static-image host, so we keep cross-origin resource access open to
// preserve image loading from file:// (Electron), mobile, and hybrid NAS.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
// Generous global anti-abuse limiter (plenty for single-user local use)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests, please slow down.' },
});
app.use('/api', apiLimiter);
// lightweight request profiler for API
app.use(requestProfiler());
// Compute guard - blocks heavy routes in NAS mode
app.use(computeGuard);
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
// Thumbs are mutable (regenerated on re-export) — use short cache + revalidate.
// Originals/full are immutable — safe to cache aggressively.
const staticOptions = {
  maxAge: '1y',
  immutable: true,
  etag: true,
  lastModified: true
};
const thumbStaticOptions = {
  maxAge: '0',       // Always revalidate thumbs
  immutable: false,
  etag: true,
  lastModified: true
};

// Middleware to handle case-insensitive file serving on Windows/Linux mismatch
const caseInsensitiveStatic = (root, options = {}) => {
  return (req, res, next) => {
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch (e) {
      decodedPath = req.path;
    }
    
    const filePath = path.join(root, decodedPath);

    // SECURITY: reject paths that escape `root` via ".." or absolute segments
    if (!isPathConfined(root, decodedPath)) {
      return next();
    }

    // 1. Try exact match first
    if (fs.existsSync(filePath)) {
      // Check if it's a directory to avoid EISDIR
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) return next();
      } catch (e) { return next(); }

      return res.sendFile(filePath, options, (err) => {
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
          return res.sendFile(matchedPath, options, (err) => {
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

// Serve local temp uploads for previews (no long cache). Mount BEFORE /uploads.
app.use('/uploads/tmp', express.static(localTmpDir));

// Serve thumb directories with short-lived cache (thumbs are mutable — regenerated on re-export)
// Must be mounted BEFORE the generic /uploads route so it takes priority.
app.use('/uploads/rolls', (req, res, next) => {
  // Match paths like /{rollId}/thumb/... 
  if (/\/\d+\/thumb\//.test(req.path)) {
    return express.static(rollsDir, thumbStaticOptions)(req, res, next);
  }
  next();
});

app.use('/uploads', caseInsensitiveStatic(uploadsDir, staticOptions));
app.use('/uploads', express.static(uploadsDir, staticOptions));
app.use('/uploads/rolls', caseInsensitiveStatic(rollsDir, staticOptions));
app.use('/uploads/rolls', express.static(rollsDir, staticOptions));

// --- Routes (mount after schema is ensured just before listen) ---
const mountRoutes = () => {
  // short-lived response caching for relatively static endpoints
  app.use('/api/films', cacheSeconds(120), require('./routes/films'));
  app.use('/api/film-items', require('./routes/film-items')); // No server cache - let React Query handle it
  app.use('/api/tags', cacheSeconds(120), require('./routes/tags'));
  app.use('/api/locations', cacheSeconds(300), require('./routes/locations'));
  app.use('/api/stats', cacheSeconds(60), require('./routes/stats'));
  app.use('/api/equipment', cacheSeconds(120), require('./routes/equipment')); // Equipment management
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
  app.use('/api/health', require('./routes/health'));
  app.use('/api/export', require('./routes/export')); // Batch export queue
  app.use('/api/batch-render', require('./routes/batch-render')); // Batch render
  app.use('/api/batch-download', require('./routes/batch-download')); // Batch download
  app.use('/api/export-history', require('./routes/export-history')); // Export history
  app.use('/api/import', require('./routes/import')); // External positive import
  app.use('/api/luts', require('./routes/luts')); // LUT file management
  app.use('/api/edge-detection', require('./routes/edge-detection')); // Edge detection for auto-crop
  app.use('/api/raw', require('./routes/raw')); // RAW file decoding
  app.use('/api/filesystem', require('./routes/filesystem')); // Filesystem browsing for hybrid mode
  // Stricter limiter on billable AI endpoints
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'AI request limit reached, please slow down.' },
  });
  app.use('/api/ai', aiLimiter);
  app.use('/api/ai', require('./routes/ai-chat')); // AI assistant
  app.get('/api/_profiler', (req, res) => res.json(getProfilerStats()));
  app.get('/api/_prepared-statements', (req, res) => res.json(PreparedStmt.getStats()));
  
  // Port discovery API for mobile/watch auto-discovery
  // Also returns server capabilities for hybrid compute mode
  app.get('/api/discover', (req, res) => {
    const appInfo = require('./constants/app-info');
    const capabilities = getCapabilities();
    
    // Get mDNS status if available
    let mdnsStatus = null;
    try {
      const mdnsService = require('./services/mdns-service');
      mdnsStatus = mdnsService.getStatus();
    } catch (e) {
      // mDNS service not loaded yet
    }
    
    res.json({
      app: appInfo.APP_IDENTIFIER,
      version: appInfo.APP_VERSION,
      port: global.__actualServerPort || 4000,
      timestamp: Date.now(),
      // mDNS discovery info
      mdns: mdnsStatus,
      // Server capabilities for hybrid compute mode
      ...capabilities
    });
  });
  
  // Mount centralized error handling (must be after all routes)
  const { errorHandler, notFoundHandler } = require('./middleware/error-handler');
  app.use('/api/*', notFoundHandler); // 404 for unmatched API routes
  app.use(errorHandler); // Global error handler
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
  category TEXT,
  description TEXT,
  params TEXT,
  params_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS ai_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_base_url TEXT DEFAULT 'https://api.openai.com/v1',
  api_key TEXT,
  text_model TEXT DEFAULT 'gpt-4o-mini',
  vision_model TEXT DEFAULT 'gpt-4o',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 2048,
  monthly_budget_usd REAL DEFAULT 10.0,
  monthly_tokens_used INTEGER DEFAULT 0,
  allow_image_analysis INTEGER DEFAULT 1,
  image_max_resolution TEXT DEFAULT 'medium',
  confirm_before_write INTEGER DEFAULT 1,
  max_tool_calls_per_request INTEGER DEFAULT 15,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ai_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  platform TEXT DEFAULT 'desktop',
  context_snapshot TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  image_refs TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER,
  action_type TEXT NOT NULL,
  tool_name TEXT,
  tool_args TEXT,
  result_summary TEXT,
  old_values TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_prompt_shortcuts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  icon TEXT DEFAULT 'zap',
  sort_order INTEGER DEFAULT 0,
  scope TEXT DEFAULT 'general',
  is_built_in INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ai_prompt_shortcuts (id, label, prompt, icon, sort_order, scope, is_built_in) VALUES
  (1, '分析这张照片', '请分析这张照片的构图、曝光、色彩和整体表现，给出改进建议。', 'camera', 1, 'photo', 1),
  (2, '评价曝光', '请评价这张照片的曝光是否准确，高光和阴影细节如何？', 'sun', 2, 'photo', 1),
  (3, '构图建议', '请分析这张照片的构图，包括三分法、引导线、前景/背景层次，并给出改进建议。', 'grid-3x3', 3, 'photo', 1),
  (4, '胶片特性', '这张照片使用的胶片有什么特点？色彩表现如何？', 'film', 4, 'photo', 1),
  (5, '统计摘要', '请给我一个整体的摄影统计摘要，包括胶卷数量、最常用的相机和镜头。', 'bar-chart-2', 1, 'general', 1),
  (6, '最近拍摄', '我最近拍了什么？列出最近的胶卷和照片。', 'clock', 2, 'general', 1),
  (7, 'FilmLab 建议', '根据当前的编辑参数，你觉得这张照片的后期处理如何？有什么建议？', 'sliders-horizontal', 1, 'filmlab', 1);

CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'bot',
  description TEXT DEFAULT '',
  system_prompt TEXT NOT NULL,
  hidden_command TEXT DEFAULT '',
  starter_prompt TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  is_built_in INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ai_prompt_templates (id, name, icon, description, system_prompt, hidden_command, starter_prompt, is_default, is_built_in, sort_order) VALUES
  (1, '通用助手', 'bot', '友好的通用 AI 助手', '你是一个友好、专业、可靠的 AI 助手。回答要简洁、准确、可执行。信息不确定时必须明确说明。', 'skill=general.assistant; style=concise; truth=first; format=markdown_when_useful', '请先用 1 句话复述我的目标，再给出结构化回答。', 1, 1, 1),
  (2, '照片分析师', 'camera', '专业的摄影作品分析与改进建议', '你是一位专业的摄影评论家和技术分析师。擅长胶片摄影的构图分析、曝光评价、色彩解读。分析时先客观描述（EXIF/技术数据），再给出主观评价和改进建议。', 'skill=photo.analysis; style=structured; output=objective_then_subjective', '请先列出技术参数，再给出分析。', 0, 1, 2),
  (3, '数据管家', 'database', '高效的摄影数据管理与分析', '你是 FilmGallery 的数据管家。擅长查询、整理和分析摄影数据。帮助用户高效管理胶卷、照片标签、设备记录和胶片库存。执行操作前总是先搜索确认数据，避免错误修改。', 'skill=data.management; style=action_oriented; safety=query_before_modify', '告诉我你想管理什么数据，我会先查询现状再操作。', 0, 1, 3),
  (4, 'FilmLab 调色顾问', 'sliders-horizontal', '胶片冲扫调色的专业建议', '你是一位胶片冲扫和调色专家。了解各种胶片的色彩特性、反转负冲的影响、以及数字化调色的最佳实践。基于 FilmLab 的编辑参数（曝光/对比度/色温/饱和度等）提供调色建议。', 'skill=filmlab.grading; style=technical_with_examples; domain=color_science', '请描述你希望的画面风格，或者让我分析当前参数。', 0, 1, 4);

CREATE TABLE IF NOT EXISTS ai_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider TEXT DEFAULT 'openai',
  capabilities TEXT DEFAULT 'text',
  api_base_url TEXT,
  api_key TEXT,
  enabled INTEGER DEFAULT 1,
  is_default_text INTEGER DEFAULT 0,
  is_default_vision INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

// Seed locations if needed
const seedLocations = async () => {
	// ... (implementation if needed, or keep empty if handled elsewhere)
};

(async () => {
	try {
		// ========================================
		// MIGRATIONS DISABLED - Database is up to date
		// Uncomment these sections if you need to run migrations on older databases
		// ========================================
		
		/*
		// 1. Run Migration BEFORE loading DB
		console.log('[SERVER] Starting migration check...');
		await runMigration();
		console.log('[SERVER] Migration check complete.');

        // 2. Run Schema Migration (Systematic Update)
        console.log('[SERVER] Starting schema migration...');
        await runSchemaMigration();
        console.log('[SERVER] Schema migration complete.');

        // 2b. Run Equipment Migration (Cameras, Lenses, Flashes, Film Formats)
        console.log('[SERVER] Starting equipment migration...');
        await runEquipmentMigration();
        console.log('[SERVER] Equipment migration complete.');

        // 2c. Run Film Structure Migration (Brand, Format, Process)
        console.log('[SERVER] Starting film structure migration...');
        await runFilmStructMigration();
        console.log('[SERVER] Film structure migration complete.');
		*/
		
		console.log('[SERVER] Migrations skipped (database is up to date)');

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

		// Add graceful shutdown endpoint (localhost-only).
		// MUST be registered BEFORE mountRoutes() so the /api/* 404 catch-all
		// inside mountRoutes() does not shadow it.
		app.post('/api/shutdown', (req, res) => {
			// SECURITY: only allow shutdown from loopback (Electron / local tools)
			const remoteIp = (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
			if (!['127.0.0.1', '::1', 'localhost'].includes(remoteIp) && remoteIp !== '') {
				return res.status(403).json({ ok: false, error: 'Forbidden' });
			}
			console.log('[SERVER] Shutdown requested');
			res.json({ ok: true, message: 'Shutting down...' });
			// Close DB and exit after sending response
			setTimeout(() => {
				console.log('[SERVER] Closing database connection...');
        // Ensure WAL is checkpointed (or no-op in write-through) before exit
        PreparedStmt.finalizeAllWithCheckpoint().catch((err) => {
          console.error('[SERVER] finalizeAllWithCheckpoint error:', err && err.message ? err.message : err);
        });
				if (db && typeof db.close === 'function') {
					db.close((err) => {
						if (err) console.error('[SERVER] Error closing DB:', err);
						else console.log('[SERVER] Database closed.');
						process.exit(0);
					});
				} else {
					process.exit(0);
				}
			}, 100);
		});

		mountRoutes();

	// Port configuration:
		// - Dev mode (ELECTRON_DEV=true or explicit PORT): use fixed port for easier debugging
		// - Production mode (spawned by Electron): try ports starting from 4000
		const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_DEV === 'true';
		const explicitPort = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
		
		// Port range that mobile/watch apps will scan
		const PORT_RANGE = [4000, 4001, 4002, 4003, 4004, 4005, 4010, 4020, 4100];
		
		/**
		 * Try to listen on a port, returns a promise
		 */
		const tryListen = (port) => {
			return new Promise((resolve, reject) => {
				const server = app.listen(port, '0.0.0.0');
				server.once('listening', () => resolve(server));
				server.once('error', (err) => {
					if (err.code === 'EADDRINUSE') {
						reject(err);
					} else {
						reject(err);
					}
				});
			});
		};
		
		/**
		 * Find an available port from the range
		 */
		const findAvailablePort = async () => {
			// If explicit port is set, use it directly (wrap in promise to wait for listening)
			if (explicitPort) {
				return await tryListen(explicitPort);
			}
			
			// In dev mode, prefer 4000
			if (isDev) {
				try {
					return await tryListen(4000);
				} catch (e) {
					console.log('[SERVER] Port 4000 in use, trying alternatives...');
				}
			}
			
			// Try each port in the scan range
			for (const port of PORT_RANGE) {
				try {
					const server = await tryListen(port);
					return server;
				} catch (e) {
					console.log(`[SERVER] Port ${port} in use, trying next...`);
				}
			}
			
			// If all ports in range are taken, let OS assign one (fallback)
			console.warn('[SERVER] All preferred ports in use, using OS-assigned port');
			return await tryListen(0);
		};
		
		// Start server with port discovery
		const server = await findAvailablePort();
		const actualPort = server.address().port;
		
		// Store actual port globally for /api/discover endpoint
		global.__actualServerPort = actualPort;
		
		// Output special marker for electron-main.js to parse
		// This MUST be the first line of output to ensure reliable parsing
		console.log(`SERVER_PORT:${actualPort}`);
		console.log(`Server running on http://0.0.0.0:${actualPort}`);
		console.log('[PREPARED STATEMENTS] Ready for lazy initialization');
		scheduleProfilerLog();
		
		// Initialize mDNS service for LAN auto-discovery
		const mdnsService = require('./services/mdns-service');
		const appInfo = require('./constants/app-info');
		const mdnsEnabled = await mdnsService.initialize({
			port: actualPort,
			version: appInfo.APP_VERSION
		});
		if (mdnsEnabled) {
			console.log('[SERVER] mDNS auto-discovery enabled for LAN clients');
		}
		
		// Graceful shutdown on signals
		const gracefulShutdown = async (signal) => {
			console.log(`\n[SERVER] Received ${signal}. Shutting down gracefully...`);
			
			// Stop mDNS service first
			mdnsService.shutdown();
			
			// Force exit timeout
			const forceExitTimer = setTimeout(() => {
				console.error('[SERVER] ⚠️  Forced exit after 10 second timeout');
				process.exit(1);
			}, 10000);
			
			try {
				// Step 1: Stop accepting new connections
				await new Promise((resolve) => {
					server.close(() => {
						console.log('[SERVER] ✅ HTTP server closed.');
						resolve();
					});
				});
				
				// Step 2: Finalize prepared statements and checkpoint WAL
				await PreparedStmt.finalizeAllWithCheckpoint();
				
				// Step 3: Close database connection
				if (db && typeof db.close === 'function') {
					await new Promise((resolve, reject) => {
						db.close((err) => {
							if (err) {
								console.error('[SERVER] ❌ Error closing DB:', err);
								reject(err);
							} else {
								console.log('[SERVER] ✅ Database closed.');
								resolve();
							}
						});
					});
				}
				
				// Step 4: Verify WAL files are cleaned up
				const fs = require('fs');
				const { getDbPath } = require('./config/db-config');
				const dbPath = getDbPath();
				const walPath = dbPath + '-wal';
				const shmPath = dbPath + '-shm';
				
				setTimeout(() => {
					let filesRemaining = [];
					if (fs.existsSync(walPath)) filesRemaining.push('WAL');
					if (fs.existsSync(shmPath)) filesRemaining.push('SHM');
					
					if (filesRemaining.length > 0) {
						console.warn(`[SERVER] ⚠️  ${filesRemaining.join(', ')} files still exist (will be cleaned on next startup)`);
					} else {
						console.log('[SERVER] ✅ All database files cleaned up');
					}
					
					clearTimeout(forceExitTimer);
					console.log('[SERVER] 🎉 Graceful shutdown complete');
					process.exit(0);
				}, 500);
				
			} catch (err) {
				console.error('[SERVER] ❌ Error during shutdown:', err);
				clearTimeout(forceExitTimer);
				process.exit(1);
			}
		};
		
		process.on('SIGINT', () => gracefulShutdown('SIGINT'));
		process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
		
	} catch (e) {
		console.error('Failed to ensure DB schema', e);
		process.exit(1);
	}
})();
