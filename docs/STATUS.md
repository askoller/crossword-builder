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
- No Notebook UI yet, so "Start from a Notebook theme" only sets `themeId` and the title.
- The production build has no fixtures (they're dev-only), so on the deployed site use
  Settings → Import data pack from files.
