// Check (SPEC §4.6): dupes, viability, grid stats, entry quality.
import type { Issue } from '../engine/check';
import type { EditorSession } from '../state/editor';
import { IconClose } from './icons';

const LEVEL_LABEL: Record<Issue['level'], string> = { error: 'Fix', warning: 'Look at', info: 'Note' };

export function CheckPanel({ s, onClose }: { s: EditorSession; onClose: () => void }) {
  const f = s.fill;
  const r = f.report.value;
  return (
    <div class="check-panel" aria-label="Check">
      <div class="fill-head">
        <h2>
          Check
          {f.reportStale.value ? ' · checking…' : r ? ` · ${r.count ? `${r.count} issue${r.count === 1 ? '' : 's'}` : 'all clear'}` : ''}
        </h2>
        <button class="icon-btn" aria-label="Close" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div class={`check-body${f.reportStale.value ? ' stale' : ''}`}>
        {!r ? (
          <p class="placeholder">{f.noData.value ? 'Import the data pack in Settings to check entries.' : 'Checking…'}</p>
        ) : (
          <>
            <dl class="stats">
              <div>
                <dt>Words</dt>
                <dd>{r.stats.words}</dd>
              </div>
              <div>
                <dt>Blocks</dt>
                <dd>{r.stats.blocks}</dd>
              </div>
              <div>
                <dt>Filled</dt>
                <dd>
                  {r.stats.filledSquares}/{r.stats.openSquares}
                </dd>
              </div>
              <div>
                <dt>Longest</dt>
                <dd>{r.stats.longest}</dd>
              </div>
              <div>
                <dt>Shortest</dt>
                <dd>{r.stats.shortest}</dd>
              </div>
              <div>
                <dt>Unchecked</dt>
                <dd>{r.stats.unchecked}</dd>
              </div>
              <div>
                <dt>Symmetry</dt>
                <dd class={r.stats.symmetric ? 'ok' : 'bad'}>{r.stats.symmetric ? 'yes' : 'no'}</dd>
              </div>
              <div>
                <dt>Connected</dt>
                <dd class={r.stats.connected ? 'ok' : 'bad'}>{r.stats.connected ? 'yes' : 'no'}</dd>
              </div>
            </dl>
            {r.issues.length === 0 && <p class="placeholder">No dupes, every open slot has room, and every entry is in your list.</p>}
            <ul class="issues">
              {r.issues.map((x, i) => (
                <li key={i}>
                  <button class={`issue ${x.level}`} disabled={!x.slots.length} onClick={() => x.slots[0] && f.goToSlot(x.slots[0])}>
                    <span class={`issue-level ${x.level}`}>{LEVEL_LABEL[x.level]}</span>
                    <span class="issue-text">{x.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
