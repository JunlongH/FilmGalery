## Filesystem Migration (Expo SDK 54)

This project migrated away from deprecated `expo-file-system` procedural APIs (`downloadAsync`, `uploadAsync`, etc.) to the new class-based API introduced in Expo SDK 54.

### Why
- `downloadAsync` now throws unless imported from `expo-file-system/legacy`.
- New API provides clearer separation of concerns (`File`, `Directory`, `Paths`) and future-proofed surface.
- Centralizing logic avoids sprinkling conditional code across screens.

### New Helper
`src/utils/fileSystem.js` exposes:
- `downloadImageAsync(url, { fileName, saveToLibrary })` — downloads an image into the app document directory using `File.createAsync(...).downloadFileAsync(url)`; optionally saves to the user media library.
- Automatic fallback to legacy API if the new classes are unavailable (older build environment).

### Permissions
`ensureMediaPermissionsAsync()` is called internally when `saveToLibrary` is true. It requests MediaLibrary permissions only on native platforms.

### Updating Other Legacy Calls
If you find additional uses of `FileSystem.downloadAsync` in code:
1. Remove the `import * as FileSystem from 'expo-file-system'`.
2. Import `{ downloadImageAsync }` from `../utils/fileSystem`.
3. Replace the call, passing a `fileName` if needed.

### Legacy Fallback
If the new API is not present (e.g. mismatch in SDK version), the helper attempts `require('expo-file-system/legacy')` and runs the old method. This allows the app to stay functional while ensuring forward compatibility.

### Future Improvements
- Add generic file download (non-image) variant.
- Add resumable downloads if required.
- Centralize error analytics.
