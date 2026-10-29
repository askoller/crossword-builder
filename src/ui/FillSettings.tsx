// Settings → Fill (SPEC §3.9): per-length floors, dupe-rule affix exceptions, never-use list.
import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_AFFIXES, defaultFloors, type FillSettings } from '../engine/settings';
import { fillSettings, loadFillSettings, saveFillSettings } from '../state/fill';

const LENGTHS = Array.from({ length: 13 }, (_, i) => i + 3); // 3–15; 15 also covers 16–21

const words = (text: string): string[] =>
  [...new Set(text.toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3))].sort();

export function FillSettingsSection({ neverUseInPack }: { neverUseInPack?: number }) {
  useEffect(() => void loadFillSettings(), []);
  const cur = fillSettings.value;
  const [affixes, setAffixes] = useState(cur.affixes.join(', '));
  const [bans, setBans] = useState(cur.neverUse.join('\n'));
  useEffect(() => {
    setAffixes(cur.affixes.join(', '));
    setBans(cur.neverUse.join('\n'));
  }, [cur]);

  const save = (patch: Partial<FillSettings>) => void saveFillSettings({ ...fillSettings.value, ...patch });
  const setFloor = (len: number, v: number) => {
    const floors = fillSettings.value.floors.slice();
    const value = Math.max(0, Math.min(60, Math.round(v)));
    if (len === 15) for (let l = 15; l < floors.length; l++) floors[l] = value;
    else floors[len] = value;
    save({ floors });
  };

  return (
    <section class="card section">
      <h2>Fill</h2>
      <label class="label">Lowest score allowed, by length</label>
      <div class="floor-grid">
        {LENGTHS.map((len) => (
          <label key={len} class="floor-cell">
            <span class="small muted">{len === 15 ? '15+' : len}</span>
            <input
              class="field num"
              type="number"
              inputMode="numeric"
              min={0}
              max={60}
              value={cur.floors[len]}
              aria-label={`Floor for ${len === 15 ? '15 or more' : len} letters`}
              onChange={(e) => setFloor(len, Number((e.target as HTMLInputElement).value))}
            />
          </label>
        ))}
      </div>
      <label class="label">Dupe-rule affix exceptions</label>
      <input
        class="field"
        value={affixes}
        aria-label="Affix exceptions"
        onInput={(e) => setAffixes((e.target as HTMLInputElement).value)}
        onBlur={() => save({ affixes: [...new Set(affixes.toUpperCase().split(/[^A-Z]+/).filter(Boolean))] })}
      />
      <label class="label">Never use (on top of the score-1 words in the data pack)</label>
      <textarea
        class="field area"
        rows={4}
        value={bans}
        placeholder="One word per line"
        aria-label="Never-use words"
        onInput={(e) => setBans((e.target as HTMLTextAreaElement).value)}
        onBlur={() => save({ neverUse: words(bans) })}
      />
      <p class="muted small">
        {neverUseInPack !== undefined && `${neverUseInPack.toLocaleString('en-US')} words in the data pack are rated 1 (never use). `}
        {cur.neverUse.length} added here.
      </p>
      <div class="button-col">
        <button class="btn" onClick={() => save({ floors: defaultFloors(), affixes: [...DEFAULT_AFFIXES] })}>
          Reset floors and affixes
        </button>
      </div>
    </section>
  );
}
