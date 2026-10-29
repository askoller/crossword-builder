// Autofill screen (SPEC §3.6) and the select-mode banner with in-place results (§3.3).
import { useEffect, useState } from 'preact/hooks';
import type { CheckReport } from '../engine/check';
import type { FillEntry } from '../engine/protocol';
import { DAYS, type Day, type Puzzle } from '../model/types';
import type { EditorSession } from '../state/editor';
import { fillLetter, type FillResultView } from '../state/fill';
import { Chips, Menu } from './common';
import { shortYear } from './FillPanel';
import { IconClose, IconMore } from './icons';

const WEEK: Day[] = DAYS.filter((d) => d !== 'Sun');
const FLOORS: { value: string; label: string }[] = [
  { value: 'default', label: 'Per length' },
  { value: '30', label: '30' },
  { value: '35', label: '35' },
  { value: '40', label: '40' },
  { value: '45', label: '45' },
];

function seconds(ms: number): string {
  return `${Math.floor(ms / 1000)}s`;
}

const entryList = (es: FillEntry[]) => es.map((e) => e.word).join(' · ');

/** The orange banner that replaces the clue bar in select mode. */
export function SelectBanner({ s }: { s: EditorSession }) {
  const f = s.fill;
  const n = f.selection.value.size;
  const run = f.run.value?.inPlace ? f.run.value : null;
  const [menu, setMenu] = useState(false);
  const res = run?.results[run.current];

  if (run && res) {
    const entries = res.stats.entries ?? [];
    return (
      <div class="select-banner">
        <div class="select-main">
          <div class="strong">
            Fill {fillLetter(run.current)} of {run.results.length}
            {run.running ? '+' : ''} · {n} squares
          </div>
          <div class="small mono select-entries">{entryList(entries)}</div>
          <div class="small">avg {res.stats.average}{run.running ? ` · searching ${seconds(run.elapsed)}` : ''}</div>
        </div>
        <div class="select-actions">
          <button class="icon-btn" aria-label="Discard fills" onClick={() => f.discardResults()}>
            <IconClose />
          </button>
          <button class="btn small" disabled={run.results.length < 2} onClick={() => f.nextResult()}>
            Next fill
          </button>
          <button class="btn small autofill" onClick={() => void f.keep()}>
            Keep
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="select-banner">
      <div class="select-main">
        <div class="strong">
          {n} square{n === 1 ? '' : 's'} selected
        </div>
        <div class="small">
          {run?.running
            ? `Searching… ${seconds(run.elapsed)}`
            : run?.message || 'Tap squares to add or remove. The rest of the grid stays as is.'}
        </div>
      </div>
      <div class="select-actions">
        <button class="icon-btn" aria-label="Selection options" onClick={() => setMenu(true)}>
          <IconMore />
        </button>
        {run?.running ? (
          <button class="btn small" onClick={() => f.stop()}>
            Stop
          </button>
        ) : (
          <>
            <button class="btn small" onClick={() => (n ? f.setSelection([]) : f.exitSelect())}>
              {n ? 'Clear' : 'Done'}
            </button>
            <button class="btn small autofill" disabled={!n} onClick={() => f.autofillSelection()}>
              Autofill these
            </button>
          </>
        )}
      </div>
      {menu && (
        <Menu
          onClose={() => setMenu(false)}
          anchor="bottom"
          items={[
            { label: 'Select current word', onSelect: () => f.selectCurrentWord() },
            { label: 'Select region', hint: 'Open squares around the last one tapped', onSelect: () => f.selectRegion() },
            { label: 'Invert selection', onSelect: () => f.invertSelection() },
            { label: 'Clear selection', onSelect: () => f.setSelection([]) },
            { label: 'Done selecting', onSelect: () => f.exitSelect() },
          ]}
        />
      )}
    </div>
  );
}

/** Thumbnail with blocks and the scope highlighted. */
function ScopeThumb({ p, fill, size = 72 }: { p: Puzzle; fill: Record<number, string>; size?: number }) {
  const parts = [];
  for (let i = 0; i < p.cells.length; i++) {
    const c = p.cells[i];
    const fillColor = c.b ? 'var(--ink)' : i in fill ? 'var(--selection)' : c.lock ? 'var(--locked)' : null;
    if (fillColor) parts.push(<rect key={i} x={i % p.width} y={Math.floor(i / p.width)} width={1} height={1} fill={fillColor} />);
  }
  return (
    <svg class="thumb" viewBox={`0 0 ${p.width} ${p.height}`} width={size} height={(size * p.height) / p.width} aria-hidden="true">
      <rect width={p.width} height={p.height} fill="#fff" />
      {parts}
      <rect width={p.width} height={p.height} fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

function ResultCard({ p, r, i, on, whole, onPick }: { p: Puzzle; r: FillResultView; i: number; on: boolean; whole: boolean; onPick: () => void }) {
  const entries = r.stats.entries ?? [];
  const across = entries.filter((e) => e.slot.startsWith('A'));
  const down = entries.filter((e) => e.slot.startsWith('D'));
  const debuts = entries.filter((e) => e.nyt === 0);
  const old = entries.filter((e) => e.nyt > 0 && e.last > 0 && e.last < 2005);
  return (
    <button class={`card result-card${on ? ' on' : ''}`} onClick={onPick} aria-pressed={on}>
      <ScopeThumb p={p} fill={r.fill} />
      <div class="result-body">
        <div class="result-top">
          <span class="strong">Fill {fillLetter(i)}</span>
          <span class="small">avg {r.stats.average}</span>
          {r.stats.weakest && (
            <span class="small muted">
              weakest <span class="mono">{r.stats.weakest.word}</span> {Math.round(r.stats.weakest.value)}
            </span>
          )}
        </div>
        {across.length > 0 && (
          <div class="small entries">
            <span class="muted">Across </span>
            <span class="mono">{entryList(across)}</span>
          </div>
        )}
        {down.length > 0 && (
          <div class="small entries">
            <span class="muted">Down </span>
            <span class="mono">{entryList(down)}</span>
          </div>
        )}
        {whole && (
          <div class="small muted">
            {r.stats.underFloor} under the floor · {debuts.length} debut{debuts.length === 1 ? '' : 's'}
            {debuts.length > 0 && <span class="mono"> ({debuts.slice(0, 4).map((e) => e.word).join(', ')})</span>} · {old.length} only before 2005
            {old.length > 0 && <span class="mono"> ({old.slice(0, 3).map((e) => `${e.word} ${shortYear(e.last)}`).join(', ')})</span>}
          </div>
        )}
      </div>
    </button>
  );
}

export function AutofillPanel({ s, onClose }: { s: EditorSession; onClose: () => void }) {
  const f = s.fill;
  const p = s.puzzle.value;
  const sel = f.selection.value;
  const prefs = f.prefs.value;
  const run = f.run.value && !f.run.value.inPlace ? f.run.value : null;
  const [scope, setScope] = useState<'grid' | 'selection'>(sel.size ? 'selection' : 'grid');
  const effScope = scope === 'selection' && sel.size ? 'selection' : 'grid';
  const [check, setCheck] = useState<CheckReport | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [editSettings, setEditSettings] = useState(false);
  const res = run?.results[run.current];

  useEffect(() => {
    setCheck(null);
    if (!res) return;
    let alive = true;
    void f.checkWith(res.fill).then((r) => alive && setCheck(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [res]);

  const start = (append = false) => {
    setEditSettings(false);
    f.startAutofill(effScope === 'selection' ? { kind: 'selection', cells: [...sel] } : { kind: 'grid' }, false, append);
  };

  return (
    <div class="autofill-panel" aria-label="Autofill">
      <div class="fill-head">
        <h2>Autofill</h2>
        <button class="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div class="autofill-body">
        <Chips
          label="Scope"
          options={[{ value: 'grid', label: 'Whole grid' }, ...(sel.size ? [{ value: 'selection', label: `Selected squares · ${sel.size}` }] : [])] as { value: 'grid' | 'selection'; label: string }[]}
          value={effScope}
          onChange={(v) => setScope(v)}
        />
        {run && !editSettings ? (
          <div class="row settings-summary">
            <span class="small">
              {effScope === 'selection' ? `${sel.size} squares` : 'Whole grid'} · {prefs.day} · floor {prefs.floor ?? 'per length'} · keep {prefs.keepOpen} open
            </span>
            <button class="btn small" onClick={() => setEditSettings(true)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <label class="label">Day</label>
            <Chips label="Day" options={WEEK} value={(prefs.day === 'Sun' ? 'Sat' : prefs.day) as Day} onChange={(day: Day) => (f.prefs.value = { ...prefs, day })} />
            <label class="label">Floor</label>
            <Chips
              label="Floor"
              options={FLOORS}
              value={prefs.floor === null ? 'default' : String(prefs.floor)}
              onChange={(v) => (f.prefs.value = { ...prefs, floor: v === 'default' ? null : Number(v) })}
            />
            <label class="label">Keep crossers open</label>
            <div class="row">
              <span class="stepper" aria-label="Keep crossers open">
                <button aria-label="Fewer" onClick={() => (f.prefs.value = { ...prefs, keepOpen: Math.max(1, prefs.keepOpen - 1) })}>
                  −
                </button>
                <span class="mono">{prefs.keepOpen}</span>
                <button aria-label="More" onClick={() => (f.prefs.value = { ...prefs, keepOpen: Math.min(20, prefs.keepOpen + 1) })}>
                  +
                </button>
              </span>
              <span class="small muted">words left in each slot outside the scope</span>
            </div>
          </>
        )}

        {run && (
          <div class="results">
            <div class="results-head">
              <span class="strong">
                {run.scope.kind === 'selection' ? 'Fills for the selection' : 'Whole-grid fills'}
                {run.results.length > 0 && ` · best ${Math.min(3, run.results.length)} of ${run.results.length}`}
              </span>
              {run.running ? (
                <span class="row">
                  <span class="small muted">Searching… {seconds(run.elapsed)}</span>
                  <button class="btn small" onClick={() => f.stop()}>
                    Stop
                  </button>
                </span>
              ) : (
                run.message && <span class="small muted">{run.message}</span>
              )}
            </div>
            {run.results.slice(0, showAll ? undefined : 3).map((r, i) => (
              <ResultCard key={i} p={p} r={r} i={i} on={i === run.current} whole={run.scope.kind === 'grid'} onPick={() => f.showResult(i)} />
            ))}
            {run.results.length > 3 && (
              <button class="btn small" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show the best 3' : `Show all ${run.results.length}`}
              </button>
            )}
            {check && res && (
              <div class={`check-summary${check.count ? ' warn' : ''}`}>
                <span class="strong">Check for Fill {fillLetter(run.current)}:</span>{' '}
                {check.count ? `${check.count} issue${check.count === 1 ? '' : 's'}` : 'no issues'}
                {check.issues
                  .filter((x) => x.level !== 'info')
                  .slice(0, 3)
                  .map((x, k) => (
                    <div key={k} class="small">
                      {x.text}
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div class="fill-foot">
        {run && run.results.length > 0 ? (
          <>
            <button class="btn" disabled={run.running} onClick={() => start(true)}>
              Keep searching
            </button>
            {run.scope.kind === 'selection' && (
              <button
                class="btn"
                onClick={() => {
                  f.widenSelection();
                  setScope('selection');
                  f.startAutofill({ kind: 'selection', cells: [...f.selection.value] }, false);
                }}
              >
                Widen selection
              </button>
            )}
            <button
              class="btn primary"
              onClick={async () => {
                await f.keep();
                onClose();
              }}
            >
              Apply Fill {fillLetter(run.current)}
            </button>
          </>
        ) : (
          <button class="btn primary" disabled={run?.running} onClick={() => start()}>
            {run?.running ? 'Searching…' : effScope === 'selection' ? `Fill ${sel.size} squares` : 'Fill the grid'}
          </button>
        )}
      </div>
    </div>
  );
}
