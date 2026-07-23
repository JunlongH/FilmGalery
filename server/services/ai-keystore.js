/**
 * 安全存储工具 — API Key 加密/解密
 *
 * 策略（Phase 0 决策）：
 *   - Electron 桌面模式：使用 safeStorage 加密 API key 后存入 SQLite
 *   - Docker/NAS 无桌面环境：keychain 不可用时强制走 AI_API_KEY 环境变量，DB 不存 key
 *
 * safeStorage 是 Electron 主进程 API，仅在 Electron 进程内可用。
 * 当 require('electron') 失败（独立 Node / Docker），降级为 env-only 模式。
 */

let _safeStorage = null;
let _safeStorageAvailable = null;

function getSafeStorage() {
  if (_safeStorageAvailable !== null) return _safeStorage;
  try {
    const electron = require('electron');
    if (electron.safeStorage && electron.safeStorage.isEncryptionAvailable()) {
      _safeStorage = electron.safeStorage;
      _safeStorageAvailable = true;
    } else {
      _safeStorageAvailable = false;
    }
  } catch {
    _safeStorageAvailable = false;
  }
  return _safeStorageAvailable;
}

/**
 * 加密 API key（仅在 safeStorage 可用时调用）
 * @param {string} plaintext
 * @returns {string} base64 编码的密文，带 'enc:' 前缀标识
 */
function encryptApiKey(plaintext) {
  if (!plaintext) return null;
  if (!getSafeStorage()) return null; // 不可加密 → 调用方不应存 DB
  const encrypted = _safeStorage.encryptString(plaintext);
  return 'enc:' + Buffer.from(encrypted).toString('base64');
}

/**
 * 解密 API key
 * @param {string} stored — DB 中存储的值（可能带 'enc:' 前缀，也可能是历史明文）
 * @returns {string} 明文 key
 */
function decryptApiKey(stored) {
  if (!stored) return null;
  // 历史明文 key（无前缀）直接返回
  if (!stored.startsWith('enc:')) return stored;
  if (!getSafeStorage()) return null; // 密文但无法解密（环境变化）
  try {
    const buf = Buffer.from(stored.slice(4), 'base64');
    return _safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

/**
 * 当前是否支持 safeStorage 加密
 */
function isEncryptionAvailable() {
  return getSafeStorage();
}

module.exports = { encryptApiKey, decryptApiKey, isEncryptionAvailable };
