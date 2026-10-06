// Guards the difficulty standard: run `node test.mjs [days]`.
import assert from 'node:assert';
import * as G from './games.js';

const days = +process.argv[2] || 60, B = G.BANDS, slow = {};
const between = (v, [lo, hi], what) => assert(v >= lo && v <= hi, `${what}=${v} outside [${lo},${hi}]`);
const time = (g, f) => { const t = performance.now(), v = f(); slow[g] = Math.max(slow[g] || 0, performance.now() - t); return v; };

for (let day = 1; day <= days; day++) {
  const r = G.rng(day * 2654435761);

  const q = time('queens', () => G.queensGen(r));
  assert(G.queensCheck(q, q.solution).win);
  const ql = G.queensLogic(q);
  assert(ql.solved && ql.queens.sort().join() === [...q.solution].sort().join(), 'queens logic finds the solution');
  between(ql.hard, B.queens.hardSteps, 'queens hard steps');
  assert(!G.queensCheck(q, q.solution.slice(1)).win);
  assert(!G.queensCheck(q, [...q.solution.slice(1), '0']).win, 'queens rejects junk');

  const t = time('tango', () => G.tangoGen(r));
  assert(G.tangoCheck(t, t.solution).win);
  const tl = G.tangoLogic(t.given, t.edges);
  assert(tl.solved && tl.g.join() === t.solution.join(), 'tango logic finds the solution');
  between(tl.hardest, B.tango.hardest, 'tango hardest');
  between(t.given.filter(v => v != null).length + t.edges.length, B.tango.clues, 'tango clues');
  const tb = [...t.solution]; tb[0] ^= 1;
  assert(!G.tangoCheck(t, tb).win);
  assert(!G.tangoCheck(t, t.solution.map(String)).win, 'tango rejects junk');
  assert(!G.tangoCheck(t, t.solution.slice(1)).win, 'tango rejects short grid');

  const s = time('sudoku', () => G.sudokuGen(r));
  assert(G.sudokuCheck(s.solution).win);
  const sl = G.sudokuLogic(s.given);
  assert(sl.solved && sl.g.join() === s.solution.join(), 'sudoku logic finds the solution');
  between(s.given.filter(v => v != null).length, B.sudoku.givens, 'sudoku givens');
  const sb = [...s.solution]; [sb[0], sb[1]] = [sb[1], sb[0]];
  assert(!G.sudokuCheck(sb).win);
  assert(!G.sudokuCheck(s.solution.map(v => v + 0.5)).win, 'sudoku rejects junk');

  const z = time('zip', () => G.zipGen(r));
  assert(G.zipCheck(z, z.solution).win);
  assert.equal(G.zipCount(z), 1, 'zip has one solution');
  between(Object.keys(z.nums).length, B.zip.numbers, 'zip numbers');
  between(z.walls.length, B.zip.walls, 'zip walls');
  assert(!G.zipCheck(z, [...z.solution].reverse()).win);
  assert(!G.zipCheck(z, z.solution.map(String)).win, 'zip rejects junk');

  const pa = time('patches', () => G.patchesGen(r));
  assert(G.patchesCheck(pa, pa.solution).win, 'patches solution valid');
  const pl = G.patchesLogic(pa);
  assert(pl.solved && JSON.stringify(pl.rects) === JSON.stringify(pa.solution), 'patches logic finds the solution');
  between(pl.hard, B.patches.hardSteps ?? B.patches.hard, 'patches hard steps');
  between(pa.clues.length, B.patches.pieces, 'patches pieces');
  assert(!G.patchesCheck(pa, pa.solution.slice(1)).win, 'patches rejects uncovered cells');
  assert(!G.patchesCheck(pa, [...pa.solution, pa.solution[0]]).win, 'patches rejects overlap');
  assert(!G.patchesCheck(pa, 'junk').win && !G.patchesCheck(pa, [[0, 0, 99, 1]]).win, 'patches rejects junk');
}
for (const [g, ms] of Object.entries(slow)) assert(ms < 3000, `${g} took ${ms.toFixed(0)}ms`);
console.log(`ok: ${days} days, slowest ms`, Object.fromEntries(Object.entries(slow).map(([g, v]) => [g, Math.round(v)])));

// rule reporting used by the UI messages
{
  const q = G.queensGen(G.rng(7)), [a] = q.solution, n = q.n;
  const rules = G.queensRules(q, [a, a % n === n - 1 ? a - 1 : a + 1]).map(v => v.rule);
  assert(rules.includes('row') && rules.includes('touch'), 'two queens side by side break row + touch');
  const t = G.tangoGen(G.rng(7)), g = [...t.solution];
  assert.deepEqual(G.tangoRules(t, g), [], 'solution has no violations');
  assert(G.sudokuRules([1, 1, ...Array(34).fill(null)]).some(v => v.rule === 'row' && v.bad.length === 2), 'sudoku row duplicate');
  console.log('ok: rule reporting');
}
