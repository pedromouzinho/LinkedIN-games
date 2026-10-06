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

// ---------- football games ----------
{
  const { FOOTBALL: F, BANDS: FB, PLAYERS, fits } = await import('./football.js');
  const play = (g, p, s, a, t = 0) => F[g].move(p, s, a, t).state;
  const fdays = Math.min(days, 25);
  for (let day = 1; day <= fdays; day++) {
    const r = G.rng(day * 40503);
    for (const g of ['whoami', 'clues']) {
      const p = time(g, () => F[g].gen(r)), name = PLAYERS.find(x => x.id === p.answer).name;
      let s = F[g].init(p);
      assert(!JSON.stringify(F[g].view(p, s)).includes(name), `${g} view hides the answer`);
      s = play(g, p, s, { skip: true });
      assert(!s.done && !JSON.stringify(F[g].view(p, s)).includes(name), `${g} skip reveals more but not the answer`);
      const win = play(g, p, s, { guess: p.answer });
      assert(win.done && win.won && win.score === 3, `${g} correct guess on attempt 2 scores 3`);
      for (let i = 0; i < 4 && !s.done; i++) s = play(g, p, s, { skip: true });
      assert(s.done && !s.won && F[g].view(p, s).answer.name === name, `${g} runs out and reveals`);
      assert.throws(() => play(g, p, F[g].init(p), { guess: 'Q0' }), /Pick a player/, `${g} rejects unknown ids`);
    }
    const w = F.whoami.gen(G.rng(day));
    assert.equal(PLAYERS.filter(q => w.clubs.every(c => q.clubIds.has(c.club))).length, 1, 'whoami: one player fits all four clubs');

    const gr = time('grid', () => F.grid.gen(r));
    const cellFits = (q, i) => fits(q, gr.cats[Math.floor(i / 3)]) && fits(q, gr.cats[3 + (i % 3)]);
    let gs = F.grid.init(gr);
    for (let i = 0; i < 9; i++) {
      const q = PLAYERS.find(q => cellFits(q, i) && !gs.cells.includes(q.id));
      const res = F.grid.move(gr, gs, { guess: q.id, cell: i });
      gs = res.state;
    }
    assert(gs.done && gs.won && gs.score === 9, 'grid: filling all squares wins');
    const misfit = PLAYERS.find(q => !Array.from({ length: 9 }, (_, i) => cellFits(q, i)).some(Boolean));
    const miss = F.grid.move(gr, F.grid.init(gr), { guess: misfit.id });
    assert(miss.state.guesses === 1 && !miss.state.cells.some(Boolean), 'grid: a player with no square costs a guess');

    const ln = time('links', () => F.links.gen(r));
    for (const grp of ln.groups) for (const id of grp.ids) {
      const q = PLAYERS.find(x => x.id === id);
      assert.equal(ln.groups.filter(g2 => fits(q, g2.cat)).length, 1, 'links: each player fits exactly one group');
    }
    let ls = F.links.init(ln);
    const oneAway = F.links.move(ln, ls, { submit: [...ln.groups[0].ids.slice(0, 3), ln.groups[1].ids[0]] });
    assert(oneAway.reply.msg.startsWith('One away') && oneAway.state.mistakes === 1, 'links: 3 of 4 is one away');
    for (const grp of ln.groups) ls = play('links', ln, ls, { submit: grp.ids });
    assert(ls.done && ls.won, 'links: all four groups win');

    const bg = time('bingo', () => F.bingo.gen(r));
    let bs = F.bingo.init(bg);
    const timeout = play('bingo', bg, bs, { skip: true }, FB.bingo.secs + 1);
    assert(timeout.done && !timeout.won, 'bingo: moves after the time limit end the game');
    bs = play('bingo', bg, bs, { skip: true });
    assert.equal(bs.at, 1, 'bingo: skip moves on');

    const hc = time('hotcold', () => F.hotcold.gen(r));
    let hs = play('hotcold', hc, F.hotcold.init(hc), { guess: PLAYERS[0].id === hc.answer ? PLAYERS[1].id : PLAYERS[0].id });
    assert(F.hotcold.view(hc, hs).guesses[0].score < 100 && !hs.done, 'hotcold: a wrong guess gives feedback');
    hs = play('hotcold', hc, hs, { guess: hc.answer });
    assert(hs.done && hs.won && hs.score === FB.hotcold.guesses - 1, 'hotcold: found on guess 2');

    const tp = time('top10', () => F.top10.gen(r));
    assert(tp.rows.length === 10 && tp.rows.every((x, i) => !i || tp.rows[i - 1].v >= x.v), 'top10: ten rows, ranked');
    let ts = F.top10.init(tp);
    assert(!JSON.stringify(F.top10.view(tp, ts)).includes(PLAYERS.find(x => x.id === tp.rows[0].id).name), 'top10 view hides names');
    for (const row of tp.rows) ts = play('top10', tp, ts, { guess: row.id });
    assert(ts.done && ts.won && ts.score === 10, 'top10: naming all ten wins');
  }
  for (const [g, ms] of Object.entries(slow)) assert(ms < 3000, `${g} took ${ms.toFixed(0)}ms`);
  console.log(`ok: football ${fdays} days, slowest ms`, Object.fromEntries(Object.entries(slow).filter(([g]) => g in F).map(([g, v]) => [g, Math.round(v)])));
}
