/**
 * Filesystem Browser API
 * 
 * 提供服务器端文件系统浏览功能，支持混合模式下的远程路径选择
 * 
 * 三种访问模式:
 * 1. 白名单模式 (默认): ALLOWED_BROWSE_PATHS 指定允许的目录
 * 2. 挂载目录模式: ALLOW_ALL_MOUNTED_PATHS=true 允许所有 /mnt 下的目录
 * 3. 完全开放模式: FILESYSTEM_OPEN_MODE=true 允许所有路径(危险!)
 * 
 * 安全限制:
 * - 敏感系统目录始终被阻止
 * - 只返回目录结构，不暴露文件内容
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

// Path access control — single source of truth (server/utils/path-security.js)
const {
  isPathBlocked,
  isPathAllowed,
  getAllowedPaths,
} = require('../utils/path-security');

/**
 * GET /api/filesystem/roots
 * 获取可浏览的根目录列表
 */
router.get('/roots', (req, res) => {
  try {
    const roots = getAllowedPaths().map(p => ({
      path: p,
      name: path.basename(p) || p,
      type: 'directory'
    }));
    
    res.json({
      ok: true,
      roots,
      serverMode: process.env.SERVER_MODE || 'standalone'
    });
  } catch (err) {
    console.error('[Filesystem] Error getting roots:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/filesystem/browse
 * 浏览指定目录的内容
 * 
 * Query params:
 * - path: 要浏览的目录路径
 * - showFiles: 是否显示文件 (默认 true)
 * - filter: 文件扩展名过滤 (如 "jpg,jpeg,tif,tiff")
 */
router.get('/browse', (req, res) => {
  try {
    const targetPath = req.query.path;
    const showFiles = req.query.showFiles !== 'false';
    const filter = req.query.filter ? req.query.filter.toLowerCase().split(',') : null;
    
    if (!targetPath) {
      return res.status(400).json({ ok: false, error: 'Path is required' });
    }
    
    // 安全检查
    if (isPathBlocked(targetPath)) {
      return res.status(403).json({ ok: false, error: 'Access denied to system path' });
    }
    
    if (!isPathAllowed(targetPath)) {
      return res.status(403).json({ 
        ok: false, 
        error: 'Path not in allowed list',
        hint: 'Configure ALLOWED_BROWSE_PATHS environment variable'
      });
    }
    
    // 检查路径是否存在
    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ ok: false, error: 'Path does not exist' });
    }
    
    const stat = fs.statSync(targetPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ ok: false, error: 'Path is not a directory' });
    }
    
    // 读取目录内容
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    
    const items = [];
    for (const entry of entries) {
      // 跳过隐藏文件
      if (entry.name.startsWith('.')) continue;
      
      const fullPath = path.join(targetPath, entry.name);
      
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          // 检查是否有子目录（用于 UI 显示展开箭头）
          hasChildren: hasSubdirectories(fullPath)
        });
      } else if (showFiles && entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1);
        
        // 如果有过滤器，检查扩展名
        if (filter && !filter.includes(ext)) continue;
        
        try {
          const fileStat = fs.statSync(fullPath);
          items.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
            size: fileStat.size,
            ext,
            modified: fileStat.mtime
          });
        } catch {
          // 跳过无法访问的文件
        }
      }
    }
    
    // 排序: 目录在前，文件在后，按名称排序
    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    
    res.json({
      ok: true,
      path: targetPath,
      parent: path.dirname(targetPath),
      canGoUp: isPathAllowed(path.dirname(targetPath)),
      items
    });
  } catch (err) {
    console.error('[Filesystem] Error browsing:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/filesystem/validate
 * 验证路径是否有效且可访问
 */
router.post('/validate', (req, res) => {
  try {
    const { path: targetPath, mustBeDirectory = true, mustBeWritable = false } = req.body;
    
    if (!targetPath) {
      return res.status(400).json({ ok: false, error: 'Path is required' });
    }
    
    // 安全检查
    if (isPathBlocked(targetPath)) {
      return res.json({ 
        ok: false, 
        valid: false, 
        error: 'Access denied to system path' 
      });
    }
    
    if (!isPathAllowed(targetPath)) {
      return res.json({ 
        ok: false, 
        valid: false, 
        error: 'Path not in allowed list' 
      });
    }
    
    // 检查路径是否存在
    if (!fs.existsSync(targetPath)) {
      return res.json({ ok: true, valid: false, error: 'Path does not exist' });
    }
    
    const stat = fs.statSync(targetPath);
    
    if (mustBeDirectory && !stat.isDirectory()) {
      return res.json({ ok: true, valid: false, error: 'Path is not a directory' });
    }
    
    // 检查写入权限
    if (mustBeWritable) {
      try {
        fs.accessSync(targetPath, fs.constants.W_OK);
      } catch {
        return res.json({ ok: true, valid: false, error: 'Path is not writable' });
      }
    }
    
    res.json({ 
      ok: true, 
      valid: true,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      size: stat.size,
      modified: stat.mtime
    });
  } catch (err) {
    console.error('[Filesystem] Error validating:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/filesystem/mkdir
 * 创建目录
 */
router.post('/mkdir', (req, res) => {
  try {
    const { path: targetPath } = req.body;
    
    if (!targetPath) {
      return res.status(400).json({ ok: false, error: 'Path is required' });
    }
    
    // 安全检查
    if (isPathBlocked(targetPath)) {
      return res.status(403).json({ ok: false, error: 'Access denied' });
    }
    
    if (!isPathAllowed(targetPath)) {
      return res.status(403).json({ ok: false, error: 'Path not in allowed list' });
    }
    
    // 创建目录
    fs.mkdirSync(targetPath, { recursive: true });
    
    res.json({ ok: true, path: targetPath });
  } catch (err) {
    console.error('[Filesystem] Error creating directory:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Helper: 检查目录是否有子目录
function hasSubdirectories(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some(e => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return false;
  }
}

module.exports = router;
