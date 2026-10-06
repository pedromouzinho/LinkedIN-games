// Puzzle generators + checkers. Pure functions, shared by the browser and test.mjs.

export const rng = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const range = n => [...Array(n).keys()];
const shuffle = (a, r) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const nb4 = (i, n) => {
  const r = Math.floor(i / n), c = i % n, o = [];
  if (r) o.push(i - n);
  if (r < n - 1) o.push(i + n);
  if (c) o.push(i - 1);
  if (c < n - 1) o.push(i + 1);
  return o;
};

// Generic backtracker over cells 0..size-1. Returns solution count (capped at limit) and first solution.
function search(size, vals, ok, given, limit, r) {
  const g = [...given];
  let count = 0, first = null;
  const go = i => {
    if (i === size) { count++; first ??= [...g]; return count >= limit; }
    if (given[i] != null) return ok(g, i, g[i]) && go(i + 1);
    for (const v of r ? shuffle([...vals], r) : vals) {
      g[i] = v;
      if (ok(g, i, v) && go(i + 1)) return true;
    }
    g[i] = null;
    return false;
  };
  go(0);
  return { count, first };
}

// ---------- Queens: one queen per row, column and color region; queens never touch ----------
export function queensCount(n, regions, limit = 2) {
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

export function queensGen(r, n = 8) {
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
      const open = nb4(cell, n).filter(x => regions[x] < 0);
      if (!open.length) { frontier.splice(k, 1); continue; }
      const x = open[Math.floor(r() * open.length)];
      regions[x] = regions[cell];
      frontier.push(x);
    }
    if (queensCount(n, regions) === 1) return { n, regions, solution: sol.map((c, row) => row * n + c) };
  }
}

// queens: Set of cell indices. Returns conflicting cells and whether solved.
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
  return { bad, win: q.length === n && !bad.size };
}

// ---------- Tango: 6x6 suns(0)/moons(1), 3 of each per row/col, no 3 in a row, = / × clues ----------
const T = 6;
const lines = i => {
  const r = Math.floor(i / T), c = i % T;
  return [range(T).map(k => r * T + k), range(T).map(k => k * T + c)];
};
function tangoViolations(g, edges) {
  const bad = new Set();
  for (let k = 0; k < T; k++)
    for (const line of [range(T).map(j => k * T + j), range(T).map(j => j * T + k)]) {
      for (const v of [0, 1]) {
        const cells = line.filter(x => g[x] === v);
        if (cells.length > T / 2) cells.forEach(x => bad.add(x));
      }
      for (let j = 0; j + 2 < T; j++) {
        const w = line.slice(j, j + 3);
        if (g[w[0]] != null && w.every(x => g[x] === g[w[0]])) w.forEach(x => bad.add(x));
      }
    }
  for (const { a, b, eq } of edges)
    if (g[a] != null && g[b] != null && (g[a] === g[b]) !== eq) { bad.add(a); bad.add(b); }
  return bad;
}
const tangoOk = edges => (g, i) => {
  // local version of tangoViolations: only lines/edges through cell i
  for (const line of lines(i)) {
    for (const v of [0, 1]) if (line.filter(x => g[x] === v).length > T / 2) return false;
    for (let j = 0; j + 2 < T; j++) {
      const w = line.slice(j, j + 3);
      if (w.includes(i) && g[w[0]] != null && w.every(x => g[x] === g[w[0]])) return false;
    }
  }
  return edges.every(({ a, b, eq }) => (a !== i && b !== i) || g[a] == null || g[b] == null || (g[a] === g[b]) === eq);
};

export function tangoGen(r) {
  const solution = search(T * T, [0, 1], tangoOk([]), Array(T * T).fill(null), 1, r).first;
  const clues = shuffle([
    ...range(T * T).map(i => ({ cell: i })),
    ...range(T * T).flatMap(a => [a + 1, a + T].filter(b => b < T * T && (b === a + T || b % T)).map(b => ({ a, b }))),
  ], r);
  const given = Array(T * T).fill(null), edges = [];
  for (const cl of clues) {
    if ('cell' in cl) given[cl.cell] = solution[cl.cell];
    else edges.push({ ...cl, eq: solution[cl.a] === solution[cl.b] });
    if (search(T * T, [0, 1], tangoOk(edges), given, 2).count === 1) break;
  }
  return { given, edges, solution };
}

export function tangoCheck({ edges }, g) {
  const bad = tangoViolations(g, edges);
  return { bad, win: g.every(v => v != null) && !bad.size };
}

// ---------- Mini Sudoku: 6x6, boxes are 2 rows x 3 cols ----------
const S = 6;
const peers = i => {
  const r = Math.floor(i / S), c = i % S, br = r - (r % 2), bc = c - (c % 3);
  return [...range(S).map(k => r * S + k), ...range(S).map(k => k * S + c),
    ...range(6).map(k => (br + Math.floor(k / 3)) * S + bc + (k % 3))].filter(x => x !== i);
};
const sudokuOk = (g, i, v) => peers(i).every(x => g[x] !== v);

export function sudokuGen(r) {
  const solution = search(S * S, range(S).map(v => v + 1), sudokuOk, Array(S * S).fill(null), 1, r).first;
  const given = [...solution];
  for (const i of shuffle(range(S * S), r)) {
    const keep = given[i];
    given[i] = null;
    if (search(S * S, range(S).map(v => v + 1), sudokuOk, given, 2).count !== 1) given[i] = keep;
  }
  return { given, solution };
}

export function sudokuCheck(g) {
  const bad = new Set(range(S * S).filter(i => g[i] != null && !sudokuOk(g, i, g[i])));
  return { bad, win: g.every(v => v != null) && !bad.size };
}

// ---------- Zip: draw one path through every cell, hitting the numbers in order ----------
export function zipGen(r, n = 6, k = 8) {
  for (;;) {
    const path = [Math.floor(r() * n * n)], seen = new Set(path);
    let steps = 0;
    const free = x => nb4(x, n).filter(y => !seen.has(y)).length;
    const go = () => {
      if (path.length === n * n) return true;
      if (++steps > 2e4) return false; // ponytail: dead-end walk, just restart with a new start cell
      const opts = shuffle(nb4(path.at(-1), n).filter(x => !seen.has(x)), r).sort((a, b) => free(a) - free(b));
      for (const x of opts) {
        path.push(x); seen.add(x);
        if (go()) return true;
        path.pop(); seen.delete(x);
      }
      return false;
    };
    if (!go()) continue;
    const idx = [0, n * n - 1, ...shuffle(range(n * n - 2).map(i => i + 1), r).slice(0, k - 2)].sort((a, b) => a - b);
    const nums = {};
    idx.forEach((p, j) => (nums[path[p]] = j + 1));
    return { n, nums, solution: path };
  }
}

export function zipCheck({ n, nums }, path) {
  if (path.length !== n * n || new Set(path).size !== n * n) return { win: false };
  if (path.some((x, i) => i && !nb4(path[i - 1], n).includes(x))) return { win: false };
  const seq = path.filter(x => nums[x]).map(x => nums[x]);
  return { win: seq.every((v, i) => v === i + 1) };
}
