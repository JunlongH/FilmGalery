## Film Gallery
### *A Film management software developed all by AI tools using vibe coding.*

**FilmGalery**
- **当前版本:** v1.3.0（已合并至 `main`）
- **发布说明:** 见 `docs/Release-1.3.0.md`

**Windows 构建（桌面端）**
- 前置条件：已安装 Node.js 18+、Git。
- 安装依赖：在仓库根目录运行：
	- `npm install`
	- 进入 `server/` 运行 `npm install`
	- 进入 `client/`（若需要重新打包前端）运行 `npm install`
- 开发运行：
	- 服务端：在 `server/` 运行 `node server.js`
	- 桌面端：在仓库根目录运行 `npm run start` 或双击 `run.bat`
- 生产构建（可选）：
	- 前端：在 `client/` 运行 `npm run build`，输出到 `client/build/`
	- Electron 打包：在根目录运行 `npm run build:electron`（如配置），生成安装包于 `build/`

**移动端构建（Android / Expo）**
- 前置条件：已安装 Node.js 18+、Git、Java/Android SDK（如需本地原生打包）。
- 安装依赖：在 `mobile/` 运行 `npm install`
- 开发运行（Expo）：在 `mobile/` 运行 `npm run start`，使用 Expo Go 或 Android 模拟器连接。
- 生产构建：
	- 使用 EAS：在 `mobile/` 运行 `npx eas build -p android` 生成 APK/AAB（需要登录并配置 EAS）。
	- 或使用本地 Gradle：在 `mobile/android/` 运行 `./gradlew assembleRelease`（需正确的签名与环境）。

仅提交源码与配置：`mobile/.gitignore` 已排除 `node_modules/` 与构建输出，请勿提交 APK/AAB、Android build 文件夹。
