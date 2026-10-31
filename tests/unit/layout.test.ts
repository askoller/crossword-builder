import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, DB_NAME } from '../../src/data/db';
import { getPuzzle, savePuzzle } from '../../src/data/puzzles';
import { chooseLayout, KEYBOARD_CLOSE_GRACE_MS, ViewportTracker } from '../../src/model/layout';
import { EditorSession } from '../../src/state/editor';
import { fixtureGrid } from './helpers';

describe('chooseLayout', () => {
  it('picks the layout for each Fold 8 shape and the phone fallback', () => {
    expect(chooseLayout(476, 752)).toBe('cover'); // cover screen, 10:16
    expect(chooseLayout(1164, 878)).toBe('inner-landscape'); // inner screen, 4:3
    expect(chooseLayout(880, 1164)).toBe('inner-portrait'); // inner screen held upright, 3:4
    expect(chooseLayout(412, 915)).toBe('phone'); // normal tall phone
  });

  it('handles neighbouring sizes by aspect and width, not exact pixels', () => {
    expect(chooseLayout(460, 780)).toBe('cover');
    expect(chooseLayout(390, 844)).toBe('phone');
    expect(chooseLayout(904, 1200)).toBe('inner-portrait');
    expect(chooseLayout(1000, 1000)).toBe('inner-landscape'); // square counts as landscape
    expect(chooseLayout(915, 412)).toBe('inner-landscape'); // phone rotated
    expect(chooseLayout(752, 476)).toBe('inner-landscape'); // cover rotated
    expect(chooseLayout(0, 0)).toBe('cover');
  });
});

describe('ViewportTracker', () => {
  it('keeps the layout while the keyboard shrinks the viewport', () => {
    const t = new ViewportTracker();
    expect(t.update(880, 1164, false, 0)).toMatchObject({ layout: 'inner-portrait', keyboardOpen: false });
    // focus a text field, keyboard takes 45 % of the height: 880 × 640 would look landscape
    t.update(880, 1164, true, 10);
    const open = t.update(880, 640, true, 300);
    expect(open).toMatchObject({ layout: 'inner-portrait', keyboardOpen: true, keyboardHeight: 524, fullHeight: 1164 });
    // cover screen too
    const c = new ViewportTracker();
    c.update(476, 752, true, 0);
    expect(c.update(476, 414, true, 100)).toMatchObject({ layout: 'cover', keyboardOpen: true });
  });

  it('closes the keyboard: grace period while it animates out, then the new size is the full size', () => {
    const t = new ViewportTracker();
    t.update(1164, 878, true, 0);
    expect(t.update(1164, 480, true, 100)).toMatchObject({ layout: 'inner-landscape', keyboardOpen: true });
    // blurred at t=200; the keyboard is still closing
    expect(t.update(1164, 600, false, 300).layout).toBe('inner-landscape');
    expect(t.update(1164, 878, false, 500)).toMatchObject({ keyboardOpen: false, fullHeight: 878 });
    // a real resize later with no text field focused is taken as is
    expect(t.update(1164, 700, false, 500 + KEYBOARD_CLOSE_GRACE_MS + 10)).toMatchObject({ keyboardOpen: false, fullHeight: 700 });
  });

  it('re-chooses on rotation and fold / unfold (width change)', () => {
    const t = new ViewportTracker();
    expect(t.update(476, 752, false, 0).layout).toBe('cover');
    expect(t.update(1164, 878, false, 10).layout).toBe('inner-landscape'); // unfold
    expect(t.update(880, 1164, false, 20).layout).toBe('inner-portrait'); // rotate
    expect(t.update(476, 752, false, 30).layout).toBe('cover'); // fold
    // rotation while a field has focus: the new width resets the full height
    t.update(476, 752, true, 40);
    expect(t.update(752, 476, true, 50)).toMatchObject({ layout: 'inner-landscape', keyboardOpen: false });
  });

  it('ignores small height changes such as the address bar', () => {
    const t = new ViewportTracker();
    t.update(412, 915, true, 0);
    expect(t.update(412, 860, true, 10).keyboardOpen).toBe(false);
    expect(t.update(412, 500, true, 20).keyboardOpen).toBe(true);
    // without a focused field a shorter viewport is never "the keyboard"
    const u = new ViewportTracker();
    u.update(412, 915, false, 0);
    expect(u.update(412, 500, false, 5000)).toMatchObject({ keyboardOpen: false, fullHeight: 500 });
  });
});

async function resetDb() {
  await closeDb();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

describe('Construct | Clue mode and clue drafts', () => {
  beforeEach(resetDb);
  afterEach(resetDb);

  it('remembers the mode per puzzle', async () => {
    const a = fixtureGrid('fixture-mini-5x5');
    const b = { ...fixtureGrid('fixture-mini-5x5'), id: 'other-mini' };
    await savePuzzle(a);
    await savePuzzle(b);
    const s = (await EditorSession.open(a.id))!;
    expect(s.mode.value).toBe('construct');
    s.setMode('clue');
    await s.close();
    await closeDb();
    const s2 = (await EditorSession.open(a.id))!;
    expect(s2.mode.value).toBe('clue');
    await s2.close();
    const s3 = (await EditorSession.open(b.id))!;
    expect(s3.mode.value).toBe('construct');
    await s3.close();
  });

  it('keeps a draft across a reload and saves it as one undoable step on Next', async () => {
    const grid = fixtureGrid('fixture-mini-5x5');
    await savePuzzle(grid);
    const s = (await EditorSession.open(grid.id))!;
    s.setMode('clue');
    const first = s.slots.value.slots[0];
    s.goToSlot(first.id);
    s.setDraft(first.id, 'Half-typed');
    await s.close(); // writes the pending draft
    await closeDb();

    const s2 = (await EditorSession.open(grid.id))!;
    expect(s2.clueDraft.value).toEqual({ slot: first.id, text: 'Half-typed' });
    expect(s2.currentSlot.value?.id).toBe(first.id); // the cursor goes back to the draft
    s2.setDraft(first.id, 'Half-typed clue ');
    const undoBefore = s2.history.value.undo.length;
    expect(s2.saveDraft()).toBe(true);
    s2.stepEntry(1);
    expect(s2.puzzle.value.clues[first.id].text).toBe('Half-typed clue');
    expect(s2.history.value.undo.length).toBe(undoBefore + 1);
    expect(s2.clueDraft.value).toBeNull();
    s2.undo();
    expect(s2.puzzle.value.clues[first.id]?.text ?? '').toBe(grid.clues[first.id]?.text ?? '');
    s2.redo();
    await s2.close();
    expect((await getPuzzle(grid.id))!.clues[first.id].text).toBe('Half-typed clue');
  });

  it('saves the draft when the cursor moves to another entry (a tap in the grid)', async () => {
    const grid = fixtureGrid('fixture-mini-5x5');
    await savePuzzle(grid);
    const s = (await EditorSession.open(grid.id))!;
    const [a, b] = s.slots.value.slots;
    s.goToSlot(a.id);
    s.setDraft(a.id, 'Tapped away');
    s.goToSlot(b.id);
    await Promise.resolve();
    await Promise.resolve();
    expect(s.puzzle.value.clues[a.id].text).toBe('Tapped away');
    expect(s.clueDraft.value).toBeNull();
    await s.close();
  });
});
