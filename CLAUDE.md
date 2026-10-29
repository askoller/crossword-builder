# Crossword Builder: instructions for every session

A mobile-first crossword construction web app for one constructor (Andrew), used on a
Samsung Galaxy Z Fold 8 (wide "passport" model). It brings ThemeFill's fill engine,
scored word list, NYT clue history and Notebook to the phone.

Read `docs/SPEC.md` before changing anything. `docs/DATA-PACK.md` defines the data files.

## Hard rules

1. **This repository is public. Never commit personal data.** That means no word lists,
   scores, taste ratings, notebook contents, NYT clues or answer counts, puzzle grids or
   theme ideas, Google client secrets, tokens, or anything copied from Andrew's files.
   Personal data reaches the app only at runtime, imported from his Google Drive or a
   local file, and is stored in IndexedDB on the phone. `.gitignore` blocks the usual
   paths; check `git status` before every commit anyway.
2. Tests and demos use the synthetic fixtures in `fixtures/` only (see "Fixtures" below).
3. The app must work offline after first load. Nothing in the editing path may wait on
   the network.
4. Never lose work. Every edit is persisted to IndexedDB within 500 ms and on
   `visibilitychange`/`pagehide`. Undo history survives a reload.
5. Touch first. Targets are at least 44 px. Never use the system keyboard for grid entry;
   the app has its own on-screen keyboard. Physical keyboards also work (letters,
   Backspace, arrows, Space to switch direction, Tab for next entry).

## Stack

- Vite + TypeScript (strict) + Preact with `@preact/signals`.
- `vite-plugin-pwa` (installable, offline, auto-update prompt).
- `idb` for IndexedDB.
- Fill engine and autofill run in a Web Worker (`src/engine/worker.ts`). The UI thread
  never runs a search.
- Vitest for unit tests; Playwright for screenshot checks at the two device sizes.
- Deployed to GitHub Pages by `.github/workflows/deploy.yml` on push to `main`
  (`base: '/crossword-builder/'` in `vite.config.ts`).
- No backend. Google sign-in uses Google Identity Services in the browser.

## Device sizes (test both, every UI change)

| Mode | CSS viewport (estimate) | Aspect | Layout |
|---|---|---|---|
| Cover screen, folded | 476 × 752 | 10:16 portrait | single column: grid, clue bar, tool row, keyboard |
| Inner screen, unfolded | 1164 × 878 | 4:3 landscape | grid + keyboard left, panel right |

The exact CSS pixel sizes are estimates. Lay out by aspect ratio and available space, not
fixed pixels, and switch layouts with a container/media query at `min-aspect-ratio: 1/1`
or width ≥ 900 px. Also keep 412 × 915 (a normal phone) usable.

## Commands

- `npm run dev`: dev server
- `npm test`: unit tests (must pass before committing)
- `npm run test:e2e`: Playwright screenshots at both sizes into `test-results/`
- `npm run build`: production build into `dist/`

## Fixtures

`fixtures/` holds synthetic data only: a word list built from a permissively licensed
English word list with deterministic pseudo-scores (`scripts/make-fixtures.mjs`), a fake
clue history, and a few small test grids. Never replace these with real data.

## Working style

- Keep modules small and pure where possible; the engine has no DOM imports.
- Write tests for engine behaviour (pattern matching, crossing checks, dupe rules,
  autofill on a selection) before wiring UI.
- When a session finishes, update `docs/STATUS.md`: what was built, what's left, known
  issues. The next session reads it first.
- Commit in small steps with clear messages. Open a pull request at the end of the
  session unless the prompt says to push to `main`.
