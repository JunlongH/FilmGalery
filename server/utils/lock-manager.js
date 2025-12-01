const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDbPath } = require('../config/db-config');

const LOCK_FILE_NAME = 'film.db.lock';
const STALE_THRESHOLD_MS = 60 * 1000; // 1 minute heartbeat threshold

class LockManager {
  constructor() {
    const dbPath = getDbPath();
    this.lockPath = path.join(path.dirname(dbPath), LOCK_FILE_NAME);
    this.heartbeatInterval = null;
    this.machineId = `${os.hostname()}-${process.pid}`;
  }

  /**
   * Try to acquire the lock.
   * @returns {Promise<{acquired: boolean, message?: string}>}
   */
  async acquire() {
    try {
      console.log('[LockManager] Checking lock at:', this.lockPath);
      if (fs.existsSync(this.lockPath)) {
        // Check if stale or corrupt
        let stats;
        try {
          stats = fs.statSync(this.lockPath);
        } catch (e) {
          // If stat fails, maybe file is gone or permission error. Try to write.
          console.warn('[LockManager] Stat failed, assuming free:', e.message);
        }

        if (stats) {
          const age = Date.now() - stats.mtimeMs;
          let isValid = false;
          let owner = 'Unknown';

          try {
            const content = fs.readFileSync(this.lockPath, 'utf-8');
            if (content && content.trim()) {
              const data = JSON.parse(content);
              owner = data.owner;
              isValid = true;
            } else {
              console.warn('[LockManager] Lock file is empty/corrupt.');
            }
          } catch (e) {
            console.warn('[LockManager] Failed to parse lock file:', e.message);
          }

          if (isValid && age < STALE_THRESHOLD_MS) {
            // Lock is active and valid
            return { 
              acquired: false, 
              message: `Database is locked by another instance (${owner}). Please close it first.` 
            };
          } else {
            console.log(`[LockManager] Overwriting lock (Valid: ${isValid}, Age: ${age}ms)`);
          }
        }
      }

      // Write lock
      this.writeLock();
      
      // Start heartbeat
      this.startHeartbeat();
      
      return { acquired: true };
    } catch (err) {
      console.error('[LockManager] Error acquiring lock:', err);
      return { acquired: false, message: err.message };
    }
  }

  writeLock() {
    const data = {
      owner: this.machineId,
      timestamp: Date.now()
    };
    fs.writeFileSync(this.lockPath, JSON.stringify(data));
  }

  startHeartbeat() {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      try {
        // Update mtime to keep lock fresh
        const now = new Date();
        fs.utimesSync(this.lockPath, now, now);
      } catch (e) {
        console.error('[LockManager] Heartbeat failed:', e.message);
      }
    }, 10000); // Update every 10s
  }

  release() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    try {
      if (fs.existsSync(this.lockPath)) {
        // Only delete if we own it (optional safety, but for now just delete)
        fs.unlinkSync(this.lockPath);
        console.log('[LockManager] Lock released');
      }
    } catch (e) {
      console.error('[LockManager] Error releasing lock:', e.message);
    }
  }
}

module.exports = new LockManager();
