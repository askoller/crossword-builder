// Notebook theme cards for choosing a theme (New puzzle), plus the symmetry pill the
// Notebook, the Theme panel and the picker share (SPEC §3.1, §3.7).
import { letters, symmetryCheck, themeAnswers, type NotebookTheme, type SymmetryCheck } from '../model/notebook';

export function SymmetryPill({ check }: { check: SymmetryCheck }) {
  return <span class={`sym-pill ${check.ok ? 'ok' : 'bad'}`}>{check.label}</span>;
}

/** Pick one Notebook theme (or none). The symmetry pill and fit warning use the chosen grid width. */
export function ThemePicker({
  themes,
  value,
  onChange,
  width,
}: {
  themes: NotebookTheme[];
  value: string;
  onChange: (id: string) => void;
  width: number;
}) {
  return (
    <div class="theme-picker" role="radiogroup" aria-label="Notebook theme">
      <button role="radio" aria-checked={!value} class={`card theme-option none${value ? '' : ' on'}`} onClick={() => onChange('')}>
        <span class="strong">No theme</span>
        <span class="muted small">Start from an empty grid</span>
      </button>
      {themes.map((t) => {
        const answers = themeAnswers(t);
        const tooLong = answers.filter((a) => letters(a).length > width);
        const on = t.id === value;
        return (
          <button key={t.id} role="radio" aria-checked={on} class={`card theme-option${on ? ' on' : ''}`} onClick={() => onChange(t.id)}>
            <span class="nb-card-top">
              <span class="strong">{t.title || 'Untitled theme'}</span>
              <SymmetryPill check={symmetryCheck(answers, width)} />
            </span>
            <span class="theme-option-entries">
              {answers.map((a, i) => (
                <span key={i} class="theme-chip">
                  <span class="mono">{a}</span>
                  <span class="muted small">
                    {letters(a).length}
                    {t.revealer && i === answers.length - 1 && letters(t.revealer.answer) ? ' · revealer' : ''}
                  </span>
                </span>
              ))}
              {!answers.length && <span class="muted small">No entries yet</span>}
            </span>
            {tooLong.length > 0 && (
              <span class="warn-text small">
                {tooLong.join(', ')} {tooLong.length === 1 ? "doesn't" : "don't"} fit a {width}-wide grid
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
