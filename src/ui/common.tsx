import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { IconClose } from './icons';

export function Dialog({
  title,
  onClose,
  children,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  actions?: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div class="dialog-head">
          <h2>{title}</h2>
          <button class="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div class="dialog-body">{children}</div>
        {actions && <div class="dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Bottom sheet over the editor (cover screen) — the grid stays visible above it. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  return (
    <div class="sheet" role="dialog" aria-label={title}>
      <div class="sheet-head">
        <h2>{title}</h2>
        <button class="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div class="sheet-body">{children}</div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  hint?: string;
}

export function Menu({ items, onClose, anchor = 'top-right' }: { items: MenuItem[]; onClose: () => void; anchor?: 'top-right' | 'bottom' }) {
  return (
    <div class="menu-overlay" onClick={onClose}>
      <div class={`menu menu-${anchor}`} role="menu" onClick={(e) => e.stopPropagation()}>
        {items.map((it) => (
          <button
            key={it.label}
            role="menuitem"
            class={`menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span class="menu-hint">{it.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly T[] | { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  const opts = (options as (T | { value: T; label: string })[]).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  return (
    <div class="chips" role="radiogroup" aria-label={label}>
      {opts.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          class={`chip${o.value === value ? ' on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function relativeTime(iso: string | number, now = Date.now()): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} d ago`;
  const date = new Date(t);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

/** Score badge: solid primary ≥ 45, soft 40–44, grey below (SPEC §3.4). */
export function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 45 ? 'hi' : score >= 40 ? 'mid' : 'lo';
  return (
    <span class={`score-badge ${cls}`} aria-label={`Score ${score}`}>
      {score}
    </span>
  );
}
