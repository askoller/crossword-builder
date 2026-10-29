// Builds fixtures/ with synthetic data in the docs/DATA-PACK.md format.
// Source words: the MIT-licensed npm package an-array-of-english-words.
// Scores, NYT counts/years and clues are fake and deterministic (hash-based).
// Usage: node scripts/make-fixtures.mjs
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const allWords = require('an-array-of-english-words');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'fixtures');
mkdirSync(join(out, 'grids'), { recursive: true });

// FNV-1a 32-bit, then a murmur-style finalizer for better bit spread.
function hash(s, seed = 0) {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

const words = [...new Set(allWords.filter((w) => /^[a-z]{3,15}$/.test(w)).map((w) => w.toUpperCase()))].sort();

function scoreOf(w) {
  if (hash(w, 7) % 1000 < 2) return 1; // about 0.2% never-use
  return 20 + (hash(w, 1) % 36); // 20..55
}
function nytOf(w) {
  const h = hash(w, 2);
  if (h % 100 < 45) return { nyt: 0, last: '' }; // debut
  const nyt = 1 + (hash(w, 3) % (w.length <= 5 ? 120 : 25));
  const last = 1995 + (hash(w, 4) % 31); // 1995..2025
  return { nyt, last: String(last) };
}

// A handful of common words that must exist with a usable score (handy in tests).
const pinned = new Map([
  ['BAGEL', 50], ['AREA', 44], ['ERA', 42], ['ERE', 38], ['ERENOW', 30], ['TEA', 45],
  ['TEAPARTY', 52], ['AND', 40], ['STANDUP', 48], ['SPOUSE', 46], ['SPOUSES', 44],
  ['PARTS', 45], ['APART', 45], ['NATION', 47], ['RATION', 46],
]);

let neverUse = 0;
const rows = ['word\tscore\tnyt\tlast'];
const info = new Map();
for (const w of words) {
  const score = pinned.get(w) ?? scoreOf(w);
  if (score === 1) neverUse++;
  const { nyt, last } = nytOf(w);
  info.set(w, { score, nyt, last });
  rows.push(`${w}\t${score}\t${nyt}\t${last}`);
}
const wordsGz = gzipSync(Buffer.from(rows.join('\n') + '\n'), { level: 9 });

// Fake clue history for ~200 common words. Clue text is synthetic: an "angle" label plus
// a variant number, so clustering and near-duplicate checks have something to work on.
const common = `ACE ACT ADD AGE AGO AID AIM AIR ALE ALL AND ANT APE ARC ARE ARK ARM ART ASH
ASK ATE AWE AXE BAG BAN BAR BAT BED BEE BET BIG BIN BIT BOW BOX BOY BUD BUG BUS BUY CAB
CAN CAP CAR CAT COW CRY CUP CUT DAM DAY DEN DEW DIG DIM DOE DOG DOT DRY DUE EAR EAT EEL
EGG ELM END ERA ERE EVE EYE FAN FAR FED FEW FIG FIN FIT FLY FOG FOR FOX FUN FUR GAP GAS
GEM GET GUM GUT HAM HAT HEN HIP HIT HOG HOP HOT HUB HUE HUG ICE ICY INK INN ION IRE ITS
IVY JAM JAR JAW JET JOB JOG JOY KEG KEY KID KIN KIT LAB LAD LAP LAW LAY LED LEG LET LID
LIE LIP LOG LOT LOW MAP MAT MOP MUD NAP NET NEW NOD NOR NOT NOW NUT OAK OAR OAT ODD ODE
OIL OLD ONE OPT ORE OWL OWN PAN PEA PEN PET PIE PIG PIN PIT POD POT RAM RAT RAW RED RIB
RID RIM ROD ROW RUG RUN SAD SAP SEA SET SEW SKI SKY SPA SUN TAB TAN TAP TAR TEA TEN TIE
TIN TIP TOE TON TOP TOY TUB TUG URN USE VAN VAT WAX WEB WET WIG WIN YAK YAM YEN YES YET
ZOO AREA ARIA BAGEL IDEA OREO ALOE EDGE NATION APART PARTS SPOUSE STANDUP TEAPARTY`
  .split(/\s+/)
  .filter((w) => info.has(w));
const angles = ['Kitchen', 'Garden', 'Travel', 'Music', 'Science', 'History', 'Sports', 'Weather'];
const clues = {};
let clueCount = 0;
let minDate = 99999999;
let maxDate = 0;
for (const w of common) {
  const n = 2 + (hash(w, 5) % 14);
  const a1 = angles[hash(w, 6) % angles.length];
  const a2 = angles[hash(w, 8) % angles.length];
  const list = [];
  for (let i = 0; i < n; i++) {
    const h = hash(w, 100 + i);
    const year = 1995 + (h % 31);
    const month = 1 + ((h >>> 8) % 12);
    const day = 1 + ((h >>> 16) % 28);
    const ymd = year * 10000 + month * 100 + day;
    const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7; // 0 = Monday
    const angle = i % 3 === 2 ? a2 : a1;
    list.push([`${angle} fixture clue ${i + 1} (${w.length} letters)`, ymd, weekday]);
    minDate = Math.min(minDate, ymd);
    maxDate = Math.max(maxDate, ymd);
  }
  list.sort((x, y) => y[1] - x[1]);
  clues[w] = list;
  clueCount += list.length;
}
const cluesGz = gzipSync(Buffer.from(JSON.stringify(clues)), { level: 9 });

const myScores = {
  scores: {
    BAGEL: { rating: 50, ts: 1700000000000, note: 'fixture rating' },
    TEAPARTY: { rating: 52, ts: 1700000000000, note: '' },
    ERENOW: { rating: 30, ts: 1700000000000, note: '' },
  },
};
const notebook = {
  clues: [
    { answer: 'BAGEL', clues: ['Fixture idea: ring-shaped roll'], boost: 40, note: '', updated: 1700000000000 },
    { answer: 'TEA PARTY', clues: ['Fixture idea: event with cups'], boost: 70, note: 'synthetic', updated: 1700000000000 },
  ],
  themes: [
    {
      id: 'fixture-theme-1',
      title: 'Fixture theme',
      description: 'Synthetic theme for tests',
      revealer: { answer: 'TEAPARTY', clues: ['Fixture revealer clue'] },
      entries: [
        { answer: 'SPOUSE', clues: ['Fixture entry clue'] },
        { answer: 'NATION', clues: [] },
      ],
      updated: 1700000000000,
    },
  ],
  deleted: [],
  synced: 0,
};

const files = {
  'words.tsv.gz': wordsGz,
  'clues.json.gz': cluesGz,
  'my-scores.json': Buffer.from(JSON.stringify(myScores, null, 2) + '\n'),
  'notebook.json': Buffer.from(JSON.stringify(notebook, null, 2) + '\n'),
};
for (const [name, buf] of Object.entries(files)) writeFileSync(join(out, name), buf);

const manifest = {
  format: 1,
  built: '2026-01-01T00:00:00+00:00',
  fixture: true,
  words: words.length,
  neverUse,
  handRatings: Object.keys(myScores.scores).length,
  themeFillBans: 0,
  clueAnswers: common.length,
  clues: clueCount,
  clueRange: [minDate, maxDate],
  files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.length])),
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Small test grids in the puzzle file format (SPEC 5.2). '#' = block, '.' = empty.
function grid(id, title, rows, extra = {}) {
  const height = rows.length;
  const width = rows[0].length;
  const cells = [];
  for (const row of rows) {
    for (const ch of row) {
      cells.push({
        b: ch === '#' ? 1 : 0,
        l: /[A-Z]/.test(ch) ? ch : '',
        rebus: null,
        circle: 0,
        lock: 0,
        src: /[A-Z]/.test(ch) ? 'typed' : null,
      });
    }
  }
  for (const i of extra.locked ?? []) {
    cells[i].lock = 1;
    cells[i].src = 'theme';
  }
  for (const i of extra.circles ?? []) cells[i].circle = 1;
  return {
    format: 1,
    id,
    title,
    width,
    height,
    day: extra.day ?? 'Tue',
    outlet: extra.outlet ?? 'NYT',
    status: extra.status ?? 'Filling',
    symmetry: 'rotational',
    cells,
    clues: {},
    themeId: null,
    created: '2026-01-01T00:00:00.000Z',
    updated: extra.updated ?? '2026-01-01T00:00:00.000Z',
  };
}

const mini = grid('fixture-mini-5x5', 'Fixture mini', ['#....', '.....', '.....', '.....', '....#'], {
  day: 'Mon',
  status: 'Theme draft',
});
const fifteenRows = [
  '....#.....#....',
  '....#.....#....',
  '...............',
  '...#....#......',
  '###...#.....###',
  '.......#.......',
  '....#....#.....',
  '...#.......#...',
  '.....#....#....',
  '.......#.......',
  '###.....#...###',
  '......#....#...',
  '...............',
  '....#.....#....',
  '....#.....#....',
];
// Theme entries across the middle rows, locked.
const theme = fifteenRows.map((r) => r.split(''));
const put = (r, c, word) => [...word].forEach((ch, k) => (theme[r][c + k] = ch));
put(2, 0, 'TEAPARTYGUESTSX'.slice(0, 15));
put(12, 0, 'SPOUSESANDPARTS');
const locked = [];
for (let c = 0; c < 15; c++) locked.push(2 * 15 + c, 12 * 15 + c);
const themed = grid('fixture-themed-15x15', 'Fixture themed 15', theme.map((r) => r.join('')), {
  day: 'Thu',
  status: 'Themers set',
  locked,
  circles: [7 * 15 + 7],
  updated: '2026-01-02T00:00:00.000Z',
});
const open = grid('fixture-open-15x15', 'Fixture open 15', fifteenRows, { day: 'Sat', updated: '2026-01-03T00:00:00.000Z' });

for (const g of [mini, themed, open]) {
  writeFileSync(join(out, 'grids', `${g.id}.json`), JSON.stringify(g) + '\n');
}

console.log(`fixtures: ${words.length} words (${neverUse} never-use), ${common.length} clue answers, ${clueCount} clues`);
