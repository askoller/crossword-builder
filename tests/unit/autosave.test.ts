import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver } from '../../src/data/autosave';
import { closeDb, DB_NAME } from '../../src/data/db';
import { addSnapshot, getHistory, getPuzzle, listSnapshots, savePuzzle, SNAPSHOT_CAP } from '../../src/data/puzzles';
import { EditorSession } from '../../src/state/editor';
import { fixtureGrid, rowsOf } from './helpers';

async function resetDb() {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(resetDb);
afterEach(() => vi.useRealTimers());

describe('Autosaver', () => {
  it('debounces saves by 300 ms', async () => {
    vi.useFakeTimers();
    const save = vi.fn(() => Promise.resolve());
    const a = new Autosaver(save);
    a.schedule();
    a.schedule();
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    a.schedule();
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    a.dispose();
  });

  it('saves immediately when the page is hidden or unloaded', async () => {
    const save = vi.fn(() => Promise.resolve());
    const a = new Autosaver(save);
    a.attach(window);
    a.schedule();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick();
    expect(save).toHaveBeenCalledTimes(1);
    a.schedule();
    window.dispatchEvent(new Event('pagehide'));
    await tick();
    expect(save).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    a.dispose();
  });

  it('retries after a failed save', async () => {
    let fail = true;
    const states: string[] = [];
    const save = vi.fn(() => (fail ? Promise.reject(new Error('quota')) : Promise.resolve()));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = new Autosaver(save, (s) => states.push(s));
    a.schedule();
    await a.flush();
    expect(states.at(-1)).toBe('error');
    expect(a.pending).toBe(true);
    fail = false;
    await a.flush();
    expect(states.at(-1)).toBe('saved');
    a.dispose();
  });
});

describe('autosave round trip', () => {
  it('persists edits and undo history across a reload', async () => {
    const grid = fixtureGrid('fixture-mini-5x5');
    await savePuzzle(grid);

    const s1 = (await EditorSession.open(grid.id))!;
    s1.cursor.value = { cell: 1, dir: 'across' };
    for (const ch of 'CAT') s1.typeLetter(ch);
    s1.cursor.value = { cell: 5, dir: 'across' };
    s1.toggleBlock(); // blocks 5 and its partner 19
    await s1.close();

    const stored = (await getPuzzle(grid.id))!;
    expect(rowsOf(stored)).toEqual(['#CAT.', '#....', '.....', '....#', '....#']);
    expect((await getHistory(grid.id)).undo).toHaveLength(4);

    // "reload": a fresh session reads everything back from IndexedDB
    await closeDb();
    const s2 = (await EditorSession.open(grid.id))!;
    expect(rowsOf(s2.puzzle.value)).toEqual(rowsOf(stored));
    expect(s2.canUndo.value).toBe(true);
    s2.undo(); // unblock
    s2.undo(); // remove T
    expect(rowsOf(s2.puzzle.value)).toEqual(['#CA..', '.....', '.....', '.....', '....#']);
    expect(s2.cursor.value.cell).toBe(3);
    s2.redo();
    expect(rowsOf(s2.puzzle.value)[0]).toBe('#CAT.');
    await s2.close();

    await closeDb();
    const s3 = (await EditorSession.open(grid.id))!;
    expect(rowsOf(s3.puzzle.value)[0]).toBe('#CAT.');
    expect(s3.history.value.undo).toHaveLength(3);
    expect(s3.history.value.redo).toHaveLength(1);
    await s3.close();
  });

  it('writes within the debounce window without an explicit flush', async () => {
    const grid = fixtureGrid('fixture-mini-5x5');
    await savePuzzle(grid);
    const s = (await EditorSession.open(grid.id))!;
    s.cursor.value = { cell: 1, dir: 'across' };
    s.typeLetter('Z');
    expect(s.saveState.value).toBe('pending');
    await new Promise((r) => setTimeout(r, 450));
    expect((await getPuzzle(grid.id))!.cells[1].l).toBe('Z');
    expect(s.saveState.value).toBe('saved');
    await s.close();
  });

  it(`keeps the newest ${SNAPSHOT_CAP} snapshots`, async () => {
    const grid = fixtureGrid('fixture-mini-5x5');
    for (let k = 0; k < SNAPSHOT_CAP + 5; k++) await addSnapshot({ ...grid, title: `v${k}` }, 'manual');
    const snaps = await listSnapshots(grid.id);
    expect(snaps).toHaveLength(SNAPSHOT_CAP);
    expect(snaps.map((x) => x.puzzle.title)).toContain(`v${SNAPSHOT_CAP + 4}`);
    expect(snaps.map((x) => x.puzzle.title)).not.toContain('v0');
  });
});
