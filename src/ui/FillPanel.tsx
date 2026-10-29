// Fill suggestions (SPEC §3.4): the sheet on the cover screen and the Fill tab on the
// inner screen (§3.8, adds a Last-used column and the clue history preview).
import { useEffect, useState } from 'preact/hooks';
import { openDb, type ClueEntry } from '../data/db';
import type { Candidate } from '../engine/candidates';
import { slotLabel } from '../model/grid';
import type { EditorSession } from '../state/editor';
import type { FillSort } from '../state/fill';
import { IconClose } from './icons';

const SORTS: { value: FillSort; label: string }[] = [
  { value: 'score', label: 'Score' },
  { value: 'nyt', label: 'NYT uses' },
  { value: 'fresh', label: 'Freshness' },
  { value: 'room', label: 'Crossing room' },
];
const ROOM_OK = 100;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function shortYear(y: number): string {
  return `’${String(y % 100).padStart(2, '0')}`;
}

function sortList(list: Candidate[], sort: FillSort): Candidate[] {
  const out = list.slice();
  const room = (c: Candidate) => (c.room === null ? Infinity : c.room);
  if (sort === 'nyt') out.sort((a, b) => b.nyt - a.nyt || b.value - a.value);
  else if (sort === 'fresh') out.sort((a, b) => a.nyt - b.nyt || a.last - b.last || b.value - a.value);
  else if (sort === 'room') out.sort((a, b) => room(b) - room(a) || b.value - a.value);
  else out.sort((a, b) => b.value - a.value);
  return out;
}

export function ScoreBadge({ score, boost = 0 }: { score: number; boost?: number }) {
  const v = Math.min(60, Math.round(score + boost * 0.3));
  const cls = v >= 45 ? 'hi' : v >= 40 ? 'mid' : 'lo';
  return <span class={`score-badge ${cls}`}>{v}</span>;
}

function RoomBar({ room }: { room: number | null }) {
  if (room === null) return <span class="muted small">no open crossers</span>;
  // log scale: 1 → ~0%, 1000+ → 100%
  const pct = Math.max(4, Math.min(100, (Math.log10(1 + room) / 3) * 100));
  return (
    <span class="room">
      <span class={`room-bar${room >= ROOM_OK ? '' : ' low'}`}>
        <span style={{ width: `${pct}%` }} />
      </span>
      <span class="small">min {room.toLocaleString('en-US')} fits</span>
    </span>
  );
}

function nytText(c: Candidate): string {
  if (!c.nyt) return 'debut';
  return c.last ? `${c.nyt} · last ${shortYear(c.last)}` : `${c.nyt}`;
}

export function FillPanel({ s, wide = false, onClose }: { s: EditorSession; wide?: boolean; onClose?: () => void }) {
  const f = s.fill;
  const slot = s.currentSlot.value;
  const list = f.list.value;
  const filters = f.filters.value;
  const picked = f.picked.value;
  const setFilters = (patch: Partial<typeof filters>) => (f.filters.value = { ...filters, ...patch });

  const rows = list
    ? sortList(
        list.candidates.filter((c) => (!filters.noDupes || !c.dupe) && (!filters.crossingsOk || c.room === null || c.room > 0)),
        filters.sort,
      )
    : [];
  const chosen = picked ?? rows[0]?.word ?? null;

  const head = slot ? (
    <div class="fill-head">
      <div class="fill-title">
        <h2>
          {slotLabel(slot)} · {slot.cells.length} letters
        </h2>
        <div class="fill-sub">
          <span class="mono pattern">{list?.pattern ?? ''}</span>
          {list && <span class="muted small">{list.inList.toLocaleString('en-US')} in your list</span>}
        </div>
      </div>
      {onClose && (
        <button class="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      )}
    </div>
  ) : null;

  if (!slot) {
    return (
      <div class="fill-panel">
        <p class="placeholder">Pick a square in an entry to see words that fit.</p>
      </div>
    );
  }

  return (
    <div class={`fill-panel${wide ? ' wide' : ''}`} aria-label="Fill suggestions">
      {head}
      <div class="fill-filters">
        <span class="stepper" aria-label="Score floor">
          <button aria-label="Lower floor" onClick={() => setFilters({ floor: Math.max(0, filters.floor - 5) })}>
            −
          </button>
          <span class="mono">{filters.floor}+</span>
          <button aria-label="Raise floor" onClick={() => setFilters({ floor: Math.min(60, filters.floor + 5) })}>
            +
          </button>
        </span>
        <button class={`chip${filters.noDupes ? ' on' : ''}`} aria-pressed={filters.noDupes} onClick={() => setFilters({ noDupes: !filters.noDupes })}>
          No dupes
        </button>
        <button
          class={`chip${filters.crossingsOk ? ' on' : ''}`}
          aria-pressed={filters.crossingsOk}
          onClick={() => setFilters({ crossingsOk: !filters.crossingsOk })}
        >
          Crossings OK
        </button>
        <select class="chip select" aria-label="Sort" value={filters.sort} onChange={(e) => setFilters({ sort: (e.target as HTMLSelectElement).value as FillSort })}>
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div class="fill-list" role="listbox" aria-label="Words that fit">
        {f.listError.value && <p class="placeholder">{f.listError.value}</p>}
        {!f.listError.value && list && !rows.length && (
          <p class="placeholder">
            {list.atFloor ? 'Nothing left after the filters.' : `No words at ${filters.floor}+ fit ${list.pattern}.`}
          </p>
        )}
        {wide && rows.length > 0 && (
          <div class="fill-row fill-row-head" aria-hidden="true">
            <span>Word</span>
            <span>Score</span>
            <span>NYT</span>
            <span>Last used</span>
            <span>Crossings</span>
          </div>
        )}
        {rows.map((c) => (
          <button
            key={c.word}
            role="option"
            aria-selected={c.word === chosen}
            class={`fill-row${c.word === picked ? ' on' : ''}`}
            onClick={() => (f.picked.value = c.word === picked ? null : c.word)}
          >
            <span class="mono fill-word">
              {c.word}
              {c.boost > 0 && <span class="boost">+{c.boost}</span>}
            </span>
            <ScoreBadge score={c.score} boost={c.boost} />
            <span class="small">{wide ? (c.nyt ? c.nyt : 'debut') : nytText(c)}</span>
            {wide && <span class="small">{c.last || '—'}</span>}
            <RoomBar room={c.room} />
            {c.dupe && <span class="dupe-note small">{c.dupe}</span>}
          </button>
        ))}
      </div>
      {wide && chosen && <CluePreview word={chosen} />}
      <div class="fill-foot">
        <button class="btn" onClick={() => (s.panel.value = 'clue')}>
          {wide ? 'Full clue history' : 'Clue history'}
        </button>
        <button class="btn primary" disabled={!chosen} onClick={() => chosen && f.useWord(chosen)}>
          Use {chosen ?? 'word'}
        </button>
      </div>
    </div>
  );
}

/** First few NYT clues for the selected word (inner screen). */
function CluePreview({ word }: { word: string }) {
  const [clues, setClues] = useState<ClueEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    setClues(null);
    void openDb()
      .then((db) => db.get('clues', word))
      .then((c) => alive && setClues(c ?? []))
      .catch(() => alive && setClues([]));
    return () => {
      alive = false;
    };
  }, [word]);
  return (
    <div class="clue-preview">
      <div class="small strong">
        Clue history · <span class="mono">{word}</span>
      </div>
      {clues === null ? null : clues.length ? (
        clues.slice(0, 4).map(([text, ymd, wd], i) => (
          <div key={i} class="clue-line small">
            <span class="muted">
              {Math.floor(ymd / 10000)} {WEEKDAYS[wd] ?? ''}
            </span>{' '}
            {text}
          </div>
        ))
      ) : (
        <div class="muted small">No NYT clues for this entry.</div>
      )}
    </div>
  );
}
