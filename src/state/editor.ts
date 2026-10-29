// State for the open puzzle: grid, cursor, undo/redo and autosave.
import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals';
import { Autosaver, type SaveState } from '../data/autosave';
import { addSnapshot, getHistory, getPuzzle, savePuzzle, SNAPSHOT_INTERVAL_MS } from '../data/puzzles';
import { computeSlots, type SlotIndex } from '../model/grid';
import * as ed from '../model/editor';
import { applyDiff, makeDiff, pushDiff, redo as redoStep, undo as undoStep, type History } from '../model/history';
import type { Cell, Clue, Puzzle, Slot } from '../model/types';
import { registerFlush } from '../sync';

export type PanelName = 'select' | 'fill' | 'autofill' | 'check' | 'clue' | null;

export class EditorSession {
  readonly puzzle: Signal<Puzzle>;
  readonly history: Signal<History>;
  readonly cursor: Signal<ed.Cursor>;
  readonly saveState = signal<SaveState>('saved');
  readonly savedAt = signal<number>(Date.now());
  readonly panel = signal<PanelName>(null);
  /** typing goes into the current cell's rebus while on */
  readonly rebusMode = signal(false);
  readonly slots: ReadonlySignal<SlotIndex>;
  readonly currentSlot: ReadonlySignal<Slot | null>;
  readonly canUndo: ReadonlySignal<boolean>;
  readonly canRedo: ReadonlySignal<boolean>;
  private readonly autosaver: Autosaver;
  private lastSnapshot = Date.now();
  private readonly unregisterFlush: () => void;

  constructor(p: Puzzle, h: History) {
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
    // Going to the background: write pending edits before the Drive upload runs.
    this.unregisterFlush = registerFlush(() => this.flush());
  }

  static async open(id: string): Promise<EditorSession | null> {
    const p = await getPuzzle(id);
    if (!p) return null;
    return new EditorSession(p, await getHistory(id));
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

  flush(): Promise<void> {
    return this.autosaver.flush();
  }

  async close(): Promise<void> {
    await this.autosaver.flush();
    this.autosaver.dispose();
    this.unregisterFlush();
  }
}
