# Crossword Builder: v1 spec

Owner: Andrew (crossword constructor, NYT and Universal). Single user. Android, Samsung
Galaxy Z Fold 8 (wide). Desktop companion: ThemeFill (Windows app, separate project).

The approved design mockup is a private Claude canvas ("Crossword Builder Mobile"). This
spec is the written form of it; where they differ, this spec wins.

## 1. What v1 does

Build and fill American-style crossword grids on the phone:

1. Puzzle library with autosave and Google Drive backup.
2. Grid editor with a custom keyboard, blocks with symmetry, rebus, circles, locks,
   undo/redo.
3. Fill suggestions for the selected slot, ranked by Andrew's own scores, with NYT usage
   and crossing viability.
4. Autofill of the whole grid **or of selected squares only**, in a worker, returning
   several distinct fills to step through.
5. Check: Andrew's duplicate rules, crossing viability, grid stats.
6. Clue editor with full NYT clue history for the entry and a near-duplicate warning.
7. Notebook (answers with clue ideas and a 1–100 boost; theme ideas), shared with
   ThemeFill through a file in Google Drive.
8. `.puz` export (with clues).

Out of scope for v1: accounts, collaboration, a server, grid design from scratch
(ThemeFill's grid factory), theme search, Claude-powered clue drafting.

## 2. Visual language

- Fonts: IBM Plex Sans (UI, 400/500/600/700) and IBM Plex Mono (patterns, scores,
  answers in lists, 500/600). Self-host them for offline use.
- Colors (light theme only in v1):
  - ink `#15171C`, app background `#F3F4F6`, surface `#FFFFFF`, hairline `#E3E5E9`,
    control border `#D9DCE1`, muted text `#5B616E` (secondary labels only).
  - primary `#2448D8` (buttons, high-score badges, typed letters), primary-soft `#E4EAFF`.
  - grid: lines `#A4A9B3` (1 px gaps), outer border 2 px ink, blocks ink.
  - active cell `#FFD452`, current word `#CFE0FF`, locked/theme cells `#EEF1F7`.
  - selection (select mode) `#FFD9A0`; selection banner `#FFE7C2`; autofill-preview
    letters `#8A4B00`.
  - warning `#B4530A` (badge) / `#FFF4E5` with text `#6B3600` (inline notice);
    success `#1F7A4D`.
- Letters: theme/locked letters ink; letters Andrew typed primary blue; previewed
  letters (fill suggestion or autofill option not yet kept) lighter (`#5B7BEA` or
  `#8A4B00` for autofill).
- Clue numbers top-left of each cell, about 28% of cell height.
- Radius: 10–14 px on controls and cards; pills fully rounded. No gradients, no emoji.

## 3. Screens

### 3.1 Puzzles (home)
- Title "Puzzles", search button.
- Backup card: "Backed up to Google Drive · Crossword Builder folder · 2 min ago", or
  "Not backed up yet · Connect Google Drive" or "Backup paused · tap to sign in".
- Filter pills: All / In progress / Submitted.
- One card per puzzle: mini grid thumbnail (blocks + theme cells tinted), title, size ·
  day · outlet, status pill (Theme draft, Themers set, Filling, Cluing, Submitted), last
  edited.
- "New puzzle" floating button: size (15×15 default; 21×21 Sunday; custom), day, outlet,
  optional start from a Notebook theme. Or **Import**: a `.puz` (Crossword Compiler
  `.ccw` planned) from the phone's files or Google Drive (Picker): grid, letters,
  clues, circles, rebus, with an option to lock the imported letters; whatever can't be
  imported is listed before Import.
- Bottom nav: Puzzles, Notebook, Clues (the clue browser: look up any answer's history),
  Settings.

### 3.2 Grid editor (cover screen, 10:16)
Top to bottom:
1. Header: back, puzzle title, save status ("Saved · Drive 2 min ago"), the
   **Construct | Clue** mode switch (§3.11), **Undo** (a
   labeled pill, disabled style when nothing to undo), Redo (icon), overflow menu
   (Rename, Puzzle settings, Export .puz, Duplicate, Delete).
2. Grid: square, full width minus 12 px margins.
   - Tap a cell: select it. Tap the selected cell again: switch direction.
   - Long-press a cell: enter select mode with that cell selected.
3. Clue bar (current-word blue): prev/next entry arrows, "6-Down", the pattern in mono
   (`??G?L`), the clue or "No clue yet · 5 letters". Tapping it switches direction.
4. Tool row (6 equal buttons): **Select**, **Fill** (primary, shows match count),
   **Autofill**, **Check** (warning badge with issue count), **Clue**, **Block**.
5. Keyboard: QWERTY rows of 10/9/7 letters; row 3 has Switch-direction on the left and
   Delete on the right. Rebus, Circle and Lock live in the overflow of the tool row or a
   long-press on Block.

Typing advances within the current word, skipping locked cells. Backspace clears the
current cell, or moves back and clears. Block toggles the cell and its 180° partner
(symmetry on by default; Puzzle settings can switch to none / left-right / diagonal).

### 3.3 Select mode and autofill selection
- Select button (or long-press) turns select mode on. The tool button shows the active
  state (filled `#8A4B00`).
- Tapping cells adds or removes them; dragging paints a rectangle. Locked cells cannot be
  selected. Quick actions in the banner overflow: select current word, select region
  (all open cells connected to the tapped one, bounded by blocks and filled cells),
  invert, clear.
- The clue bar is replaced by an orange banner: "13 squares selected · Tap squares to
  add or remove. The rest of the grid stays as is." with **Clear** and **Autofill
  these**.
- Autofill these runs the engine on just those cells: every other letter in the grid is a
  fixed constraint, and every slot touching a selected cell must end up a valid word
  (empty cells outside the selection act as wildcards but each slot crossing the
  selection must keep at least one candidate).
- Results appear in place: the grid previews option letters in `#8A4B00`; the banner
  reads "Fill A of 3 · 13 squares" with the new entries and average score, plus **Next
  fill** and **Keep**. Keep applies it as one undoable step.

### 3.4 Fill suggestions (sheet over the grid)
- Opens from Fill. The grid stays visible above; the slot stays highlighted; the selected
  row previews in the grid.
- Header: "6-Down · 5 letters", pattern, "20 in your list".
- Filters: Score floor (40+ default, adjustable), No dupes (on), Crossings OK, Sort
  (score / NYT uses / freshness / crossing room).
- Rows: word (mono), score badge (solid primary ≥ 45, soft 40–44, grey below), NYT use
  count with "last ’24", crossing bar + "min 103 fits" (the smallest number of candidates
  left in any crossing slot if this word goes in, counting words at or above the floor).
  Bar is blue at ≥ 100 fits, orange below. Notebook answers show their boost.
- Footer: **Use BAGEL** (primary), **Clue history**.

### 3.5 Clue editor
- Header: slot, answer, score badge, NYT count.
- "Your clue" textarea. While typing, compare against the NYT history: show an inline
  warning when the draft is close to a past clue (normalized token overlap ≥ 0.6, or one
  contains the other), naming the matching clues with weekday and year.
- Day target chips Mon–Sat (defaults to the puzzle's day).
- Notebook clue ideas for this answer, if any, tappable to insert.
- NYT clue history: angle split bar (simple clustering by shared content words; label
  each cluster by its most common word, at most 3 clusters + "other"), filter pills
  (All N / Since 2015 / Thu–Sat), and the list (date, weekday, clue), newest first;
  near-matches highlighted.
- Buttons: Save to Notebook, **Save clue**.

### 3.6 Autofill
- Scope toggle: **Whole grid** / **Selected squares · N** (the second only when a
  selection exists; it's the default then).
- Settings: Day (Mon–Sat; shifts weighting: early week prefers familiar entries with
  more NYT uses, late week prefers fresher and longer entries), Floor (lowest score
  allowed; per-length defaults in Settings), Keep crossers open (reject fills that leave
  any slot outside the scope with fewer than K candidates; K = 3 default).
- Results: "Fills for the selection · best 3 of 5" with cards: thumbnail with the scope
  highlighted, average score, weakest entry, the new Across and Down entries.
  Whole-grid results also list: entries under the floor, debuts (not in NYT), entries
  only used before 2005.
- Check for the selected result (see 4.6).
- Buttons: Keep searching / Widen selection, **Apply Fill A**.
- Whole-grid search streams results as found ("Searching… 41s"), keeps the best N
  distinct fills (differing in at least 15% of open cells), and can be stopped.

### 3.7 Notebook
- Tabs: Answers / Themes. "Synced with ThemeFill" status line.
- Answers: answer (spaces allowed; letter count and word breakdown "9 letters · 2 words
  (4, 5)"), clue ideas (any number), boost 1–100 slider, note; sort by boost / newest /
  A–Z; search.
- Themes: title, description, revealer with clues, theme entries with clue ideas and
  lengths, a symmetry check pill ("8·8 · 10·10 · 9 center" green, or "13 unpaired"
  amber), **Start a puzzle** / **Open puzzle**, edit.
- Boosted answers rank higher in Fill and Autofill (+0.3 score points per boost point,
  so boost 100 adds 30, matching ThemeFill) and are added to the word list if missing.

### 3.8 Inner screen (unfolded, 4:3 landscape)
- Header: back, title, size · day, save status, Undo/Redo, overflow.
- Left column: grid (as large as fits, ~560 px), clue bar, keyboard under it.
- Right column: tool row (Select, Autofill, Check, Block, Rebus) and a panel with tabs
  Fill / Clues / Theme. Fill shows the full suggestion table (adds a Last-used column)
  and the selected word's clue history preview under it, with **Full clue history** and
  **Use WORD**.
- Rotating or folding/unfolding keeps the current puzzle, selection and scroll state.

### 3.9 Settings
- Data: import data pack from Google Drive in one step (every file in
  `Crossword Builder/data`; the Picker only asks for the data folder once if the app
  can't see it) or from local files (picked one at a time or together, then imported);
  show manifest (word count, clue range, build date), re-import. A partial import without
  `manifest.json` keeps the stored manifest and updates only the counts it imported.
- Google Drive: connect / disconnect, folder name, last backup, "Back up now", restore.
- Fill: per-length floors (defaults: 3–6 letters 30, 7+ letters 40), dupe-rule affix
  exceptions (default: TION, SION, INGS, NESS, MENT, ABLE, IEST, IERS), never-use list
  editor (score-1 words plus app-level bans).
- About / version / "Update available" banner from the service worker.

### 3.10 Layouts (chosen from the real viewport)
`chooseLayout(width, height)` in `src/model/layout.ts` (pure, unit-tested):
- width ≥ height → **inner landscape** (§3.8).
- portrait and width ≥ 600 px → **inner portrait** (the inner screen held upright, about
  3:4, ~880 × 1164): header; grid at full width but sized so the clue bar, tool row
  (Select, Fill, Autofill, Check, Clue, Block, Rebus) and the app's keyboard (taller keys)
  always fit below it. Fill / Clues / Theme (and Autofill, Check) open as a bottom sheet
  with the tabs in place of the keyboard; the tool row stays above it.
- portrait, narrower, aspect (w/h) < 0.55 → **phone** fallback (412 × 915); same
  single-column layout as the cover screen.
- otherwise → **cover** (§3.2).
The height used is the height *without* the Android keyboard (`ViewportTracker`: while a
text field has focus, a shorter viewport of the same width means the keyboard is open; a
width change means rotation or fold / unfold). It re-runs on resize, rotation, fold /
unfold and keyboard changes; cursor, selection, open panel and panel tab live in the
session, so they survive a layout change.

`#app` and overlays are sized to `visualViewport` (`--app-h`, `--vv-top`; viewport meta
has `interactive-widget=resizes-content`), so nothing is laid out under the keyboard.
Every text field in the app (Notebook, rename, settings, …) is scrolled into view above
the keyboard when it gets focus and when the keyboard resizes the page. The bottom nav
hides while the keyboard is open.

### 3.11 Construct and Clue modes
Header switch **Construct | Clue**, remembered per puzzle (`settings` key
`editorMode:<id>`, not part of the puzzle file).
- **Construct**: §3.2 / §3.8 / §3.10 layouts. Nothing in the editing surface opens the
  system keyboard: the clue editor's field has `inputmode="none"` (a physical keyboard
  still types there); tapping it or **Write in Clue mode** switches to Clue mode with
  the field focused.
- **Clue**: built around the Android keyboard. From the top: compact header (no save
  line); a one-line strip with the current answer's letters and its crossing entries
  (tap one to go to it); with the keyboard closed, a smaller grid (tap a cell to jump to
  its clue; no select mode); the clue list (Across, then Down; number, answer pattern,
  clue or "No clue yet" with empty rows tinted amber), scrolled so the current clue
  stays visible; and the clue editor pinned directly above the keyboard: near-duplicate
  warning line, textarea, **Prev**, **History**, **Done**, **Next**. Next and Enter save
  and move to the next clue with the keyboard kept open; Done saves and closes it.
  History shows the NYT clue history and the near-duplicate warning in place of the
  list without taking focus from the field. On the inner screen in landscape the grid
  stays on the left and the strip, list and editor are on the right.
- Typing is kept as a draft (`settings` key `clueDraft:<id>`, written within 300 ms,
  survives a reload) and saved to the puzzle as one undoable step on Next / Prev /
  Enter / Done, or when the cursor moves to another entry.

## 4. Engine (`src/engine/`, worker-only)

Port the approach of ThemeFill's Go solver; keep everything in typed arrays.

### 4.1 Lexicon
- Words A–Z only, length 3–21, with score (1–60; **1 = never use**, excluded from all
  suggestions and fills), NYT count, last NYT year, boost (from Notebook).
- Effective value = score + boost × 0.3, capped at 60, plus small day adjustments.
- Index: per length, per position, per letter → bitset of word ids (`Uint32Array`), so a
  pattern's candidates are an AND of bitsets. Build lazily per length; cache.

### 4.2 Grid model
- `cells[r*w+c]`: block flag, letter (or rebus string), circle, locked flag, source
  (theme / typed / autofill).
- Slots computed from blocks: id, direction, cells, number. Recompute on block change.
- Theme entries are locked slots.

### 4.3 Pattern match and crossing room
- Candidates(slot) = words of that length matching fixed letters, above the floor,
  not used elsewhere in the grid, not dupes (4.5).
- Crossing room for a candidate = min over crossing open slots of the candidate count if
  the candidate's letter is placed. Show it in Fill (4.3 numbers come from here).

### 4.4 Autofill
- Search over open slots: choose the slot with the fewest candidates (MRV), order values
  by value plus crossing room (forward check the top K), backtrack with conflict-directed
  backjumping. Node limit and deadline.
- Improve phase (large-neighbourhood search): repeatedly empty a compact region around a
  weak entry and refill it by branch-and-bound, keeping changes that raise total value.
- Score of a fill = length-weighted mean entry value over open slots; also report the
  weakest entry and counts under the floor.
- **Selection scope**: open cells = the selected cells. Slots fully inside or crossing
  the selection are open slots; cells outside the selection keep their letters (or stay
  empty as wildcards). A slot that crosses the selection but also has empty cells outside
  it is checked for viability (≥ K candidates) but not itself filled.
- Return several distinct fills (Hamming distance ≥ 15% of open cells), best first.
- Messages: `{type:'autofill', grid, scope, settings}` → stream `{type:'result', fill,
  stats}` … `{type:'done'}`; `{type:'stop'}` cancels within 100 ms.

### 4.5 Andrew's duplicate rules
1. **Shared 4-letter string**: no two entries may share any 4-letter substring (SPOUSE /
   SPOUSES, PARTS / APART), except substrings that sit inside a listed affix at the same
   end of both words (default affixes TION, SION, INGS, NESS, MENT, ABLE, IEST, IERS).
2. **Word inside a phrase**: an entry may not equal a component word of another entry
   that is a multi-word phrase (ERE vs ERENOW, TEA vs TEAPARTY). Plain substrings that
   aren't whole component words are fine (AND in STANDUP). The word list has no spaces,
   so split phrases with a dictionary segmentation: minimum number of parts, each part a
   lexicon word of length ≥ 2 with score ≥ 25 (or a common short word list:
   A, I, AN, AT, BE, BY, DO, GO, IF, IN, IS, IT, ME, MY, NO, OF, ON, OR, SO, TO, UP, US,
   WE). Notebook answers typed with spaces use their own spaces.
3. The same entry twice is always a dupe.

### 4.6 Check
- Duplicates (4.5) with the pair named and the rule that fired.
- Viability: any open slot with 0 candidates (error) or < 3 (warning), naming the slot
  and the remaining words.
- Grid: word count, block count, unchecked squares, 2-letter entries, symmetry,
  connectivity, longest/shortest entry.
- Entries under the floor, never-use entries (manually typed), entries only used before
  2005, debuts.

## 5. Storage, history, backup

### 5.1 On the phone
- IndexedDB stores: `puzzles` (current state), `history` (per puzzle, undo stack of
  compact diffs, cap 500), `snapshots` (full copies every 10 minutes of active editing
  and before every autofill Keep; keep 50 per puzzle), `lexicon`, `clues`, `notebook`,
  `settings`, `outbox` (pending Drive uploads).
- Write after every change (debounced 300 ms) and immediately on `visibilitychange` →
  hidden and `pagehide`.
- Call `navigator.storage.persist()` on first run; show the result in Settings.

### 5.2 Puzzle file (JSON, also the Drive backup format)
```json
{
  "format": 1, "id": "uuid", "title": "", "width": 15, "height": 15,
  "day": "Thu", "outlet": "NYT", "status": "Filling", "symmetry": "rotational",
  "cells": [{"b": 0, "l": "A", "rebus": null, "circle": 0, "lock": 0, "src": "theme"}],
  "clues": {"A1": {"text": "", "notes": ""}, "D1": {"text": ""}},
  "themeId": "notebook theme id or null",
  "created": "iso", "updated": "iso"
}
```

### 5.3 Google Drive backup (no server)
- Google Identity Services token client, scope `https://www.googleapis.com/auth/drive.file`
  (the app sees only files it created or that Andrew picks). The OAuth client ID is a
  public value set in `src/config.ts`; it is safe to commit. No client secret exists.
- Folder `Crossword Builder/` in My Drive (create if missing; remember its id):
  - `puzzles/<slug>-<id8>.json` and `puzzles/<slug>-<id8>.puz`
  - `notebook.json`
  - `data/` (the data pack, put there by Andrew's laptop; imported via the Picker)
- Upload changed puzzles every 3 minutes while editing and on going to background;
  queue in `outbox` when offline or signed out. Access tokens last ~1 hour; renew
  silently when possible, otherwise show "Backup paused · tap to resume". Local saving
  never depends on Drive.
- Restore: list `puzzles/*.json` in the folder; restore one or all.

### 5.4 Notebook sync with ThemeFill
- Shared file: `Crossword Builder/notebook.json`, same shape as ThemeFill's notebook:
  `{clues:[{answer, clues[], boost, note, updated}], themes:[{id, title,
  description, revealer:{answer, clues[]}, entries:[{answer, clues[]}], updated}],
  deleted:[{key, at}], synced}`. `updated` and `at` are Unix milliseconds.
- Item keys: an answer is keyed by its letters (A–Z only, upper case); a theme by `id`.
  Tombstone `key` is `"answer:<LETTERS>"` or `"theme:<id>"`.
- Merge rule (both sides): per key, newest `updated` wins; a tombstone wins over edits
  older than it. Items with no `updated` count as 0. The app writes the merged result
  back.
- The app creates this file the first time (from the data pack's notebook), so it stays
  visible under `drive.file`. ThemeFill reads and writes the same file through Google
  Drive for desktop (`G:\My Drive\Crossword Builder\notebook.json`), **writing in place**
  so the Drive file id doesn't change. (ThemeFill's side is handled outside this repo.)
- Pull on app start, on returning to foreground, and every 2 minutes while the Notebook
  is open.

## 6. Data pack import
See `docs/DATA-PACK.md`. Import parses `words.tsv.gz` and `clues.json.gz` with
`DecompressionStream`, in a worker, writes them to IndexedDB in batches with a progress
bar, and keeps the manifest. Clue history is stored per answer so lookups are a single
key read.

## 7. .puz export
Standard Across Lite binary: header checksums, solution, blank fill, clues in number
order, notes. Rebus via GRBS/RTBL sections; circles via GEXT. Validate by round-tripping
with a reader in tests.

## 8. Performance targets (on the Fold 8)
- Cold start to interactive grid < 1.5 s with data already imported.
- Fill suggestions for a slot < 100 ms.
- Selection autofill of ~15 cells: first result < 2 s.
- Data pack import < 60 s.

## 9. Acceptance checks per area
- Editor: type, delete, block with symmetry, switch direction, prev/next, undo/redo
  across reload; Playwright screenshots at 476×752, 1164×878, 880×1164 and 412×915 look
  like §3, in Construct and Clue mode, and Clue mode with a simulated keyboard (viewport
  height −45 %) keeps the clue editor directly above it.
- Engine: unit tests for pattern match, crossing room, both dupe rules (cases above),
  selection autofill keeps outside letters unchanged and all touched slots valid.
- Storage: kill the tab mid-edit and reopen; nothing lost.
- Drive: with a real client ID, back up, delete local data, restore.
