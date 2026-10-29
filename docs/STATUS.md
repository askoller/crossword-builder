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

## Next
- Sessions 2, 3 and 4 (see `docs/SESSIONS.md`), in parallel.
- Session 2: the engine reads the lexicon with `openDb().get('lexicon', len)` (packed
  chunks above; `lexiconWord(chunk, i)` in `importCore.ts`). Wire Fill / Autofill / Check /
  Select into `PanelName` in `src/state/editor.ts` and replace the placeholders. Use
  `EditorSession.commit(changes)` for Keep (one undoable step) after
  `EditorSession.snapshot('autofill')`. Fill settings (floors, affixes, never-use) are not
  in Settings yet.
- Session 2: boosts for Fill/Autofill come from `notebookBoosts()` (letters → 1–100,
  ×0.3 = `BOOST_FACTOR`); boosted answers missing from the word list should be added.
  The Fill sheet's **Clue history** button can open the clue editor with
  `s.panel.value = 'clue'`. `PanelName` now also has `'theme'`.
- Session 4: Notebook sync = download Drive `notebook.json` → `mergeIntoLocal(remote)` →
  upload the returned file (it's already merged and tombstoned). Replace the "On this
  phone · syncs with ThemeFill once Google Drive is connected" line in `Notebook.tsx`.
- Session 4: call `importDataPack(files)` from the Picker; the pack notebook for seeding
  Drive is in `settings.datapackNotebook`. The `outbox` store exists but nothing writes to
  it yet. Home backup card and Settings → Google Drive are static placeholders.
  "Export .puz" in the editor overflow is disabled.

## Known issues
- Screen sizes for the Fold 8 are estimates; check on the device. The fixed-height panel
  sheet on the cover screen (222 px) is sized to replace tool row + keyboard.
- Select mode itself (tap/drag to select cells) is not built; long-press and the Select
  button only open a placeholder.
- Rebus entry uses a mode: long-press Block → Rebus (or Rebus on the inner screen), type
  letters, tap the clue bar or press Enter to finish.
- Starting a puzzle from a theme creates an empty grid; Andrew places each entry from the
  Theme tab/sheet after drawing blocks. Notebook edits are local only until session 4.
- The fixture clue history is uniform ("History fixture clue N"), so the angle split bar
  shows only with real data or varied clues (unit-tested with hand-made clues).
- Symmetry check on Notebook theme cards assumes a 15-wide grid; inside a puzzle it uses
  the puzzle's width.
- The production build has no fixtures (they're dev-only), so on the deployed site use
  Settings → Import data pack from files.
