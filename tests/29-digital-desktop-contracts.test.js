/**
 * Digital desktop UI — source-contract tests.
 *
 * Source-contract tests per project convention (no jsdom). Behavioral render
 * tests would require a jsdom+RTL environment — deferred; see audit D-P2-8.
 *
 * Covers the digital workflow surface: DigitalOverview, DigitalImportWizard,
 * DigitalDevelop, LibraryView, AlbumLibrary, AlbumDetail, plus the digital
 * branches of ImageViewer / PhotoDetailsSidebar / Statistics and the digital
 * route wiring in App.jsx.
 *
 * Each test asserts a small number of high-signal invariants about how the
 * source actually behaves (API endpoints called, state keys used, branching
 * predicates). They are NOT behavioural render tests; they read the .jsx
 * source with fs.readFileSync and match structural contracts via tolerant
 * regexes / substring checks.
 *
 * Conventions:
 *   - testEnvironment 'node' (project default; see tests/jest.config.js)
 *   - readClientSrc(relPath) helper, identical to 24-phaseQ-ui.test.js
 *   - tolerant matching: prefer toContain on bounded substrings (extracted
 *     via indexOf) or toMatch with /\s+/ regexes over whitespace-exact
 *     patterns; never assert property *order* across multiline blocks.
 */

const fs = require('fs');
const path = require('path');

function readClientSrc(relPath) {
  return fs.readFileSync(path.join(__dirname, '..', 'client', 'src', relPath), 'utf-8');
}

// ============================================================================
// 1. LibraryView — digital mode query contracts + lazy viewer wiring
// ============================================================================
describe('LibraryView — digital library fetch contracts', () => {
  test('photos query passes mode=digital and facets/sessions use digital-scoped endpoints', () => {
    const src = readClientSrc('components/digital/LibraryView.jsx');
    // WHY: searchPhotos must scope to digital; otherwise film positives would
    // leak into the digital library grid.
    expect(src).toMatch(/searchPhotos\(\{[\s\S]*?mode:\s*['"]digital['"]/);
    // WHY: facet counts drive the filter rail; without mode=digital the rail
    // would show film-only cameras/lenses.
    expect(src).toMatch(/getPhotoFacets\(\{[\s\S]*?mode:\s*['"]digital['"]/);
    // WHY: the "Last import" button reads from the digital sessions list —
    // must use the digital-sessions endpoint, not /api/rolls.
    expect(src).toMatch(/getDigitalSessions\(\)/);
    // WHY: viewer must be lazy-loaded so the FilmLab/WebGL chunk isn't pulled
    // into the library entry bundle.
    expect(src).toMatch(/from\s+['"]\.\.\/common\/LazyImageViewer['"]/);
    // WHY: empty-state CTA must route users into the digital import flow,
    // not the film positive importer.
    expect(src).toMatch(/navigate\(['"]\/digital-import['"]\)/);
  });
});

// ============================================================================
// 2. DigitalDevelop — API surface + default param schema (server contract)
// ============================================================================
describe('DigitalDevelop — develop API imports + param schema', () => {
  test('imports the five develop API functions from ../../api', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: the file must source preview/save/export/get/list from the shared
    // api module so endpoint URLs live in one place (api/digital-develop.js).
    expect(src).toMatch(/developPreview/);
    expect(src).toMatch(/developSave/);
    expect(src).toMatch(/developExport/);
    expect(src).toMatch(/getDevelopParams/);
    expect(src).toMatch(/listPresets/);
    expect(src).toMatch(/createPreset/);
  });

  test('createDefaultParams emits the server-contract param keys', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: server expects these exact keys in params_json — renaming any
    // would silently drop the corresponding develop operation.
    const startIdx = src.indexOf('function createDefaultParams()');
    const endIdx = src.indexOf('function sanitizeParams', startIdx);
    const body = src.substring(startIdx, endIdx);
    expect(body).toContain('exposure');
    expect(body).toContain('contrast');
    expect(body).toContain('highlights');
    expect(body).toContain('shadows');
    expect(body).toContain('whites');
    expect(body).toContain('blacks');
    expect(body).toContain('temp');
    expect(body).toContain('tint');
    expect(body).toContain('saturation');
    expect(body).toContain('curves');
    expect(body).toContain('hslParams');
    expect(body).toContain('splitToning');
    expect(body).toContain('lut1');
    expect(body).toContain('rotation');
    expect(body).toContain('crop');
  });

  test('WB controls use temp/tint (not temperature) — sanitizeParams deletes temperature', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: legacy 'temperature' alias is normalised to 'temp' before save;
    // the slider keys must match the canonical server key 'temp'.
    const wbStart = src.indexOf('const WB_CONTROLS');
    const wbEnd = src.indexOf('];', wbStart);
    const wbBlock = src.substring(wbStart, wbEnd);
    expect(wbBlock).toContain("'temp'");
    expect(wbBlock).toContain("'tint'");
    expect(wbBlock).not.toMatch(/['"]temperature['"]/);
    // WHY: confirm the alias-collapse is real (prevents leaking temperature
    // to the server which would reject it).
    expect(src).toMatch(/delete\s+merged\.temperature/);
  });
});

// ============================================================================
// 3. DigitalDevelop — preview blob URL + abort/debounce lifecycle
// ============================================================================
describe('DigitalDevelop — preview lifecycle (blob URL, abort, debounce)', () => {
  test('preview handler produces a blob URL via developPreview + AbortController', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: the preview is a binary blob (not JSON) and must be wired into an
    // object URL — otherwise the <img src> would receive a JSON string.
    expect(src).toMatch(/developPreview\(photoId,\s*\w+/);
    expect(src).toMatch(/URL\.createObjectURL\(blob\)/);
    // WHY: rapid slider drags spawn overlapping requests; the AbortController
    // + previewGen guard prevent the stale response from clobbering the
    // latest one.
    expect(src).toMatch(/new AbortController\(\)/);
    expect(src).toMatch(/previewGenRef/);
    // WHY: 300ms debounce coalesces param churn; if it disappears the server
    // gets one preview request per slider pixel. The debounce lives inside
    // the triggerPreview useCallback — bound the substring to that function
    // body (start: 'const triggerPreview', end: '}, 300);') and assert a
    // setTimeout(..., 300) is present inside it.
    const tpStart = src.indexOf('const triggerPreview');
    expect(tpStart).toBeGreaterThanOrEqual(0);
    const tpEndMarker = '}, 300);';
    const tpEnd = src.indexOf(tpEndMarker, tpStart);
    expect(tpEnd).toBeGreaterThanOrEqual(0);
    const tpBody = src.substring(tpStart, tpEnd + tpEndMarker.length);
    expect(tpBody).toMatch(/setTimeout\(async\s*\(\)\s*=>\s*\{/);
    expect(tpBody).toMatch(/,\s*300\)/);
  });

  test('save + export handlers route through developSave / developExport', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: handleSave must persist via developSave (POST /api/digital-develop/save)
    // so the next page load restores the user's edits.
    const saveStart = src.indexOf('async function handleSave()');
    const saveEnd = src.indexOf('async function handleExport()', saveStart);
    const saveBody = src.substring(saveStart, saveEnd);
    expect(saveBody).toMatch(/developSave\(photoId,\s*paramsRef\.current\)/);
    // WHY: handleExport uses the export endpoint so the downloaded JPEG has
    // the full-res developed pixels (not the preview thumbnail).
    const exportStart = src.indexOf('async function handleExport()');
    const exportEnd = src.indexOf('async function handleSavePreset()', exportStart);
    const exportBody = src.substring(exportStart, exportEnd);
    expect(exportBody).toMatch(/developExport\(photoId,\s*paramsRef\.current\)/);
    expect(exportBody).toMatch(/URL\.createObjectURL\(blob\)/);
  });

  test('unmount cleanup revokes blob URL and aborts in-flight preview', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: leaking object URLs across repeated open/close leaks memory; the
    // unmount effect must revoke + abort.
    expect(src).toMatch(/URL\.revokeObjectURL\(blobUrlRef\.current\)/);
    expect(src).toMatch(/abortRef\.current\.abort\(\)/);
  });

  test('presets use category="digital" on save and on list', () => {
    const src = readClientSrc('components/digital/DigitalDevelop.jsx');
    // WHY: a 'film' category preset must never appear in the digital develop
    // preset dropdown — both read+write must filter to digital.
    expect(src).toMatch(/createPreset\(\{[\s\S]*?category:\s*['"]digital['"]/);
    expect(src).toMatch(/listPresets\(['"]digital['"]\)/);
  });
});

// ============================================================================
// 4. DigitalImportWizard — endpoint wiring + 3-step flow
// ============================================================================
describe('DigitalImportWizard — endpoint + step flow contracts', () => {
  test('imports preview/execute/progress/cancel from ../../api', () => {
    const src = readClientSrc('components/digital/DigitalImportWizard.jsx');
    // WHY: the wizard must use the four shared API helpers so endpoint URLs
    // and shape stay consistent with the server's import job state machine.
    expect(src).toMatch(/digitalPreviewImport/);
    expect(src).toMatch(/digitalExecuteImport/);
    expect(src).toMatch(/getDigitalImportProgress/);
    expect(src).toMatch(/cancelDigitalImport/);
  });

  test('execute payload carries items + session_title + album_id; completes via progress polling', () => {
    const src = readClientSrc('components/digital/DigitalImportWizard.jsx');
    // WHY: server requires the exact keys items/session_title/album_id — the
    // preview->execute handoff shape is part of the contract. `items` is
    // ES shorthand so it appears as `items,` not `items:`.
    expect(src).toMatch(/digitalExecuteImport\(\{[\s\S]*?\bitems,[\s\S]*?session_title:[\s\S]*?album_id:/);
    // WHY: import is async (job queue); the wizard must poll progress, not
    // block on execute alone.
    expect(src).toMatch(/getDigitalImportProgress\(jobId\)/);
    // WHY: on completion, react-query caches for albums + library must be
    // invalidated, else the user lands on a stale empty library.
    expect(src).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['albums'\]\s*\}\)/);
    expect(src).toMatch(/invalidateQueries\(\{\s*queryKey:\s*\['library-photos'\]\s*\}\)/);
    // WHY: post-success redirect must respect album context — album-imports
    // return to the album, not the library.
    expect(src).toMatch(/navigate\(albumIdRef\.current\s*\?\s*`\/albums\/\$\{albumIdRef\.current\}`\s*:\s*['"]\/library['"]\)/);
  });

  test('accepted file formats include RAW extensions; wizard content gated by numeric step (0/1/2)', () => {
    const src = readClientSrc('components/digital/DigitalImportWizard.jsx');
    // WHY: the accept list drives both the file picker filter and validation;
    // dropping RAW support here would silently exclude the user's camera.
    expect(src).toMatch(/const\s+ACCEPTED\s*=\s*['"][^'"]*\.cr2/i);
    expect(src).toMatch(/\.nef/i);
    expect(src).toMatch(/\.arw/i);
    expect(src).toMatch(/\.dng/i);
    // WHY: the wizard state machine is driven by numeric `step` (0/1/2), not
    // by the STEPS label array. STEPS only feeds the indicator UI; the body
    // branches on `{step === N && ...}`. Asserting STEPS labels are merely
    // tautological — the real contract is the 3-step numeric gating.
    const stepsMatch = src.match(/const\s+STEPS\s*=\s*\[([^\]]+)\]/);
    expect(stepsMatch).not.toBeNull();
    const stepsEntries = stepsMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    expect(stepsEntries).toHaveLength(3);
    expect(src).toMatch(/\{step\s*===\s*0\s*&&/);
    expect(src).toMatch(/\{step\s*===\s*1\s*&&/);
    expect(src).toMatch(/\{step\s*===\s*2\s*&&/);
  });
});

// ============================================================================
// 5. AlbumLibrary — list query + parent/child nesting
// ============================================================================
describe('AlbumLibrary — albums query + hierarchy', () => {
  test('uses getAlbums() under the [\'albums\'] query key + nests by parent_id', () => {
    const src = readClientSrc('components/digital/albums/AlbumLibrary.jsx');
    // WHY: the same ['albums'] key is shared across LibraryView/DigitalOverview/
    // AlbumDetail; staying on this key means album creates from elsewhere
    // refresh this view automatically.
    expect(src).toMatch(/queryKey:\s*\['albums'\]/);
    expect(src).toMatch(/queryFn:\s*\(\)\s*=>\s*getAlbums\(\)/);
    // WHY: the hierarchy is encoded purely via parent_id on the album row;
    // the view splits roots vs children with no extra API call.
    expect(src).toMatch(/a\.parent_id\s*!=\s*null\s*&&\s*ids\.has\(a\.parent_id\)/);
    // WHY: clicking an album card must deep-link into the detail route.
    expect(src).toMatch(/navigate\(`\/albums\/\$\{album\.id\}`\)/);
  });
});

// ============================================================================
// 6. AlbumDetail — query/mutation wiring + sort-mode toggle
// ============================================================================
describe('AlbumDetail — query, sort mode, and album mutations', () => {
  test('fetches album + photos via getAlbum/getAlbumPhotos with manual/date sort toggle', () => {
    const src = readClientSrc('components/digital/albums/AlbumDetail.jsx');
    // WHY: sortMode='date' must pass sort=date_taken to match the server's
    // expected query param; otherwise the toggle would silently noop.
    expect(src).toMatch(/getAlbumPhotos\(\s*id,\s*sortMode\s*===\s*['"]date['"]\s*\?\s*\{\s*sort:\s*['"]date_taken['"]\s*\}/);
    // WHY: album metadata (title/description) is a separate fetch keyed by
    // albumId — invalidations must use the same key to refresh.
    expect(src).toMatch(/queryKey:\s*\['album',\s*albumId\]/);
    expect(src).toMatch(/queryFn:\s*\(\)\s*=>\s*getAlbum\(id\)/);
    // WHY: the Import button deep-links into the wizard with album context so
    // imported photos are auto-attached.
    expect(src).toMatch(/navigate\(`\/digital-import\?album=\$\{albumId\}`\)/);
  });

  test('cover + sort + remove mutations call the right shared API helpers', () => {
    const src = readClientSrc('components/digital/albums/AlbumDetail.jsx');
    // WHY: each mutation must hit its dedicated endpoint; ad-hoc PUTs would
    // bypass server-side validation/audit hooks.
    expect(src).toMatch(/setAlbumCover\(id,\s*photoId\)/);
    expect(src).toMatch(/sortAlbumPhotos\(id,\s*photoIds\)/);
    expect(src).toMatch(/removeAlbumPhoto\(id,\s*photoId\)/);
    expect(src).toMatch(/deleteAlbum\(id,\s*false\)/);
  });
});

// ============================================================================
// 7. ImageViewer — digital branch routing
// ============================================================================
describe('ImageViewer — digital source_type branch', () => {
  test('isDigital detection gates digital-only toolbar actions and keyboard shortcuts', () => {
    const src = readClientSrc('components/ImageViewer.jsx');
    // WHY: favorite/album/delete buttons must not render for film positives
    // — the same control surface means different operations per source type.
    expect(src).toMatch(/const\s+isDigital\s*=\s*img\?\.source_type\s*===\s*['"]digital['"]/);
    expect(src).toMatch(/\{isDigital\s*&&\s*\(/);
    // WHY: f / Delete keyboard shortcuts must be scoped to digital so the
    // film viewer's hotkeys don't accidentally delete a film positive.
    expect(src).toMatch(/imgRef\.current\?\.source_type\s*===\s*['"]digital['"]/);
    expect(src).toMatch(/e\.key\s*===\s*['"]f['"]\s*\|\|\s*e\.key\s*===\s*['"]F['"]/);
    expect(src).toMatch(/e\.key\s*===\s*['"]Delete['"]\s*\|\|\s*e\.key\s*===\s*['"]Backspace['"]/);
  });

  test('handleFilmLabClick routes digital photos to DigitalDevelop (not FilmLab)', () => {
    const src = readClientSrc('components/ImageViewer.jsx');
    // WHY: digital photos must open DigitalDevelop (server-side pipeline);
    // a film positive must never reach the digital develop endpoint.
    expect(src).toMatch(/img\?\.source_type\s*===\s*['"]digital['"]/);
    expect(src).toMatch(/setShowDigitalDevelop\(true\)/);
    expect(src).toMatch(/DigitalDevelop\s*=\s*lazy\(\(\)\s*=>\s*import\(['"]\.\/digital\/DigitalDevelop['"]\)\)/);
  });

  test('DigitalDevelop is rendered with photoId + imageUrl + onClose + onSaved props', () => {
    const src = readClientSrc('components/ImageViewer.jsx');
    // WHY: the prop contract is the boundary between viewer and develop —
    // changing names here silently breaks save callbacks (no refresh).
    // Bound each assertion to the single <DigitalDevelop ... /> render site
    // so a stray prop name elsewhere in the file can't satisfy the check.
    const ddStart = src.indexOf('<DigitalDevelop');
    expect(ddStart).toBeGreaterThanOrEqual(0);
    const ddEnd = src.indexOf('/>', ddStart);
    expect(ddEnd).toBeGreaterThanOrEqual(0);
    const ddBlock = src.substring(ddStart, ddEnd);
    expect(ddBlock).toMatch(/photoId=\{img\.id\}/);
    expect(ddBlock).toMatch(/imageUrl=\{sourcePath\}/);
    expect(ddBlock).toMatch(/onClose=\{\(\)\s*=>\s*setShowDigitalDevelop\(false\)\}/);
    expect(ddBlock).toMatch(/onSaved=\{/);
  });

  test('DigitalDevelop imageUrl is built from positive_rel_path via buildUploadUrl + addCacheKey', () => {
    const src = readClientSrc('components/ImageViewer.jsx');
    // WHY: the digital develop preview must load the rendered positive
    // (positive_rel_path), not the raw upload — and must go through the same
    // buildUploadUrl + addCacheKey pair as the film viewer so the cache key
    // (updated_at) busts correctly after a re-develop. Bound the assertion
    // to the `const sourcePath = ...;` statement so a similar expression
    // elsewhere in the file can't satisfy it.
    const spStart = src.indexOf('const sourcePath');
    expect(spStart).toBeGreaterThanOrEqual(0);
    const spEnd = src.indexOf(';', spStart);
    expect(spEnd).toBeGreaterThanOrEqual(0);
    const spExpr = src.substring(spStart, spEnd);
    expect(spExpr).toMatch(/positive_rel_path/);
    expect(spExpr).toMatch(/buildUploadUrl\(/);
    expect(spExpr).toMatch(/addCacheKey\(/);
    expect(spExpr).toMatch(/\/uploads\/\$\{/);
    expect(spExpr).toMatch(/updated_at/);
  });
});

// ============================================================================
// 8. PhotoDetailsSidebar — digital branch
// ============================================================================
describe('PhotoDetailsSidebar — digital-specific sections', () => {
  test('shows Digital Source read-only fields and hides Scanning for digital photos', () => {
    const src = readClientSrc('components/PhotoDetailsSidebar.jsx');
    // WHY: digital photos have no scanner metadata — showing the Scanning
    // section would be misleading; the predicate must be source_type-based.
    expect(src).toMatch(/base\?\.source_type\s*!==\s*['"]digital['"]\s*&&\s*\(/);
    expect(src).toMatch(/base\?\.source_type\s*===\s*['"]digital['"]\s*&&\s*\(/);
    // WHY: the digital source fields are read from base.* and rendered
    // read-only (server-derived EXIF, not user-editable).
    expect(src).toMatch(/value=\{base\?\.source_make\s*\|\|\s*['"]['"]\}\s+readOnly/);
    expect(src).toMatch(/value=\{base\?\.source_model\s*\|\|\s*['"]['"]\}\s+readOnly/);
    expect(src).toMatch(/value=\{base\?\.source_software\s*\|\|\s*['"]['"]\}\s+readOnly/);
    expect(src).toMatch(/value=\{base\?\.source_lens\s*\|\|\s*['"]['"]\}\s+readOnly/);
    // WHY: EquipmentSelector mode must follow source_type so the digital
    // equipment pool (no film bodies) is offered.
    expect(src).toMatch(/mode=\{photo\?\.source_type\s*===\s*['"]digital['"]\s*\?\s*['"]digital['"]\s*:\s*['"]film['"]\}/);
  });

  test('photoAlbums query is enabled only for digital non-batch photos', () => {
    const src = readClientSrc('components/PhotoDetailsSidebar.jsx');
    // WHY: film photos don't belong to albums; enabling the query for them
    // would fire an irrelevant network request on every film sidebar open.
    expect(src).toMatch(/enabled:\s*!isBatch\s*&&\s*isDigital\s*&&\s*!!base\?\.id/);
    // WHY: the Albums section header is rendered conditionally on the same
    // predicate so digital-batch edits skip the empty section.
    expect(src).toMatch(/!isBatch\s*&&\s*isDigital\s*&&\s*photoAlbums\.length\s*>\s*0/);
  });
});

// ============================================================================
// 9. Statistics — workspace/view prop branching
// ============================================================================
describe('Statistics — workspace/view prop branches (spending vs film vs digital)', () => {
  test('spending branch is distinct from workspace branch and gates the costs query', () => {
    const src = readClientSrc('components/Statistics.jsx');
    // WHY: 'spending' is the legacy cost view; conflating it with the
    // workspace ('film'/'digital') would erase the cost dashboard. The split
    // into two props (workspace + view) keeps view selection independent of
    // workspace selection.
    expect(src).toMatch(/const\s+isSpending\s*=\s*view\s*===\s*['"]spending['"]/);
    // WHY: costs query is heavy and only relevant to spending; it must be
    // disabled in workspace modes to avoid an extra round-trip.
    expect(src).toMatch(/enabled:\s*isSpending/);
  });

  test('workspace derived from workspace === \'digital\' drives digital-only endpoints + enables', () => {
    const src = readClientSrc('components/Statistics.jsx');
    // WHY: digital workspace hits /api/stats/digital/monthly + /cameras; film
    // workspace must keep using the film activity endpoint. The `ws` local
    // normalises the prop so an unexpected value can't leak through.
    expect(src).toMatch(/const\s+ws\s*=\s*workspace\s*===\s*['"]digital['"]\s*\?\s*['"]digital['"]\s*:\s*['"]film['"]/);
    expect(src).toMatch(/isDigital\s*\?\s*`\$\{API\}\/api\/stats\/digital\/monthly`/);
    expect(src).toMatch(/`\$\{API\}\/api\/stats\/digital\/cameras`/);
    // WHY: the inventory section is film-only (rolls in stock) — must be
    // disabled for digital or it would render an empty grid.
    expect(src).toMatch(/enabled:\s*!isDigital/);
    // WHY: digitalCameras query must be gated so a film viewer doesn't pay
    // the cost of fetching digital-camera distribution. Extract the useQuery
    // block by its queryKey and assert the endpoint + the enabled flag
    // independently — their relative order within the block is not part of
    // the contract and must not be coupled by one regex.
    const dcStart = src.indexOf("['stats-digital-cameras']");
    expect(dcStart).toBeGreaterThanOrEqual(0);
    const dcEnd = src.indexOf('});', dcStart);
    expect(dcEnd).toBeGreaterThanOrEqual(0);
    const dcBlock = src.substring(dcStart, dcEnd);
    expect(dcBlock).toMatch(/digital\/cameras/);
    expect(dcBlock).toMatch(/enabled:\s*isDigital/);
  });

  test('modeQs (?mode=${ws}) is appended to summary + gear queries', () => {
    const src = readClientSrc('components/Statistics.jsx');
    // WHY: every workspace-aware query must carry ?mode=film|digital so the
    // server returns only that workspace's rows. If modeQs is dropped from
    // summary/gear, the digital stats tab would render film counts (or vice
    // versa) — a silent data-leak across workspaces.
    expect(src).toMatch(/const\s+modeQs\s*=\s*`\?mode=\$\{ws\}`/);
    expect(src).toMatch(/stats\/summary\$\{modeQs\}/);
    expect(src).toMatch(/stats\/gear\$\{modeQs\}/);
  });

  test('component signature uses explicit workspace + view props', () => {
    const src = readClientSrc('components/Statistics.jsx');
    // WHY: the audit (D-P3-3) flagged the overloaded `mode` prop conflating
    // workspace ('film'/'digital') with view ('stats'/'spending'). The split
    // signature makes the two axes independent and prevents a future
    // `mode="activity"` from compounding the overload.
    expect(src).toMatch(/export\s+default\s+function\s+Statistics\(\{\s*workspace\s*=\s*['"]film['"]\s*,\s*view\s*=\s*['"]stats['"]\s*\}\)/);
  });
});

// ============================================================================
// 10. App.jsx — workspace mode state + persistence + routes
// ============================================================================
describe('App.jsx — workspace mode state + persistence + shortcuts', () => {
  test('MODE_KEY persisted via localStorage; mode initialized from it; toggle writes through', () => {
    const src = readClientSrc('App.jsx');
    // WHY: workspace choice must survive reload; the MODE_KEY is the SSOT
    // the layout reads at first paint to pick film vs digital routes.
    expect(src).toMatch(/const\s+MODE_KEY\s*=\s*['"]fg-workspace-mode['"]/);
    expect(src).toMatch(/localStorage\.getItem\(MODE_KEY\)\s*\|\|\s*['"]film['"]/);
    expect(src).toMatch(/localStorage\.setItem\(MODE_KEY,\s*next\)/);
    // WHY: each workspace remembers its own last route; sharing one key
    // would have film's last route hijack digital's first paint.
    expect(src).toMatch(/ROUTE_KEYS\s*=\s*\{\s*film:[^,]+,\s*digital:[^}]+\}/);
    // WHY: the Onboarding/Settings page can switch workspace without a remount;
    // App listens on WORKSPACE_EVENT so the toggle is global.
    expect(src).toMatch(/window\.addEventListener\(WORKSPACE_EVENT/);
    // WHY: Ctrl+Shift+M is the documented keyboard shortcut — removing it
    // breaks power-user workflow.
    expect(src).toMatch(/key\s*===\s*['"]m['"]/);
    expect(src).toMatch(/toggleMode\(\)/);
  });

  test('DigitalRoutes mounts digital components at the expected paths', () => {
    const src = readClientSrc('App.jsx');
    // WHY: each digital route must mount the matching component — a missing
    // or misnamed route would 404 inside the digital workspace.
    expect(src).toMatch(/<Route\s+path=['"]\/['"]\s+element=\{<DigitalOverview\s*\/>\}/);
    expect(src).toMatch(/<Route\s+path=['"]\/library['"]\s+element=\{<LibraryView\s*\/>\}/);
    expect(src).toMatch(/<Route\s+path=['"]\/albums['"]\s+element=\{<AlbumLibrary\s*\/>\}/);
    expect(src).toMatch(/<Route\s+path=['"]\/albums\/:id['"]\s+element=\{<AlbumDetail\s*\/>\}/);
    expect(src).toMatch(/<Route\s+path=['"]\/digital-import['"]\s+element=\{<DigitalImportWizard\s*\/>\}/);
    // WHY: digital stats route must pass workspace="digital" so Statistics
    // queries the digital workspace instead of the default film one.
    expect(src).toMatch(/<Route\s+path=['"]\/stats['"]\s+element=\{<Statistics\s+workspace=['"]digital['"]\s*\/>\}/);
    // WHY: the top-level gate must select the route tree by mode; otherwise
    // film routes would render inside the digital workspace.
    expect(src).toMatch(/mode\s*===\s*['"]film['"]\s*\?\s*<FilmRoutes\s*\/>\s*:\s*<DigitalRoutes\s*\/>/);
  });
});

// ============================================================================
// 11. MODE_KEY — cross-file literal drift contract
// ============================================================================
describe('MODE_KEY — same literal across App / Onboarding / GeneralSettings', () => {
  test('all three files declare MODE_KEY with the identical string literal', () => {
    // WHY: MODE_KEY ('fg-workspace-mode') is duplicated as a literal in three
    // files rather than imported from a shared module. If any one drifts
    // (e.g. typo, rename), that file would read/write a different localStorage
    // slot than App.jsx — workspace switches from Onboarding/Settings would
    // silently fail to persist. Assert all three extract to the same value.
    const extractModeKey = (relPath) => {
      const src = readClientSrc(relPath);
      const m = src.match(/const\s+MODE_KEY\s*=\s*['"]([^'"]+)['"]/);
      expect(m).not.toBeNull();
      return m[1];
    };
    const appKey = extractModeKey('App.jsx');
    const onboardingKey = extractModeKey('components/Onboarding.jsx');
    const settingsKey = extractModeKey('components/Settings/GeneralSettings.jsx');
    expect(appKey).toBe('fg-workspace-mode');
    expect(onboardingKey).toBe(appKey);
    expect(settingsKey).toBe(appKey);
  });
});
