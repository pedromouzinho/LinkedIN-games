import * as G from './games.js';

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const fmt = s => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const avatar = u => /^https:\/\//.test(u.picture || '')
  ? `<img class="av" src="${esc(u.picture)}" alt="" referrerpolicy="no-referrer">`
  : `<span class="av">${esc((u.name || '?')[0].toUpperCase())}</span>`;
const store = {
  get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
let toastTimer;
const toast = msg => { $('#toast').textContent = msg; $('#toast').className = 'show'; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($('#toast').className = ''), 2200); };

async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong'), { status: r.status });
  return j;
}

const GAMES = {
  queens: { title: 'Queens', icon: '👑', rules: 'One ♛ in each row, column and color region. Queens can’t touch, not even diagonally. Tap for ✕, tap again for ♛. Drag to mark ✕.' },
  tango: { title: 'Tango', icon: '🌗', rules: 'Fill with suns and moons. Each row and column has 3 of each, never 3 in a row. = means same, × means opposite.' },
  zip: { title: 'Zip', icon: '🔗', rules: 'Drag one path through the numbers in order. Fill every cell. Thick lines are walls.' },
  sudoku: { title: 'Mini Sudoku', icon: '🔢', rules: 'Fill 1–6 so every row, column and 2×3 box has each number once.' },
};

let cfg, me;
const inviteLink = () => `${location.origin}/?invite=${me.uid}`;

// ---------- shell ----------
async function boot() {
  cfg = await api('/api/config');
  $('#today').textContent = new Date(cfg.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  me = await api('/api/me').catch(e => { if (e.status === 401) return null; throw e; });
  if (!me) return signIn();
  left();
  right();
  const invite = new URLSearchParams(location.search).get('invite');
  if (invite && invite !== me.uid && !me.connections.includes(invite)) return inviteCard(invite);
  home();
}

function signIn() {
  $('#left').innerHTML = $('#right').innerHTML = '';
  $('#center').innerHTML = `<div class="card hero">
    <h2>Daily puzzles with your network</h2>
    <p class="muted">Four quick puzzles, new every day. Keep your streak and see how your connections did.</p>
    <div id="gbtn"></div>
    ${cfg.devLogin ? `<form id="dev" class="row"><input name="name" placeholder="Name (dev login)" required maxlength="30"><button class="btn">Sign in</button></form>` : ''}
    ${!cfg.clientId && !cfg.devLogin ? '<p class="bad-text">Sign-in is not configured (GOOGLE_CLIENT_ID).</p>' : ''}
  </div>`;
  if (cfg.devLogin) $('#dev').onsubmit = async e => { e.preventDefault(); await api('/api/dev-login', { name: e.target.name.value }); boot(); };
  if (cfg.clientId) {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => {
      google.accounts.id.initialize({ client_id: cfg.clientId, callback: async r => { await api('/api/login', { credential: r.credential }); boot(); } });
      google.accounts.id.renderButton($('#gbtn'), { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with' });
    };
    document.head.append(s);
  }
}

function left() {
  $('#left').innerHTML = `<div class="card profile">
    <div class="banner"></div>${avatar(me)}
    <b>${esc(me.name)}</b>
    <p class="muted">🔥 <b>${me.streak}</b>-day streak · ${me.connections.length} connection${me.connections.length === 1 ? '' : 's'}</p>
    <button class="btn" id="invite">Invite connections</button>
    <button class="btn ghost small" id="logout">Sign out</button>
  </div>`;
  $('#invite').onclick = () => share(`Play Grid Games with me: ${inviteLink()}`, 'Invite link copied');
  $('#logout').onclick = async () => { await api('/api/logout', {}); boot(); };
}

async function right() {
  const board = await api('/api/leaderboard');
  const rows = Object.entries(GAMES).filter(([id]) => board[id].length).map(([id, g]) =>
    `<h4>${g.icon} ${g.title}</h4><ol class="lb">${board[id].map(r => `<li class="${r.me ? 'me' : ''}">${avatar(r)}<span class="nm">${esc(r.name)}</span>${r.hints ? `<i title="hints">💡${r.hints}</i>` : ''}<b>${fmt(r.secs)}</b></li>`).join('')}</ol>`).join('');
  $('#right').innerHTML = `<div class="card"><h3>Your network today</h3>${rows || `<p class="muted">No results yet today. Solve a puzzle and invite your connections.</p>`}</div>`;
}

async function inviteCard(uid) {
  const u = await api(`/api/user?uid=${encodeURIComponent(uid)}`).catch(() => null);
  history.replaceState(null, '', '/');
  if (!u) return home();
  $('#center').innerHTML = `<div class="card hero">${avatar(u)}<h2>${esc(u.name)} invited you</h2>
    <p class="muted">Connect to compare puzzle times every day.</p>
    <div class="row center"><button class="btn" id="yes">Connect</button><button class="btn ghost" id="no">Not now</button></div></div>`;
  $('#yes').onclick = async () => { await api('/api/connect', { uid }); me = await api('/api/me'); left(); right(); toast(`You’re now connected with ${u.name}`); home(); };
  $('#no').onclick = home;
}

let tick, onKey;
document.addEventListener('keydown', e => onKey?.(e));
const stop = () => { clearInterval(tick); onKey = null; };

function home() {
  stop();
  const past = [];
  for (let d = new Date(cfg.day + 'T12:00Z'); ; ) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.toISOString().slice(0, 10);
    if (day < cfg.launch || past.length >= 14) break;
    past.push(day);
  }
  $('#center').innerHTML = `<div class="card"><h2>Today’s puzzles</h2><p class="muted">Solve them all to keep your streak.</p></div>
    ${Object.entries(GAMES).map(([id, g]) => `
      <button class="card tile" data-game="${id}">
        <span class="icon">${g.icon}</span>
        <span><b>${g.title}</b><br><span class="muted">#${cfg.num}</span></span>
        <span class="status">${me.played[id] != null ? '✓ ' + fmt(me.played[id]) : 'Play'}</span>
      </button>`).join('')}
    ${past.length ? `<div class="card"><h3>Archive</h3><p class="muted small">Practice past puzzles. They don’t count for the leaderboard.</p>
      ${past.map(day => `<div class="arch"><span>${new Date(day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        ${Object.entries(GAMES).map(([id, g]) => `<button class="btn ghost small" data-game="${id}" data-day="${day}" title="${g.title}">${g.icon}</button>`).join('')}</div>`).join('')}</div>` : ''}`;
  $('#center').onclick = e => { const b = e.target.closest('[data-game]'); if (b) intro(b.dataset.game, b.dataset.day || cfg.day); };
}

function intro(id, day) {
  const g = GAMES[id], practice = day !== cfg.day;
  if (!practice && me.played[id] != null) return result(id, day, { secs: me.played[id] });
  $('#center').onclick = null;
  $('#center').innerHTML = `<div class="card hero">
    <div class="big">${g.icon}</div><h2>${g.title}</h2>
    <p class="muted">${practice ? `Archive · ${day}` : `#${cfg.num}`}</p>
    <p>${g.rules}</p>
    <div class="row center"><button class="btn ghost" id="back">Back</button><button class="btn" id="start">${practice ? 'Practice' : 'Start'}</button></div>
    ${practice ? '' : '<p class="muted small">The timer starts when you press Start and keeps running if you leave.</p>'}
  </div>`;
  $('#back').onclick = home;
  $('#start').onclick = async () => { $('#start').disabled = true; play(id, await api(`/api/puzzle?game=${id}&day=${day}`)); };
}

// ---------- the game screen: shared toolbar, history, timer; per-game boards below ----------
function play(id, data) {
  stop();
  const g = GAMES[id], p = data.puzzle, practice = !data.play, key = `gg:${data.day}:${id}`;
  $('#center').innerHTML = `<div class="card game">
    <div class="row"><button class="btn ghost small" id="back">←</button><b>${g.icon} ${g.title} ${practice ? data.day : '#' + data.num}</b><span id="timer">0:00</span></div>
    <div id="board"></div>
    <div class="row center tools"><button class="btn ghost small" id="undo">↶ Undo</button><button class="btn ghost small" id="clear">Clear</button><button class="btn ghost small" id="hint">💡 Hint</button></div>
    <p class="muted small">${g.rules}</p>
  </div>`;
  $('#back').onclick = () => { stop(); home(); };

  const t0 = Date.now() - (data.play?.elapsed || 0) * 1000;
  const timer = $('#timer');
  const show = () => (timer.textContent = fmt(Math.floor((Date.now() - t0) / 1000)));
  show();
  tick = setInterval(show, 250);

  const undo = [];
  let snap = null, solved = false;
  const ctx = {
    before: () => { snap = JSON.stringify(game.get()); },
    after: () => {
      const cur = JSON.stringify(game.get());
      if (snap != null && snap !== cur) { undo.push(snap); snap = null; }
      store.set(key, game.get());
      redraw();
    },
    flash: i => { const c = $('#board').querySelectorAll('.c')[i]; c?.classList.remove('flash'); void c?.offsetWidth; c?.classList.add('flash'); },
  };
  const game = BOARDS[id]($('#board'), p, ctx);
  const saved = store.get(key);
  if (saved) game.set(saved);

  async function redraw() {
    if (!game.draw() || solved) return;
    solved = true;
    stop();
    $('#board').classList.add('won');
    const res = await api('/api/solve', { game: id, day: data.day, answer: game.answer() }).catch(e => ({ error: e.message }));
    if (!res.win) { solved = false; $('#board').classList.remove('won'); return toast(res.error || 'Not quite — check the rules'); }
    if (!practice) { me.played[id] = res.secs; me.streak = res.streak; left(); right(); }
    setTimeout(() => result(id, data.day, practice ? { secs: Math.floor((Date.now() - t0) / 1000), practice } : res), 700);
  }
  $('#undo').onclick = () => { if (undo.length) { game.set(JSON.parse(undo.pop())); store.set(key, game.get()); redraw(); } };
  $('#clear').onclick = () => { ctx.before(); game.reset(); ctx.after(); };
  $('#hint').onclick = async () => {
    const h = await api('/api/hint', { game: id, day: data.day, state: game.answer() });
    if (h.wrong != null || h.truncate != null) toast('Found a mistake');
    game.hint(h);
  };
  redraw();
}

async function result(id, day, res) {
  stop();
  const g = GAMES[id], board = res.practice ? [] : res.board || (await api('/api/leaderboard'))[id];
  const rank = board.findIndex(r => r.me) + 1;
  const text = `${g.title} #${cfg.num} | ${fmt(res.secs)} ${g.icon}\n🔥 ${me.streak}-day streak\nPlay with me: ${inviteLink()}`;
  $('#center').innerHTML = `<div class="card hero result">
    <div class="big pop">${g.icon}</div>
    <h2>${res.practice ? 'Practice solved!' : 'You solved it!'}</h2>
    <p class="time">${fmt(res.secs)}</p>
    ${res.practice ? '' : `<p class="muted">🔥 ${me.streak}-day streak${board.length > 1 ? ` · #${rank} of ${board.length} in your network` : ''}</p>
    <ol class="lb">${board.map(r => `<li class="${r.me ? 'me' : ''}">${avatar(r)}<span class="nm">${esc(r.name)}</span>${r.hints ? `<i>💡${r.hints}</i>` : ''}<b>${fmt(r.secs)}</b></li>`).join('')}</ol>
    <pre>${esc(text)}</pre>`}
    <div class="row center">${res.practice ? '' : '<button class="btn" id="share">Share</button>'}<button class="btn ghost" id="next">More puzzles</button></div>
  </div>`;
  $('#next').onclick = home;
  if (!res.practice) $('#share').onclick = () => share(text, 'Result copied');
}

async function share(text, copied) {
  try { await navigator.share({ text }); } catch (e) {
    if (e.name === 'AbortError') return;
    try { await navigator.clipboard.writeText(text); toast(copied); } catch { toast('Copy failed — select the text and copy it'); }
  }
}

// ---------- boards: build DOM once, then draw() only touches what changed ----------
const COLORS = ['#f9c7a8', '#b9d6f2', '#c8e6b0', '#f5e19a', '#d9c2ef', '#f2b8c6', '#a8e3d8', '#e0e0e0', '#ffd8a8', '#c5cae9', '#dcedc8'];
const cellAt = (grid, e, n) => {
  const r = grid.getBoundingClientRect(), x = Math.floor(((e.clientX - r.left) / r.width) * n), y = Math.floor(((e.clientY - r.top) / r.height) * n);
  return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
};
const setText = (c, t) => { if (c.textContent !== t) c.textContent = t; };
const gridHtml = (n, cls, cell) => `<div class="grid ${cls}" style="--n:${n}">${Array.from({ length: n * n }, (_, i) => cell(i)).join('')}</div>`;

const BOARDS = {
  queens(el, p, ctx) {
    const { n, regions } = p;
    let marks = Array(n * n).fill(0); // 0 empty, 1 ✕, 2 queen
    el.innerHTML = gridHtml(n, 'queens', i => {
      const bt = i >= n && regions[i - n] !== regions[i], bl = i % n && regions[i - 1] !== regions[i];
      return `<div class="c${bt ? ' bt' : ''}${bl ? ' bl' : ''}" style="background:${COLORS[regions[i]]}"></div>`;
    });
    const grid = el.firstChild, cells = [...grid.children];
    let down = -1, painting = false;
    grid.onpointerdown = e => { down = cellAt(grid, e, n); painting = false; if (down >= 0) { grid.setPointerCapture(e.pointerId); ctx.before(); } };
    grid.onpointermove = e => {
      if (down < 0) return;
      const i = cellAt(grid, e, n);
      if (i < 0 || (i === down && !painting)) return;
      if (!painting) { if (marks[down]) return (down = -1); painting = true; marks[down] = 1; }
      if (!marks[i]) marks[i] = 1;
      ctx.after();
    };
    grid.onpointerup = () => { if (down >= 0 && !painting) { marks[down] = (marks[down] + 1) % 3; ctx.after(); } down = -1; };
    const queens = () => marks.flatMap((m, i) => (m === 2 ? [i] : []));
    return {
      draw() {
        const { bad, win } = G.queensCheck(p, queens());
        cells.forEach((c, i) => { setText(c, ['', '✕', '♛'][marks[i]]); c.classList.toggle('q', marks[i] === 2); c.classList.toggle('bad', bad.has(i)); });
        return win;
      },
      get: () => marks, set: s => (marks = [...s]), reset: () => marks.fill(0), answer: queens,
      hint(h) { if (h.wrong != null) return ctx.flash(h.wrong); ctx.before(); marks[h.cell] = 2; ctx.after(); ctx.flash(h.cell); },
    };
  },

  tango(el, p, ctx) {
    let g = [...p.given];
    el.innerHTML = gridHtml(6, 'tango', i => `<div class="c${p.given[i] != null ? ' given' : ''}">${p.edges.filter(e => e.a === i)
      .map(e => `<i class="edge ${e.b === i + 1 ? 'r' : 'd'}">${e.eq ? '=' : '×'}</i>`).join('')}</div>`);
    const grid = el.firstChild, cells = [...grid.children];
    grid.onpointerdown = e => {
      const i = cellAt(grid, e, 6);
      if (i < 0 || p.given[i] != null) return;
      ctx.before(); g[i] = g[i] == null ? 0 : g[i] === 0 ? 1 : null; ctx.after();
    };
    return {
      draw() {
        const { bad, win } = G.tangoCheck(p, g);
        cells.forEach((c, i) => { const v = String(g[i] ?? ''); if (c.dataset.v !== v) c.dataset.v = v; c.classList.toggle('bad', bad.has(i)); });
        return win;
      },
      get: () => g, set: s => (g = s.map((v, i) => p.given[i] ?? v)), reset: () => (g = [...p.given]), answer: () => g,
      hint(h) { if (h.wrong != null) return ctx.flash(h.wrong); ctx.before(); g[h.cell] = h.value; ctx.after(); ctx.flash(h.cell); },
    };
  },

  sudoku(el, p, ctx) {
    let g = [...p.given], sel = g.indexOf(null);
    el.innerHTML = gridHtml(6, 'sudoku', i => `<div class="c${p.given[i] != null ? ' given' : ''}">${p.given[i] ?? ''}</div>`) +
      `<div class="pad">${[1, 2, 3, 4, 5, 6].map(n => `<button class="btn ghost" data-n="${n}">${n}</button>`).join('')}<button class="btn ghost" data-n="">⌫</button></div>`;
    const grid = el.firstChild, cells = [...grid.children];
    const put = v => { if (sel >= 0 && p.given[sel] == null) { ctx.before(); g[sel] = v; ctx.after(); } };
    grid.onpointerdown = e => { const i = cellAt(grid, e, 6); if (i >= 0) { sel = i; ctx.after(); } };
    el.querySelector('.pad').onclick = e => { const n = e.target.dataset.n; if (n != null) put(n ? +n : null); };
    onKey = e => {
      if (/^[1-6]$/.test(e.key)) put(+e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete') put(null);
      else if (e.key.startsWith('Arrow')) {
        const d = { ArrowUp: -6, ArrowDown: 6, ArrowLeft: -1, ArrowRight: 1 }[e.key];
        sel = Math.min(35, Math.max(0, sel + d)); e.preventDefault(); ctx.after();
      }
    };
    return {
      draw() {
        const { bad, win } = G.sudokuCheck(g);
        cells.forEach((c, i) => { setText(c, String(g[i] ?? '')); c.classList.toggle('bad', bad.has(i)); c.classList.toggle('sel', i === sel); });
        return win;
      },
      get: () => g, set: s => (g = s.map((v, i) => p.given[i] ?? v)), reset: () => (g = [...p.given]), answer: () => g,
      hint(h) { if (h.wrong != null) { sel = h.wrong; ctx.after(); return ctx.flash(h.wrong); } sel = h.cell; ctx.before(); g[h.cell] = h.value; ctx.after(); ctx.flash(h.cell); },
    };
  },

  zip(el, p, ctx) {
    const { n, nums, walls } = p, moves = G.zipMoves(p);
    const wr = new Set(walls.filter(([a, b]) => b === a + 1).map(([a]) => a)), wb = new Set(walls.filter(([a, b]) => b === a + n).map(([a]) => a));
    let path = [];
    el.innerHTML = gridHtml(n, 'zip', i => `<div class="c${wr.has(i) ? ' wr' : ''}${wb.has(i) ? ' wb' : ''}">${nums[i] ? `<b>${nums[i]}</b>` : ''}</div>`);
    const grid = el.firstChild, cells = [...grid.children];
    grid.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${n} ${n}"><polyline/></svg>`);
    const line = grid.querySelector('polyline');
    const enter = x => {
      const at = path.indexOf(x);
      if (at >= 0) { path.length = at + 1; return true; }
      if (path.length ? !moves(path.at(-1)).includes(x) : nums[x] !== 1) return false;
      if (nums[x] && nums[x] !== path.filter(c => nums[c]).length + 1) return false;
      path.push(x);
      return true;
    };
    // fast swipes can skip cells: walk toward the pointer one cell at a time along a row/column
    const reach = i => {
      for (let guard = 0; path.length && path.at(-1) !== i && guard < n; guard++) {
        const h = path.at(-1), dr = Math.sign(Math.floor(i / n) - Math.floor(h / n)), dc = Math.sign((i % n) - (h % n));
        if (dr && dc) return enter(i);
        if (!enter(h + dr * n + dc)) return;
      }
      if (!path.length) enter(i);
    };
    let dragging = false;
    grid.onpointerdown = e => { const i = cellAt(grid, e, n); if (i < 0) return; dragging = true; grid.setPointerCapture(e.pointerId); ctx.before(); reach(i); ctx.after(); };
    grid.onpointermove = e => { if (!dragging) return; const i = cellAt(grid, e, n); if (i >= 0 && i !== path.at(-1)) { reach(i); ctx.after(); } };
    grid.onpointerup = grid.onpointercancel = () => (dragging = false);
    let shown = '';
    return {
      draw() {
        const on = new Set(path);
        cells.forEach((c, i) => c.classList.toggle('on', on.has(i)));
        const pts = path.map(i => `${(i % n) + 0.5},${Math.floor(i / n) + 0.5}`).join(' ');
        if (pts !== shown) line.setAttribute('points', (shown = pts));
        return G.zipCheck(p, path).win;
      },
      get: () => path, set: s => (path = [...s]), reset: () => (path = []), answer: () => path,
      hint(h) {
        ctx.before();
        if (h.truncate != null) { path.length = h.truncate; ctx.after(); return ctx.flash(path.at(-1) ?? 0); }
        path.push(h.cell); ctx.after(); ctx.flash(h.cell);
      },
    };
  },
};

boot().catch(e => { $('#center').innerHTML = `<div class="card">Couldn’t load: ${esc(e.message)}</div>`; });
