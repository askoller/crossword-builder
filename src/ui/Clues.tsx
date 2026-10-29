// Clues tab (bottom nav): look up any answer's NYT clue history.
import { useEffect, useState } from 'preact/hooks';
import { suggestAnswers } from '../data/clues';
import { letterBreakdown } from '../model/notebook';
import { dataVersion } from '../state/app';
import { AnswerFacts, ClueHistory, useAnswerData } from './Clue';
import { IconClose, IconSearch } from './icons';

export function CluesScreen() {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const data = useAnswerData(answer);
  const q = query.toUpperCase().replace(/[^A-Z]/g, '');

  useEffect(() => {
    let alive = true;
    void suggestAnswers(q, 30).then((s) => alive && setSuggestions(s));
    return () => {
      alive = false;
    };
  }, [q, dataVersion.value]);

  const look = (a: string) => {
    setAnswer(a);
    setQuery(a);
  };

  return (
    <div class="screen clues-screen">
      <header class="topbar">
        <h1>Clues</h1>
      </header>
      <div class="scroll">
        <form
          class="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.length >= 3) look(q);
          }}
        >
          <IconSearch />
          <input
            class="field mono"
            placeholder="Look up an answer"
            aria-label="Answer"
            autoCapitalize="characters"
            autoComplete="off"
            spellcheck={false}
            value={query}
            onInput={(e) => {
              setQuery((e.target as HTMLInputElement).value);
              setAnswer(null);
            }}
          />
          {query && (
            <button
              type="button"
              class="icon-btn"
              aria-label="Clear"
              onClick={() => {
                setQuery('');
                setAnswer(null);
              }}
            >
              <IconClose />
            </button>
          )}
        </form>

        {!answer && q && (
          <div class="card list-card">
            {q.length >= 3 && !suggestions.includes(q) && (
              <button class="list-row" onClick={() => look(q)}>
                <span class="mono strong">{q}</span>
                <span class="muted small">Look up</span>
              </button>
            )}
            {suggestions.map((a) => (
              <button key={a} class="list-row" onClick={() => look(a)}>
                <span class="mono strong">{a}</span>
                <span class="muted small">{a.length} letters</span>
              </button>
            ))}
            {!suggestions.length && q.length < 3 && <p class="muted pad">Type at least 3 letters.</p>}
          </div>
        )}

        {!q && (
          <div class="empty">
            <p class="muted">Type an answer to see every NYT clue for it, newest first, split by angle.</p>
          </div>
        )}

        {answer && (
          <section class="card section">
            <div class="answer-head">
              <span class="mono answer big">{answer}</span>
              <AnswerFacts facts={data.facts} history={data.history} />
            </div>
            <p class="muted small">{letterBreakdown(answer)}</p>
            {data.notebook && (
              <div class="nb-ideas">
                <div class="label">Notebook · boost {data.notebook.boost}</div>
                {data.notebook.clues.length ? (
                  <ul class="plain-list">
                    {data.notebook.clues.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p class="muted small">No clue ideas yet.</p>
                )}
              </div>
            )}
            {data.loaded ? <ClueHistory history={data.history} /> : <p class="muted">Loading…</p>}
          </section>
        )}
      </div>
    </div>
  );
}
