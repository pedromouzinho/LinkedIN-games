import { rng, nb4, queensGen, queensCheck, tangoGen, tangoCheck, sudokuGen, sudokuCheck, zipGen, zipCheck } from './games.js';

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const dayNum = Math.round((Date.parse(iso) - Date.parse('2024-01-01')) / 864e5);
const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const fmt = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;

// ---------- persistence (per device; sharing text is the "network") ----------
let state = { name: '', results: {}, friends: [] };
try { state = { ...state, ...JSON.parse(localStorage.getItem('gg')) }; } catch {}
const save = () => { try { localStorage.setItem('gg', JSON.stringify(state)); } catch {} };

const GAMES = {
  queens: { title: 'Queens', icon: '👑', gen: queensGen, view: queensView,
    rules: 'Place one 👑 in each row, column and color region. Queens can’t touch, not even diagonally. Tap once for ✕, twice for 👑.' },
  tango: { title: 'Tango', icon: '🌗', gen: tangoGen, view: tangoView,
    rules: 'Fill the grid with ☀ and ☾. Each row and column has 3 of each, no more than 2 in a row. = means same, × means opposite.' },
  zip: { title: 'Zip', icon: '🔗', gen: zipGen, view: zipView,
    rules: 'Drag one path from 1 through the numbers in order, filling every cell.' },
  sudoku: { title: 'Mini Sudoku', icon: '🔢', gen: sudokuGen, view: sudokuView,
    rules: 'Fill 1–6 so each row, column and 2×3 box has every number once.' },
};

const puzzle = id => GAMES[id].gen(rng(hash(iso + id)));
const myTime = id => state.results[iso]?.[id];

// ---------- profile / streak / network ----------
function streak() {
  const d = new Date(Date.parse(iso));
  if (!state.results[iso]) d.setUTCDate(d.getUTCDate() - 1);
  let n = 0;
  while (state.results[d.toISOString().slice(0, 10)]) { n++; d.setUTCDate(d.getUTCDate() - 1); }
  return n;
}

function sidebar() {
  $('#name').value = state.name;
  $('#avatar').textContent = (state.name || '?')[0].toUpperCase();
  $('#streak').textContent = streak();
  $('#board').innerHTML = Object.entries(GAMES).map(([id, g]) => {
    const rows = state.friends.filter(f => f.game === g.title && f.num === dayNum);
    if (myTime(id) != null) rows.push({ name: (state.name || 'You') + ' (you)', secs: myTime(id) });
    if (!rows.length) return '';
    rows.sort((a, b) => a.secs - b.secs);
    return `<h4>${g.icon} ${g.title}</h4><ol>${rows.map(r => `<li><span>${esc(r.name)}</span><b>${fmt(r.secs)}</b></li>`).join('')}</ol>`;
  }).join('') || '<p class="muted">Solve a puzzle or add a friend’s result to start a leaderboard.</p>';
}
const esc = s => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

$('#name').oninput = e => { state.name = e.target.value.trim(); save(); sidebar(); };
$('#add').onclick = () => {
  const titles = Object.values(GAMES).map(g => g.title).join('|');
  const found = [...$('#paste').value.matchAll(new RegExp(`(${titles}) #(\\d+) \\| (\\d+):(\\d\\d) \\| (.+)`, 'g'))];
  for (const [, game, num, m, s, name] of found) {
    const f = { game, num: +num, secs: +m * 60 + +s, name: name.trim().slice(0, 30) };
    state.friends = state.friends.filter(x => !(x.game === f.game && x.num === f.num && x.name === f.name));
    state.friends.push(f);
  }
  $('#addMsg').textContent = found.length ? `Added ${found.length} result(s).` : 'No results found in that text.';
  $('#paste').value = '';
  save(); sidebar();
};

// ---------- screens ----------
let tick, onKey;
document.onkeydown = e => onKey?.(e);

function home() {
  clearInterval(tick); onKey = null;
  $('#center').innerHTML = `<div class="card"><h2>Today’s puzzles</h2><p class="muted">New puzzles every day. Compare times with your connections.</p></div>` +
    Object.entries(GAMES).map(([id, g]) => `
      <button class="card tile" data-game="${id}">
        <span class="icon">${g.icon}</span>
        <span><b>${g.title}</b><br><span class="muted">#${dayNum}</span></span>
        <span class="status">${myTime(id) != null ? '✓ ' + fmt(myTime(id)) : 'Play'}</span>
      </button>`).join('');
  $('#center').onclick = e => { const id = e.target.closest('[data-game]')?.dataset.game; if (id) play(id); };
}

function play(id) {
  const g = GAMES[id], start = Date.now();
  let solved = false;
  $('#center').onclick = null;
  $('#center').innerHTML = `<div class="card game">
    <div class="row"><button class="btn ghost" id="back">← Games</button><b>${g.icon} ${g.title} #${dayNum}</b><span id="timer">0:00</span></div>
    <p class="muted">${g.rules}</p><div id="play"></div></div>`;
  $('#back').onclick = home;
  const secs = () => Math.floor((Date.now() - start) / 1000);
  tick = setInterval(() => ($('#timer').textContent = fmt(secs())), 1000);
  g.view($('#play'), puzzle(id), () => {
    if (solved) return;
    solved = true;
    clearInterval(tick);
    const t = secs();
    $('#play').classList.add('solved');
    if (myTime(id) == null) { (state.results[iso] ??= {})[id] = t; save(); } // first solve counts, replays are practice
    const text = `${g.title} #${dayNum} | ${fmt(myTime(id))} | ${state.name || 'Anonymous'}\n${g.icon} Grid Games`;
    $('#doneTitle').textContent = `Solved in ${fmt(t)}! ${g.icon}`;
    $('#shareText').textContent = text;
    $('#share').onclick = async () => {
      try { await navigator.share({ text }); } catch { await navigator.clipboard?.writeText(text); $('#share').textContent = 'Copied!'; }
    };
    sidebar();
    $('#done').showModal();
  });
}
$('#close').onclick = () => { $('#done').close(); $('#share').textContent = 'Share'; home(); };

// ---------- game views: render(el, puzzle, won) ----------
const COLORS = ['#f9c7a8', '#b9d6f2', '#c8e6b0', '#f5e19a', '#d9c2ef', '#f2b8c6', '#a8e3d8', '#e0e0e0', '#ffd8a8', '#c5cae9', '#dcedc8'];
const cell = i => +i.closest('[data-i]')?.dataset.i;

function queensView(el, p, won) {
  const marks = Array(p.n * p.n).fill(0); // 0 empty, 1 ✕, 2 queen
  const draw = () => {
    const { bad, win } = queensCheck(p, new Set(marks.flatMap((m, i) => (m === 2 ? [i] : []))));
    el.innerHTML = `<div class="grid" style="--n:${p.n}">${marks.map((m, i) => {
      const bt = i >= p.n && p.regions[i - p.n] !== p.regions[i], bl = i % p.n && p.regions[i - 1] !== p.regions[i];
      return `<div data-i="${i}" class="c ${bad.has(i) ? 'bad' : ''} ${bt ? 'bt' : ''} ${bl ? 'bl' : ''}" style="background:${COLORS[p.regions[i]]}">${['', '✕', '👑'][m]}</div>`;
    }).join('')}</div>`;
    if (win) won();
  };
  el.onclick = e => { const i = cell(e.target); if (i >= 0) { marks[i] = (marks[i] + 1) % 3; draw(); } };
  draw();
}

function tangoView(el, p, won) {
  const g = [...p.given];
  const draw = () => {
    const { bad, win } = tangoCheck(p, g);
    el.innerHTML = `<div class="grid" style="--n:6">${g.map((v, i) => `
      <div data-i="${i}" class="c ${p.given[i] != null ? 'given' : ''} ${bad.has(i) ? 'bad' : ''}">
        <span class="${['sun', 'moon'][v] ?? ''}">${['☀', '☾'][v] ?? ''}</span>
        ${p.edges.filter(e => e.a === i).map(e => `<i class="edge ${e.b === i + 1 ? 'r' : 'd'}">${e.eq ? '=' : '×'}</i>`).join('')}
      </div>`).join('')}</div>`;
    if (win) won();
  };
  el.onclick = e => {
    const i = cell(e.target);
    if (i >= 0 && p.given[i] == null) { g[i] = g[i] == null ? 0 : g[i] === 0 ? 1 : null; draw(); }
  };
  draw();
}

function sudokuView(el, p, won) {
  const g = [...p.given];
  let sel = g.indexOf(null);
  const set = v => { if (p.given[sel] == null) { g[sel] = v; draw(); } };
  const draw = () => {
    const { bad, win } = sudokuCheck(g);
    el.innerHTML = `<div class="grid sudoku" style="--n:6">${g.map((v, i) =>
      `<div data-i="${i}" class="c ${p.given[i] != null ? 'given' : ''} ${bad.has(i) ? 'bad' : ''} ${i === sel ? 'sel' : ''}">${v ?? ''}</div>`).join('')}</div>
      <div class="pad">${[1, 2, 3, 4, 5, 6].map(n => `<button class="btn ghost" data-n="${n}">${n}</button>`).join('')}<button class="btn ghost" data-n="">⌫</button></div>`;
    if (win) won();
  };
  el.onclick = e => {
    const n = e.target.dataset.n;
    if (n != null) return set(n ? +n : null);
    const i = cell(e.target);
    if (i >= 0) { sel = i; draw(); }
  };
  onKey = e => {
    if (/^[1-6]$/.test(e.key)) set(+e.key);
    else if (e.key === 'Backspace' || e.key === 'Delete') set(null);
  };
  draw();
}

function zipView(el, p, won) {
  const path = [];
  let dragging = false;
  const enter = x => {
    const at = path.indexOf(x);
    if (at >= 0) { if (at < path.length - 1) { path.length = at + 1; draw(); } return; }
    if (path.length ? !nb4(path.at(-1), p.n).includes(x) : p.nums[x] !== 1) return;
    if (p.nums[x] && p.nums[x] !== path.filter(c => p.nums[c]).length + 1) return;
    path.push(x); draw();
  };
  const draw = () => {
    const pts = path.map(i => `${(i % p.n) + 0.5},${Math.floor(i / p.n) + 0.5}`).join(' ');
    el.innerHTML = `<div class="grid zip" style="--n:${p.n}">
      ${Array.from({ length: p.n * p.n }, (_, i) => `<div data-i="${i}" class="c ${path.includes(i) ? 'on' : ''}">${p.nums[i] ? `<b>${p.nums[i]}</b>` : ''}</div>`).join('')}
      <svg viewBox="0 0 ${p.n} ${p.n}"><polyline points="${pts}"/></svg></div>`;
    if (zipCheck(p, path).win) won();
  };
  const hit = e => { const t = document.elementFromPoint(e.clientX, e.clientY); if (t && el.contains(t)) { const i = cell(t); if (i >= 0) enter(i); } };
  el.onpointerdown = e => { dragging = true; hit(e); };
  el.onpointermove = e => dragging && hit(e);
  window.onpointerup = () => (dragging = false);
  draw();
}

$('#today').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
sidebar();
home();
