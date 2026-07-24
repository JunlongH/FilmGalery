const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { isPathConfined } = require('/home/juno/FilmGallery/server/utils/path-security');

const uploadsDir = '/home/juno/FilmGallery/server/uploads';
const rollsDir = path.join(uploadsDir, 'rolls');
const staticOptions = { maxAge: '1y', immutable: true, etag: true, lastModified: true };
const thumbStaticOptions = { maxAge: '0', immutable: false, etag: true, lastModified: true };

const caseInsensitiveStatic = (root, options = {}) => {
  return (req, res, next) => {
    let decodedPath;
    try { decodedPath = decodeURIComponent(req.path); } catch (e) { decodedPath = req.path; }
    const filePath = path.join(root, decodedPath);
    if (!isPathConfined(root, decodedPath)) { console.log('[CI-STATIC] not confined, next'); return next(); }
    if (fs.existsSync(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        if (stats.isDirectory()) { console.log('[CI-STATIC] is dir, next'); return next(); }
      } catch (e) { console.log('[CI-STATIC] stat err, next'); return next(); }
      console.log('[CI-STATIC] FOUND, sending:', filePath);
      return res.sendFile(filePath, options, (err) => {
        if (err) {
          if (res.headersSent) { console.log('[CI-STATIC] err but headers sent'); return; }
          console.error('[CI-STATIC] sendFile err:', err.message);
          next();
        } else {
          console.log('[CI-STATIC] sendFile OK');
        }
      });
    }
    console.log('[CI-STATIC] not found:', filePath);
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        const match = files.find(f => f.toLowerCase() === base.toLowerCase());
        if (match) {
          const matchedPath = path.join(dir, match);
          console.log('[CI-STATIC] case-insensitive match:', matchedPath);
          return res.sendFile(matchedPath, options, (err) => {
            if (err) { if (res.headersSent) return; console.error('[CI-STATIC] err:', err.message); next(); }
            else console.log('[CI-STATIC] ci-match sendFile OK');
          });
        }
      } catch (e) { console.error('[CI-STATIC] readdir err:', e.message); }
    }
    next();
  };
};

const app = express();
app.use('/uploads/tmp', express.static('/tmp'));
app.use('/uploads/rolls', (req, res, next) => {
  if (/\/thumb\//.test(req.path)) {
    console.log('[THUMB-MW] thumb path, serving from rollsDir. req.path:', req.path);
    return express.static(rollsDir, thumbStaticOptions)(req, res, next);
  }
  console.log('[THUMB-MW] not thumb, next. req.path:', req.path);
  next();
});
app.use('/uploads', caseInsensitiveStatic(uploadsDir, staticOptions));
app.use('/uploads', express.static(uploadsDir, staticOptions));
app.use('/uploads/rolls', caseInsensitiveStatic(rollsDir, staticOptions));
app.use('/uploads/rolls', express.static(rollsDir, staticOptions));

// 模拟 auth（非 loopback 就 401）
app.use((req, res, next) => {
  const ip = req.ip;
  const isLoop = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  console.log('[AUTH-MOCK] ip:', ip, 'isLoop:', isLoop, 'path:', req.path);
  if (isLoop) return next();
  return res.status(401).json({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
});

const tlsCreds = {
  cert: fs.readFileSync('/home/juno/.filmgallery/certs/cert.pem'),
  key: fs.readFileSync('/home/juno/.filmgallery/certs/key.pem')
};
const server = https.createServer({ cert: tlsCreds.cert, key: tlsCreds.key }, app);
server.listen(0, '0.0.0.0', () => {
  const port = server.address().port;
  console.log('测试服务器启动在端口:', port);
  console.log('--- 测试 loopback ---');
  const req1 = https.request({ hostname: '127.0.0.1', port, path: '/uploads/rolls/testroll/thumb.jpg', method: 'GET', rejectUnauthorized: false }, (res) => {
    console.log('loopback 状态码:', res.statusCode);
    res.resume();
    console.log('--- 测试远端IP ---');
    const req2 = https.request({ hostname: '166.111.42.179', port, path: '/uploads/rolls/testroll/thumb.jpg', method: 'GET', rejectUnauthorized: false }, (res2) => {
      console.log('远端IP 状态码:', res2.statusCode);
      res2.resume();
      setTimeout(() => { server.close(); process.exit(0); }, 500);
    });
    req2.on('error', (e) => { console.error('远端请求错误:', e.message); process.exit(1); });
    req2.end();
  });
  req1.on('error', (e) => { console.error('loopback请求错误:', e.message); process.exit(1); });
  req1.end();
});
