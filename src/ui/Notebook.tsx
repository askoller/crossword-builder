// Notebook (SPEC §3.7): answers with clue ideas and a boost, and theme ideas.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { deleteItem, notebookVersion, readNotebook, saveAnswer, saveTheme } from '../data/notebook';
import { listPuzzles } from '../data/puzzles';
import { uuid } from '../model/grid';
import {
  answerKey,
  BOOST_FACTOR,
  DEFAULT_BOOST,
  letterBreakdown,
  letters,
  normalizeAnswer,
  symmetryCheck,
  themeAnswers,
  themeKey,
  type NotebookAnswer,
  type NotebookFile,
  type NotebookTheme,
  type SymmetryCheck,
  type ThemeEntry,
} from '../model/notebook';
import type { Puzzle } from '../model/types';
import { navigate } from '../state/app';
import { Chips, Dialog } from './common';
import { NewPuzzleDialog } from './Home';
import { IconClose, IconPlus, IconSearch } from './icons';

type Tab = 'Answers' | 'Themes';
type Sort = 'boost' | 'newest' | 'az';

export function SymmetryPill({ check }: { check: SymmetryCheck }) {
  return <span class={`sym-pill ${check.ok ? 'ok' : 'bad'}`}>{check.label}</span>;
}

export function NotebookScreen() {
  const [tab, setTab] = useState<Tab>('Answers');
  const [nb, setNb] = useState<NotebookFile | null>(null);
  const [puzzles, setPuzzles] = useState<Puzzle[]>([]);
  const [search, setSearch] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('boost');
  const [editAnswer, setEditAnswer] = useState<NotebookAnswer | 'new' | null>(null);
  const [editTheme, setEditTheme] = useState<NotebookTheme | 'new' | null>(null);
  const [startTheme, setStartTheme] = useState<string | null>(null);

  useEffect(() => {
    void readNotebook().then(setNb);
    void listPuzzles().then(setPuzzles);
  }, [notebookVersion.value]);

  const q = (search ?? '').trim().toLowerCase();
  const answers = useMemo(() => {
    const list = (nb?.clues ?? []).filter(
      (a) => !q || a.answer.toLowerCase().includes(q) || letters(a.answer).toLowerCase().includes(q.replace(/\s/g, '')) || a.clues.some((c) => c.toLowerCase().includes(q)),
    );
    const az = (x: NotebookAnswer, y: NotebookAnswer) => (letters(x.answer) < letters(y.answer) ? -1 : 1);
    if (sort === 'boost') return list.sort((x, y) => y.boost - x.boost || az(x, y));
    if (sort === 'newest') return list.sort((x, y) => (y.updated ?? 0) - (x.updated ?? 0) || az(x, y));
    return list.sort(az);
  }, [nb, q, sort]);
  const themes = (nb?.themes ?? [])
    .filter((t) => !q || t.title.toLowerCase().includes(q) || themeAnswers(t).some((a) => a.toLowerCase().includes(q)))
    .sort((x, y) => (y.updated ?? 0) - (x.updated ?? 0));

  return (
    <div class="screen notebook">
      <header class="topbar">
        {search === null ? (
          <>
            <h1>Notebook</h1>
            <button class="icon-btn" aria-label="Search" onClick={() => setSearch('')}>
              <IconSearch />
            </button>
          </>
        ) : (
          <>
            <input
              class="field search"
              placeholder={`Search ${tab.toLowerCase()}`}
              aria-label="Search notebook"
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
      <div class="tabs nb-tabs" role="tablist">
        {(['Answers', 'Themes'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} class={`tab${t === tab ? ' on' : ''}`} onClick={() => setTab(t)}>
            {t}
            <span class="tab-count">{t === 'Answers' ? (nb?.clues.length ?? 0) : (nb?.themes.length ?? 0)}</span>
          </button>
        ))}
      </div>
      <div class="scroll">
        <p class="muted small sync-line">On this phone · syncs with ThemeFill once Google Drive is connected</p>
        {tab === 'Answers' ? (
          <>
            <Chips
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: 'boost', label: 'Boost' },
                { value: 'newest', label: 'Newest' },
                { value: 'az', label: 'A–Z' },
              ]}
            />
            {nb && !answers.length && (
              <div class="empty">
                <p class="muted">{q ? 'No answers match.' : 'No answers yet. Save entries you love with clue ideas and a boost.'}</p>
              </div>
            )}
            <div class="nb-list">
              {answers.map((a) => (
                <button key={answerKey(a.answer)} class="card nb-card" onClick={() => setEditAnswer(a)}>
                  <div class="nb-card-top">
                    <span class="mono strong nb-answer">{a.answer}</span>
                    <span class="boost" aria-label={`Boost ${a.boost}`}>
                      +{a.boost}
                    </span>
                  </div>
                  <div class="muted small">{letterBreakdown(a.answer)}</div>
                  {a.clues.length > 0 && (
                    <ul class="plain-list small">
                      {a.clues.slice(0, 3).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                      {a.clues.length > 3 && <li class="muted">+{a.clues.length - 3} more</li>}
                    </ul>
                  )}
                  {a.note && <div class="muted small nb-note">{a.note}</div>}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            {nb && !themes.length && (
              <div class="empty">
                <p class="muted">{q ? 'No themes match.' : 'No theme ideas yet.'}</p>
              </div>
            )}
            <div class="nb-list">
              {themes.map((t) => {
                const linked = puzzles.filter((p) => p.themeId === t.id).sort((x, y) => (x.updated < y.updated ? 1 : -1));
                return (
                  <div key={t.id} class="card nb-card theme-card">
                    <div class="nb-card-top">
                      <span class="strong">{t.title || 'Untitled theme'}</span>
                      <SymmetryPill check={symmetryCheck(themeAnswers(t))} />
                    </div>
                    {t.description && <div class="muted small">{t.description}</div>}
                    <ul class="theme-list">
                      {t.entries.map((e, i) => (
                        <li key={i}>
                          <span class="mono">{e.answer}</span>
                          <span class="muted small">{letters(e.answer).length}</span>
                        </li>
                      ))}
                      {t.revealer && letters(t.revealer.answer) && (
                        <li>
                          <span class="mono">{t.revealer.answer}</span>
                          <span class="muted small">{letters(t.revealer.answer).length} · revealer</span>
                        </li>
                      )}
                    </ul>
                    <div class="card-actions">
                      <button class="btn small" onClick={() => setEditTheme(t)}>
                        Edit
                      </button>
                      {linked.length > 0 && (
                        <button class="btn small" onClick={() => navigate({ name: 'editor', id: linked[0].id })}>
                          Open puzzle
                        </button>
                      )}
                      <button class={`btn small${linked.length ? '' : ' primary'}`} onClick={() => setStartTheme(t.id)}>
                        Start a puzzle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
      <button class="fab" onClick={() => (tab === 'Answers' ? setEditAnswer('new') : setEditTheme('new'))}>
        <IconPlus />
        <span>{tab === 'Answers' ? 'New answer' : 'New theme'}</span>
      </button>
      {editAnswer && <AnswerDialog item={editAnswer === 'new' ? null : editAnswer} onClose={() => setEditAnswer(null)} />}
      {editTheme && <ThemeDialog item={editTheme === 'new' ? null : editTheme} onClose={() => setEditTheme(null)} />}
      {startTheme && <NewPuzzleDialog themeId={startTheme} onClose={() => setStartTheme(null)} />}
    </div>
  );
}

function ClueIdeas({ clues, onChange, label = 'Clue ideas' }: { clues: string[]; onChange: (c: string[]) => void; label?: string }) {
  const [adding, setAdding] = useState('');
  const add = () => {
    const t = adding.trim();
    if (t && !clues.includes(t)) onChange([...clues, t]);
    setAdding('');
  };
  return (
    <div class="clue-ideas">
      {clues.map((c, i) => (
        <div key={i} class="idea-row">
          <span>{c}</span>
          <button class="icon-btn" aria-label={`Remove clue idea ${c}`} onClick={() => onChange(clues.filter((_, j) => j !== i))}>
            <IconClose size={18} />
          </button>
        </div>
      ))}
      <div class="row">
        <input
          class="field"
          placeholder="Add a clue idea"
          aria-label={label}
          value={adding}
          onInput={(e) => setAdding((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
        />
        <button class="btn" disabled={!adding.trim()} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

function AnswerDialog({ item, onClose }: { item: NotebookAnswer | null; onClose: () => void }) {
  const [a, setA] = useState<NotebookAnswer>(item ?? normalizeAnswer({ answer: '', boost: DEFAULT_BOOST }));
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<NotebookAnswer>) => setA((x) => ({ ...x, ...patch }));
  const save = async () => {
    try {
      await saveAnswer(a, item?.answer);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Dialog
      title={item ? 'Edit answer' : 'New answer'}
      onClose={onClose}
      actions={
        <>
          {item &&
            (confirm ? (
              <button
                class="btn danger"
                onClick={async () => {
                  await deleteItem(answerKey(item.answer));
                  onClose();
                }}
              >
                Delete for good
              </button>
            ) : (
              <button class="btn" onClick={() => setConfirm(true)}>
                Delete
              </button>
            ))}
          <button class="btn primary" disabled={!letters(a.answer)} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label class="label" for="nb-answer">
        Answer
      </label>
      <input
        id="nb-answer"
        class="field mono"
        value={a.answer}
        autoCapitalize="characters"
        spellcheck={false}
        placeholder="TEA PARTY"
        onInput={(e) => set({ answer: (e.target as HTMLInputElement).value.toUpperCase() })}
      />
      <div class="muted small field-hint">{letters(a.answer) ? letterBreakdown(a.answer) : 'Spaces between words are kept'}</div>
      <label class="label">Clue ideas</label>
      <ClueIdeas clues={a.clues} onChange={(clues) => set({ clues })} />
      <label class="label" for="nb-boost">
        Boost · {a.boost} <span class="muted">(+{Math.round(a.boost * BOOST_FACTOR * 10) / 10} score in Fill)</span>
      </label>
      <input id="nb-boost" class="slider" type="range" min={1} max={100} value={a.boost} onInput={(e) => set({ boost: +(e.target as HTMLInputElement).value })} />
      <label class="label" for="nb-note">
        Note
      </label>
      <textarea id="nb-note" class="field" rows={2} value={a.note} onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
      {error && <p class="warn-text">{error}</p>}
    </Dialog>
  );
}

const emptyTheme = (): NotebookTheme => ({ id: uuid(), title: '', description: '', revealer: null, entries: [{ answer: '', clues: [] }] });

function ThemeDialog({ item, onClose }: { item: NotebookTheme | null; onClose: () => void }) {
  const [t, setT] = useState<NotebookTheme>(() => (item ? structuredClone(item) : emptyTheme()));
  const [confirm, setConfirm] = useState(false);
  const set = (patch: Partial<NotebookTheme>) => setT((x) => ({ ...x, ...patch }));
  const setEntry = (i: number, patch: Partial<ThemeEntry>) => set({ entries: t.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  const rev = t.revealer ?? { answer: '', clues: [] };
  const save = async () => {
    await saveTheme({
      ...t,
      title: t.title.trim(),
      entries: t.entries.filter((e) => letters(e.answer)).map((e) => ({ ...e, answer: e.answer.trim() })),
      revealer: letters(rev.answer) ? { ...rev, answer: rev.answer.trim() } : null,
    });
    onClose();
  };
  return (
    <Dialog
      title={item ? 'Edit theme' : 'New theme'}
      onClose={onClose}
      actions={
        <>
          {item &&
            (confirm ? (
              <button
                class="btn danger"
                onClick={async () => {
                  await deleteItem(themeKey(item.id));
                  onClose();
                }}
              >
                Delete for good
              </button>
            ) : (
              <button class="btn" onClick={() => setConfirm(true)}>
                Delete
              </button>
            ))}
          <button class="btn primary" disabled={!t.title.trim()} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label class="label" for="th-title">
        Title
      </label>
      <input id="th-title" class="field" value={t.title} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
      <label class="label" for="th-desc">
        Description
      </label>
      <textarea id="th-desc" class="field" rows={2} value={t.description} onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} />
      <div class="label row-between">
        <span>Theme entries</span>
        <SymmetryPill check={symmetryCheck(themeAnswers({ ...t, revealer: rev }))} />
      </div>
      {t.entries.map((e, i) => (
        <div key={i} class="entry-edit">
          <div class="row">
            <input
              class="field mono"
              value={e.answer}
              aria-label={`Entry ${i + 1}`}
              placeholder="ENTRY"
              autoCapitalize="characters"
              spellcheck={false}
              onInput={(ev) => setEntry(i, { answer: (ev.target as HTMLInputElement).value.toUpperCase() })}
            />
            <span class="muted small len">{letters(e.answer).length || ''}</span>
            <button class="icon-btn" aria-label={`Remove entry ${i + 1}`} onClick={() => set({ entries: t.entries.filter((_, j) => j !== i) })}>
              <IconClose size={18} />
            </button>
          </div>
          <ClueIdeas clues={e.clues} label={`Clue idea for entry ${i + 1}`} onChange={(clues) => setEntry(i, { clues })} />
        </div>
      ))}
      <button class="btn small" onClick={() => set({ entries: [...t.entries, { answer: '', clues: [] }] })}>
        Add entry
      </button>
      <label class="label" for="th-rev">
        Revealer
      </label>
      <div class="entry-edit">
        <div class="row">
          <input
            id="th-rev"
            class="field mono"
            value={rev.answer}
            placeholder="Optional"
            autoCapitalize="characters"
            spellcheck={false}
            onInput={(ev) => set({ revealer: { ...rev, answer: (ev.target as HTMLInputElement).value.toUpperCase() } })}
          />
          <span class="muted small len">{letters(rev.answer).length || ''}</span>
        </div>
        <ClueIdeas clues={rev.clues} label="Revealer clue idea" onChange={(clues) => set({ revealer: { ...rev, clues } })} />
      </div>
    </Dialog>
  );
}
