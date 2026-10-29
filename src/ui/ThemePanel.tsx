// Theme entries for the open puzzle (inner-screen Theme tab, cover-screen sheet): place
// each Notebook theme entry into a slot as a locked theme entry.
import { useEffect, useState } from 'preact/hooks';
import { getTheme, notebookVersion, readNotebook } from '../data/notebook';
import { slotLabel } from '../model/grid';
import { letterBreakdown, letters, symmetryCheck, themeAnswers, type NotebookTheme, type ThemeEntry } from '../model/notebook';
import { findPlaced, placeThemeEntry, unlockSlot } from '../model/theme';
import type { EditorSession } from '../state/editor';
import { SymmetryPill } from './Notebook';

export function ThemePanel({ s }: { s: EditorSession }) {
  const p = s.puzzle.value;
  const [theme, setTheme] = useState<NotebookTheme | null | undefined>(undefined);
  const [all, setAll] = useState<NotebookTheme[]>([]);
  const [error, setError] = useState('');
  const nbv = notebookVersion.value;

  useEffect(() => {
    let alive = true;
    void (p.themeId ? getTheme(p.themeId) : Promise.resolve(null)).then((t) => alive && setTheme(t));
    void readNotebook().then((nb) => alive && setAll(nb.themes));
    return () => {
      alive = false;
    };
  }, [p.themeId, nbv]);

  if (theme === undefined) return <p class="muted">Loading…</p>;
  if (!theme) {
    return (
      <div class="theme-panel">
        <p class="muted">{p.themeId ? 'The linked Notebook theme was deleted.' : 'No Notebook theme linked to this puzzle.'}</p>
        {all.length > 0 ? (
          <>
            <label class="label">Link a theme</label>
            <div class="ideas">
              {all.map((t) => (
                <button key={t.id} class="idea" onClick={() => s.updateMeta({ themeId: t.id })}>
                  {t.title || 'Untitled theme'}
                </button>
              ))}
            </div>
          </>
        ) : (
          <p class="muted small">Add theme ideas in the Notebook.</p>
        )}
      </div>
    );
  }

  const slot = s.currentSlot.value;
  const idx = s.slots.value;
  const place = (e: ThemeEntry) => {
    if (!slot) return;
    const r = placeThemeEntry(p, slot, e.answer);
    if (!r.ok) return setError(r.reason);
    setError('');
    s.commit(r.changes);
  };

  const rows: { entry: ThemeEntry; revealer: boolean }[] = [
    ...theme.entries.map((entry) => ({ entry, revealer: false })),
    ...(theme.revealer && letters(theme.revealer.answer) ? [{ entry: theme.revealer, revealer: true }] : []),
  ];

  return (
    <div class="theme-panel">
      <div class="theme-panel-head">
        <span class="strong">{theme.title || 'Untitled theme'}</span>
        <SymmetryPill check={symmetryCheck(themeAnswers(theme), p.width)} />
      </div>
      {theme.description && <p class="muted small">{theme.description}</p>}
      {error && <div class="inline-warning">{error}</div>}
      <ul class="theme-entries">
        {rows.map(({ entry, revealer }, k) => {
          const placed = findPlaced(p, idx, entry.answer);
          const lockedAt = placed.find((sl) => sl.cells.every((i) => p.cells[i].lock));
          const len = letters(entry.answer).length;
          return (
            <li key={k}>
              <div class="te-main">
                <span class="mono strong">{entry.answer}</span>
                <span class="muted small">
                  {revealer ? 'Revealer · ' : ''}
                  {letterBreakdown(entry.answer)}
                </span>
                {entry.clues[0] && <span class="small te-clue">{entry.clues[0]}</span>}
              </div>
              {lockedAt ? (
                <div class="te-actions">
                  <span class="te-placed">{slotLabel(lockedAt)}</span>
                  <button class="btn small" onClick={() => s.commit(unlockSlot(p, lockedAt, idx))}>
                    Unlock
                  </button>
                </div>
              ) : slot && slot.cells.length === len ? (
                <button class="btn small primary" onClick={() => place(entry)}>
                  Place in {slotLabel(slot)}
                </button>
              ) : (
                <span class="muted small te-hint">Select a {len}-letter slot</span>
              )}
            </li>
          );
        })}
      </ul>
      <button class="btn small" onClick={() => s.updateMeta({ themeId: null })}>
        Unlink theme
      </button>
    </div>
  );
}
