// Puzzle generators, logic solvers and checkers. Pure functions, shared by server, browser and tests.
//
// Difficulty standard: every puzzle must be solvable by the logic solver below (no guessing, so the
// solution is unique) and its difficulty score must land inside BANDS. Generators retry until it does.

export const BANDS = {
  queens: { n: 8, hardSteps: [2, 6] },   // steps needing region/row confinement or lookahead
  tango: { hardest: [2, 3], clues: [8, 12] }, // hardest = most line options left when a forced cell was found
  sudoku: { givens: [10, 12] },
  zip: { n: 6, numbers: [6, 9], walls: [3, 5] }, // walls are added until the path is unique
};

export const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const range = n => [...Array(n).keys()];
const inBand = (v, [lo, hi]) => v >= lo && v <= hi;
const shuffle = (a, r) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const combos = (a, k) => (k === 0 ? [[]] : a.flatMap((x, i) => combos(a.slice(i + 1), k - 1).map(c => [x, ...c])));
export const nb4 = (i, n) => {
  const r = Math.floor(i / n), c = i % n, o = [];
  if (r) o.push(i - n);
  if (r < n - 1) o.push(i + n);
  if (c) o.push(i - 1);
  if (c < n - 1) o.push(i + 1);
  return o;
};
const nb8 = (i, n) => {
  const r = Math.floor(i / n), c = i % n, o = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if ((dr || dc) && r + dr >= 0 && r + dr < n && c + dc >= 0 && c + dc < n) o.push(i + dr * n + dc);
  return o;
};

// Random complete grid by backtracking (used for Tango and Sudoku solutions).
function fill(size, vals, ok, r) {
  const g = Array(size).fill(null);
  const go = i => {
    if (i === size) return true;
    for (const v of shuffle([...vals], r)) {
      g[i] = v;
      if (ok(g, i, v) && go(i + 1)) return true;
    }
    g[i] = null;
    return false;
  };
  go(0);
  return g;
}

// ---------- Queens: one queen per row, column and color region; queens never touch ----------
// Logic solver. Level 1: a unit with one candidate left. Level 2: k units confined to k other units.
// Level 3: lookahead (a queen here would wipe out some unit). Returns hard-step count (level >= 2).
export function queensLogic({ n, regions }) {
  const rows = range(n).map(r => range(n).map(c => r * n + c));
  const cols = range(n).map(c => range(n).map(r => r * n + c));
  const regs = range(n).map(k => range(n * n).filter(i => regions[i] === k));
  const cand = new Set(range(n * n)), queens = [];
  const hits = c => [...rows[Math.floor(c / n)], ...cols[c % n], ...regs[regions[c]], ...nb8(c, n)];
  const place = c => { queens.push(c); hits(c).forEach(x => cand.delete(x)); };
  const open = units => units.filter(u => !u.some(x => queens.includes(x)));
  let hard = 0;
  for (;;) {
    let progress = false;
    for (const u of open([...rows, ...cols, ...regs])) {
      const cs = u.filter(x => cand.has(x));
      if (!cs.length) return { solved: false, hard };
      if (cs.length === 1) { place(cs[0]); progress = true; break; }
    }
    if (progress) continue;
    confine: for (let k = 1; k <= 3; k++)
      for (const [A, B] of [[regs, rows], [regs, cols], [rows, regs], [cols, regs]])
        for (const set of combos(open(A), k)) {
          const inSet = new Set(set.flat());
          const covered = open(B).filter(b => b.some(x => cand.has(x) && inSet.has(x)));
          if (covered.length !== k) continue;
          const kill = covered.flat().filter(x => cand.has(x) && !inSet.has(x));
          if (kill.length) { kill.forEach(x => cand.delete(x)); progress = true; hard++; break confine; }
        }
    if (progress) continue;
    for (const c of cand) {
      const gone = new Set(hits(c));
      if (open([...rows, ...cols, ...regs]).some(u => !u.includes(c) && u.every(x => !cand.has(x) || gone.has(x)))) {
        cand.delete(c); progress = true; hard++; break;
      }
    }
    if (!progress) return { solved: queens.length === n, hard, queens };
  }
}

function queensCount(n, regions, limit = 2) {
  let count = 0;
  const cols = [], used = new Set();
  const go = row => {
    if (row === n) return ++count >= limit;
    for (let c = 0; c < n; c++) {
      const reg = regions[row * n + c];
      if (cols.includes(c) || used.has(reg) || (row && Math.abs(c - cols[row - 1]) < 2)) continue;
      cols.push(c); used.add(reg);
      if (go(row + 1)) return true;
      cols.pop(); used.delete(reg);
    }
    return false;
  };
  go(0);
  return count;
}

export function queensGen(r, { n, hardSteps } = BANDS.queens) {
  for (;;) {
    const sol = [];
    const place = row => {
      if (row === n) return true;
      for (const c of shuffle(range(n), r)) {
        if (sol.includes(c) || (row && Math.abs(c - sol[row - 1]) < 2)) continue;
        sol.push(c);
        if (place(row + 1)) return true;
        sol.pop();
      }
      return false;
    };
    place(0);
    const regions = Array(n * n).fill(-1), frontier = [];
    sol.forEach((c, row) => { regions[row * n + c] = row; frontier.push(row * n + c); });
    while (frontier.length) {
      const k = Math.floor(r() * frontier.length), cell = frontier[k];
      const free = nb4(cell, n).filter(x => regions[x] < 0);
      if (!free.length) { frontier.splice(k, 1); continue; }
      const x = free[Math.floor(r() * free.length)];
      regions[x] = regions[cell];
      frontier.push(x);
    }
    const p = { n, regions };
    if (queensCount(n, regions) !== 1) continue; // fast reject before the slower logic solver
    const { solved, hard } = queensLogic(p);
    if (solved && inBand(hard, hardSteps)) return { ...p, solution: sol.map((c, row) => row * n + c), score: hard };
  }
}

export function queensCheck({ n, regions }, queens) {
  const q = [...queens], bad = new Set();
  for (let i = 0; i < q.length; i++)
    for (let j = i + 1; j < q.length; j++) {
      const [a, b] = [q[i], q[j]];
      const ra = Math.floor(a / n), ca = a % n, rb = Math.floor(b / n), cb = b % n;
      if (ra === rb || ca === cb || regions[a] === regions[b] || (Math.abs(ra - rb) < 2 && Math.abs(ca - cb) < 2)) {
        bad.add(a); bad.add(b);
      }
    }
  const ok = q.every(x => Number.isInteger(x) && x >= 0 && x < n * n);
  return { bad, win: ok && q.length === n && !bad.size };
}

// ---------- Tango: 6x6 suns(0)/moons(1), 3 of each per row/col, no 3 in a row, = / × clues ----------
const T = 6;
const LINES = [...range(T).map(r => range(T).map(c => r * T + c)), ...range(T).map(c => range(T).map(r => r * T + c))];
const PATTERNS = range(1 << T).map(m => range(T).map(k => (m >> k) & 1))
  .filter(p => p.filter(Boolean).length === T / 2 && !p.some((v, k) => k > 1 && v === p[k - 1] && v === p[k - 2]));

// One deduction: for every line, keep the valid patterns consistent with it; a cell all of them agree on is forced.
// Picks the easiest one (fewest patterns left), like a person would. Returns null when stuck, false on contradiction.
export function tangoStep(g, edges) {
  let best = null;
  for (const L of LINES) {
    const le = edges.filter(e => L.includes(e.a) && L.includes(e.b));
    const fits = PATTERNS.filter(p => p.every((v, k) => g[L[k]] == null || g[L[k]] === v) &&
      le.every(e => (p[L.indexOf(e.a)] === p[L.indexOf(e.b)]) === e.eq));
    if (!fits.length) return false;
    for (let k = 0; k < T; k++)
      if (g[L[k]] == null && fits.every(p => p[k] === fits[0][k]) && (!best || fits.length < best.options))
        best = { cell: L[k], value: fits[0][k], options: fits.length };
  }
  return best;
}

export function tangoLogic(given, edges) {
  const g = [...given];
  let hardest = 0, s;
  while ((s = tangoStep(g, edges))) { g[s.cell] = s.value; hardest = Math.max(hardest, s.options); }
  return { solved: s !== false && g.every(v => v != null), hardest, g };
}

const tangoOk = (g, i) => LINES.filter(L => L.includes(i)).every(L => {
  const v = L.map(x => g[x]);
  return [0, 1].every(b => v.filter(x => x === b).length <= T / 2) &&
    !v.some((x, k) => k > 1 && x != null && x === v[k - 1] && x === v[k - 2]);
});

export function tangoGen(r, { hardest, clues } = BANDS.tango) {
  for (;;) {
    const solution = fill(T * T, [0, 1], tangoOk, r);
    const pool = shuffle([
      ...range(T * T).map(i => ({ cell: i })),
      ...range(T * T).flatMap(a => [a + 1, a + T].filter(b => b < T * T && (b === a + T || b % T)).map(b => ({ a, b }))),
    ], r);
    const given = Array(T * T).fill(null), edges = [];
    const apply = cl => ('cell' in cl ? (given[cl.cell] = solution[cl.cell]) : edges.push({ ...cl, eq: solution[cl.a] === solution[cl.b] }));
    const used = [];
    for (const cl of pool) {
      apply(cl); used.push(cl);
      if (tangoLogic(given, edges).solved) break;
    }
    // prune clues that logic doesn't need, so every puzzle is minimal
    for (const cl of [...used]) {
      const g2 = [...given], e2 = edges.filter(e => !(e.a === cl.a && e.b === cl.b));
      if ('cell' in cl) g2[cl.cell] = null;
      if (tangoLogic(g2, e2).solved) {
        if ('cell' in cl) given[cl.cell] = null; else edges.splice(edges.findIndex(e => e.a === cl.a && e.b === cl.b), 1);
        used.splice(used.indexOf(cl), 1);
      }
    }
    const res = tangoLogic(given, edges);
    if (inBand(res.hardest, hardest) && inBand(used.length, clues)) return { given, edges, solution, score: res.hardest };
  }
}

function tangoViolations(g, edges) {
  const bad = new Set();
  for (const L of LINES) {
    for (const v of [0, 1]) {
      const cells = L.filter(x => g[x] === v);
      if (cells.length > T / 2) cells.forEach(x => bad.add(x));
    }
    for (let j = 0; j + 2 < T; j++) {
      const w = L.slice(j, j + 3);
      if (g[w[0]] != null && w.every(x => g[x] === g[w[0]])) w.forEach(x => bad.add(x));
    }
  }
  for (const { a, b, eq } of edges)
    if (g[a] != null && g[b] != null && (g[a] === g[b]) !== eq) { bad.add(a); bad.add(b); }
  return bad;
}

export function tangoCheck({ edges }, g) {
  const bad = tangoViolations(g, edges);
  return { bad, win: g.length === T * T && g.every(v => v === 0 || v === 1) && !bad.size };
}

// ---------- Mini Sudoku: 6x6, boxes are 2 rows x 3 cols ----------
const S = 6;
const UNITS = [...LINES, ...range(S).map(b => range(6).map(k => (Math.floor(b / 2) * 2 + Math.floor(k / 3)) * S + (b % 2) * 3 + (k % 3)))];
const PEERS = range(S * S).map(i => [...new Set(UNITS.filter(u => u.includes(i)).flat())].filter(x => x !== i));
const sudokuOk = (g, i, v) => PEERS[i].every(x => g[x] !== v);
const DIGITS = range(S).map(v => v + 1);

// One deduction: hidden single (a digit with one spot in a unit) or naked single (a cell with one digit left).
export function sudokuStep(g) {
  for (const u of UNITS)
    for (const v of DIGITS) {
      if (u.some(x => g[x] === v)) continue;
      const spots = u.filter(x => g[x] == null && sudokuOk(g, x, v));
      if (!spots.length) return false;
      if (spots.length === 1) return { cell: spots[0], value: v };
    }
  for (let i = 0; i < S * S; i++) {
    if (g[i] != null) continue;
    const c = DIGITS.filter(v => sudokuOk(g, i, v));
    if (c.length === 1) return { cell: i, value: c[0] };
  }
  return null;
}

export function sudokuLogic(given) {
  const g = [...given];
  let s;
  while ((s = sudokuStep(g))) g[s.cell] = s.value;
  return { solved: s !== false && g.every(v => v != null), g };
}

export function sudokuGen(r, { givens } = BANDS.sudoku) {
  for (;;) {
    const solution = fill(S * S, DIGITS, sudokuOk, r);
    const given = [...solution];
    for (const i of shuffle(range(S * S), r)) {
      const keep = given[i];
      given[i] = null;
      if (!sudokuLogic(given).solved || given.filter(v => v != null).length < givens[0]) given[i] = keep;
    }
    const count = given.filter(v => v != null).length;
    if (inBand(count, givens)) return { given, solution, score: count };
  }
}

export function sudokuCheck(g) {
  const bad = new Set(range(S * S).filter(i => g[i] != null && !sudokuOk(g, i, g[i])));
  return { bad, win: g.length === S * S && g.every(v => DIGITS.includes(v)) && !bad.size };
}

// ---------- Zip: one path from 1 through the numbers in order, ending on the last, filling every cell ----------
// Walls block moves between two cells; they are added until the intended path is the only one.
const wallKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
const zipMoves = ({ n, walls = [] }) => {
  const w = new Set(walls.map(([a, b]) => wallKey(a, b)));
  return x => nb4(x, n).filter(y => !w.has(wallKey(x, y)));
};

export function zipCount(p, limit = 2) {
  const { n, nums } = p, moves = zipMoves(p);
  const k = Math.max(...Object.values(nums)), cells = Object.keys(nums).map(Number);
  const start = cells.find(c => nums[c] === 1), end = cells.find(c => nums[c] === k);
  const seen = new Uint8Array(n * n);
  let count = 0, left = n * n - 1;
  const connected = from => { // all unvisited cells still reachable from the head?
    const stack = [from], vis = new Uint8Array(n * n);
    vis[from] = 1;
    let reached = 0;
    while (stack.length)
      for (const y of moves(stack.pop()))
        if (!seen[y] && !vis[y]) { vis[y] = 1; reached++; stack.push(y); }
    return reached === left;
  };
  const go = (cur, next) => {
    if (!left) return cur === end && ++count >= limit;
    if (cur === end || !connected(cur)) return false;
    for (const x of moves(cur)) {
      if (seen[x] || (nums[x] && nums[x] !== next)) continue;
      seen[x] = 1; left--;
      const stop = go(x, nums[x] ? next + 1 : next);
      seen[x] = 0; left++;
      if (stop) return true;
    }
    return false;
  };
  seen[start] = 1;
  go(start, 2);
  return count;
}

export function zipGen(r, { n, numbers, walls: wallBand } = BANDS.zip) {
  for (;;) {
    const path = [Math.floor(r() * n * n)], seen = new Set(path);
    let steps = 0;
    const free = x => nb4(x, n).filter(y => !seen.has(y)).length;
    const walk = () => {
      if (path.length === n * n) return true;
      if (++steps > 2e4) return false; // ponytail: dead-end walk, just restart with a new start cell
      const opts = shuffle(nb4(path.at(-1), n).filter(x => !seen.has(x)), r).sort((a, b) => free(a) - free(b));
      for (const x of opts) {
        path.push(x); seen.add(x);
        if (walk()) return true;
        path.pop(); seen.delete(x);
      }
      return false;
    };
    if (!walk()) continue;
    const k = numbers[0] + Math.floor(r() * (numbers[1] - numbers[0] + 1));
    const idx = [0, n * n - 1, ...shuffle(range(n * n - 2).map(i => i + 1), r).slice(0, k - 2)].sort((a, b) => a - b);
    const nums = Object.fromEntries(idx.map((p, j) => [path[p], j + 1]));
    const onPath = new Set(path.slice(1).map((x, i) => wallKey(path[i], x)));
    const pool = shuffle(range(n * n).flatMap(a => nb4(a, n).filter(b => b > a && !onPath.has(wallKey(a, b))).map(b => [a, b])), r);
    const walls = [];
    while (pool.length && zipCount({ n, nums, walls }) > 1) walls.push(pool.pop());
    for (const w of [...walls]) { // drop walls that aren't needed
      const rest = walls.filter(x => x !== w);
      if (zipCount({ n, nums, walls: rest }) === 1) walls.splice(walls.indexOf(w), 1);
    }
    if (zipCount({ n, nums, walls }) === 1 && inBand(walls.length, wallBand)) return { n, nums, walls, solution: path, score: walls.length };
  }
}

export function zipCheck(p, path) {
  const { n, nums } = p, moves = zipMoves(p), k = Math.max(...Object.values(nums));
  if (path.length !== n * n || new Set(path).size !== n * n || !path.every(x => Number.isInteger(x) && x >= 0 && x < n * n)) return { win: false };
  if (nums[path[0]] !== 1 || nums[path.at(-1)] !== k) return { win: false };
  if (path.some((x, i) => i && !moves(path[i - 1]).includes(x))) return { win: false };
  const seq = path.filter(x => nums[x]).map(x => nums[x]);
  return { win: seq.every((v, i) => v === i + 1) };
}
export { zipMoves };

export const GENERATORS = { queens: queensGen, tango: tangoGen, sudoku: sudokuGen, zip: zipGen };
