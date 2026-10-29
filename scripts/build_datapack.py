"""Build the Crossword Builder data pack from Andrew's local files.

Outputs (all in OUT):
  words.tsv.gz      WORD<TAB>score<TAB>nytCount<TAB>lastNytYear  (score 1 = never use)
  clues.json.gz     {"ANSWER": [[clue, yyyymmdd, weekday0Mon], ...]} newest first
  my-scores.json    hand ratings from ThemeFill (word -> {rating, ts})
  notebook.json     Crossword Notebook (same shape ThemeFill uses)
  manifest.json     version, build time, row counts, file sizes
"""
import gzip, json, re, sqlite3, sys, time, os, datetime

wordlist, scores, notebook, banned, cluedb, OUT = sys.argv[1:7]
os.makedirs(OUT, exist_ok=True)
clean = lambda s: re.sub('[^A-Z]', '', s.upper())

# Word list (Andrew's rescored list: word;score, score 1 = never use)
words = {}
with open(wordlist, encoding='utf-8', errors='replace') as f:
    for line in f:
        line = line.strip()
        if ';' not in line:
            continue
        w, s = line.rsplit(';', 1)
        w = clean(w)
        if len(w) < 3 or not s.strip().isdigit():
            continue
        words[w] = max(words.get(w, 0), int(s))

# Hand ratings override list scores
my = json.load(open(scores, encoding='utf-8')).get('scores', {})
overrides = 0
for w, v in my.items():
    cw = clean(w)
    if cw and isinstance(v, dict) and 'rating' in v:
        words[cw] = int(v['rating']); overrides += 1

# ThemeFill's own exclusions become never-use (score 1)
bans = 0
for line in open(banned, encoding='utf-8', errors='replace'):
    line = line.strip()
    if line and not line.startswith('#'):
        cw = clean(line)
        if cw:
            words[cw] = 1; bans += 1

# NYT clue history
db = sqlite3.connect('file:' + cluedb + '?mode=ro&immutable=1', uri=True)
clues, count, last = {}, {}, {}
days = {'Monday': 0, 'Tuesday': 1, 'Wednesday': 2, 'Thursday': 3, 'Friday': 4, 'Saturday': 5, 'Sunday': 6}
n_clues = 0
for eq, clue, date, wd in db.execute('select EQUIV, Clue, Date, Weekday from tblClues order by Date desc, id desc'):
    a = clean(eq or '')
    if not a or not clue or not re.fullmatch(r'[A-Za-z]+', eq or ''):
        continue
    ymd = int(date.replace('-', '')) if date else 0
    clues.setdefault(a, []).append([clue.strip(), ymd, days.get(wd, -1)])
    count[a] = count.get(a, 0) + 1
    if ymd and ymd // 10000 > last.get(a, 0):
        last[a] = ymd // 10000
    n_clues += 1

with gzip.open(os.path.join(OUT, 'words.tsv.gz'), 'wt', encoding='utf-8', compresslevel=9) as f:
    f.write('word\tscore\tnyt\tlast\n')
    for w in sorted(words):
        f.write('%s\t%d\t%d\t%s\n' % (w, words[w], count.get(w, 0), last.get(w, '')))
with gzip.open(os.path.join(OUT, 'clues.json.gz'), 'wt', encoding='utf-8', compresslevel=9) as f:
    json.dump(clues, f, ensure_ascii=False, separators=(',', ':'))
json.dump(my, open(os.path.join(OUT, 'my-scores.json'), 'w', encoding='utf-8'), indent=1)
nb = json.load(open(notebook, encoding='utf-8'))
nb['clues'] = nb.get('clues') or []
nb['themes'] = nb.get('themes') or []
json.dump(nb, open(os.path.join(OUT, 'notebook.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

files = {}
for fn in ['words.tsv.gz', 'clues.json.gz', 'my-scores.json', 'notebook.json']:
    files[fn] = os.path.getsize(os.path.join(OUT, fn))
manifest = {
    'format': 1,
    'built': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
    'words': len(words), 'neverUse': sum(1 for s in words.values() if s == 1),
    'handRatings': overrides, 'themeFillBans': bans,
    'clueAnswers': len(clues), 'clues': n_clues,
    'clueRange': [min(v[-1][1] for v in clues.values()), max(v[0][1] for v in clues.values())],
    'files': files,
}
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
print(json.dumps(manifest, indent=1))
