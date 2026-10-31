// Clue mode (SPEC §3.11): writing clues with the Android keyboard open.
//
// From the top: compact header, a one-line strip with the answer and its crossings, the
// grid (only while the keyboard is closed), the clue list, and the clue field pinned
// directly above the keyboard. On the inner screen in landscape the grid sits on the left.
import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { nearDuplicates, weekdayName, yearOf } from '../model/clues';
import { slotLabel, slotPattern } from '../model/grid';
import type { Layout } from '../model/layout';
import { cellText, type Slot } from '../model/types';
import { keyboardOpen } from '../state/app';
import type { EditorSession } from '../state/editor';
import { AnswerFacts, ClueHistory, useAnswerData } from './Clue';
import { Grid } from './Grid';
import { IconChevronLeft, IconChevronRight, IconClose } from './icons';

/** The slot's answer, or null while a square is empty. */
function answerOf(s: EditorSession, slot: Slot | null): string | null {
  if (!slot) return null;
  const p = s.puzzle.value;
  const t = slot.cells.map((i) => cellText(p.cells[i]));
  return t.every(Boolean) ? t.join('') : null;
}

/**
 * Props for buttons that must not take focus from the clue field, so tapping them keeps
 * the keyboard open. If focus moves anyway, it is handed back after the click.
 */
function useKeepFocus(field: RefObject<HTMLTextAreaElement | null>) {
  const had = useRef(false);
  const down = (e: Event) => {
    const b = (e.target as Element).closest('button');
    had.current = false;
    if (!b || b.hasAttribute('data-release')) return; // Done lets the keyboard close
    had.current = document.activeElement === field.current;
    if (had.current) e.preventDefault();
  };
  return {
    onPointerDown: down,
    onMouseDown: down,
    onClick: () => {
      if (had.current && document.activeElement !== field.current) field.current?.focus({ preventScroll: true });
      had.current = false;
    },
  };
}

export function ClueModeScreen({ s, layout, header }: { s: EditorSession; layout: Layout; header: ComponentChildren }) {
  const kb = keyboardOpen.value;
  const [history, setHistory] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const keep = useKeepFocus(field);
  const landscape = layout === 'inner-landscape';
  const slot = s.currentSlot.value;

  // Opened from the clue editor's "Write in Clue mode": focus the field (keyboard opens).
  useEffect(() => {
    if (!s.focusClue) return;
    s.focusClue = false;
    field.current?.focus();
  }, [s]);

  const middle = history ? (
    <HistoryPanel s={s} slot={slot} onClose={() => setHistory(false)} keep={keep} />
  ) : (
    <ClueList s={s} keep={keep} />
  );
  const grid = (
    <div class="clue-mode-grid">
      <Grid s={s} tapOnly />
    </div>
  );
  const composer = <ClueComposer s={s} field={field} keep={keep} history={history} onHistory={() => setHistory(!history)} />;

  return (
    <div class={`screen editor clue-mode ${landscape ? 'clue-mode-wide' : 'clue-mode-narrow'}${kb ? ' kb-open' : ''}`} data-layout={layout}>
      {header}
      {landscape ? (
        <div class="clue-mode-body">
          {grid}
          <div class="clue-mode-right">
            <CrossStrip s={s} keep={keep} />
            {middle}
            {composer}
          </div>
        </div>
      ) : (
        <>
          <CrossStrip s={s} keep={keep} />
          {!kb && !history && grid}
          {middle}
          {composer}
        </>
      )}
    </div>
  );
}

type Keep = ReturnType<typeof useKeepFocus>;

/** One line: the answer's letters and the crossing entries (tap one to go to it). */
function CrossStrip({ s, keep }: { s: EditorSession; keep: Keep }) {
  const slot = s.currentSlot.value;
  const p = s.puzzle.value;
  const idx = s.slots.value;
  if (!slot) return <div class="cross-strip muted">Select an entry</div>;
  const crossers: Slot[] = [];
  for (const cell of slot.cells) {
    const k = (slot.dir === 'across' ? idx.down : idx.across)[cell];
    const c = k >= 0 ? idx.slots[k] : null;
    if (c && !crossers.includes(c)) crossers.push(c);
  }
  return (
    <div class="cross-strip" {...keep} aria-label="Answer and crossings">
      <span class="cs-label">{slotLabel(slot)}</span>
      <span class="cs-letters mono" aria-label={`Answer ${slotPattern(p.cells, slot)}`}>
        {slot.cells.map((i) => (
          <span key={i} class="cs-cell">
            {cellText(p.cells[i]) || ' '}
          </span>
        ))}
      </span>
      {crossers.map((c) => (
        <button key={c.id} class="cs-cross" onClick={() => s.goToSlot(c.id)} aria-label={`Go to ${slotLabel(c)}`}>
          <span class="cs-num">
            {c.number}
            {c.dir === 'across' ? 'A' : 'D'}
          </span>
          <span class="mono">{slotPattern(p.cells, c)}</span>
        </button>
      ))}
    </div>
  );
}

/** Across, then Down; the current clue stays scrolled into view. */
function ClueList({ s, keep }: { s: EditorSession; keep: Keep }) {
  const list = useRef<HTMLDivElement>(null);
  const p = s.puzzle.value;
  const slots = s.slots.value.slots;
  const cur = s.currentSlot.value;
  const kb = keyboardOpen.value;
  const empty = slots.filter((sl) => !s.clueText(sl.id).trim()).length;

  // Keep the current row visible, also when the keyboard or a rotation resizes the list.
  const reveal = () => {
    const el = list.current;
    const row = el?.querySelector<HTMLElement>('.cl-row.on');
    if (!el || !row) return;
    const head = 32; // the sticky Across / Down heading
    const top = row.offsetTop;
    if (top - head < el.scrollTop) el.scrollTop = Math.max(0, top - head - 4);
    else if (top + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = top + row.offsetHeight - el.clientHeight + 4;
  };
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  useLayoutEffect(reveal, [cur?.id, kb]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const ro = new ResizeObserver(() => revealRef.current());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = (dir: 'across' | 'down') =>
    slots
      .filter((sl) => sl.dir === dir)
      .map((sl) => {
        const text = s.clueText(sl.id).trim();
        const on = cur?.id === sl.id;
        return (
          <button
            key={sl.id}
            class={`cl-row${on ? ' on' : ''}${text ? '' : ' empty'}`}
            aria-current={on ? 'true' : undefined}
            onClick={() => s.goToSlot(sl.id)}
          >
            <span class="cl-num">{sl.number}</span>
            <span class="cl-answer mono">{slotPattern(p.cells, sl)}</span>
            <span class="cl-clue">{text || 'No clue yet'}</span>
          </button>
        );
      });

  return (
    <div class="clue-list" ref={list} {...keep} aria-label="Clues">
      <div class="cl-summary muted small">
        {empty ? `${empty} of ${slots.length} without a clue` : `All ${slots.length} clued`}
      </div>
      <h3 class="cl-head">Across</h3>
      {rows('across')}
      <h3 class="cl-head">Down</h3>
      {rows('down')}
    </div>
  );
}

/** The clue field, pinned directly above the keyboard. */
function ClueComposer({
  s,
  field,
  keep,
  history,
  onHistory,
}: {
  s: EditorSession;
  field: RefObject<HTMLTextAreaElement | null>;
  keep: Keep;
  history: boolean;
  onHistory: () => void;
}) {
  const slot = s.currentSlot.value;
  const answer = answerOf(s, slot);
  const data = useAnswerData(answer);
  const text = slot ? s.clueText(slot.id) : '';
  const matches = useMemo(() => nearDuplicates(text, data.history), [text, data.history]);
  const step = (d: 1 | -1) => {
    s.saveDraft();
    s.stepEntry(d);
  };

  return (
    <div class="clue-composer" data-pinned-editor {...keep}>
      {matches.length > 0 && (
        <div class="inline-warning compact" role="status">
          Close to {matches.length === 1 ? 'a past clue' : `${matches.length} past clues`}: “{data.history[matches[0].index][0]}” (
          {weekdayName(data.history[matches[0].index][2])} {yearOf(data.history[matches[0].index][1])})
        </div>
      )}
      <textarea
        id="clue-compose"
        ref={field}
        class="field compose-field"
        rows={2}
        enterkeyhint="next"
        autoCapitalize="sentences"
        disabled={!slot}
        aria-label={slot ? `Clue for ${slotLabel(slot)}` : 'Clue'}
        placeholder={slot ? `Clue for ${slotLabel(slot)}` : 'Select an entry'}
        value={text}
        onInput={(e) => slot && s.setDraft(slot.id, (e.target as HTMLTextAreaElement).value.replace(/\n/g, ' '))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === 'Escape') {
            s.saveDraft();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
      <div class="compose-actions">
        <button class="btn compose-btn" aria-label="Previous clue" onClick={() => step(-1)}>
          <IconChevronLeft size={18} />
          <span>Prev</span>
        </button>
        <button class={`btn compose-btn${history ? ' on' : ''}`} aria-pressed={history} disabled={!answer} onClick={onHistory}>
          History{data.history.length ? ` ${data.history.length}` : ''}
        </button>
        <button
          class="btn compose-btn"
          data-release
          onClick={() => {
            s.saveDraft();
            field.current?.blur();
          }}
        >
          Done
        </button>
        <button class="btn primary compose-btn" aria-label="Next clue" onClick={() => step(1)}>
          <span>Next</span>
          <IconChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}

/** NYT clue history for the current answer; shown in place of the list, keyboard stays open. */
function HistoryPanel({ s, slot, onClose, keep }: { s: EditorSession; slot: Slot | null; onClose: () => void; keep: Keep }) {
  const answer = answerOf(s, slot);
  const data = useAnswerData(answer);
  const text = slot ? s.clueText(slot.id) : '';
  const matches = useMemo(() => nearDuplicates(text, data.history), [text, data.history]);
  const near = useMemo(() => new Set(matches.map((m) => m.index)), [matches]);
  return (
    <div class="history-sheet" role="dialog" aria-label="Clue history" {...keep}>
      <div class="sheet-head">
        <h2>
          History <span class="mono">{answer ?? ''}</span>
        </h2>
        <button class="icon-btn" aria-label="Close history" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div class="sheet-body">
        {answer && <AnswerFacts facts={data.facts} history={data.history} />}
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
        {!answer ? (
          <p class="muted">Fill every square to see its clue history.</p>
        ) : data.loaded ? (
          <ClueHistory history={data.history} highlight={near} day={s.puzzle.value.day} />
        ) : (
          <p class="muted">Loading…</p>
        )}
      </div>
    </div>
  );
}
