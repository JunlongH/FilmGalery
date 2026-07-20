---
name: desktop-ci-build
description: Use when building Windows/macOS/Linux desktop installers via GitHub Actions for the FilmGallery Electron app (Electron 26 + electron-builder + native modules). Covers the CRA→Vite migration lockfile pitfalls, Windows VS 2026 Preview detection failure (pin windows-2022), macOS libraw linker path (LIBRARY_PATH), npm ci vs npm install with platform-specific native binaries (rolldown), PowerShell vs bash on Windows runners, GitHub release creation via gh CLI (not softprops), and log diagnosis via GitHub MCP token. Trigger keywords: electron-builder, windows exe, nsis, AppImage, deb, CI build failure, GitHub Actions, release, rolldown, vite build, node-gyp, visual studio not found, npm ci lockfile sync.
---

# Desktop CI build & release (GitHub Actions)

Hard-won playbook for building the FilmGallery Electron desktop app across
Windows / macOS / Linux via GitHub Actions. Every fact below was verified
by producing working installers on all three platforms.

## 0. Architecture

```
.github/workflows/
  ci.yml              — lint + jest + mobile typecheck (push/PR gate)
  build-linux.yml     — Linux .deb + .AppImage (push + tag)
  build-desktop.yml   — Win + Mac + Linux matrix (tag only)
                        build-desktop (client-only) + build-desktop-full (with server)
                        release job aggregates artifacts → gh release create
  build-mobile.yml    — EAS Cloud (needs Expo credentials)
```

Build chain: `npm install` → `npm run build-client` (Vite) → `npm run rebuild:electron` (native for Electron ABI) → `npx electron-builder --<platform> --publish never` → `gh release create`.

## 1. The install step — the #1 source of CI failures

### Rule: three-step install, never rely on postinstall

```yaml
- name: Install root dependencies
  run: npm install --legacy-peer-deps --ignore-scripts

- name: Install client dependencies
  shell: bash
  run: |
    cd client
    rm -rf node_modules package-lock.json
    npm install --legacy-peer-deps

- name: Install server dependencies
  run: |
    cd server
    npm install --legacy-peer-deps
```

**Why `--ignore-scripts` on root only:** The root `postinstall` (`cd client && npm install && cd ../server && npm install`) spawns nested installs that:
- Run WITHOUT `--legacy-peer-deps` (the flag doesn't propagate to postinstall)
- Hit peer-dep conflicts in the React/Electron tree
- On Win/Mac, try to compile native modules without system headers

**Why `rm -rf node_modules package-lock.json` on client:** The client migrated from CRA to Vite. The GitHub Actions npm cache (`setup-node@v4` with `cache: npm`) can restore STALE CRA-era node_modules (with react-scripts/craco) that survive a subsequent `npm install`. Deleting both node_modules AND the lockfile ensures:
- No stale react-scripts/craco packages
- Fresh resolution of platform-specific optional dependencies (rolldown native binaries)

**Why `--legacy-peer-deps` everywhere:** The project has React 19 + React Native + Electron + canvas, which have unsolvable peer-dep conflicts. A root `.npmrc` with `legacy-peer-deps=true` covers local dev, but CI sub-installs don't inherit it (npm only reads `.npmrc` from cwd, not parent dirs).

### `npm ci` vs `npm install` — use install, not ci

`npm ci` is theoretically better (clean, reproducible) but fails when:
- The lockfile has platform-specific entries missing (file: deps resolved differently)
- The lockfile was regenerated on one platform (Linux) and CI runs on another (Win/Mac)
- The package.json has been modified but lockfile not yet updated

Use `rm -rf node_modules && npm install` instead. It achieves the same clean state without the strict lockfile sync requirement.

## 2. Platform-specific gotchas

### Windows: pin to `windows-2022`, not `windows-latest`

`windows-latest` now includes Visual Studio 18 (2026 Preview). `@electron/node-gyp` (pinned to Electron 26) only recognizes up to VS 17 (2022). The error:

```
gyp ERR! find VS unknown version "undefined" found at "C:\Program Files\Microsoft Visual Studio\18\Enterprise"
```

**Fix:** Always pin `windows-2022` in the matrix:
```yaml
- os: windows-2022
  platform: win
```

### Windows: `shell: bash` for any step using Unix commands

Windows runners default to PowerShell. Commands like `rm -rf`, `set -o pipefail`, `find`, `tee` silently fail or produce wrong results.

```yaml
- name: Any step with Unix commands
  shell: bash
  run: |
    rm -rf node_modules
    find . -name "*.exe" -delete
```

### Windows: Python setup for node-gyp

node-gyp needs Python AND MSVC. The runner's default Python isn't always on PATH for node-gyp's detection logic. Pin it:

```yaml
- uses: actions/setup-python@v5
  with:
    python-version: '3.11'
```

### macOS: `LIBRARY_PATH` for Homebrew libraries

Homebrew installs to `/opt/homebrew/lib` (Apple Silicon) or `/usr/local/lib` (Intel). Native modules that link `-l<lib>` via binding.gyp don't tell the linker WHERE to find the library. The error:

```
ld: library 'raw' not found
```

**Fix:** Set `LIBRARY_PATH` (clang/gcc link-time search path) in the rebuild step:

```yaml
- name: Rebuild native modules for Electron ABI
  shell: bash
  env:
    LIBRARY_PATH: "${{ matrix.platform == 'mac' && '/opt/homebrew/lib' || '' }}"
  run: npm run rebuild:electron
```

### Linux: system deps required

```yaml
- name: Install Linux native build deps
  if: matrix.platform == 'linux'
  run: sudo apt-get update && sudo apt-get install -y libraw-dev libvips-dev
```

### macOS: Homebrew deps

```yaml
- name: Install macOS native build deps
  if: matrix.platform == 'mac'
  run: brew install libraw vips
```

## 3. Vite 8 + rolldown: platform-specific native binary

Vite 8 uses `rolldown` (a Rust-based bundler) with platform-specific native
binaries (`rolldown-binding.win32-x64-msvc.node`, etc.). These are installed
as optional dependencies.

**The problem:** A lockfile generated on Linux only includes the Linux binary.
`npm install` on Windows can't find `rolldown-binding.win32-x64-msvc.node`.

**The fix:** Delete `package-lock.json` before install on non-Linux platforms
(or on all platforms for simplicity):

```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
```

This lets each platform resolve its own optional dependencies fresh.

## 4. CRA → Vite migration: the lockfile trap

When migrating from `react-scripts` (CRA) to `vite`:

1. **Regenerate the lockfile** — the old lockfile contains react-scripts, craco, webpack, and 1300+ transitive deps that Vite doesn't need
2. **Commit BOTH package.json AND package-lock.json** — a lockfile without the matching package.json (or vice versa) causes `npm ci` to fail with "Missing: X from lock file"
3. **Move `index.html`** from `public/index.html` (CRA convention) to project root `index.html` (Vite convention)
4. **Clear CI npm cache** — the GitHub Actions cache key is based on the lockfile hash. If the lockfile changes, the cache should invalidate. But the cache can restore OLD node_modules that still have react-scripts. Use `rm -rf node_modules` before install.

**The `build-client` vs `build` distinction:** The root `build` script may
include steps that reference files not in git (e.g. `build:gpu` → `node
electron-gpu/build.js`). Always use `npm run build-client` in CI, not
`npm run build`, unless every sub-step is verified.

## 5. Release creation: use `gh` CLI, not softprops

### Why not `softprops/action-gh-release@v1`

softprops v1 has asset-collision issues on re-runs:
- It tries to delete existing assets then re-upload in parallel
- Some assets get deleted, others don't (race condition)
- The second upload attempt hits 422 "already_exists"
- The overall step fails even though most assets uploaded fine

### The `gh` CLI approach

```yaml
release:
  needs: [build-desktop, build-desktop-full]
  runs-on: ubuntu-latest
  if: startsWith(github.ref, 'refs/tags/v')
  permissions:
    contents: write
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: artifacts
    - name: Create or update release
      continue-on-error: true
      run: |
        INSTALLERS=()
        while IFS= read -r f; do
          INSTALLERS+=("$f")
        done < <(find artifacts/ -type f \( -name "*.exe" -o -name "*.dmg" -o -name "*.AppImage" -o -name "*.deb" -o -name "*.zip" \) | sort)
        gh release create "${{ github.ref_name }}" "${INSTALLERS[@]}" \
          --repo "${{ github.repository }}" \
          --draft \
          --generate-notes \
          || gh release upload "${{ github.ref_name }}" "${INSTALLERS[@]}" --repo "${{ github.repository }}" --clobber
      env:
        GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Key points:
- **`permissions: contents: write`** — GitHub's 2023 default-token tightening made releases need explicit write permission
- **`--repo` flag** — the release job has no `checkout`, so `gh` can't detect the repo from `.git`
- **Bash array for filenames with spaces** — `FilmGallery Setup 3.3.0.exe` has spaces; unquoted `$INSTALLERS` word-splits into three args
- **`|| gh release upload --clobber`** — handles both fresh-create and re-run (overwrite) scenarios
- **`continue-on-error: true`** — release hiccups shouldn't mask that all 6 build jobs succeeded
- **Filter to installer files only** — skip electron-builder metadata (`latest*.yml`) that causes noise

### Race condition: only ONE workflow should create releases

If both `build-linux.yml` and `build-desktop.yml` trigger on tags and both have release steps, they race to create the same release → 422 collisions. Designate ONE workflow (build-desktop.yml) as the release owner; others only upload artifacts.

## 6. `--publish never` on electron-builder

electron-builder auto-publishes to GitHub releases when `GH_TOKEN` is set AND the build is on a tag. This collides with the explicit release step. Always pass:

```
npx electron-builder --<platform> --publish never
```

## 7. Diagnosing CI failures without web UI access

### GitHub MCP token for log access

The GitHub REST API requires authentication for log/artifact downloads. A fine-grained PAT with `Actions: Read` + `Contents: Read` is sufficient for diagnosis.

```bash
# Get failing job's log
JOB_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/actions/runs/$RUN_ID/jobs" \
  | python3 -c "import sys,json; ...")
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OWNER/REPO/actions/jobs/$JOB_ID/logs" \
  -o /tmp/job.log

# Download jest JSON results artifact
curl -sL -H "Authorization: Bearer $TOKEN" \
  "$ARTIFACT_URL" -o results.zip
```

### Capturing CI-only test failures

Tests that pass locally but fail on CI are usually environment-specific. Capture jest JSON output as an artifact:

```yaml
- name: Test
  run: npm test -- --json --outputFile=/tmp/jest-results.json --silent || true
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: jest-results
    path: /tmp/jest-results.json
```

### Common CI-only test failures

| Pattern | Cause | Fix |
|---------|-------|-----|
| ORDER BY tie-break flaky | Same-millisecond timestamps | `ORDER BY col DESC, id DESC` |
| Module not found in jest | Workspace file: dep loaded from source path, not node_modules | `modulePaths: ['<rootDir>/node_modules']` in jest config |
| TypeScript type error on CI but not local | Different @types versions resolved | Add explicit dep in package.json |
| ESLint errors on CI but not local | `CI=true` makes CRA treat warnings as errors | Fix the warnings or set `CI=false` |

## 8. The `git add -A` pitfall

When working in a shared repository with parallel agents/sessions:

- **NEVER use `git add -A`** blindly — it sweeps in all working-tree changes including other agents' incomplete work
- **Always specify exact files:** `git add .github/workflows/build-desktop.yml client/src/api/pairing.js`
- **Before committing, check:** `git diff --cached --stat` to see exactly what's staged
- If untracked files from parallel work appear, leave them untouched

Symptoms of swept-in parallel work:
- Build fails referencing files that don't exist in your mental model (e.g. `electron-gpu/build.js`)
- `package.json` has scripts you didn't write (e.g. `build:gpu`)
- Lockfiles out of sync because the migration was disk-only, never committed

## 9. electron-builder local build (when CI is slow)

For immediate local builds (Linux only — Windows cross-compile needs wine32):

```bash
# Rebuild native for Electron ABI
npm run rebuild:electron

# Build Linux installer
npx electron-builder --linux deb

# Build Windows portable (cross-compile, needs wine + rcedit-x64 swap)
npx electron-builder --win portable

# If GitHub binary downloads timeout (China network):
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
  npx electron-builder --linux
```

### Windows NSIS cross-compile on Linux (without wine32)

The NSIS installer target requires wine32 to finalize the installer payload embedding. Without sudo for `apt install wine32:i386`:

1. Use `portable` target instead (single .exe, no installer UX)
2. OR swap `rcedit-ia32.exe` → `rcedit-x64.exe` in the winCodeSign cache (wine64 can run x64 binaries)
3. OR push a tag and let GitHub Actions build natively on `windows-2022`

## 10. Mobile Android build — EAS quota exhaustion + local fallback

### The problem: EAS Free plan monthly quota

EAS (Expo Application Services) Cloud builds have a monthly limit on the
Free plan (30 Android builds / 15 iOS builds). When exhausted:

```
This account has used its Android builds from the Free plan this month,
which will reset in N days. Upgrade your plan for more builds...
Error: build command failed.
```

### The fix: local gradle build on the GitHub Actions runner

`ubuntu-latest` has the Android SDK pre-installed. Build the APK locally
as a fallback when EAS fails:

```yaml
# Step 1: try EAS first (fast, offloaded to cloud)
- name: Build Android APK (EAS Cloud)
  id: eas
  continue-on-error: true
  run: cd mobile && npx eas build -p android --profile preview --non-interactive
  env:
    EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}

# Step 2: fallback to local gradle build
- name: Build Android APK locally (EAS fallback)
  if: steps.eas.outcome == 'failure'
  working-directory: mobile
  run: |
    npx expo prebuild --platform android --clean --no-install
    cd android
    echo "sdk.dir=${ANDROID_HOME}" > local.properties
    ./gradlew assembleDebug --no-daemon

- name: Upload APK
  if: steps.eas.outcome == 'failure'
  uses: actions/upload-artifact@v4
  with:
    name: android-apk
    path: mobile/android/app/build/outputs/apk/debug/*.apk
```

Key points:
- **`continue-on-error: true`** on EAS step — the job doesn't fail when
  quota is exhausted. `steps.eas.outcome` is `'failure'`, triggering the
  fallback.
- **Java 17 required** — `actions/setup-java@v4` with `zulu` distribution.
  Gradle 8.x needs JDK 17+.
- **`expo prebuild --clean`** — regenerates the native Android project
  from app.json (needed because the `android/` dir might be stale or
  git-ignored prebuild artifacts).
- **`assembleDebug`** not `assembleRelease` — release builds need a
  keystore (not available on CI without secrets). Debug-signed APK is
  fine for sideloading.
- **Build time: ~22 min** on ubuntu-latest (vs ~3 min for EAS Cloud).
  The first build downloads Gradle + compiles all native modules.
- **iOS cannot be built locally on Linux** — requires macOS. Use
  `continue-on-error: true` on the iOS EAS step so the overall workflow
  passes when Android succeeds even if iOS quota is exhausted.
- **APK is ~65MB** (debug build with all ABIs: armeabi-v7a, x86, x86_64).

### `gh release upload` for APK

Attach the APK to the tag's release:

```yaml
- name: Attach APK to release
  if: steps.eas.outcome == 'failure' && startsWith(github.ref, 'refs/tags/v')
  run: |
    APK=$(find mobile/android/app/build/outputs -name "*.apk" | head -1)
    if [ -n "$APK" ]; then
      gh release upload "${{ github.ref_name }}" "$APK" \
        --repo "${{ github.repository }}" --clobber || true
    fi
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 11. Quick troubleshooting matrix

| Error | Root cause | Fix |
|-------|-----------|-----|
| `npm ci: Missing X from lock file` | package.json modified but lockfile not regenerated | `rm package-lock.json && npm install` then commit both |
| `Could not find a required file: index.html in public/` | CRA convention, but project migrated to Vite | Ensure `build` script is `vite build` not `craco build`; verify `index.html` is at project root |
| `Cannot find module 'rolldown-binding.win32-x64-msvc.node'` | Lockfile generated on Linux, missing Win optional dep | `rm -rf node_modules package-lock.json && npm install` |
| `gyp ERR! find VS unknown version "undefined"` | VS 2026 Preview on windows-latest | Pin to `windows-2022` |
| `ld: library 'raw' not found` (macOS) | Homebrew lib path not in linker search | `LIBRARY_PATH=/opt/homebrew/lib` |
| `Cannot bind parameter 'Option' ... 'pipefail'` | PowerShell can't parse bash syntax | Add `shell: bash` to the step |
| `Failed to upload release asset. 422 already_exists` | softprops race condition on re-runs | Switch to `gh release create/upload --clobber` |
| `Resource not accessible by personal access token` | Fine-grained PAT lacks `Contents: Write` scope | Re-create token with proper scopes, or use `GITHUB_TOKEN` in workflow |
| Tests pass locally, fail on CI | Environment-specific (timestamps, module resolution) | Capture jest JSON artifact; check ORDER BY tie-breaks, modulePaths |
| `react-scripts/config/webpack.config.js` in stack trace | Stale CRA node_modules from npm cache | `rm -rf node_modules package-lock.json` before install |
