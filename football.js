// Football trivia games, built on data/football.json (Wikidata, CC0). Server-only: answers never leave this module;
// the browser gets view(puzzle, state). Each game: gen(r) -> puzzle, init() -> state,
// move(puzzle, state, action, elapsedSecs) -> { state, reply }, view(puzzle, state, elapsedSecs), share(puzzle, state).
import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('./data/football.json', import.meta.url)));
const CLUBS = DATA.clubs, LEAGUES = DATA.leagues, PLAYERS = DATA.players;
const BY_ID = new Map(PLAYERS.map(p => [p.id, p]));
for (const p of PLAYERS) {
  p.clubIds = new Set(p.clubs.map(c => c[0]));
  p.maxClub = Math.max(...p.clubs.map(c => CLUBS[c[0]].sl));
}
// Wikidata has no league for some big clubs (Juventus, Bayern, Roma...): use their country's top league.
const topLeague = {};
for (const c of Object.values(CLUBS)) if (c.league && c.sl >= 60) (topLeague[c.country] ??= {})[c.league] = (topLeague[c.country][c.league] || 0) + c.sl;
for (const c of Object.values(CLUBS))
  if (!c.league && c.sl >= 60 && topLeague[c.country]) c.league = Object.entries(topLeague[c.country]).sort((a, b) => b[1] - a[1])[0][0];

// Sitelinks alone overrate players with bot-made stubs, so "known" also needs a stint at a well-known club.
const TIER_A = PLAYERS.filter(p => p.sl >= 50 && p.maxClub >= 100 && p.born >= 1970); // hidden answers
const TIER_B = PLAYERS.filter(p => p.sl >= 40 && p.maxClub >= 60 && p.born >= 1970); // grid / links / bingo picks
const IN_B = new Set(TIER_B.map(p => p.id));
const BIG_CLUBS = Object.keys(CLUBS).filter(c => CLUBS[c].sl >= 80);
const natCount = TIER_B.reduce((m, p) => m.set(p.nat, (m.get(p.nat) || 0) + 1), new Map());
const NATS = [...natCount].filter(([c, k]) => c && k >= 15).map(([c]) => c);

export const BANDS = {
  grid: { minAnswers: 3, hardCells: [2, 5], guesses: 12 }, // hard cell = 6 or fewer well-known answers
  links: { mistakes: 4, herrings: [2, 99] },                // herring = two players from different groups sharing a club
  bingo: { secs: 90, solvableWithin: 25 },                  // all 12 squares fillable from the first 25 players
  hotcold: { guesses: 10 },
  top10: { lives: 3, known: 6 },                            // at least 6 of the 10 are well-known players
};

const range = n => [...Array(n).keys()];
const shuffle = (a, r) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a, r) => a[Math.floor(r() * a.length)];
const inBand = (v, [lo, hi]) => v >= lo && v <= hi;
const fail = msg => Object.assign(new Error(msg), { status: 400 });
const player = id => BY_ID.get(id) || (() => { throw fail('Pick a player from the list'); })();
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const HOME = { 'GB-ENG': 'England', 'GB-SCT': 'Scotland', 'GB-WLS': 'Wales', 'GB-NIR': 'Northern Ireland' };
export const nationName = code => (code ? HOME[code] || regionNames.of(code.slice(0, 2)) : '?');
const POS = { GK: 'Goalkeeper', DF: 'Defender', MF: 'Midfielder', FW: 'Forward' };

const pub = p => ({ id: p.id, name: p.name, nat: p.nat });
const clubView = id => ({ id, name: CLUBS[id].name, colors: CLUBS[id].colors });
const fits = (p, cat) => (cat.t === 'club' ? p.clubIds.has(cat.id) : cat.t === 'nat' ? p.nat === cat.id : p.pos.includes(cat.id));
const catView = cat => (cat.t === 'club' ? { t: 'club', ...clubView(cat.id) } : cat.t === 'nat' ? { t: 'nat', id: cat.id, name: nationName(cat.id) } : { t: 'pos', id: cat.id, name: POS[cat.id] + 's' });
const done = (state, won, score) => ({ ...state, done: true, won, score });

// Well-known players per category, cached: the grid generator intersects these a lot.
const memberCache = new Map();
const members = cat => {
  const key = cat.t + cat.id;
  if (!memberCache.has(key)) memberCache.set(key, new Set(TIER_B.filter(p => fits(p, cat)).map(p => p.id)));
  return memberCache.get(key);
};

// Distinct clubs a player actually played for (apps unknown or >= 1), merged across spells, oldest first.
function career(p) {
  const by = new Map();
  for (const [club, from, to, apps, goals] of p.clubs) {
    if (apps === 0) continue;
    const s = by.get(club);
    if (s) Object.assign(s, { spells: s.spells + 1, apps: (s.apps ?? 0) + (apps ?? 0), goals: s.goals + (goals ?? 0) });
    else by.set(club, { club, from, to, apps, goals: goals ?? 0, spells: 1 });
  }
  return [...by.values()];
}

// Largest number of categories that can each get a different player (augmenting paths).
function matching(ids, cats) {
  const owner = Array(cats.length).fill(-1);
  const tryPlayer = (i, seen) => cats.some((c, k) => {
    if (seen.has(k) || !fits(BY_ID.get(ids[i]), c)) return false;
    seen.add(k);
    if (owner[k] < 0 || tryPlayer(owner[k], seen)) { owner[k] = i; return true; }
    return false;
  });
  return ids.filter((_, i) => tryPlayer(i, new Set())).length;
}

export const FOOTBALL = {
  // "I played for these 4 clubs. Who am I?" One club shown, each miss or skip shows the next.
  whoami: {
    gen(r) {
      for (;;) {
        const p = pick(TIER_A, r), cs = career(p);
        if (cs.length < 4) continue;
        const four = [...cs].sort((a, b) => (b.apps ?? 0) - (a.apps ?? 0)).slice(0, 4).sort((a, b) => a.from - b.from);
        if (PLAYERS.filter(q => four.every(s => q.clubIds.has(s.club))).length !== 1) continue; // only one player fits all 4
        return { answer: p.id, clubs: four.map(({ club, from, to, spells }) => ({ club, from, to, spells })) };
      }
    },
    init: () => ({ shown: 1, guesses: [] }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, 0) };
      const g = a.skip ? null : player(a.guess).id;
      const state = { ...s, guesses: [...s.guesses, g] };
      if (g === p.answer) return { state: done(state, true, 5 - s.shown), reply: { ok: true, msg: 'Correct!' } };
      const reply = g ? { msg: `It’s not ${BY_ID.get(g).name}` } : { msg: 'Next club', neutral: true };
      if (s.shown === 4) return { state: done(state, false, 0), reply };
      return { state: { ...state, shown: s.shown + 1 }, reply };
    },
    view: (p, s) => ({
      clubs: p.clubs.slice(0, s.done ? 4 : s.shown).map(c => ({ ...clubView(c.club), from: c.from, to: c.to, more: c.spells > 1 })), total: 4,
      guesses: s.guesses.filter(id => id !== p.answer).map(id => (id ? BY_ID.get(id).name : null)), answer: s.done ? pub(BY_ID.get(p.answer)) : null,
    }),
    share: (p, s) => (s.won ? '🟥'.repeat(s.shown - 1) + '🟩' + '⬜'.repeat(4 - s.shown) : '🟥🟥🟥🟥'),
  },

  // Guess the player from one club spell: clue tiles revealed two at a time, most telling ones last.
  clues: {
    gen(r) {
      for (;;) {
        const p = pick(TIER_A, r);
        const spells = p.clubs.filter(([c, from, to, apps, goals]) => apps >= 10 && goals != null && CLUBS[c].sl >= 60 && (to ?? from + 1) - from <= 3);
        if (!spells.length || !p.h || !p.pos.length || !p.nat) continue;
        const [club, from, to, apps, goals] = pick(spells, r), league = CLUBS[club].league;
        const where = c => (league ? CLUBS[c].league === league : CLUBS[c].country === CLUBS[club].country);
        const alike = PLAYERS.filter(q => q.nat === p.nat && q.born === p.born && q.pos.some(x => p.pos.includes(x))
          && q.clubs.some(s => where(s[0]) && s[1] <= (to ?? 9999) && (s[2] ?? 9999) >= from));
        if (alike.length !== 1) continue; // all clues together point at exactly one player
        const order = [...shuffle(['apps', 'goals', 'height', 'pos'], r), ...shuffle(['age', 'caps'], r), ...shuffle(['nat', 'club'], r)];
        return {
          answer: p.id, order,
          banner: { league: league ? LEAGUES[league] : nationName(CLUBS[club].country), from, to },
          tiles: { apps, goals, height: p.h, pos: p.pos.map(x => POS[x]).join(' / '), age: from - p.born, caps: p.caps, nat: p.nat, club },
        };
      }
    },
    init: () => ({ shown: 2, guesses: [] }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, 0) };
      const g = a.skip ? null : player(a.guess).id;
      const state = { ...s, guesses: [...s.guesses, g] };
      if (g === p.answer) return { state: done(state, true, 5 - state.guesses.length), reply: { ok: true, msg: 'Correct!' } };
      const reply = g ? { msg: `It’s not ${BY_ID.get(g).name}` } : { msg: 'Two more clues', neutral: true };
      if (s.shown >= 8) return { state: done(state, false, 0), reply };
      return { state: { ...state, shown: s.shown + 2 }, reply };
    },
    view: (p, s) => ({
      banner: p.banner, attempts: 4, used: s.guesses.length,
      tiles: (s.done ? p.order : p.order.slice(0, s.shown)).map(k => ({ k, v: k === 'club' ? clubView(p.tiles.club) : p.tiles[k] })),
      hidden: s.done ? [] : p.order.slice(s.shown), guesses: s.guesses.filter(id => id !== p.answer).map(id => (id ? BY_ID.get(id).name : null)),
      answer: s.done ? pub(BY_ID.get(p.answer)) : null,
    }),
    share: (p, s) => (s.won ? '🟨'.repeat(s.guesses.length - 1) + '🟩' : '🟥🟥🟥🟥'),
  },

  // 3x3: rows are clubs, columns are clubs or nations; each square needs a player who fits both.
  grid: {
    gen(r) {
      const both = (a, b) => [...members(a)].filter(id => members(b).has(id)).length;
      for (;;) {
        const rows = shuffle(BIG_CLUBS, r).slice(0, 3).map(id => ({ t: 'club', id }));
        const ok = c => rows.every(row => both(row, c) >= BANDS.grid.minAnswers);
        const clubs = shuffle(BIG_CLUBS, r).filter(id => !rows.some(x => x.id === id)).map(id => ({ t: 'club', id })).filter(ok);
        const nats = shuffle(NATS, r).map(id => ({ t: 'nat', id })).filter(ok);
        const k = 1 + Math.floor(r() * 2);
        if (clubs.length < 3 - k || nats.length < k) continue;
        const cats = [...rows, ...shuffle([...clubs.slice(0, 3 - k), ...nats.slice(0, k)], r)];
        const counts = range(9).map(i => both(cats[Math.floor(i / 3)], cats[3 + (i % 3)]));
        if (inBand(counts.filter(n => n <= 6).length, BANDS.grid.hardCells)) return { cats };
      }
    },
    init: () => ({ cells: Array(9).fill(null), guesses: 0 }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, s.cells.filter(Boolean).length) };
      const q = player(a.guess);
      if (s.cells.includes(q.id)) throw fail(`${q.name} is already on the grid`);
      const options = range(9).filter(i => s.cells[i] == null && fits(q, p.cats[Math.floor(i / 3)]) && fits(q, p.cats[3 + (i % 3)]));
      if (a.cell == null && options.length > 1) return { state: s, reply: { choices: options, guess: q.id, msg: `${q.name} fits more than one square — pick one` } };
      const cell = a.cell ?? options[0];
      const cells = [...s.cells], ok = options.includes(cell);
      if (ok) cells[cell] = q.id;
      const state = { ...s, cells, guesses: s.guesses + 1 }, filled = cells.filter(Boolean).length;
      const reply = ok ? { ok: true, msg: `${q.name} added` } : { msg: options.length ? `${q.name} doesn’t fit that square` : `There’s no square for ${q.name}` };
      if (filled === 9 || state.guesses >= BANDS.grid.guesses) return { state: done(state, filled === 9, filled), reply };
      return { state, reply };
    },
    view: (p, s) => ({
      cats: p.cats.map(catView), guessesLeft: BANDS.grid.guesses - s.guesses,
      cells: s.cells.map((id, i) => (id ? { name: BY_ID.get(id).name, ok: true }
        : s.done ? { name: TIER_B.filter(q => fits(q, p.cats[Math.floor(i / 3)]) && fits(q, p.cats[3 + (i % 3)])).slice(0, 3).map(q => q.name).join(', '), ok: false } : null)),
    }),
    share: (p, s) => [0, 3, 6].map(i => s.cells.slice(i, i + 3).map(c => (c ? '🟩' : '⬜')).join('')).join('\n'),
  },

  // Four hidden groups of four players. Every player fits exactly one group, so the split is unique.
  links: {
    gen(r) {
      const clubPool = BIG_CLUBS.filter(c => CLUBS[c].sl >= 100);
      for (;;) {
        const nNat = 1 + Math.floor(r() * 2);
        const cats = [...shuffle(NATS, r).slice(0, nNat).map(id => ({ t: 'nat', id })), ...shuffle(clubPool, r).slice(0, 4 - nNat).map(id => ({ t: 'club', id }))];
        const groups = cats.map(cat => shuffle(TIER_B.filter(p => fits(p, cat) && cats.every(c => c === cat || !fits(p, c))), r).slice(0, 4));
        if (groups.some(g => g.length < 4)) continue;
        const all = groups.flat(), herrings = all.flatMap((a, i) => all.slice(i + 1).filter(b =>
          groups.findIndex(g => g.includes(a)) !== groups.findIndex(g => g.includes(b)) && [...a.clubIds].some(c => b.clubIds.has(c)))).length;
        if (!inBand(herrings, BANDS.links.herrings)) continue;
        // colour = difficulty: nations are easiest, then the biggest clubs
        const rank = cat => (cat.t === 'nat' ? 0 : 1 + (1000 - CLUBS[cat.id].sl) / 1000);
        const order = range(4).sort((a, b) => rank(cats[a]) - rank(cats[b]));
        return {
          groups: order.map((k, level) => ({ cat: cats[k], level, ids: groups[k].map(p => p.id) })),
          order: shuffle(all.map(p => p.id), r),
        };
      }
    },
    init: () => ({ solved: [], mistakes: 0, history: [] }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, s.solved.length) };
      const sel = [...new Set(Array.isArray(a.submit) ? a.submit : [])];
      const open = p.groups.filter((_, g) => !s.solved.includes(g)).flatMap(g => g.ids);
      if (sel.length !== 4 || !sel.every(id => open.includes(id))) throw fail('Pick 4 players');
      const hits = p.groups.map(g => g.ids.filter(id => sel.includes(id)).length), g = hits.indexOf(4);
      const history = [...s.history, sel.map(id => p.groups.findIndex(x => x.ids.includes(id)))];
      if (g >= 0) {
        const state = { ...s, solved: [...s.solved, g], history };
        return { state: state.solved.length === 4 ? done(state, true, 4 - s.mistakes) : state, reply: { ok: true, msg: 'Correct!' } };
      }
      const state = { ...s, mistakes: s.mistakes + 1, history }, msg = hits.includes(3) ? 'One away…' : 'Not a group';
      return { state: state.mistakes >= BANDS.links.mistakes ? done(state, false, s.solved.length) : state, reply: { msg } };
    },
    view(p, s) {
      const title = cat => (cat.t === 'nat' ? `${nationName(cat.id)} internationals` : `Played for ${CLUBS[cat.id].name}`);
      return {
        solved: (s.done ? [...s.solved, ...range(4).filter(g => !s.solved.includes(g))] : s.solved)
          .map(g => ({ title: title(p.groups[g].cat), level: p.groups[g].level, names: p.groups[g].ids.map(id => BY_ID.get(id).name), found: s.solved.includes(g) })),
        cards: s.done ? [] : p.order.filter(id => !s.solved.some(g => p.groups[g].ids.includes(id))).map(id => ({ id, name: BY_ID.get(id).name })),
        mistakes: s.mistakes, maxMistakes: BANDS.links.mistakes,
      };
    },
    share: (p, s) => s.history.map(row => row.map(g => ['🟨', '🟩', '🟦', '🟪'][p.groups[g].level]).join('')).join('\n'),
  },

  // 12 categories; players appear one at a time: put each in a square it fits, or skip. 90 seconds.
  bingo: {
    limit: BANDS.bingo.secs,
    gen(r) {
      for (;;) {
        const cats = shuffle([...shuffle(BIG_CLUBS, r).slice(0, 8).map(id => ({ t: 'club', id })), ...shuffle(NATS, r).slice(0, 4).map(id => ({ t: 'nat', id }))], r);
        const fitting = TIER_B.filter(p => cats.some(c => fits(p, c))), others = TIER_B.filter(p => !cats.some(c => fits(p, c)));
        const stream = shuffle([...shuffle(fitting, r).slice(0, 42), ...shuffle(others, r).slice(0, 18)], r).map(p => p.id);
        if (matching(stream.slice(0, BANDS.bingo.solvableWithin), cats) === 12) return { cats, stream };
      }
    },
    init: () => ({ at: 0, cells: Array(12).fill(null), last: null }),
    move(p, s, a, elapsed) {
      if (a.timeout && elapsed <= BANDS.bingo.secs) return { state: s }; // browser clock ran a little ahead
      if (a.giveUp || elapsed > BANDS.bingo.secs) return { state: done(s, false, s.cells.filter(Boolean).length), reply: { msg: a.giveUp ? '' : 'Time’s up' } };
      const cur = BY_ID.get(p.stream[s.at]), cells = [...s.cells];
      let reply = { msg: '' }, last = null;
      if (!a.skip) {
        if (!Number.isInteger(a.cell) || a.cell < 0 || a.cell > 11 || cells[a.cell]) throw fail('Pick an empty square');
        if (fits(cur, p.cats[a.cell])) { cells[a.cell] = cur.id; reply = { ok: true, msg: `${cur.name} ✓` }; }
        else { last = a.cell; reply = { msg: `${cur.name} doesn’t fit there` }; }
      }
      const state = { ...s, at: s.at + 1, cells, last }, filled = cells.filter(Boolean).length;
      if (filled === 12 || state.at >= p.stream.length) return { state: done(state, filled === 12, filled), reply };
      return { state, reply };
    },
    view: (p, s, elapsed = 0) => ({
      cats: p.cats.map(catView), cells: s.cells.map(id => (id ? BY_ID.get(id).name : null)), wrong: s.last,
      current: s.done ? null : { name: BY_ID.get(p.stream[s.at]).name }, left: p.stream.length - s.at,
      remaining: Math.max(0, BANDS.bingo.secs - elapsed),
    }),
    share: (p, s) => `${s.cells.filter(Boolean).length}/12`,
  },

  // Guess the secret player; every guess says what matches (unlike a bare similarity score).
  hotcold: {
    gen(r) {
      for (;;) {
        const p = pick(TIER_A, r);
        if (p.born >= 1980 && p.h && p.pos.length && p.nat) return { answer: p.id };
      }
    },
    init: () => ({ guesses: [] }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, 0) };
      const q = player(a.guess);
      if (s.guesses.includes(q.id)) throw fail(`You already tried ${q.name}`);
      const state = { ...s, guesses: [...s.guesses, q.id] };
      if (q.id === p.answer) return { state: done(state, true, BANDS.hotcold.guesses + 1 - state.guesses.length), reply: { ok: true, msg: 'Found!' } };
      return { state: state.guesses.length >= BANDS.hotcold.guesses ? done(state, false, 0) : state };
    },
    view(p, s) {
      const a = BY_ID.get(p.answer), league = x => CLUBS[x.clubs.at(-1)[0]].league;
      return {
        max: BANDS.hotcold.guesses, answer: s.done ? pub(a) : null,
        guesses: s.guesses.map(id => {
          const g = BY_ID.get(id), shared = [...g.clubIds].filter(c => a.clubIds.has(c));
          const samePos = g.pos.some(x => a.pos.includes(x)), sameLeague = !!league(g) && league(g) === league(a);
          const score = id === a.id ? 100 : Math.min(99, Math.round((g.nat === a.nat ? 20 : 0) + (samePos ? 15 : 0) + (Math.min(shared.length, 3) / 3) * 35
            + Math.max(0, 1 - Math.abs(g.born - a.born) / 10) * 15 + (sameLeague ? 15 : 0)));
          return {
            name: g.name, score, nat: { v: g.nat, ok: g.nat === a.nat }, pos: { v: g.pos.join('/'), ok: samePos },
            born: { v: g.born, dir: Math.sign(a.born - g.born) }, height: { v: g.h, dir: g.h && a.h ? Math.sign(a.h - g.h) : 0 },
            league: { v: league(g) ? LEAGUES[league(g)] : '–', ok: sameLeague }, shared: shared.map(c => CLUBS[c].name),
          };
        }),
      };
    },
    share: (p, s) => (s.won ? `found in ${s.guesses.length}` : 'not found'),
  },

  // Name the ten players on a ranked list. Three wrong names and the round is over.
  top10: {
    gen(r) {
      const bigNats = NATS.filter(c => natCount.get(c) >= 25), bigClubs = BIG_CLUBS.filter(c => CLUBS[c].sl >= 100);
      const clubTotal = (p, club, i) => p.clubs.filter(c => c[0] === club).reduce((t, c) => t + (c[i] ?? 0), 0);
      for (;;) {
        const kind = pick(['caps', 'intGoals', 'clubApps', 'clubGoals'], r), nat = kind === 'caps' || kind === 'intGoals';
        const key = nat ? pick(bigNats, r) : pick(bigClubs, r);
        const val = nat ? p => p[kind] : p => clubTotal(p, key, kind === 'clubApps' ? 3 : 4);
        const list = (nat ? PLAYERS.filter(p => p.nat === key) : PLAYERS.filter(p => p.clubIds.has(key))).map(p => ({ p, v: val(p) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
        if (list.length < 11 || list[9].v === list[10].v) continue; // no tie at the cut-off
        const top = list.slice(0, 10);
        if (top.filter(x => IN_B.has(x.p.id)).length < BANDS.top10.known) continue;
        const name = nat ? nationName(key) : CLUBS[key].name;
        const title = { caps: `Most caps for ${name}`, intGoals: `Top scorers for ${name}`, clubApps: `Most league games for ${name}`, clubGoals: `Most league goals for ${name}` }[kind];
        return { title, nat, rows: top.map(({ p, v }) => ({ id: p.id, v })) };
      }
    },
    init: () => ({ found: [], wrong: [] }),
    move(p, s, a) {
      if (a.giveUp) return { state: done(s, false, s.found.length) };
      const q = player(a.guess);
      if (s.found.includes(q.id) || s.wrong.includes(q.id)) throw fail(`You already tried ${q.name}`);
      if (p.rows.some(x => x.id === q.id)) {
        const state = { ...s, found: [...s.found, q.id] };
        return { state: state.found.length === 10 ? done(state, true, 10) : state, reply: { ok: true, msg: `${q.name} is on the list` } };
      }
      const state = { ...s, wrong: [...s.wrong, q.id] };
      return { state: state.wrong.length >= BANDS.top10.lives ? done(state, false, s.found.length) : state, reply: { msg: `${q.name} is not on the list` } };
    },
    view: (p, s) => ({
      title: p.title, lives: BANDS.top10.lives - s.wrong.length,
      rows: p.rows.map(({ id, v }, i) => {
        const q = BY_ID.get(id), open = s.found.includes(id) || s.done;
        return { rank: i + 1, hint: p.nat ? `${POS[q.pos[0]] || ''} · born ${Math.floor(q.born / 10) * 10}s` : nationName(q.nat), nat: p.nat ? null : q.nat,
          name: open ? q.name : null, v: open ? v : null, found: s.found.includes(id) };
      }),
      wrong: s.wrong.map(id => BY_ID.get(id).name),
    }),
    share: (p, s) => `${s.found.length}/10`,
  },
};

// Search list for the browser: every player, most famous first.
export const PLAYER_INDEX = PLAYERS.map(p => [p.id, p.name, p.nat || '']);
export const answerName = (game, p) => (p.answer ? BY_ID.get(p.answer).name : null);
export { PLAYERS, fits }; // for tests
