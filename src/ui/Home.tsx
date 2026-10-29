import { useEffect, useState } from 'preact/hooks';
import { readNotebook } from '../data/notebook';
import { listPuzzles, savePuzzle } from '../data/puzzles';
import { newPuzzle } from '../model/grid';
import type { NotebookTheme } from '../model/notebook';
import { DAYS, type Day, type Puzzle, type Status } from '../model/types';
import { dataVersion, navigate } from '../state/app';
import { openPanelOnLoad } from '../state/editor';
import { Chips, Dialog, relativeTime } from './common';
import { Thumb } from './Grid';
import { BackupCard } from './Drive';
import { IconClose, IconPlus, IconSearch } from './icons';
import { ThemePicker } from './ThemePicker';

type Filter = 'All' | 'In progress' | 'Submitted';

const STATUS_CLASS: Record<Status, string> = {
  'Theme draft': 'st-draft',
  'Themers set': 'st-themers',
  Filling: 'st-filling',
  Cluing: 'st-cluing',
  Submitted: 'st-submitted',
};

export function Home() {
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void listPuzzles().then(setPuzzles);
  }, [dataVersion.value]);

  const q = (search ?? '').trim().toLowerCase();
  const shown = (puzzles ?? []).filter(
    (p) =>
      (filter === 'All' || (filter === 'Submitted') === (p.status === 'Submitted')) &&
      (!q || p.title.toLowerCase().includes(q)),
  );

  return (
    <div class="screen home">
      <header class="topbar">
        {search === null ? (
          <>
            <h1>Puzzles</h1>
            <button class="icon-btn" aria-label="Search" onClick={() => setSearch('')}>
              <IconSearch />
            </button>
          </>
        ) : (
          <>
            <input
              class="field search"
              placeholder="Search puzzles"
              aria-label="Search puzzles"
              autoFocus
              value={search}
              onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
            />
            <button class="icon-btn" aria-label="Close search" onClick={() => setSearch(null)}>
              <IconClose />
            </button>
          </>
        )}
      </header>
      <div class="scroll">
        <BackupCard />
        <Chips label="Filter" options={['All', 'In progress', 'Submitted'] as const} value={filter} onChange={setFilter} />
        {puzzles && !puzzles.length && (
          <div class="empty">
            <p class="strong">No puzzles yet</p>
            <p class="muted">Tap New puzzle to start a grid.</p>
          </div>
        )}
        <div class="puzzle-list">
          {shown.map((p) => (
            <button key={p.id} class="card puzzle-card" onClick={() => navigate({ name: 'editor', id: p.id })}>
              <Thumb cells={p.cells} width={p.width} height={p.height} />
              <div class="puzzle-info">
                <div class="strong title-line">{p.title}</div>
                <div class="muted">
                  {p.width}×{p.height} · {p.day} · {p.outlet}
                </div>
                <div class="puzzle-meta">
                  <span class={`status ${STATUS_CLASS[p.status]}`}>{p.status}</span>
                  <span class="muted small">Edited {relativeTime(p.updated)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <button class="fab" onClick={() => setCreating(true)}>
        <IconPlus />
        <span>New puzzle</span>
      </button>
      {creating && <NewPuzzleDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

type SizeChoice = '15×15' | '21×21' | 'Custom';

export function NewPuzzleDialog({ onClose, themeId: initialTheme = '' }: { onClose: () => void; themeId?: string }) {
  const [size, setSize] = useState<SizeChoice>('15×15');
  const [w, setW] = useState(15);
  const [h, setH] = useState(15);
  const [day, setDay] = useState<Day>('Tue');
  const [outlet, setOutlet] = useState('NYT');
  const [title, setTitle] = useState('');
  const [themes, setThemes] = useState<NotebookTheme[]>([]);
  const [themeId, setThemeId] = useState(initialTheme);

  useEffect(() => {
    void readNotebook().then((nb) => {
      // The theme this dialog was opened for first, then the most recently edited.
      const order = (t: NotebookTheme) => (t.id === initialTheme ? Infinity : (t.updated ?? 0));
      setThemes(nb.themes.sort((a, b) => order(b) - order(a)));
    });
  }, []);

  const pickSize = (v: SizeChoice) => {
    setSize(v);
    if (v === '15×15') {
      setW(15);
      setH(15);
    }
    if (v === '21×21') {
      setW(21);
      setH(21);
      setDay('Sun');
    }
  };
  const clamp = (n: number) => Math.max(3, Math.min(25, Math.round(n) || 3));

  const create = async () => {
    const theme = themes.find((t) => t.id === themeId);
    const p = newPuzzle({ width: w, height: h, day, outlet: outlet.trim() || 'NYT', title: title || theme?.title, themeId: theme?.id ?? null });
    await savePuzzle(p);
    onClose();
    if (theme) openPanelOnLoad(p.id, 'theme');
    navigate({ name: 'editor', id: p.id });
  };

  return (
    <Dialog
      title="New puzzle"
      onClose={onClose}
      actions={
        <button class="btn primary" onClick={create}>
          Create
        </button>
      }
    >
      <label class="label">Size</label>
      <Chips label="Size" options={['15×15', '21×21', 'Custom'] as const} value={size} onChange={pickSize} />
      {size === 'Custom' && (
        <div class="row">
          <input class="field num" type="number" min={3} max={25} value={w} aria-label="Width" onInput={(e) => setW(clamp(+(e.target as HTMLInputElement).value))} />
          <span>×</span>
          <input class="field num" type="number" min={3} max={25} value={h} aria-label="Height" onInput={(e) => setH(clamp(+(e.target as HTMLInputElement).value))} />
        </div>
      )}
      <label class="label">Day</label>
      <Chips label="Day" options={DAYS} value={day} onChange={setDay} />
      <label class="label">Outlet</label>
      <Chips
        label="Outlet"
        options={['NYT', 'Universal', 'Other'] as const}
        value={outlet === 'NYT' || outlet === 'Universal' ? outlet : 'Other'}
        onChange={(v) => setOutlet(v === 'Other' ? '' : v)}
      />
      {outlet !== 'NYT' && outlet !== 'Universal' && (
        <input class="field" placeholder="Outlet name" aria-label="Outlet name" value={outlet} onInput={(e) => setOutlet((e.target as HTMLInputElement).value)} />
      )}
      <label class="label">Title (optional)</label>
      <input class="field" value={title} aria-label="Title" placeholder="Untitled puzzle" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
      {themes.length > 0 && (
        <>
          <label class="label">Start from a Notebook theme (optional)</label>
          <ThemePicker themes={themes} value={themeId} onChange={setThemeId} width={w} />
        </>
      )}
    </Dialog>
  );
}
