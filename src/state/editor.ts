// State for the open puzzle: grid, cursor, undo/redo and autosave.
import { computed, effect, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { Autosaver, type SaveState } from '../data/autosave';
import { getSetting, setSetting } from '../data/db';
import { addSnapshot, getHistory, getPuzzle, savePuzzle, SNAPSHOT_INTERVAL_MS } from '../data/puzzles';
import { computeSlots, type SlotIndex } from '../model/grid';
import * as ed from '../model/editor';
import { applyDiff, makeDiff, pushDiff, redo as redoStep, undo as undoStep, type History } from '../model/history';
import type { Cell, Clue, Puzzle, Slot } from '../model/types';
import { FillController } from './fill';
import { registerFlush } from '../sync';

export type PanelName = 'select' | 'fill' | 'autofill' | 'check' | 'clue' | 'theme' | null;
/** Construct: grid entry with the app's keyboard. Clue: writing clues with the system keyboard. */
export type EditorMode = 'construct' | 'clue';
export type SideTab = 'Fill' | 'Clues' | 'Theme';
/** An unsaved clue being typed in Clue mode (kept across reloads, saved on Next / Done). */
export interface ClueDraft {
  slot: string;
  text: string;
}

/** Per-puzzle settings keys (the `settings` store; not part of the puzzle file). */
export const modeKey = (id: string) => `editorMode:${id}`;
export const draftKey = (id: string) => `clueDraft:${id}`;
const DRAFT_SAVE_MS = 300;

let panelOnLoad: { id: string; panel: PanelName } | null = null;

/** Open `panel` the next time the editor opens puzzle `id` (a new puzzle from a Notebook theme opens Theme entries). */
export function openPanelOnLoad(id: string, panel: PanelName): void {
  panelOnLoad = { id, panel };
}

export function takePanelOnLoad(id: string): PanelName {
  const p = panelOnLoad?.id === id ? panelOnLoad.panel : null;
  panelOnLoad = null;
  return p;
}

export class EditorSession {
  readonly puzzle: Signal<Puzzle>;
  readonly history: Signal<History>;
  readonly cursor: Signal<ed.Cursor>;
  readonly saveState = signal<SaveState>('saved');
  readonly savedAt = signal<number>(Date.now());
  readonly panel = signal<PanelName>(null);
  /** Construct | Clue, remembered per puzzle */
  readonly mode = signal<EditorMode>('construct');
  /** tab of the Fill / Clues / Theme panel (inner screen), kept across layout changes */
  readonly sideTab = signal<SideTab>('Fill');
  /** the clue being typed in Clue mode, not yet saved to the puzzle */
  readonly clueDraft = signal<ClueDraft | null>(null);
  /** focus the clue field (opening the keyboard) when Clue mode next renders */
  focusClue = false;
  /** typing goes into the current cell's rebus while on */
  readonly rebusMode = signal(false);
  readonly slots: ReadonlySignal<SlotIndex>;
  readonly currentSlot: ReadonlySignal<Slot | null>;
  readonly canUndo: ReadonlySignal<boolean>;
  readonly canRedo: ReadonlySignal<boolean>;
  /** fill suggestions, select mode, autofill and Check */
  readonly fill: FillController;
  private readonly autosaver: Autosaver;
  private lastSnapshot = Date.now();
  private readonly unregisterFlush: () => void;
  private readonly disposeDraftWatch: () => void;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(p: Puzzle, h: History, init: { mode?: EditorMode; draft?: ClueDraft | null } = {}) {
    this.puzzle = signal(p);
    this.history = signal(h);
    this.cursor = signal(ed.initialCursor(p));
    // Slots only depend on blocks; recompute when the block pattern changes.
    let key = '';
    let cached: SlotIndex | null = null;
    this.slots = computed(() => {
      const q = this.puzzle.value;
      const k = `${q.width}x${q.height}:${q.cells.map((c) => c.b).join('')}`;
      if (k !== key || !cached) {
        key = k;
        cached = computeSlots(q.width, q.height, q.cells);
      }
      return cached;
    });
    this.currentSlot = computed(() => ed.currentSlot(this.slots.value, this.cursor.value));
    this.canUndo = computed(() => this.history.value.undo.length > 0);
    this.canRedo = computed(() => this.history.value.redo.length > 0);
    this.autosaver = new Autosaver(() => this.save(), (s) => {
      this.saveState.value = s;
      if (s === 'saved') this.savedAt.value = Date.now();
    });
    this.autosaver.attach();
    this.fill = new FillController(this);
    // Going to the background: write pending edits before the Drive upload runs.
    this.unregisterFlush = registerFlush(() => this.flush());
    if (init.mode === 'clue') this.mode.value = 'clue';
    const draft = init.draft;
    if (draft && this.slots.value.slots.some((sl) => sl.id === draft.slot)) {
      this.clueDraft.value = draft;
      this.goToSlot(draft.slot);
    }
    // Moving to another entry (a tap in the grid, Prev / Next) saves the draft first.
    this.disposeDraftWatch = effect(() => {
      const d = this.clueDraft.value;
      const slot = this.currentSlot.value;
      if (d && slot?.id !== d.slot) queueMicrotask(() => this.saveDraft(d.slot));
    });
  }

  static async open(id: string): Promise<EditorSession | null> {
    const p = await getPuzzle(id);
    if (!p) return null;
    const [h, mode, draft] = await Promise.all([
      getHistory(id),
      getSetting<EditorMode>(modeKey(id)).catch(() => undefined),
      getSetting<ClueDraft | null>(draftKey(id)).catch(() => undefined),
    ]);
    return new EditorSession(p, h, { mode, draft });
  }

  /** Switch Construct / Clue; remembered for this puzzle. */
  setMode(mode: EditorMode): void {
    if (this.mode.value === mode) return;
    this.rebusMode.value = false;
    if (this.fill.selectMode.peek()) this.fill.exitSelect();
    if (mode === 'clue') this.panel.value = null;
    else this.saveDraft();
    this.mode.value = mode;
    void setSetting(modeKey(this.puzzle.value.id), mode).catch(() => undefined);
  }

  /** Put the cursor at the start of a slot (by id). */
  goToSlot(id: string): void {
    const slot = this.slots.value.slots.find((sl) => sl.id === id);
    if (!slot) return;
    this.rebusMode.value = false;
    const here = this.currentSlot.value;
    if (here?.id === id) return;
    this.cursor.value = { cell: slot.cells[0], dir: slot.dir };
  }

  /** Text shown for a slot's clue: the draft while one is being typed, else the saved clue. */
  clueText(id: string): string {
    const d = this.clueDraft.value;
    return d?.slot === id ? d.text : (this.puzzle.value.clues[id]?.text ?? '');
  }

  /** Typing in Clue mode: kept as a draft (persisted within 300 ms) until saved. */
  setDraft(slot: string, text: string): void {
    this.clueDraft.value = { slot, text };
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.writeDraft(), DRAFT_SAVE_MS);
  }

  private async writeDraft(): Promise<void> {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    await setSetting(draftKey(this.puzzle.value.id), this.clueDraft.peek()).catch(() => undefined);
  }

  /**
   * Save the draft as the slot's clue (one undoable step; nothing when unchanged).
   * `only` limits it to a draft for that slot.
   */
  saveDraft(only?: string): boolean {
    const d = this.clueDraft.peek();
    if (!d || (only && d.slot !== only)) return false;
    this.clueDraft.value = null;
    void this.writeDraft();
    const text = d.text.trim();
    const p = this.puzzle.value;
    if (text === (p.clues[d.slot]?.text ?? '')) return false;
    if (!this.slots.value.slots.some((sl) => sl.id === d.slot)) return false;
    return this.commit(new Map(), new Map([[d.slot, text ? { ...p.clues[d.slot], text } : null]]));
  }

  private async save(): Promise<void> {
    const p = this.puzzle.value;
    await savePuzzle(p, this.history.value);
    if (Date.now() - this.lastSnapshot >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshot = Date.now();
      await addSnapshot(p, 'interval');
    }
  }

  private touch(p: Puzzle): Puzzle {
    return { ...p, updated: new Date().toISOString() };
  }

  /** Apply cell (and clue) changes as one undoable step. */
  commit(cells: Map<number, Cell>, clues?: Map<string, Clue | null>): boolean {
    const p = this.puzzle.value;
    const c = this.cursor.value;
    const d = makeDiff(p, cells, [c.cell, c.dir], clues);
    if (!d) return false;
    this.puzzle.value = this.touch(applyDiff(p, d));
    this.history.value = pushDiff(this.history.value, d);
    this.autosaver.schedule();
    return true;
  }

  private run(r: ed.EditResult): void {
    this.commit(r.changes);
    this.cursor.value = r.cursor;
  }

  /** Non-undoable puzzle settings (title, day, symmetry, status, ...). */
  updateMeta(patch: Partial<Omit<Puzzle, 'cells' | 'clues' | 'id' | 'format'>>): void {
    this.puzzle.value = this.touch({ ...this.puzzle.value, ...patch });
    this.autosaver.schedule();
  }

  typeLetter(letter: string): void {
    if (this.rebusMode.value) {
      const c = this.puzzle.value.cells[this.cursor.value.cell];
      this.run(ed.setRebus(this.puzzle.value, this.cursor.value, (c.rebus ?? c.l) + letter));
      return;
    }
    this.run(ed.typeLetter(this.puzzle.value, this.slots.value, this.cursor.value, letter));
  }

  backspace(): void {
    if (this.rebusMode.value) {
      const c = this.puzzle.value.cells[this.cursor.value.cell];
      this.run(ed.setRebus(this.puzzle.value, this.cursor.value, (c.rebus ?? c.l).slice(0, -1)));
      return;
    }
    this.run(ed.backspace(this.puzzle.value, this.slots.value, this.cursor.value));
  }

  toggleBlock(): void {
    this.rebusMode.value = false;
    this.run(ed.toggleBlock(this.puzzle.value, this.cursor.value));
  }

  toggleCircle(): void {
    this.run(ed.toggleCircle(this.puzzle.value, this.cursor.value));
  }

  toggleLock(): void {
    this.run(ed.toggleLockWord(this.puzzle.value, this.slots.value, this.cursor.value));
  }

  toggleRebus(): void {
    const c = this.puzzle.value.cells[this.cursor.value.cell];
    if (!this.rebusMode.value && (c.b || c.lock)) return;
    this.rebusMode.value = !this.rebusMode.value;
  }

  tapCell(cell: number): void {
    this.rebusMode.value = false;
    this.cursor.value = ed.tapCell(this.puzzle.value, this.slots.value, this.cursor.value, cell);
  }

  switchDirection(): void {
    this.rebusMode.value = false;
    this.cursor.value = ed.switchDirection(this.slots.value, this.cursor.value);
  }

  arrow(key: ed.Arrow): void {
    this.rebusMode.value = false;
    this.cursor.value = ed.arrow(this.puzzle.value, this.cursor.value, key);
  }

  stepEntry(delta: 1 | -1): void {
    this.rebusMode.value = false;
    this.cursor.value = ed.stepEntry(this.puzzle.value, this.slots.value, this.cursor.value, delta);
  }

  undo(): void {
    const r = undoStep(this.puzzle.value, this.history.value);
    if (!r) return;
    this.rebusMode.value = false;
    this.puzzle.value = this.touch(r.puzzle);
    this.history.value = r.history;
    if (r.diff.at) this.cursor.value = { cell: r.diff.at[0], dir: r.diff.at[1] };
    this.autosaver.schedule();
  }

  redo(): void {
    const r = redoStep(this.puzzle.value, this.history.value);
    if (!r) return;
    this.rebusMode.value = false;
    this.puzzle.value = this.touch(r.puzzle);
    this.history.value = r.history;
    const first = r.diff.c[r.diff.c.length - 1];
    if (first) this.cursor.value = { cell: first[0], dir: r.diff.at?.[1] ?? this.cursor.value.dir };
    this.autosaver.schedule();
  }

  /** Full copy before a big change (e.g. autofill Keep). */
  snapshot(reason: 'autofill' | 'manual'): Promise<void> {
    return addSnapshot(this.puzzle.value, reason);
  }

  async flush(): Promise<void> {
    if (this.draftTimer) await this.writeDraft();
    await this.autosaver.flush();
  }

  async close(): Promise<void> {
    this.disposeDraftWatch();
    if (this.draftTimer) await this.writeDraft();
    this.fill.dispose();
    await this.autosaver.flush();
    this.autosaver.dispose();
    this.unregisterFlush();
  }
}
