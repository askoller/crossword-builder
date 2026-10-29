# Data pack (format 1)

Personal data lives outside this repository. Andrew's laptop builds the data pack with
`scripts/build_datapack.py` and puts it in Google Drive at `Crossword Builder/data/`. The
app imports it at runtime (Settings → Data). Tests use `fixtures/`, which follow the
same format with synthetic content.

## Files

### `manifest.json`
```json
{
  "format": 1,
  "built": "2026-10-29T15:58:59+00:00",
  "words": 195618, "neverUse": 319, "handRatings": 81, "themeFillBans": 11,
  "clueAnswers": 121626, "clues": 893192, "clueRange": [19950101, 20251231],
  "files": {"words.tsv.gz": 1071017, "clues.json.gz": 11887421,
            "my-scores.json": 4534, "notebook.json": 1089}
}
```
(Numbers shown are the sizes of the real pack, for planning only.)

### `words.tsv.gz`
gzip text, tab-separated, header row `word	score	nyt	last`.
- `word`: A–Z, upper case, no spaces, length ≥ 3.
- `score`: integer 1–60. **1 means never use.** Typical scale: 20–30 weak, 35–40 OK,
  40–45 clean everyday fill, 45–50 strong, 55–60 lively debut-worthy phrases.
- `nyt`: number of NYT appearances in the clue history (0 = debut).
- `last`: last NYT year, or empty.
Hand ratings are already applied to `score`.

### `clues.json.gz`
gzip JSON object: `{"ANSWER": [[clue, yyyymmdd, weekday], ...], ...}`, newest first.
`weekday` 0 = Monday … 6 = Sunday. Answers containing rebus digits are excluded.
About 12 MB compressed, 36 MB raw, ~122k answers.

### `my-scores.json`
`{"scores": {"WORD": {"rating": 40, "ts": 1792007488591, "note": ""}}}`: ratings
Andrew set by hand (already folded into `words.tsv.gz`; kept for reference and so the
app can show "rated by you").

### `notebook.json`
The Notebook at build time, same shape as `docs/SPEC.md` §5.4. Used once to seed the
shared Drive `notebook.json` if that file doesn't exist yet.
