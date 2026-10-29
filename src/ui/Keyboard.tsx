// The app's own keyboard; the system keyboard is never used for grid entry.
import type { EditorSession } from '../state/editor';
import { IconDelete, IconSwitch } from './icons';

const ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

/** Act on pointerdown for speed; keep focus and avoid double-tap zoom. */
function press(fn: () => void) {
  return (e: PointerEvent) => {
    e.preventDefault();
    fn();
  };
}

export function Keyboard({ s }: { s: EditorSession }) {
  return (
    <div class="keyboard" aria-label="Keyboard">
      {ROWS.map((row, r) => (
        <div class="kb-row" key={row}>
          {r === 2 && (
            <button class="key key-wide" aria-label="Switch direction" onPointerDown={press(() => s.switchDirection())}>
              <IconSwitch />
            </button>
          )}
          {[...row].map((ch) => (
            <button class="key" key={ch} aria-label={ch} onPointerDown={press(() => s.typeLetter(ch))}>
              <span>{ch}</span>
            </button>
          ))}
          {r === 2 && (
            <button class="key key-wide" aria-label="Delete" onPointerDown={press(() => s.backspace())}>
              <IconDelete />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
