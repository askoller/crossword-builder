# Build plan: cloud sessions

Each session starts from a fresh clone and reads `CLAUDE.md`, `docs/SPEC.md` and
`docs/STATUS.md` first. Session 1 runs alone and pushes to `main`. Sessions 2, 3 and 4
run in parallel on their own branches and open pull requests. Session 5 merges and fixes.

Paste each prompt as the first message of a new cloud session on this repository.

---

## Session 1: foundation (run alone, push to `main`)

```
Read CLAUDE.md, docs/SPEC.md and docs/STATUS.md first.

Build the foundation of Crossword Builder and push it straight to main:

1. Scaffold: Vite + TypeScript (strict) + Preact + @preact/signals, vite-plugin-pwa,
   idb, Vitest, Playwright. base '/crossword-builder/'. GitHub Actions workflow that
   runs tests and deploys dist/ to GitHub Pages on push to main.
2. scripts/make-fixtures.mjs: build fixtures/ from the MIT-licensed npm package
   an-array-of-english-words (3–15 letters, A–Z), with deterministic pseudo-scores
   (hash-based, spread 20–55, about 0.2% set to 1), fake NYT counts/years, and a fake
   clue history for ~200 common words, all in the docs/DATA-PACK.md format. Commit the
   generated fixtures. No real word lists or clues.
3. Data layer: IndexedDB schema from SPEC §5.1, puzzle model §5.2, autosave (300 ms
   debounce + visibilitychange/pagehide), undo/redo as compact diffs persisted per
   puzzle, snapshots, navigator.storage.persist().
4. Screens with the visual language in SPEC §2: Puzzles home (§3.1) with New puzzle,
   Grid editor (§3.2) with the custom keyboard, symmetric blocks, rebus/circle/lock,
   clue bar, prev/next, physical keyboard support, and the labeled Undo + Redo in the
   header. Responsive layouts for the cover screen (476×752) and inner screen (1164×878,
   SPEC §3.8) switching by aspect ratio. Leave Fill, Autofill, Check, Clue, Select as
   buttons that open placeholder panels, so later sessions can fill them in.
5. A dev-only "Load fixtures" button in Settings that imports fixtures/ through the same
   import path the real data pack will use (SPEC §6), so the app is usable in testing.
6. Tests: unit tests for slots/numbering, typing/advance/backspace, symmetry, undo/redo,
   autosave round trip. Playwright screenshots of home and editor at both sizes.

Finish with docs/STATUS.md updated (done, next, known issues, the Pages URL).
```

---

## Session 2: fill engine and autofill (parallel, branch + PR)

```
Read CLAUDE.md, docs/SPEC.md and docs/STATUS.md first. Work on a branch and open a PR.

Build the engine in src/engine/ (worker-only, no DOM) per SPEC §4, then wire it to the UI:

1. Lexicon index with per-length/position/letter bitsets, effective value with boost and
   day adjustment, never-use (score 1) excluded.
2. Candidates for a slot, crossing room per candidate (§4.3).
3. Duplicate rules exactly as SPEC §4.5, with tests for SPOUSE/SPOUSES, PARTS/APART,
   NATION/RATION (affix exception), ERE vs ERENOW, TEA vs TEAPARTY, AND vs STANDUP (not
   a dupe), same entry twice.
4. Autofill (§4.4): MRV + forward checking + conflict-directed backjumping, then the
   large-neighbourhood improve phase; distinct results streamed from the worker;
   stoppable. Selection scope with the exact semantics in §3.3/§4.4. Tests: selection
   autofill never changes letters outside the selection; every slot touching the
   selection is a valid word; whole-grid fill of a fixture grid completes.
5. Check (§4.6).
6. UI: Fill suggestions sheet (§3.4), select mode + in-place autofill banner with Next
   fill / Keep (§3.3), Autofill screen with scope toggle (§3.6), Check panel, and the
   Fill tab on the inner screen. Keep is one undoable step.
7. Benchmark on fixtures in a test: selection of ~15 cells returns a first result in
   under 2 s on CI.

Update docs/STATUS.md before opening the PR.
```

---

## Session 3: data import, clues, notebook (parallel, branch + PR)

```
Read CLAUDE.md, docs/SPEC.md and docs/STATUS.md first. Work on a branch and open a PR.

1. Data pack import (SPEC §6, docs/DATA-PACK.md) from local files (<input type=file
   multiple>, works with files from Google Drive on Android). Parse gzip with
   DecompressionStream in a worker, batch-write to IndexedDB with progress, store the
   manifest, show it in Settings. The Google Drive Picker path is added by session 4;
   expose an import function it can call with File/Blob objects.
2. Clue history store keyed by answer. Clue editor (§3.5) with the near-duplicate
   warning, angle split, filters, day chips, Notebook ideas, Save clue / Save to Notebook.
   Clues tab in bottom nav: look up any answer.
3. Notebook (§3.7): Answers and Themes, boost slider, letter/word count, symmetry check
   pill, Start a puzzle from a theme (creates a puzzle with the theme entries as locked
   slots placed by the user afterwards). Local storage only in this session; implement
   the merge function from §5.4 as a pure, tested module (tombstones, newest wins) that
   session 4 will use for Drive sync.
4. Clues and Theme tabs on the inner screen panel.
5. Tests for import parsing, the near-duplicate matcher, the notebook merge.

Update docs/STATUS.md before opening the PR.
```

---

## Session 4: Google Drive backup, Picker import, .puz (parallel, branch + PR)

```
Read CLAUDE.md, docs/SPEC.md and docs/STATUS.md first. Work on a branch and open a PR.

The Google Cloud values are in src/config.ts (OAuth client ID, API key restricted to the
Picker API and this site, app/project number). They are public by design; no secrets.

1. Google Identity Services token client, scope drive.file (SPEC §5.3). Connect /
   disconnect in Settings, silent renewal, "Backup paused · tap to resume" banner.
2. Drive folder "Crossword Builder" with puzzles/ and notebook.json; upload changed
   puzzles (JSON + .puz) every 3 minutes and on background; offline outbox; restore one
   or all puzzles.
3. Google Picker import of the data pack from Crossword Builder/data (multi-select),
   calling the import function from session 3 if it's merged, otherwise a shared
   interface stub in src/data/import.ts.
4. Notebook sync file per §5.4: create from the data pack notebook if missing, pull on
   start/foreground/every 2 min while open, merge (use session 3's merge if merged,
   otherwise implement the same contract), write back.
5. .puz export (SPEC §7) with round-trip tests, Export in the overflow menu and in
   backups.
6. Mock Google APIs in tests; document manual test steps in docs/STATUS.md.

Update docs/STATUS.md before opening the PR.
```

---

## Session 5: merge and polish (after 2–4)

```
Read CLAUDE.md, docs/SPEC.md and docs/STATUS.md first.

Merge the open PRs from sessions 2, 3 and 4 into main, resolving conflicts. Make sure
the whole app builds, all tests pass, and Playwright screenshots at 476×752 and 1164×878
match SPEC §3. Then fix these issues Andrew found on his phone:

<paste the list here>

Push to main and update docs/STATUS.md.
```
