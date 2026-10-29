// UI state for the fill engine on the open puzzle: fill suggestions for the current slot,
// select mode, autofill runs (in place and on the Autofill screen) and Check.
import { computed, effect, signal, type Signal } from '@preact/signals';
import { getSetting, setSetting } from '../data/db';
import type { CandidateList } from '../engine/candidates';
import type { CheckReport } from '../engine/check';
import { engineGrid, getCandidates, NoDataError, reloadEngine, runCheck, startAutofill, type AutofillRun } from '../engine/client';
import type { AutofillScope, FillStats } from '../engine/protocol';
import { defaultFillSettings, type FillSettings } from '../engine/settings';
import type { Cell, Day, Puzzle } from '../model/types';
import { dataVersion, wide } from './app';
import type { EditorSession } from './editor';

// ---------- fill settings (Settings → Fill), shared by every puzzle ----------

export const fillSettings = signal<FillSettings>(defaultFillSettings());
let settingsLoaded: Promise<void> | null = null;

export function loadFillSettings(): Promise<void> {
  settingsLoaded ??= getSetting<Partial<FillSettings>>('fill').then((s) => {
    if (s) fillSettings.value = { ...defaultFillSettings(), ...s };
  });
  return settingsLoaded;
}

export async function saveFillSettings(s: FillSettings): Promise<void> {
  fillSettings.value = s;
  await setSetting('fill', s);
}

const lexConfig = computed(() => ({ neverUse: fillSettings.value.neverUse }));

if (typeof window !== 'undefined') {
  let first = true;
  effect(() => {
    void dataVersion.value;
    if (!first) reloadEngine();
    first = false;
  });
}

// ---------- per-puzzle state ----------

export type FillSort = 'score' | 'nyt' | 'fresh' | 'room';

export interface FillFilters {
  floor: number;
  noDupes: boolean;
  crossingsOk: boolean;
  sort: FillSort;
}

export interface FillResultView {
  fill: Record<number, string>;
  stats: FillStats;
}

export interface AutofillState {
  scope: AutofillScope;
  /** started from the select-mode banner (results shown in place) */
  inPlace: boolean;
  running: boolean;
  elapsed: number;
  results: FillResultView[];
  current: number;
  /** the user picked a fill; until then the best one is shown */
  picked: boolean;
  message: string;
}

export interface AutofillPrefs {
  day: Day;
  /** null = per-length floors from Settings */
  floor: number | null;
  keepOpen: number;
}

const CANDIDATE_DEBOUNCE = 120;
const CHECK_DEBOUNCE = 500;
const RESULT_COUNT = 3;
const SELECTION_TIME_MS = 8000;
const GRID_TIME_MS = 60000;

function hamming(a: Record<number, string>, b: Record<number, string>): number {
  let d = 0;
  for (const k in a) if (a[k] !== b[k]) d++;
  return d;
}

export class FillController {
  // fill suggestions
  readonly filters = signal<FillFilters>({ floor: 40, noDupes: true, crossingsOk: false, sort: 'score' });
  readonly list = signal<CandidateList | null>(null);
  readonly listError = signal('');
  readonly listLoading = signal(false);
  /** word previewed in the grid from the Fill list */
  readonly picked = signal<string | null>(null);

  // select mode
  readonly selectMode = signal(false);
  readonly selection = signal<ReadonlySet<number>>(new Set());

  // autofill
  readonly run = signal<AutofillState | null>(null);
  readonly prefs: Signal<AutofillPrefs>;

  // check
  readonly report = signal<CheckReport | null>(null);
  /** the puzzle state the report was made for */
  private readonly reportFor = signal<Puzzle | null>(null);
  /** the grid changed since the last report */
  readonly reportStale = computed(() => this.reportFor.value !== this.s.puzzle.value);
  readonly noData = signal(false);

  /** letters previewed in the grid, and their style */
  readonly preview = computed<{ letters: Map<number, string>; kind: 'fill' | 'autofill' } | null>(() => {
    const r = this.run.value;
    const res = r?.results[r.current];
    if (res) return { letters: new Map(Object.entries(res.fill).map(([k, v]) => [Number(k), v])), kind: 'autofill' };
    // a word picked in the Fill list, while the list is on screen
    const fillVisible = !this.selectMode.value && (this.s.panel.value === 'fill' || (wide.value && !this.s.panel.value));
    const word = fillVisible ? this.picked.value : null;
    const slot = this.s.currentSlot.value;
    if (!word || !slot || slot.cells.length !== word.length) return null;
    const cells = this.s.puzzle.value.cells;
    const letters = new Map<number, string>();
    slot.cells.forEach((c, i) => {
      if (!cells[c].l) letters.set(c, word[i]);
    });
    return { letters, kind: 'fill' };
  });

  private activeRun: AutofillRun | null = null;
  private disposers: (() => void)[] = [];
  private candidateSeq = 0;
  private checkSeq = 0;

  constructor(private readonly s: EditorSession) {
    this.prefs = signal<AutofillPrefs>({ day: s.puzzle.peek().day, floor: null, keepOpen: 3 });
    void loadFillSettings();
    if (typeof Worker === 'undefined') return;

    // fill suggestions follow the current slot and the grid
    let ct: ReturnType<typeof setTimeout> | null = null;
    this.disposers.push(
      effect(() => {
        const slot = this.s.currentSlot.value;
        const p = this.s.puzzle.value;
        const f = this.filters.value;
        void fillSettings.value;
        if (ct) clearTimeout(ct);
        if (!slot) {
          this.list.value = null;
          return;
        }
        ct = setTimeout(() => void this.loadCandidates(p, slot.id, f.floor), CANDIDATE_DEBOUNCE);
      }),
    );
    // the picked word is for one slot only
    let lastSlot = '';
    this.disposers.push(
      effect(() => {
        const id = this.s.currentSlot.value?.id ?? '';
        if (id !== lastSlot) this.picked.value = null;
        lastSlot = id;
      }),
    );
    // Check runs in the background for the tool badge
    let kt: ReturnType<typeof setTimeout> | null = null;
    this.disposers.push(
      effect(() => {
        const p = this.s.puzzle.value;
        void fillSettings.value;
        if (kt) clearTimeout(kt);
        kt = setTimeout(() => void this.loadCheck(p), CHECK_DEBOUNCE);
      }),
    );
    this.disposers.push(() => {
      if (ct) clearTimeout(ct);
      if (kt) clearTimeout(kt);
    });
  }

  dispose(): void {
    this.activeRun?.stop();
    this.activeRun = null;
    for (const d of this.disposers) d();
  }

  private async loadCandidates(p: Puzzle, slot: string, floor: number): Promise<void> {
    const seq = ++this.candidateSeq;
    this.listLoading.value = true;
    try {
      const list = await getCandidates(lexConfig.value, engineGrid(p), slot, { day: p.day, floor, affixes: fillSettings.value.affixes });
      if (seq !== this.candidateSeq) return;
      this.list.value = list;
      this.listError.value = '';
      this.noData.value = false;
    } catch (e) {
      if (seq !== this.candidateSeq) return;
      this.list.value = null;
      this.noData.value = e instanceof NoDataError;
      this.listError.value = e instanceof Error ? e.message : String(e);
    } finally {
      if (seq === this.candidateSeq) this.listLoading.value = false;
    }
  }

  private async loadCheck(p: Puzzle): Promise<void> {
    const seq = ++this.checkSeq;
    try {
      const report = await runCheck(lexConfig.value, engineGrid(p), {
        floor: fillSettings.value.floors,
        affixes: fillSettings.value.affixes,
        symmetry: p.symmetry,
      });
      if (seq === this.checkSeq) {
        this.report.value = report;
        this.reportFor.value = p;
      }
    } catch {
      if (seq === this.checkSeq) this.report.value = null;
    }
  }

  /** Check a grid with an autofill result applied (Autofill screen). */
  checkWith(fill: Record<number, string>): Promise<CheckReport | null> {
    const p = this.s.puzzle.value;
    return runCheck(lexConfig.value, engineGrid(applyFill(p, fill)), {
      floor: fillSettings.value.floors,
      affixes: fillSettings.value.affixes,
      symmetry: p.symmetry,
    });
  }

  /** Put a word from the Fill list into the current slot (one undoable step). */
  useWord(word: string): void {
    const slot = this.s.currentSlot.value;
    if (!slot || slot.cells.length !== word.length) return;
    const p = this.s.puzzle.value;
    const changes = new Map<number, Cell>();
    slot.cells.forEach((c, i) => {
      const cell = p.cells[c];
      if (cell.lock || cell.l === word[i]) return;
      changes.set(c, { ...cell, l: word[i], rebus: null, src: 'typed' });
    });
    this.s.commit(changes);
    this.picked.value = null;
  }

  // ---------- select mode ----------

  selectable(i: number): boolean {
    const c = this.s.puzzle.value.cells[i];
    return !!c && !c.b && !c.lock;
  }

  enterSelect(cell?: number): void {
    this.s.panel.value = null;
    this.picked.value = null;
    this.selectMode.value = true;
    if (cell !== undefined && this.selectable(cell)) this.selection.value = new Set([...this.selection.value, cell]);
  }

  exitSelect(): void {
    this.stopRun();
    this.run.value = null;
    this.selectMode.value = false;
    this.selection.value = new Set();
  }

  setSelection(cells: Iterable<number>): void {
    const next = new Set<number>();
    for (const i of cells) if (this.selectable(i)) next.add(i);
    this.selection.value = next;
    // results were for the old selection
    if (this.run.value?.inPlace) {
      this.stopRun();
      this.run.value = null;
    }
  }

  toggleCell(i: number): void {
    const next = new Set(this.selection.value);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    this.setSelection(next);
  }

  selectCurrentWord(): void {
    this.setSelection([...this.selection.value, ...(this.s.currentSlot.value?.cells ?? [])]);
  }

  /** All open cells connected to the cursor cell, bounded by blocks and filled cells. */
  selectRegion(): void {
    const p = this.s.puzzle.value;
    const start = this.s.cursor.value.cell;
    if (!this.selectable(start)) return;
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / p.width);
      const c = i % p.width;
      for (const [rr, cc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
        if (rr < 0 || cc < 0 || rr >= p.height || cc >= p.width) continue;
        const j = rr * p.width + cc;
        const cell = p.cells[j];
        if (seen.has(j) || cell.b || cell.lock || cell.l) continue;
        seen.add(j);
        stack.push(j);
      }
    }
    this.setSelection([...this.selection.value, ...seen]);
  }

  invertSelection(): void {
    const p = this.s.puzzle.value;
    const sel = this.selection.value;
    this.setSelection(p.cells.map((_, i) => i).filter((i) => !sel.has(i)));
  }

  /** Grow the selection by one square in every direction. */
  widenSelection(): void {
    const p = this.s.puzzle.value;
    const next = new Set(this.selection.value);
    for (const i of this.selection.value) {
      const r = Math.floor(i / p.width);
      const c = i % p.width;
      for (const [rr, cc] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
        if (rr >= 0 && cc >= 0 && rr < p.height && cc < p.width) next.add(rr * p.width + cc);
      }
    }
    this.setSelection(next);
  }

  // ---------- autofill ----------

  private stopRun(): void {
    this.activeRun?.stop();
    this.activeRun = null;
  }

  stop(): void {
    this.stopRun();
    const r = this.run.value;
    if (r) this.run.value = { ...r, running: false, message: r.results.length ? '' : 'Stopped' };
  }

  /**
   * Start an autofill run. `append` keeps the current results and adds new distinct ones
   * (Keep searching).
   */
  startAutofill(scope: AutofillScope, inPlace: boolean, append = false): void {
    this.stopRun();
    const p = this.s.puzzle.value;
    const prefs = this.prefs.value;
    const settings = fillSettings.value;
    const prev = append ? (this.run.value?.results ?? []) : [];
    const openCount =
      scope.kind === 'selection' ? scope.cells.length : p.cells.filter((c) => !c.b && !c.l).length;
    const minDist = Math.max(1, Math.ceil(openCount * 0.15));
    this.run.value = {
      scope,
      inPlace,
      running: true,
      elapsed: 0,
      results: prev,
      current: append ? (this.run.value?.current ?? 0) : 0,
      picked: append && !!this.run.value?.picked,
      message: '',
    };
    // worker result index → our result object, so a better version replaces the right one
    const byWorker = new Map<number, FillResultView>();
    const run = startAutofill(
      lexConfig.value,
      engineGrid(p),
      scope,
      {
        day: prefs.day,
        floor: prefs.floor ?? settings.floors,
        keepOpen: prefs.keepOpen,
        maxResults: RESULT_COUNT,
        affixes: settings.affixes,
        timeLimitMs: scope.kind === 'selection' ? SELECTION_TIME_MS : GRID_TIME_MS,
      },
      {
        onResult: (m) => {
          const r = this.run.value;
          if (!r || this.activeRun !== run) return;
          const shown = r.results[r.current];
          let results = r.results.slice();
          const view = { fill: m.fill, stats: m.stats };
          const old = byWorker.get(m.index);
          if (m.replaces && old) results = results.map((x) => (x === old ? view : x));
          else if (results.some((x) => hamming(x.fill, m.fill) < minDist)) return;
          else results.push(view);
          byWorker.set(m.index, view);
          // best first, so Fill A is always the best so far; keep showing the same fill
          results.sort((a, b) => b.stats.average - a.stats.average);
          const current = shown && r.picked ? results.indexOf(shown === old ? view : shown) : 0;
          this.run.value = { ...r, results, current: Math.max(0, current) };
        },
        onProgress: (elapsed) => {
          const r = this.run.value;
          if (r && this.activeRun === run) this.run.value = { ...r, elapsed };
        },
        onDone: (d) => {
          if (this.activeRun !== run) return;
          this.activeRun = null;
          const r = this.run.value;
          if (!r) return;
          let message = d.reason ?? '';
          if (d.noData) message = 'Import the data pack in Settings first.';
          else if (d.error) message = `Engine error: ${d.error}`;
          else if (!r.results.length && !message) message = d.stopped ? 'Stopped' : 'No fill found.';
          this.run.value = { ...r, running: false, message };
        },
      },
    );
    this.activeRun = run;
  }

  autofillSelection(): void {
    const cells = [...this.selection.value];
    if (cells.length) this.startAutofill({ kind: 'selection', cells }, true);
  }

  showResult(i: number): void {
    const r = this.run.value;
    if (r && i >= 0 && i < r.results.length) this.run.value = { ...r, current: i, picked: true };
  }

  nextResult(): void {
    const r = this.run.value;
    if (r && r.results.length) this.showResult((r.current + 1) % r.results.length);
  }

  discardResults(): void {
    this.stopRun();
    this.run.value = null;
  }

  /** Apply the shown result as one undoable step, after a snapshot. */
  async keep(): Promise<void> {
    const r = this.run.value;
    const res = r?.results[r.current];
    if (!r || !res) return;
    this.stopRun();
    await this.s.snapshot('autofill');
    const p = this.s.puzzle.value;
    const changes = new Map<number, Cell>();
    for (const [k, l] of Object.entries(res.fill)) {
      const i = Number(k);
      const cell = p.cells[i];
      if (cell.b || cell.lock) continue;
      changes.set(i, { ...cell, l, rebus: null, src: 'autofill' });
    }
    this.s.commit(changes);
    this.run.value = null;
    if (this.selectMode.value) this.exitSelect();
  }

  /** Jump to a slot (from Check). */
  goToSlot(id: string): void {
    const idx = this.s.slots.value;
    const slot = idx.slots.find((x) => x.id === id);
    if (!slot) return;
    const cell = slot.cells.find((c) => !this.s.puzzle.value.cells[c].l) ?? slot.cells[0];
    this.s.cursor.value = { cell, dir: slot.dir };
  }
}

export function applyFill(p: Puzzle, fill: Record<number, string>): Puzzle {
  const cells = p.cells.slice();
  for (const [k, l] of Object.entries(fill)) cells[Number(k)] = { ...cells[Number(k)], l, rebus: null, src: 'autofill' };
  return { ...p, cells };
}

/** "A" for 0, "B" for 1, ... */
export const fillLetter = (i: number): string => String.fromCharCode(65 + (i % 26));
