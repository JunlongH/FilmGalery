# 7. 部署运维

## 7.1 生产环境部署

### 7.1.1 服务器部署

**环境准备：**
```bash
# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 安装 PM2（进程管理）
npm install -g pm2

# 克隆代码
git clone <repository-url> /opt/filmgallery
cd /opt/filmgallery
```

**安装依赖：**
```bash
cd server
npm install --production

# 构建 Sharp（原生模块）
npm rebuild sharp
```

**启动服务：**
```bash
# 使用 PM2 启动
pm2 start server.js --name filmgallery-server

# 开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs filmgallery-server

# 重启
pm2 restart filmgallery-server
```

**环境变量：**
```bash
# 创建 .env 文件
cat > /opt/filmgallery/server/.env << EOF
NODE_ENV=production
PORT=4000
DB_PATH=/data/filmgallery/film.db
UPLOADS_PATH=/data/filmgallery/uploads
EOF
```

### 7.1.2 Nginx 反向代理

```nginx
# /etc/nginx/sites-available/filmgallery
server {
    listen 80;
    server_name filmgallery.example.com;

    # API 代理
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # 大文件上传
        client_max_body_size 100M;
    }

    # 静态文件
    location /uploads {
        alias /data/filmgallery/uploads;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # 桌面端静态资源
    location / {
        root /opt/filmgallery/client/build;
        try_files $uri /index.html;
    }
}

# 启用站点
sudo ln -s /etc/nginx/sites-available/filmgallery /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 7.1.3 HTTPS 配置

```bash
# 使用 Let's Encrypt
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d filmgallery.example.com

# 自动续期
sudo crontab -e
0 3 * * * certbot renew --quiet
```

## 7.2 桌面端打包

### 7.2.1 Windows 打包

```bash
# 在根目录
npm run build-client  # 构建 React 应用
npm run dist          # 打包 Electron

# 输出位置
dist_v9/FilmGallery Setup 1.6.0.exe
```

**配置文件（package.json）：**
```json
{
  "build": {
    "appId": "com.yourorg.filmgallery",
    "productName": "FilmGallery",
    "win": {
      "target": ["nsis"],
      "icon": "assets/icon.ico"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    },
    "files": [
      "client/build/**/*",
      "electron-main.js",
      "electron-preload.js",
      "server/**/*",
      "!server/film.db",
      "!server/uploads/**"
    ]
  }
}
```

### 7.2.2 macOS 打包

```bash
npm run dist

# 输出
dist_v9/FilmGallery-1.6.0.dmg
```

**签名（可选）：**
```bash
# 需要 Apple Developer 账号
export CSC_LINK=path/to/certificate.p12
export CSC_KEY_PASSWORD=password
npm run dist
```

## 7.3 移动端打包

### 7.3.1 Android APK (EAS)

```bash
cd mobile

# 登录 Expo
npx eas-cli login

# 配置项目
npx eas build:configure

# 构建 APK（开发版）
npm run build:apk

# 构建 AAB（生产版）
npm run build:aab
```

**配置文件（eas.json）：**
```json
{
  "build": {
    "preview": {
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "android": {
        "buildType": "app-bundle"
      }
    }
  }
}
```

### 7.3.2 本地构建

```bash
cd mobile/android

# 生成签名密钥
keytool -genkeypair -v -storetype PKCS12 \
  -keystore filmgallery.keystore \
  -alias filmgallery \
  -keyalg RSA -keysize 2048 -validity 10000

# 配置签名
# android/gradle.properties
MYAPP_RELEASE_STORE_FILE=filmgallery.keystore
MYAPP_RELEASE_KEY_ALIAS=filmgallery
MYAPP_RELEASE_STORE_PASSWORD=***
MYAPP_RELEASE_KEY_PASSWORD=***

# 构建
./gradlew assembleRelease

# 输出
# android/app/build/outputs/apk/release/app-release.apk
```

## 7.4 数据库维护

### 7.4.1 备份策略

```bash
# 每日备份脚本
#!/bin/bash
DATE=$(date +%Y%m%d)
BACKUP_DIR=/backup/filmgallery
DB_PATH=/data/filmgallery/film.db

# 创建备份目录
mkdir -p $BACKUP_DIR

# 备份数据库（包括 WAL）
sqlite3 $DB_PATH "PRAGMA wal_checkpoint(FULL);"
cp $DB_PATH $BACKUP_DIR/film-${DATE}.db
cp $DB_PATH-wal $BACKUP_DIR/film-${DATE}.db-wal 2>/dev/null || true

# 压缩
gzip $BACKUP_DIR/film-${DATE}.db

# 删除 30 天前的备份
find $BACKUP_DIR -name "film-*.db.gz" -mtime +30 -delete

# 添加到 crontab
0 2 * * * /opt/filmgallery/backup.sh
```

### 7.4.2 数据库优化

```bash
# 清理 WAL 文件
sqlite3 film.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 压缩数据库
sqlite3 film.db "VACUUM;"

# 分析查询计划
sqlite3 film.db "ANALYZE;"

# 检查完整性
sqlite3 film.db "PRAGMA integrity_check;"
```

### 7.4.3 迁移数据

```bash
# 导出数据
sqlite3 film.db .dump > backup.sql

# 导入到新数据库
sqlite3 new-film.db < backup.sql

# 仅导出特定表
sqlite3 film.db <<EOF
.output photos.sql
.dump photos
EOF
```

## 7.5 监控与日志

### 7.5.1 应用监控

```javascript
// server/server.js
const os = require('os');

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cpu: os.loadavg(),
    database: db ? 'connected' : 'disconnected'
  });
});

// PM2 监控
pm2 monit
```

### 7.5.2 日志管理

```bash
# PM2 日志
pm2 logs filmgallery-server --lines 100

# 日志轮转
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# 查看错误日志
tail -f ~/.pm2/logs/filmgallery-server-error.log
```

### 7.5.3 性能分析

```javascript
// 查看 Prepared Statements 性能
GET /api/_prepared-statements

// 查看请求分析
GET /api/_profiler

// 响应示例
{
  "statements": {
    "photos.getById": { "hits": 1250, "avgTime": 2.3 },
    "tags.insert": { "hits": 450, "avgTime": 1.1 }
  },
  "requests": {
    "/api/rolls": { "count": 89, "avgTime": 45.2 }
  }
}
```

## 7.6 OneDrive 同步

### 7.6.1 同步配置

```bash
# 将数据库目录放在 OneDrive
mklink /D "D:\OneDrive\FilmGallery" "C:\ProgramData\FilmGallery"

# 或使用环境变量
DB_PATH=D:\OneDrive\FilmGallery\film.db
```

### 7.6.2 WAL Checkpoint

```javascript
// server/db.js
// 每 5 分钟执行一次 checkpoint
setInterval(() => {
  db.run('PRAGMA wal_checkpoint(PASSIVE)', (err) => {
    if (err) {
      console.error('[DB] Checkpoint failed:', err);
    } else {
      console.log('[DB] Checkpoint completed');
    }
  });
}, 5 * 60 * 1000);
```

### 7.6.3 冲突处理

```bash
# 自动清理冲突文件
node server/conflict-resolver.js

# 手动合并
sqlite3 film.db ".backup film-backup.db"
sqlite3 film-conflict.db ".dump" | sqlite3 film.db
```

## 7.7 安全最佳实践

### 7.7.1 服务器安全

```bash
# 限制文件权限
chmod 700 /data/filmgallery
chown -R filmgallery:filmgallery /data/filmgallery

# 防火墙配置
sudo ufw allow 22    # SSH
sudo ufw allow 80    # HTTP
sudo ufw allow 443   # HTTPS
sudo ufw enable

# 禁用不必要的端口
# 不要直接暴露 4000 端口到公网
```

### 7.7.2 数据库安全

```javascript
// 使用 Prepared Statements 防止 SQL 注入
const stmt = db.prepare('SELECT * FROM photos WHERE id = ?');
stmt.get([userId]); // 安全

// 不要这样做
db.all(`SELECT * FROM photos WHERE id = ${userId}`); // 危险！
```

### 7.7.3 文件上传安全

```javascript
// 限制文件类型
const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

// 限制文件大小
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  }
});

// 重命名上传文件（防止路径遍历）
const safeName = path.basename(file.originalname);
const uuid = require('uuid').v4();
const fileName = `${uuid}-${safeName}`;
```

## 7.8 性能优化

### 7.8.1 数据库优化

```sql
-- 创建索引
CREATE INDEX idx_photos_roll_rating ON photos(roll_id, rating);
CREATE INDEX idx_photos_date ON photos(date_taken);

-- 使用 Prepared Statements
-- 缓存查询计划，减少解析开销

-- WAL 模式
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

### 7.8.2 图片优化

```javascript
// 生成多种尺寸
await sharp(input)
  .resize(1920, 1920, { fit: 'inside' })
  .jpeg({ quality: 85 })
  .toFile(fullPath);

await sharp(input)
  .resize(400, 400, { fit: 'cover' })
  .jpeg({ quality: 80 })
  .toFile(thumbPath);

// WebP 格式（可选）
await sharp(input)
  .resize(800)
  .webp({ quality: 80 })
  .toFile(webpPath);
```

### 7.8.3 缓存策略

```javascript
// HTTP 缓存头
app.use('/uploads', express.static('uploads', {
  maxAge: '7d',
  immutable: true
}));

// React Query 缓存
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,  // 5 分钟
      cacheTime: 10 * 60 * 1000  // 10 分钟
    }
  }
});
```

## 7.9 故障恢复

### 7.9.1 数据库损坏

```bash
# 尝试修复
sqlite3 film.db "PRAGMA integrity_check;"

# 恢复备份
cp /backup/film-20251203.db.gz ./
gunzip film-20251203.db.gz
cp film-20251203.db film.db

# 重建索引
sqlite3 film.db "REINDEX;"
```

### 7.9.2 服务崩溃

```bash
# PM2 自动重启
pm2 start server.js --name filmgallery --max-restarts 10

# 查看崩溃日志
pm2 logs filmgallery --err

# 清除所有进程
pm2 delete all
pm2 start server.js --name filmgallery
```

### 7.9.3 磁盘空间不足

```bash
# 清理旧日志
pm2 flush

# 清理临时文件
rm -rf server/uploads/temp/*

# 压缩旧照片
find server/uploads -name "*.jpg" -mtime +180 -exec \
  mogrify -quality 80 {} \;

# 删除重复文件（需手动确认）
fdupes -r server/uploads
```

## 7.10 更新与升级

### 7.10.1 版本更新流程

```bash
# 1. 备份数据
./backup.sh

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
cd server && npm install
cd ../client && npm install

# 4. 运行迁移（自动）
cd ../server && node server.js

# 5. 重启服务
pm2 restart filmgallery-server

# 6. 验证
curl http://localhost:4000/api/health
```

### 7.10.2 回滚版本

```bash
# 查看版本
git log --oneline

# 回滚到特定版本
git checkout <commit-hash>

# 恢复数据库备份
cp /backup/film-<date>.db film.db

# 重启服务
pm2 restart filmgallery-server
```

---

**🎉 恭喜！你已完成 FilmGallery 开发手册的阅读。**

有问题？查看：
- [GitHub Issues](https://github.com/JunlongH/FilmGalery/issues)
- [项目 Wiki](https://github.com/JunlongH/FilmGalery/wiki)
