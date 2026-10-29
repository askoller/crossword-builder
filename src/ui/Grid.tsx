import { useEffect, useRef, useState } from 'preact/hooks';
import { cellText } from '../model/types';
import type { EditorSession } from '../state/editor';

const U = 100; // SVG units per cell
const LONG_PRESS_MS = 450;

export function Grid({ s }: { s: EditorSession }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(0);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; fired: boolean } | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const p = s.puzzle.peek();
      const scale = Math.min(el.clientWidth / p.width, el.clientHeight / p.height);
      setSize(Math.max(0, Math.floor(scale)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [s]);

  const p = s.puzzle.value;
  const idx = s.slots.value;
  const cur = s.cursor.value;
  const word = new Set(s.currentSlot.value?.cells ?? []);
  const rebus = s.rebusMode.value;
  const W = p.width * U;
  const H = p.height * U;

  const cellFrom = (e: PointerEvent): number | null => {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const c = Math.floor(((e.clientX - r.left) / r.width) * p.width);
    const row = Math.floor(((e.clientY - r.top) / r.height) * p.height);
    if (c < 0 || row < 0 || c >= p.width || row >= p.height) return null;
    return row * p.width + c;
  };

  const onDown = (e: PointerEvent) => {
    const cell = cellFrom(e);
    if (cell === null) return;
    e.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const state = {
      fired: false,
      timer: setTimeout(() => {
        state.fired = true;
        // Long-press: enter select mode with that cell (select mode lands with the engine).
        s.cursor.value = { cell, dir: s.cursor.value.dir };
        s.panel.value = 'select';
      }, LONG_PRESS_MS),
    };
    press.current = state;
  };
  const onUp = (e: PointerEvent) => {
    const st = press.current;
    press.current = null;
    if (!st) return;
    clearTimeout(st.timer);
    if (st.fired) return;
    const cell = cellFrom(e);
    if (cell !== null) s.tapCell(cell);
  };
  const onCancel = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  const rects = [];
  const texts = [];
  for (let i = 0; i < p.cells.length; i++) {
    const c = p.cells[i];
    const x = (i % p.width) * U;
    const y = Math.floor(i / p.width) * U;
    let fill = '#FFFFFF';
    if (c.b) fill = i === cur.cell ? '#3A3F4B' : 'var(--ink)';
    else if (i === cur.cell) fill = 'var(--active)';
    else if (word.has(i)) fill = 'var(--word)';
    else if (c.lock) fill = 'var(--locked)';
    rects.push(<rect key={`r${i}`} x={x} y={y} width={U} height={U} fill={fill} />);
    if (c.b) continue;
    if (c.circle) {
      texts.push(<circle key={`o${i}`} cx={x + U / 2} cy={y + U / 2} r={U / 2 - 3} class="cell-circle" />);
    }
    const n = idx.numbers[i];
    if (n) {
      texts.push(
        <text key={`n${i}`} x={x + 5} y={y + 27} class="cell-num">
          {n}
        </text>,
      );
    }
    const t = cellText(c);
    if (t) {
      const fs = t.length > 1 ? Math.min(56, 150 / t.length) : 64;
      const color = c.lock || c.src === 'theme' || c.src === 'autofill' ? 'var(--ink)' : 'var(--primary)';
      texts.push(
        <text key={`l${i}`} x={x + U / 2} y={y + 62 + fs * 0.36} class="cell-letter" font-size={fs} fill={color}>
          {t}
        </text>,
      );
    }
  }
  const lines = [];
  for (let k = 1; k < p.width; k++) lines.push(`M${k * U} 0V${H}`);
  for (let k = 1; k < p.height; k++) lines.push(`M0 ${k * U}H${W}`);
  const cx = (cur.cell % p.width) * U;
  const cy = Math.floor(cur.cell / p.width) * U;

  return (
    <div class="grid-wrap" ref={wrap}>
      <svg
        class="grid"
        role="grid"
        aria-label={`${p.width} by ${p.height} grid`}
        viewBox={`0 0 ${W} ${H}`}
        width={size * p.width}
        height={size * p.height}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={onCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {rects}
        <path d={lines.join('')} class="grid-lines" />
        {texts}
        {rebus && <rect x={cx + 4} y={cy + 4} width={U - 8} height={U - 8} class="rebus-ring" />}
        <rect x={0} y={0} width={W} height={H} class="grid-border" />
      </svg>
    </div>
  );
}

/** Small thumbnail for puzzle cards: blocks, theme cells tinted. */
export function Thumb({ cells, width, height, size = 64 }: { cells: { b: number; lock: number }[]; width: number; height: number; size?: number }) {
  const parts = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c.b && !c.lock) continue;
    parts.push(
      <rect key={i} x={i % width} y={Math.floor(i / width)} width={1} height={1} fill={c.b ? 'var(--ink)' : 'var(--primary-soft)'} />,
    );
  }
  return (
    <svg class="thumb" viewBox={`0 0 ${width} ${height}`} width={size} height={(size * height) / width} aria-hidden="true">
      <rect width={width} height={height} fill="#fff" />
      {parts}
      <rect width={width} height={height} fill="none" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
    </svg>
  );
}
