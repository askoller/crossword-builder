// Clue editor (SPEC §3.5) and the NYT clue history view shared with the Clues browser.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { getClueHistory, wordFacts, type WordFacts } from '../data/clues';
import type { ClueEntry } from '../data/db';
import { addClueIdea, getAnswer, notebookVersion } from '../data/notebook';
import { clusterAngles, filterHistory, formatYmd, nearDuplicates, weekdayName, yearOf, type HistoryFilter } from '../model/clues';
import { slotLabel } from '../model/grid';
import type { NotebookAnswer } from '../model/notebook';
import { cellText, DAYS, type Day } from '../model/types';
import { dataVersion } from '../state/app';
import type { EditorSession } from '../state/editor';
import { Chips, ScoreBadge } from './common';
import { IconChevronLeft, IconChevronRight, IconClose } from './icons';

export interface AnswerData {
  history: ClueEntry[];
  facts: WordFacts | null;
  notebook: NotebookAnswer | null;
  loaded: boolean;
}

/** History, word facts and Notebook item for an answer; reloads after imports and Notebook edits. */
export function useAnswerData(answer: string | null): AnswerData {
  const [data, setData] = useState<AnswerData>({ history: [], facts: null, notebook: null, loaded: false });
  const nbv = notebookVersion.value;
  const dv = dataVersion.value;
  useEffect(() => {
    let alive = true;
    if (!answer) {
      setData({ history: [], facts: null, notebook: null, loaded: true });
      return;
    }
    void Promise.all([getClueHistory(answer), wordFacts(answer), getAnswer(answer)]).then(([history, facts, notebook]) => {
      if (alive) setData({ history, facts, notebook, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [answer, nbv, dv]);
  return data;
}

export function AnswerFacts({ facts, history }: { facts: WordFacts | null; history: ClueEntry[] }) {
  const nyt = facts?.nyt ?? history.length;
  const last = facts?.last || (history[0] ? yearOf(history[0][1]) : 0);
  return (
    <span class="answer-facts">
      {facts ? <ScoreBadge score={facts.score} /> : <span class="muted small">Not in your list</span>}
      <span class="muted small">
        {nyt ? `NYT ${nyt}×${last ? ` · last ’${String(last).slice(-2)}` : ''}` : 'NYT debut'}
      </span>
    </span>
  );
}

const ANGLE_COLORS = ['var(--primary)', '#5B7BEA', '#9DB0F2', '#C9CDD5'];

export function ClueHistory({ history, highlight, day }: { history: ClueEntry[]; highlight?: Set<number>; day?: Day }) {
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [angle, setAngle] = useState<number | null>(null);
  const angles = useMemo(() => clusterAngles(history), [history]);
  useEffect(() => setAngle(null), [history]);
  if (!history.length) return <p class="muted">No NYT clues for this answer. It would be a debut.</p>;

  const counts = { all: history.length, since2015: filterHistory(history, 'since2015').length, late: filterHistory(history, 'late').length };
  const inAngle = angle === null ? null : new Set(angles[angle]?.indices);
  const shown = filterHistory(history, filter).filter((i) => !inAngle || inAngle.has(i));
  const dayIndex = day ? DAYS.indexOf(day) : -1;

  return (
    <div class="history">
      {angles.length > 1 && (
        <div class="angles">
          <div class="angle-bar" role="group" aria-label="Clue angles">
            {angles.map((a, i) => (
              <button
                key={a.label}
                class={`angle-seg${angle === i ? ' on' : ''}`}
                style={{ flex: a.indices.length, background: ANGLE_COLORS[a.label === 'other' ? 3 : i] }}
                aria-label={`${a.label}: ${a.indices.length} clues`}
                onClick={() => setAngle(angle === i ? null : i)}
              />
            ))}
          </div>
          <div class="angle-legend">
            {angles.map((a, i) => (
              <button key={a.label} class={`angle-key${angle === i ? ' on' : ''}`} onClick={() => setAngle(angle === i ? null : i)}>
                <span class="dot" style={{ background: ANGLE_COLORS[a.label === 'other' ? 3 : i] }} />
                {a.label} {a.indices.length}
              </button>
            ))}
          </div>
        </div>
      )}
      <Chips
        label="History filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: `All ${counts.all}` },
          { value: 'since2015', label: `Since 2015 · ${counts.since2015}` },
          { value: 'late', label: `Thu–Sat · ${counts.late}` },
        ]}
      />
      <ul class="history-list">
        {shown.map((i) => {
          const [clue, ymd, wd] = history[i];
          return (
            <li key={i} class={highlight?.has(i) ? 'near' : ''}>
              <span class="h-date mono">{formatYmd(ymd)}</span>
              <span class={`h-day${wd === dayIndex ? ' same' : ''}`}>{weekdayName(wd)}</span>
              <span class="h-clue">{clue}</span>
            </li>
          );
        })}
        {!shown.length && <li class="muted">No clues match this filter.</li>}
      </ul>
    </div>
  );
}

const TARGET_DAYS = DAYS.slice(0, 6);

/** The clue editor for the editor's current slot. `full` is the cover-screen full-page version. */
export function ClueEditor({ s, onClose, full = false }: { s: EditorSession; onClose?: () => void; full?: boolean }) {
  const slot = s.currentSlot.value;
  const p = s.puzzle.value;
  const texts = slot ? slot.cells.map((i) => cellText(p.cells[i])) : [];
  const complete = !!slot && texts.every(Boolean);
  const answer = complete ? texts.join('') : null;
  const data = useAnswerData(answer);
  const saved = slot ? (p.clues[slot.id]?.text ?? '') : '';
  const [draft, setDraft] = useState(saved);
  const [day, setDay] = useState<Day>(p.day);
  const [note, setNote] = useState('');
  useEffect(() => {
    setDraft(saved);
    setNote('');
  }, [slot?.id, saved]);
  const matches = useMemo(() => nearDuplicates(draft, data.history), [draft, data.history]);
  const near = useMemo(() => new Set(matches.map((m) => m.index)), [matches]);

  const saveClue = () => {
    if (!slot) return;
    s.commit(new Map(), new Map([[slot.id, draft.trim() ? { ...p.clues[slot.id], text: draft.trim() } : null]]));
    setNote('Clue saved');
  };
  const saveIdea = async () => {
    if (!answer || !draft.trim()) return;
    await addClueIdea(data.notebook?.answer ?? answer, draft);
    setNote('Saved to Notebook');
  };

  return (
    <div class={`clue-editor${full ? ' clue-screen' : ''}`} data-blocks-keys={full ? '' : undefined}>
      <div class="clue-head">
        <button class="icon-btn" aria-label="Previous entry" onClick={() => s.stepEntry(-1)}>
          <IconChevronLeft />
        </button>
        <div class="clue-head-main">
          <div class="clue-head-top">
            <span class="cluebar-label">{slot ? slotLabel(slot) : 'No entry'}</span>
            <span class="mono answer">{slot ? texts.map((t) => t || '?').join('') : ''}</span>
          </div>
          {answer ? <AnswerFacts facts={data.facts} history={data.history} /> : slot && <span class="muted small">Fill every square to see its clue history</span>}
        </div>
        <button class="icon-btn" aria-label="Next entry" onClick={() => s.stepEntry(1)}>
          <IconChevronRight />
        </button>
        {onClose && (
          <button class="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        )}
      </div>
      <div class="clue-body">
        {slot ? (
          <>
            <label class="label" for="clue-draft">
              Your clue
            </label>
            <textarea
              id="clue-draft"
              class="field clue-draft"
              rows={2}
              value={draft}
              placeholder={`Clue for ${slotLabel(slot)}`}
              onInput={(e) => {
                setDraft((e.target as HTMLTextAreaElement).value);
                setNote('');
              }}
            />
            {matches.length > 0 && (
              <div class="inline-warning" role="status">
                Close to {matches.length === 1 ? 'a past clue' : `${matches.length} past clues`}:{' '}
                {matches.slice(0, 3).map((m, k) => {
                  const [c, ymd, wd] = data.history[m.index];
                  return (
                    <span key={m.index}>
                      {k > 0 && '; '}“{c}” ({weekdayName(wd)} {yearOf(ymd)})
                    </span>
                  );
                })}
                {matches.length > 3 && ` and ${matches.length - 3} more`}
              </div>
            )}
            <label class="label">Day target</label>
            <Chips label="Day target" options={TARGET_DAYS} value={day} onChange={setDay} />
            {data.notebook && data.notebook.clues.length > 0 && (
              <>
                <label class="label">Notebook ideas</label>
                <div class="ideas">
                  {data.notebook.clues.map((c) => (
                    <button key={c} class="idea" onClick={() => setDraft(c)}>
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}
            <div class="clue-actions">
              <span class="muted small" aria-live="polite">
                {note}
              </span>
              <button class="btn" disabled={!answer || !draft.trim()} onClick={saveIdea}>
                Save to Notebook
              </button>
              <button class="btn primary" disabled={draft.trim() === saved} onClick={saveClue}>
                Save clue
              </button>
            </div>
            {answer && (
              <>
                <h3 class="section-title">NYT clue history</h3>
                {data.loaded ? <ClueHistory history={data.history} highlight={near} day={day} /> : <p class="muted">Loading…</p>}
              </>
            )}
          </>
        ) : (
          <p class="muted">Select an entry in the grid to write its clue.</p>
        )}
      </div>
    </div>
  );
}

