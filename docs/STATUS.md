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

### Session 2: fill engine and autofill (branch `claude/tender-feynman-kif67m`)
- **Engine** (`src/engine/`, no DOM, runs in `worker.ts`):
  - `lexicon.ts`: per-length index, words sorted by base value (score + boost × 0.3,
    capped at 60) so bitset scans visit the best words first; lazily built
    position × letter bitsets (`Uint32Array`); floor sets cached per floor; day values
    cached per day (`settings.ts` `dayAdjustment`, ±3 max: early week favours NYT-familiar
    words, late week fresh and long ones). Score 1 and Settings bans are never-use.
    Boosted Notebook answers missing from the list are added with score 40
    (`NOTEBOOK_BASE_SCORE`); answers typed with spaces keep their parts for dupe rule 2.
  - `dupes.ts`: SPEC §4.5. Rule 1 affix exception, as implemented: a shared 4-letter
    string is exempt when it sits at the same distance from the same end in both words
    and overlaps a listed affix both words share (so NATION/RATION are fine; at most 3
    shared letters next to the affix are tolerated). Rule 2 segments into the fewest
    parts (≥ 2) of lexicon words with score ≥ 25 or the common short list. Note this
    also splits ordinary words (CARPET → CAR PET), so CAR + CARPET is flagged.
    `DupeTracker` indexes placed entries for fast checks during search.
  - `board.ts`: scope split per §4.4 into var / viability / fixed / ignore slots.
    Whole-grid scope = every empty square (letters already in the grid are kept).
    Slots with a rebus, and slots under 3 letters, are ignored by the search.
  - `search.ts`: MRV, top-12 candidates forward-checked and ordered by value +
    1.5·log2(crossing room), conflict-directed backjumping; `best` mode is
    branch-and-bound for the improve phase.
  - `autofill.ts`: restarts with growing noise and per-slot word bans to find distinct
    fills (≥ 15% of open squares differ), LNS improve phase (clear a weak entry plus 2
    squares along each crosser, refill by B&B), streamed results; a generator, so the
    worker runs it in 30 ms slices and handles `stop` between them.
  - `candidates.ts` (Fill list: crossing room per candidate, dupe reason), `check.ts`
    (dupes, viability, entry quality with debuts/pre-2005 grouped, grid stats).
  - `client.ts`: the one worker, request/response by id, `startAutofill(...).stop()`,
    `reloadEngine()` (called on `dataVersion` changes; session 3 should also call it
    after Notebook boost edits).
- **UI**: `state/fill.ts` (`FillController`, at `EditorSession.fill`): candidates for the
  current slot (debounced), background Check for the badge, select mode, autofill runs.
  Fill sheet / Fill tab (`FillPanel.tsx`; wide adds Last used and a clue history preview
  read straight from the `clues` store), select mode (Select button or long-press; tap
  toggles, drag paints a rectangle; banner overflow: current word, region, invert, clear)
  with in-place results (Fill A = best so far, Next fill, Keep), Autofill screen
  (`AutofillPanel.tsx`: scope, day, floor, keep-open K, streamed cards, Check of the
  shown fill, Keep searching, Widen selection, Apply), Check panel (`CheckPanel.tsx`,
  tap an issue to jump to the slot). Keep and Apply take a snapshot and commit one
  undoable diff with `src: 'autofill'`. Settings → Fill (`FillSettings.tsx`): per-length
  floors, affixes, app-level never-use words (stored in `settings.fill`).
  On the cover screen Fill / Autofill / Check use a taller sheet (`.sheet.tall`, 54%);
  the grid shrinks but stays visible.
- **Tests**: `tests/unit/dupes.test.ts`, `engine.test.ts`, `autofill.test.ts` (whole-grid
  fills of both 15×15 fixtures, selection keeps outside letters and leaves every touched
  slot a valid, dupe-free word, viability-only slots stay unfilled, failure reporting,
  benchmark: 15-square selection first result ~0.1 s locally, asserted < 2 s).
  `tests/e2e/fill.spec.ts`: Fill use + undo, select-drag + Autofill these + Keep + undo,
  Autofill screen on the mini grid + Check, at all three sizes.

### Session 3: data import, clues, notebook
- **Import** (already built in session 1) is unchanged apart from more tests: gzip/plain
  detection, a pack without a manifest, keeping existing clues when a file is missing.
  `importDataPack(files, onProgress)` in `src/data/import.ts` is the function session 4's
  Picker calls with File/Blob objects. After an import, Settings calls `resetWordCache()`.
- **Clue history** (`src/model/clues.ts`, pure): `nearDuplicates(draft, history)`
  (content-word overlap |A∩B|/max(|A|,|B|) ≥ 0.6, or whole-word containment where the
  contained side has ≥ 2 words), `clusterAngles` (most-shared content word per cluster,
  at most 3 + "other", light plural folding), `filterHistory` (All / Since 2015 / Thu–Sat).
  `src/data/clues.ts`: `getClueHistory(answer)` (one key read), `suggestAnswers(prefix)`,
  `wordFacts(word)` (score / NYT count / last year from the packed lexicon, cached per length).
- **Clue editor** (`src/ui/Clue.tsx`, §3.5): slot + answer header with score badge and NYT
  count, prev/next entry, "Your clue" textarea with the near-duplicate warning (names the
  clues with weekday and year), day target chips Mon–Sat (highlights same-weekday clues),
  Notebook ideas (tap to insert), angle split bar (tap a segment or legend to filter),
  filter pills, history list with near-matches highlighted, **Save to Notebook** and
  **Save clue** (undoable via `EditorSession.commit`). Full page on the cover screen (Clue
  tool), Clues tab on the inner screen.
- **Clues tab** (`src/ui/Clues.tsx`): type an answer, prefix suggestions from the clue
  store, then facts, Notebook ideas and the full history view.
- **Notebook** (`src/ui/Notebook.tsx`, §3.7): Answers / Themes tabs with counts, search,
  sort (boost / newest / A–Z), answer cards ("9 letters · 2 words (4, 5)", ideas, boost),
  edit dialog (clue ideas add/remove, boost slider 1–100 showing the score effect, note,
  delete), theme cards with the symmetry pill (`symmetryCheck`), Edit / Open puzzle /
  **Start a puzzle** (the New puzzle dialog with the theme preselected).
  Model in `src/model/notebook.ts`; local store in `src/data/notebook.ts`
  (`readNotebook`, `saveAnswer` (rename tombstones the old key), `saveTheme`, `deleteItem`,
  `addClueIdea`, `writeNotebook`, `mergeIntoLocal(remote)`, `notebookBoosts()`,
  `notebookVersion` signal). Tombstones are stored in the `notebook` store under
  `deleted:<key>`.
- **Merge** (`mergeNotebooks(a, b)`, §5.4): per key newest `updated` wins (missing = 0),
  a tombstone wins over edits not newer than it (ties go to the tombstone), superseded
  tombstones are dropped, ties between equal times break deterministically, so the merge
  is symmetric and idempotent (tested).
- **Theme entries in the grid** (`src/model/theme.ts`, `src/ui/ThemePanel.tsx`): Theme tab
  on the inner screen, "Theme entries" in the editor overflow on the cover screen. Lists
  the linked theme's entries + revealer; "Place in 17-Across" when the current slot has
  the right length (locked theme letters, one undoable step, refuses conflicting locked
  crossings), shows where an entry is placed, Unlock, link / unlink a theme.
- **Tests**: +27 unit tests (70 total) (clue matcher, angles, filters, notebook merge, symmetry
  check, local notebook store, word facts, theme placement, import parsing). Playwright
  adds a Notebook / Clues / clue editor / theme panel flow with screenshots at all three
  sizes.
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

### Session 5: merge and integration
- **Merged** PRs askoller/crossword-builder#3 (session 2), #1 (session 3) and #2 (session 4)
  into `main` in that order with merge commits. Conflicts: `styles.css` (each branch
  appended a block at the same spot; all kept, in merge order), `src/ui/Editor.tsx`
  (Fill / Autofill / Check panels from session 2 plus the Clue editor and Theme panel from
  session 3; the inner-screen tabs are Fill → `FillPanel`, Clues → `ClueEditor`,
  Theme → `ThemePanel`; overflow has both "Theme entries" and the working Export .puz),
  `src/state/editor.ts` (`FillController` and the Drive flush hook), `src/ui/Settings.tsx`
  (Fill settings and the Drive section). `src/model/notebook.ts`, `src/data/notebook.ts` and
  `tests/unit/notebook.test.ts` were byte-identical in #1 and #2; one copy kept.
- **New puzzle → Notebook theme**: the New puzzle dialog now reads themes through
  `readNotebook()` and shows them as Notebook theme cards (`src/ui/ThemePicker.tsx`: title,
  entries with lengths, revealer, the symmetry pill computed for the chosen grid width,
  a warning when an entry is longer than the width), with "No theme" first. The theme
  the dialog was opened for (Notebook → Start a puzzle) is preselected and listed first.
  Creating a puzzle from a theme opens the editor on Theme entries (sheet on the cover
  screen, Theme tab on the inner screen) via `openPanelOnLoad` / `takePanelOnLoad` in
  `src/state/editor.ts`. `SymmetryPill` moved to `ThemePicker.tsx`.
- **Fill ↔ Notebook boosts**: `notebookVersion` changes reload the engine's word list
  (`reloadEngine()`, `src/state/fill.ts`) and refresh the open Fill list and Check, so a
  boost edited in the Notebook, a "Save to Notebook" from the clue editor, or a change
  pulled from ThemeFill shows up in Fill and Autofill straight away. Boosted answers
  missing from the list are added by the engine (session 2). Fill rows show the boost as
  a small version of the Notebook's boost pill (`.fill-word .boost`).
- **Notebook edits → Drive**: `src/data/notebook.ts` has a second signal, `notebookEdits`,
  bumped only by edits made in the app (`saveAnswer`, `saveTheme`, `deleteItem`,
  `addClueIdea`), not by sync merges. `src/sync/index.ts` pushes 1.5 s after an edit
  (`NOTEBOOK_PUSH_DELAY_MS`). `syncNotebook()` called during a running sync queues one
  more round, so a mid-sync edit still reaches Drive. `mergeIntoLocal()` now reads, merges
  and writes in **one IndexedDB transaction** (an edit saved while a download is in flight
  can no longer be overwritten by the merge result) and only bumps `notebookVersion` when
  the content actually changed (a no-op sync doesn't reload the engine). The Notebook's
  status line (`NotebookSyncLine` in `src/ui/Drive.tsx`) reads "Synced with ThemeFill ·
  2 min ago" / "Syncing…" / "Sync failed · … · tap to retry" / "Offline · …" /
  "Sync paused · tap to resume" / "On this phone · Connect Google Drive to sync with
  ThemeFill"; tapping it syncs now (or goes to Settings / resumes sign-in).
- **Tests**: 134 unit tests (17 files): +2 for the queued sync round and edit vs. merge
  counting. Playwright: 8 tests × 3 sizes = 24, all passing (ran the full suite 3× in a
  row). New `tests/e2e/integration.spec.ts`: load fixtures, connect mocked Drive, add a
  boosted Notebook answer not in the list (QXJZ, boost 100) → it appears in Drive's
  `notebook.json` and tops the Fill list with "+100"; New puzzle → pick the fixture theme
  card → the editor opens on its theme entries. The Google mock moved to
  `tests/e2e/mockGoogle.ts` (shared with `drive.spec.ts`). Screenshots
  `*-notebook-synced.png`, `*-fill-boost.png`, `*-new-puzzle-theme.png`,
  `*-new-puzzle-theme-editor.png` in `test-results/screens/`.
- **Screens checked against SPEC §3** at 476×752 and 1164×878: home, editor, Fill sheet /
  Fill tab with the full table, select mode, Autofill, Check, clue editor, Clues browser,
  Notebook answers / themes / edit, New puzzle with theme cards, Theme entries,
  Settings → Drive. No layout regressions from the merge.

## Next
- Andrew tests on the Fold 8 (cover and inner screen) and on a real Google account (manual
  steps above), then a polish session for the issues he finds (`docs/SESSIONS.md`,
  session 5 template's "issues Andrew found" list).
- Check the engine's speed on the real data pack on the device.

## Known issues
- Screen sizes for the Fold 8 are estimates; check on the device. The fixed-height panel
  sheet on the cover screen (222 px) is sized to replace tool row + keyboard; Fill,
  Autofill and Check use a taller sheet (54%).
- Selecting squares whose slots also run through empty squares outside the selection
  leaves those squares empty: such slots are only checked for room (SPEC §4.4). Select
  whole entries (or use Select region) to fill them.
- Fill-list sorting by NYT / freshness / crossing room re-sorts the best 300 by value,
  not the whole list.
- Autofill's stop-within-100 ms is by design (30 ms slices) but has no automated test
  (vitest runs without workers).
- No check yet that the engine is fast enough on the real 195k-word pack on the Fold 8;
  fixture runs (270k synthetic words) are fast on the CI machine. Every Notebook change
  rebuilds the engine's index on the next Fill request; fine on fixtures, unmeasured on
  the device.
- Rebus entry uses a mode: long-press Block → Rebus (or Rebus on the inner screen), type
  letters, tap the clue bar or press Enter to finish.
- Starting a puzzle from a theme creates an empty grid that opens on Theme entries;
  Andrew places each entry after drawing blocks (no automatic placement).
- The fixture clue history is uniform ("History fixture clue N"), so the angle split bar
  shows only with real data or varied clues (unit-tested with hand-made clues).
- Symmetry check on Notebook theme cards assumes a 15-wide grid; in New puzzle it uses the
  chosen width, inside a puzzle the puzzle's width.
- Drive: the real Google flow (consent, Picker, folder pick granting access under
  `drive.file`) is only tested with mocks; follow the manual steps above.
- Drive: if the laptop and the app write `notebook.json` within the same second, the last
  write wins for that round; the next sync merges again, but an edit could be lost in
  that window. Deleting a puzzle on the phone does not delete its Drive backup.
- Two `.score-badge` rule sets exist in `styles.css` (Fill rows from session 2, clue editor
  from session 3); the later one wins where they overlap. Looks right in both screens.
- The production build has no fixtures (they're dev-only), so on the deployed site use
  Settings → Import data pack from files.
