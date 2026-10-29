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

## Next
- Sessions 2, 3 and 4 (see `docs/SESSIONS.md`), in parallel.
- Session 2 is done (see above). Session 5 merge notes: `src/ui/Editor.tsx` now renders
  `FillPanel`, `AutofillPanel`, `CheckPanel` and `SelectBanner`; the Clue panel and the
  Clues / Theme tabs are still placeholders for session 3 (`CLUE_PLACEHOLDER`,
  `SidePanel`). "Clue history" / "Full clue history" set `s.panel.value = 'clue'`.
  `PanelName` still contains `'select'` but select mode is `s.fill.selectMode`.
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
- Selecting squares whose slots also run through empty squares outside the selection
  leaves those squares empty: such slots are only checked for room (SPEC §4.4). Select
  whole entries (or use Select region) to fill them.
- Fill-list sorting by NYT / freshness / crossing room re-sorts the best 300 by value,
  not the whole list.
- Autofill's stop-within-100 ms is by design (30 ms slices) but has no automated test
  (vitest runs without workers).
- No check yet that the engine is fast enough on the real 195k-word pack on the Fold 8;
  fixture runs (270k synthetic words) are fast on the CI machine.
- Rebus entry uses a mode: long-press Block → Rebus (or Rebus on the inner screen), type
  letters, tap the clue bar or press Enter to finish.
- No Notebook UI yet, so "Start from a Notebook theme" only sets `themeId` and the title.
- The production build has no fixtures (they're dev-only), so on the deployed site use
  Settings → Import data pack from files.
