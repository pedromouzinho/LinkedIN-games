import assert from 'node:assert';
import { rng, queensGen, queensCheck, tangoGen, tangoCheck, sudokuGen, sudokuCheck, zipGen, zipCheck } from './games.js';

for (let seed = 1; seed <= 20; seed++) {
  const r = rng(seed);
  const q = queensGen(r);
  assert(queensCheck(q, new Set(q.solution)).win, 'queens solution valid');
  assert(!queensCheck(q, new Set(q.solution.slice(1))).win, 'queens incomplete rejected');

  const t = tangoGen(r);
  assert(tangoCheck(t, t.solution).win, 'tango solution valid');
  assert(t.given.every((v, i) => v == null || v === t.solution[i]), 'tango givens match');
  const tb = [...t.solution]; tb[0] ^= 1;
  assert(!tangoCheck(t, tb).win, 'tango flipped cell rejected');

  const s = sudokuGen(r);
  assert(sudokuCheck(s.solution).win, 'sudoku solution valid');
  assert(s.given.some(v => v == null), 'sudoku has blanks');
  const sb = [...s.solution]; [sb[0], sb[1]] = [sb[1], sb[0]];
  assert(!sudokuCheck(sb).win, 'sudoku swap rejected');

  const z = zipGen(r);
  assert(zipCheck(z, z.solution).win, 'zip solution valid');
  assert(!zipCheck(z, [...z.solution].reverse()).win, 'zip reversed rejected');
}
console.log('ok');
