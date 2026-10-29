# Status

Updated by each session at the end of its work.

Live app (GitHub Pages): https://askoller.github.io/crossword-builder/
(Deploys from `main` via `.github/workflows/deploy.yml`. Pages must be set to
"Source: GitHub Actions" in the repository settings once, or the deploy job fails.)

## Done

### Session 1: foundation
- **Scaffold**: Vite 8 + TypeScript 7 (strict) + Preact + `@preact/signals`, `vite-plugin-pwa`
  (prompt-to-update, offline precache, manifest + icons), `idb`, Vitest (jsdom +
  `fake-indexeddb`), Playwright 1.63 (pinned to match the preinstalled Chromium).
  `base: '/crossword-builder/'`. IBM Plex Sans/Mono self-hosted via `@fontsource` (latin only).
- **CI/deploy**: `.github/workflows/deploy.yml` runs `npm test` and `npm run build` on every
  push and PR, and deploys `dist/` to Pages on push to `main`.
- **Fixtures**: `scripts/make-fixtures.mjs` (deterministic) builds `fixtures/` from the MIT
  package `an-array-of-english-words`: 270,530 words of 3–15 letters, hash scores 20–55 with
  ~0.2% set to 1, fake NYT counts/years, fake clue history for 229 common words, fake
  `my-scores.json` and `notebook.json`, plus three test grids in `fixtures/grids/`
  (5×5 mini, 15×15 open, 15×15 with two locked theme rows and a circle). A few words have
  pinned scores for the dupe-rule test cases (SPOUSE/SPOUSES, TEA/TEAPARTY, …).
- **Model** (`src/model/`, pure, no DOM): `types.ts` (puzzle file §5.2), `grid.ts`
  (slots/numbering, symmetry partners for rotational / left-right / diagonal / none,
  patterns), `editor.ts` (typing with advance and locked-cell skipping, backspace, block
  toggle with symmetry, circle, lock word, rebus, tap/arrow/Tab navigation), `history.ts`
  (compact diffs of changed cells and clues + cursor, cap 500).
- **Data layer** (`src/data/`): IndexedDB schema §5.1 (`db.ts`: puzzles, history,
  snapshots, lexicon, clues, notebook, settings, outbox); `puzzles.ts` (CRUD, duplicate,
  snapshots capped at 50); `autosave.ts` (300 ms debounce, flush on `visibilitychange` →
  hidden and `pagehide`, retry on failure). `navigator.storage.persist()` requested once on
  first run (`main.tsx`), result shown in Settings.
- **Data pack import** (`src/data/import.ts` → `import.worker.ts` → `importCore.ts`):
  `importDataPack(files, onProgress)` accepts named File/Blob objects in any order (or a
  classified `DataPackFiles` object), gunzips with `DecompressionStream` in a worker, stores
  the lexicon **packed per word length** (`lexicon` store, key = length:
  `{words: concatenated string, score: Uint8Array, nyt: Uint16Array, last: Uint16Array}`),
  clue history per answer (`clues` store, key = answer, batches of 2000), `my-scores.json`
  and the pack notebook in `settings` (`myScores`, `datapackNotebook`), seeds the local
  `notebook` store (keys `answer:<LETTERS>` / `theme:<id>`) only if it is empty, and saves
  the manifest (`settings.manifest`). Settings has a working "Import data pack from files"
  button (`<input type=file multiple>`) with a progress bar, and a dev-only
  "Load fixtures (dev)" button that goes through the same function and also adds the
  fixture grids as puzzles.
- **State**: `src/state/editor.ts` (`EditorSession`: puzzle/cursor/history signals, every
  edit is one undoable diff, undo/redo restore the cursor, autosave of puzzle + history,
  interval snapshot every 10 min of editing, `snapshot('autofill')` for session 2's Keep);
  `src/state/app.ts` (hash routes `#/`, `#/puzzle/<id>`, `#/notebook`, `#/clues`,
  `#/settings`; `wide` signal from the media query below).
- **Screens** (`src/ui/`): Puzzles home (search, backup card placeholder, filter pills,
  cards with thumbnail + status pill, New puzzle dialog with size 15/21/custom, day,
  outlet, title, optional Notebook theme); Grid editor with SVG grid, clue bar
  (prev/next, label, mono pattern, clue or "No clue yet · N letters", tap switches
  direction), tool row (Select, Fill, Autofill, Check, Clue, Block; long-press Block for
  Rebus / Circle / Lock word), custom keyboard (10/9/7 with Switch and Delete), header
  with labeled Undo pill, Redo, overflow (Rename, Puzzle settings, Export .puz disabled,
  Duplicate, Delete). Physical keyboard: letters, Backspace/Delete, arrows, Space, Tab /
  Shift+Tab, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, `.` toggles a block, Esc closes panels.
  Long-press on a cell opens the Select placeholder. Inner screen (§3.8): grid +
  clue bar + keyboard left; tool row (Select, Autofill, Check, Block, Rebus) and a
  Fill / Clues / Theme tab panel right. Layout switches on
  `(min-aspect-ratio: 1/1), (min-width: 900px)`. Notebook and Clues tabs are placeholders.
- **Placeholders for later sessions**: Select, Fill, Autofill, Check and Clue open
  placeholder panels (a sheet replacing tool row + keyboard on the cover screen, the right
  panel on the inner screen); see `PLACEHOLDERS` / `SidePanel` in `src/ui/Editor.tsx`.
  `src/engine/protocol.ts` has the worker message types from §4.4; `src/engine/worker.ts`
  is a stub that answers `done`.
- **Tests**: 43 unit tests (`tests/unit/`): slots/numbering, symmetry, typing / advance /
  locked skip / backspace, block symmetry, navigation, rebus/circle/lock, undo/redo +
  cap + clue diffs, autosave debounce / hidden / pagehide / retry, autosave round trip
  across a reload (including undo history), snapshot cap, data pack parsing and fixture
  import. Playwright (`tests/e2e/app.spec.ts`) at 476×752, 1164×878 and 412×915: loads
  fixtures, screenshots home, editor and editor with a panel into `test-results/screens/`,
  and checks typing, symmetric blocks, undo/redo across a reload, Space and tap direction
  switches.

### Session 4: Google Drive backup, Picker import, .puz
- **Config** (`src/config.ts`): OAuth client ID, Picker API key (restricted to the Picker API
  and this site), project number as the Picker app ID, scope `drive.file`. Public by design.
- **Sign-in** (`src/google/auth.ts`): GIS token client loaded on demand
  (`src/google/loader.ts`). Connect (consent) / resume / disconnect (revokes). Token + expiry
  kept in `settings` (`googleToken`, `googleConnected`), so a reload within the hour stays
  connected with no network. Silent renewal (`prompt: ''`) 5 min before expiry; if Google
  needs a tap, `authState` becomes `paused` and nothing retries in the background until
  Andrew taps "Backup paused · tap to resume" (banner on every tab screen, Home card,
  Settings, and "Saved on phone · Backup paused" in the editor header).
- **Drive client** (`src/google/drive.ts`): fetch-only Drive v3 (list with paging, folders,
  multipart create, multipart PATCH in place, download). One retry with a fresh token on 401.
- **Folder** (`src/sync/backup.ts`): under `drive.file` the app can only find a
  "Crossword Builder" folder it made itself. If none is visible, Settings asks
  **Choose existing folder** (Picker, folder mode; for the folder the laptop already made)
  or **Create new folder**, so there are never two folders with the same name. `puzzles/`
  is created inside. Ids are remembered in `settings.driveIds`.
- **Backup**: `savePuzzle()` now also queues the puzzle in `outbox` in the same transaction
  (one row per puzzle), so every local save, new puzzle, duplicate and restore is queued.
  The outbox uploads `puzzles/<slug>-<id8>.json` and `.puz` (tagged with
  `appProperties {puzzleId, kind}`, updated in place and renamed with the title; found again
  by tag after a reinstall; re-created if deleted in Drive) every 3 minutes, on
  `visibilitychange` → hidden / `pagehide` (after the open editor flushes its autosave),
  on `online`, and on connect/resume. Offline, signed out or paused it just waits. Edits
  made during an upload stay queued.
- **Restore**: Settings → Restore from Drive lists `puzzles/*.json`; restore one or all.
  A puzzle that also exists locally is snapshotted (`reason: 'import'`) before being replaced.
- **Picker import** (`src/google/picker.ts`, `src/sync/driveImport.ts`): Settings →
  "Import data pack from Google Drive" (when connected) opens the Picker multi-select at
  the root folder (the laptop-made `data/` is one tap in), downloads the picked files and
  calls `importDataPack()` (downloads are the first 30% of the progress bar).
- **Notebook sync** (`src/sync/notebookSync.ts`): `Crossword Builder/notebook.json`. Created
  the first time from the data pack notebook (`settings.datapackNotebook`) merged with the
  local Notebook; otherwise download → merge into local → write back in place (same file
  id) only if the content changed. Runs on start/connect, on returning to the foreground,
  on `online`, and every 2 min while `#/notebook` is open (`src/sync/index.ts`). A remote
  file that isn't valid JSON is reported and never overwritten.
- **Notebook contract**: session 3 isn't merged yet, so `src/model/notebook.ts`,
  `src/data/notebook.ts` and `tests/unit/notebook.test.ts` are **byte-identical copies** of
  session 3's files (its `mergeNotebooks`, `mergeIntoLocal`, tombstones under
  `deleted:<key>`). Git merges identical additions cleanly; if session 3 changes them before
  merging, take session 3's version.
- **.puz** (`src/model/puz.ts`): Across Lite 1.3 writer with all header checksums, clues in
  number order (Across first at a shared number), clue notes as the notes string, rebus via
  GRBS/RTBL, circles via GEXT, ISO-8859-1 text (curly quotes/dashes → ASCII). Unfilled
  squares are `-` in the solution. Reader used for round-trip tests; output also verified
  once by hand with the independent Python reader `puzpy` (checksums valid, rebus and
  circles read). Editor overflow → Export .puz downloads `<slug>-<id8>.puz`; backups upload
  it next to the JSON.
- **UI** (`src/ui/Drive.tsx`): Settings → Google Drive section, Home backup card
  ("Backed up to Google Drive · Crossword Builder folder · 2 min ago" / "Not backed up yet ·
  Connect Google Drive" / "Backup paused · Tap to sign in" / "Choose a Drive folder"),
  paused banner, restore dialog. Editor header shows "Saved · Drive 2 min ago" when connected.
- **Tests**: unit tests mock Google entirely — `tests/unit/fakeDrive.ts` is an in-memory
  Drive behind a fake fetch, GIS is a stubbed `window.google`. Covered: .puz checksums,
  round trip of all fixture grids, rebus/circles, corruption detection, Latin-1; folder
  choose/create/reuse; outbox queueing, upload, in-place update + rename, lookup by tag,
  re-create after delete, offline/paused waits, error keeps queue, 401 retry, edits during
  upload; restore one (with snapshot) and all; notebook create/merge/tombstones/no-op/
  re-create/broken file; sign-in connect/silent renew/pause/resume/restore/disconnect/denied;
  Drive import of the fixtures through the Picker path. Playwright `tests/e2e/drive.spec.ts`
  mocks GIS and the Drive REST endpoints: export .puz, connect, create folder, back up,
  restore dialog, Home card; screenshots `*-settings-drive-*.png`, `*-home-backed-up.png`.

#### Manual test steps (real Google account, on the phone)
1. Google Cloud console: the OAuth client must list `https://askoller.github.io` as an
   authorized JavaScript origin (and `http://localhost:5173` for dev); the API key must
   allow `askoller.github.io/*` and the Picker API; the Drive API must be enabled. While
   the consent screen is in "Testing", Andrew's account must be a test user.
2. Settings → Connect Google Drive → consent. If the laptop already made
   `Crossword Builder`, tap **Choose existing folder** and pick it; otherwise **Create new
   folder**. Expect "Last backup just now" and `puzzles/` with a `.json` and `.puz` per puzzle.
3. Edit a puzzle, switch apps: within seconds the Drive file's modified time updates. Rename
   the puzzle: the Drive files are renamed, not duplicated.
4. Airplane mode, edit, reconnect: the change uploads (Home card goes back to "Backed up").
5. Settings → Import data pack from Google Drive → open `data/`, select all five files →
   import completes; the manifest shows the real counts.
6. `notebook.json` appears in the folder. Edit it from the laptop (ThemeFill), return to the
   app: the Notebook shows the change; edit in the app: the laptop file updates in place.
7. Open the downloaded `.puz` from Export .puz in Across Lite (or puzpy): grid, clues,
   rebus and circles appear.
8. Restore: clear the site data in Chrome (or use a second phone), connect, choose
   the same folder, Restore from Drive → Restore all. Puzzles come back.
9. Leave the app idle for over an hour, then edit: either it renews silently or the
   "Backup paused · tap to resume" banner appears; tapping it resumes and uploads.

## Next
- Sessions 2, 3 and 4 (see `docs/SESSIONS.md`), in parallel.
- Session 2: the engine reads the lexicon with `openDb().get('lexicon', len)` (packed
  chunks above; `lexiconWord(chunk, i)` in `importCore.ts`). Wire Fill / Autofill / Check /
  Select into `PanelName` in `src/state/editor.ts` and replace the placeholders. Use
  `EditorSession.commit(changes)` for Keep (one undoable step) after
  `EditorSession.snapshot('autofill')`. Fill settings (floors, affixes, never-use) are not
  in Settings yet.
- Session 3: import already exists and works from local files; move on to clues and the
  Notebook. Clue text can be written with `EditorSession.commit(new Map(), cluesMap)`
  (undoable). The Clues tab in the bottom nav and the Notebook are placeholders.
- Session 4: done on its branch (see above).
- Session 5 (merge): session 3 and session 4 both add `src/model/notebook.ts`,
  `src/data/notebook.ts` and `tests/unit/notebook.test.ts` with identical content. Session 4
  touches `src/data/puzzles.ts` (`savePuzzle` queues the outbox), `src/state/editor.ts`
  (flush hook), `src/ui/{App,Home,Settings,Editor}.tsx`, `src/main.tsx` and appends CSS
  at the end of `styles.css`. When the real Notebook screen lands on `#/notebook`, the
  2-minute sync already runs there; it should also re-read on `notebookVersion` (it does,
  since `writeNotebook` bumps it).

## Known issues
- Screen sizes for the Fold 8 are estimates; check on the device. The fixed-height panel
  sheet on the cover screen (222 px) is sized to replace tool row + keyboard.
- Select mode itself (tap/drag to select cells) is not built; long-press and the Select
  button only open a placeholder.
- Rebus entry uses a mode: long-press Block → Rebus (or Rebus on the inner screen), type
  letters, tap the clue bar or press Enter to finish.
- No Notebook UI yet, so "Start from a Notebook theme" only sets `themeId` and the title.
- Drive: the real Google flow (consent, Picker, folder pick granting access under
  `drive.file`) is only tested with mocks here; follow the manual steps above.
- Drive: if the laptop and the app write `notebook.json` within the same second, the last
  write wins for that round; the next sync merges again, but an edit could be lost in
  that window. Deleting a puzzle on the phone does not delete its Drive backup.
- The production build has no fixtures (they're dev-only), so on the deployed site use
  Settings → Import data pack from files.
