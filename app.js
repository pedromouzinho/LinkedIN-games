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

// Native <dialog> confirm: resolves true when the person picks the action.
function ask(title, text, action) {
  const d = document.createElement('dialog');
  d.innerHTML = `<h3>${esc(title)}</h3><p>${esc(text)}</p>
    <form method="dialog" class="row center"><button class="btn ghost" value="">Cancel</button><button class="btn" value="ok">${esc(action)}</button></form>`;
  document.body.append(d);
  d.showModal();
  return new Promise(res => d.addEventListener('close', () => { res(d.returnValue === 'ok'); d.remove(); }));
}

const GAMES = {
  queens: { title: 'Queens', icon: '👑', theme: '#6f4bb7',
    rules: 'One ♛ in each row, column and color region. Queens can’t touch, not even diagonally. Tap for ✕, tap again for ♛. Drag to mark ✕.',
    msgs: { row: 'Each row can only have one ♛.', col: 'Each column can only have one ♛.', region: 'Each color region can only have one ♛.', touch: 'Two ♛ can’t touch, not even diagonally.' } },
  tango: { title: 'Tango', icon: '🌗', theme: '#22314f',
    rules: 'Fill with suns and moons. Each row and column has 3 of each, never 3 in a row. = means same, × means opposite.',
    msgs: { three: 'No more than 2 ☀ or ☾ can be next to each other.', count: 'Each row and column has exactly 3 ☀ and 3 ☾.', sign: 'Cells joined by = must match, cells joined by × must differ.' } },
  zip: { title: 'Zip', icon: '🔗', theme: '#d9541e', rules: 'Drag one path through the numbers in order. Fill every cell. Thick lines are walls.' },
  sudoku: { title: 'Mini Sudoku', icon: '🔢', theme: '#2f8f5b',
    rules: 'Fill 1–6 so every row, column and 2×3 box has each number once. Turn on ✏️ Notes to pencil in candidates.',
    msgs: { row: 'Each row can only have one of each number.', col: 'Each column can only have one of each number.', box: 'Each 2×3 box can only have one of each number.' } },
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
    <p class="muted">Quick puzzles, new every day. Keep your streak and see how your connections did.</p>
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

const lbRows = rows => rows.map(r => `<li class="${r.me ? 'me' : ''}">${avatar(r)}<span class="nm">${esc(r.name)}</span>${r.hints ? `<i title="hints used">💡${r.hints}</i>` : ''}<b>${fmt(r.secs)}</b></li>`).join('');

async function right() {
  const board = await api('/api/leaderboard');
  const rows = Object.entries(GAMES).filter(([id]) => board[id]?.length).map(([id, g]) => `<h4>${g.icon} ${g.title}</h4><ol class="lb">${lbRows(board[id])}</ol>`).join('');
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

const status = id => { const p = me.played[id]; return p ? (p.won ? '✓ ' + fmt(p.secs) : '✗ Tomorrow') : 'Play'; };
const tile = id => `<button class="card tile" data-game="${id}" style="--theme:${GAMES[id].theme}">
  <span class="icon">${GAMES[id].icon}</span><span><b>${GAMES[id].title}</b><br><span class="muted">#${cfg.num}</span></span>
  <span class="status">${status(id)}</span></button>`;
const openTile = e => { const b = e.target.closest('[data-game]'); if (b) intro(b.dataset.game, b.dataset.day || cfg.day); };

function home() {
  stop();
  const past = [];
  for (let d = new Date(cfg.day + 'T12:00Z'); ; ) {
    d.setUTCDate(d.getUTCDate() - 1);
    const day = d.toISOString().slice(0, 10);
    if (day < cfg.launch || past.length >= 14) break;
    past.push(day);
  }
  $('#center').innerHTML = `<div class="card"><h2>Today’s puzzles</h2><p class="muted">Solve one every day to keep your streak.</p></div>
    ${Object.keys(GAMES).map(tile).join('')}
    ${past.length ? `<div class="card"><h3>Archive</h3><p class="muted small">Practice past puzzles. They don’t count for the leaderboard.</p>
      ${past.map(day => `<div class="arch"><span>${new Date(day + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        ${Object.entries(GAMES).map(([id, g]) => `<button class="btn ghost small" data-game="${id}" data-day="${day}" title="${g.title}">${g.icon}</button>`).join('')}</div>`).join('')}</div>` : ''}`;
  $('#center').onclick = openTile;
}

function intro(id, day) {
  const g = GAMES[id], practice = day !== cfg.day;
  if (!practice && me.played[id]) return result(id, day, {});
  $('#center').onclick = null;
  $('#center').innerHTML = `<div class="card hero" style="--theme:${g.theme}">
    <div class="big">${g.icon}</div><h2>${g.title}</h2>
    <p class="muted">${practice ? `Archive · ${day}` : `#${cfg.num}`}</p>
    <p>${g.rules}</p>
    <div class="row center"><button class="btn ghost" id="back">Back</button><button class="btn" id="start">${practice ? 'Practice' : 'Start'}</button></div>
    ${practice ? '' : '<p class="muted small">The timer starts when you press Start and keeps running if you leave.</p>'}
  </div>`;
  $('#back').onclick = home;
  $('#start').onclick = async () => { $('#start').disabled = true; play(id, await api(`/api/puzzle?game=${id}&day=${day}`)); };
}

// ---------- the game screen: shared toolbar, history, timer, rule messages; per-game boards below ----------
function play(id, data) {
  stop();
  const g = GAMES[id], p = data.puzzle, practice = !data.play, key = `gg:${data.day}:${id}`;
  $('#center').innerHTML = `<div class="card game" style="--theme:${g.theme}">
    <div class="row"><button class="btn ghost small" id="back" aria-label="Back">←</button><b>${g.icon} ${g.title} ${practice ? data.day : '#' + data.num}</b><span id="timer">0:00</span></div>
    <div id="board"></div>
    <div class="row center tools"><button class="btn ghost small" id="undo">↶ Undo</button><button class="btn ghost small" id="clear">Clear</button><button class="btn ghost small" id="hint">💡 Hint</button></div>
    <div id="errs" aria-live="polite"></div>
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
    flash: i => { const c = cells[i]; c?.classList.remove('flash'); void c?.offsetWidth; c?.classList.add('flash'); },
  };
  const game = BOARDS[id]($('#board'), p, ctx);
  const cells = [...$('#board .grid').querySelectorAll(':scope > .c')], n = Math.round(Math.sqrt(cells.length));
  cells.forEach((c, i) => c.style.setProperty('--d', `${(Math.floor(i / n) + (i % n)) * 45}ms`)); // win wave delay
  const saved = store.get(key);
  if (saved) game.set(saved);

  // LinkedIn-style feedback: hatch every row/column/region that breaks a rule, one message per broken rule.
  let errHtml = '';
  function showRules(rules) {
    const area = new Set(rules.flatMap(v => v.area));
    cells.forEach((c, i) => c.classList.toggle('hatch', area.has(i)));
    const html = [...new Set(rules.map(v => v.rule))].map(k => `<div class="err">Oops. ${g.msgs[k]} <button class="link" data-rule="${k}">Show me</button></div>`).join('');
    if (html !== errHtml) $('#errs').innerHTML = errHtml = html;
    $('#errs').onclick = e => { const k = e.target.dataset.rule; if (k) rules.filter(v => v.rule === k).flatMap(v => v.area).forEach(ctx.flash); };
  }

  async function redraw() {
    const { win, rules = [] } = game.draw();
    showRules(rules);
    if (!win || solved) return;
    solved = true;
    stop();
    $('#board').classList.add('won');
    const res = await api('/api/solve', { game: id, day: data.day, answer: game.answer() }).catch(e => ({ error: e.message }));
    if (!res.win) { solved = false; $('#board').classList.remove('won'); return toast(res.error || 'Not quite — check the rules'); }
    if (!practice) { me.played[id] = { secs: res.secs, won: true }; me.streak = res.streak; left(); right(); }
    setTimeout(() => result(id, data.day, practice ? { practice: true, secs: Math.floor((Date.now() - t0) / 1000) } : res), 1300);
  }
  $('#undo').onclick = () => { if (undo.length) { game.set(JSON.parse(undo.pop())); store.set(key, game.get()); redraw(); } };
  $('#clear').onclick = async () => {
    if (await ask('Clear the board?', 'This removes all your moves. The timer keeps running.', 'Clear')) { ctx.before(); game.reset(); ctx.after(); }
  };
  $('#hint').onclick = async () => {
    const h = await api('/api/hint', { game: id, day: data.day, state: game.answer() });
    if (h.wrong != null || h.truncate != null) toast('Found a mistake');
    game.hint(h);
  };
  redraw();
}

// ---------- results: one template for every game, themed by the game's colour ----------
async function result(id, day, res) {
  stop();
  const g = GAMES[id];
  $('#center').onclick = null;
  if (res.practice) {
    $('#center').innerHTML = `<div class="card result" style="--theme:${g.theme}"><div class="res-hero"><div class="big pop">${g.icon}</div>
      <h2>Practice solved!</h2><div class="res-inner"><span class="pill">${fmt(res.secs)}</span><span class="muted small">Archive puzzles don’t count for the leaderboard.</span></div></div>
      <div class="row center"><button class="btn ghost" id="next">More puzzles</button></div></div>`;
    return ($('#next').onclick = home);
  }
  if (!res.stats) res = await api(`/api/result?game=${id}`);
  const headline = res.pct == null ? 'First to finish today!' : res.pct >= 90 ? 'Lightning fast ⚡' : res.pct >= 60 ? 'Faster than most' : res.pct >= 30 ? 'Nicely done' : 'Solved!';
  const sub = res.pct == null ? 'Nobody else has finished yet.' : `Faster than ${res.pct}% of today’s players`;
  const text = `${g.title} #${cfg.num} | ${fmt(res.secs)} ${g.icon}${res.hints ? ` · 💡${res.hints}` : ''}\n🔥 ${res.streak}-day streak\nPlay with me: ${inviteLink()}`;
  const s = res.stats, others = Object.keys(GAMES).filter(k => k !== id && !me.played[k]);
  $('#center').innerHTML = `<div class="card result" style="--theme:${g.theme}">
    <div class="res-hero">
      <div class="big pop">${g.icon}</div>
      <div class="small">${g.title} #${cfg.num}</div>
      <h2>See you tomorrow.</h2>
      <div class="res-inner">
        <span class="pill">Solved in ${fmt(res.secs)}</span>
        <b>${headline}</b><span class="muted small">${sub}</span>
        <div class="row center"><button class="btn" id="share">Share</button><button class="btn ghost" id="copy">Copy</button></div>
      </div>
    </div>
    <h3>Your network</h3>
    ${res.board.length > 1 ? `<ol class="lb">${lbRows(res.board)}</ol>` : `<p class="muted">Invite connections to compare times here. <button class="link" id="inv">Invite</button></p>`}
    <div class="stats">${[[s.played, 'played'], [s.winPct + '%', 'win rate'], [s.best != null ? fmt(s.best) : '–', 'best time'], [s.maxStreak, 'max streak']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <div class="week"><b>🔥 ${s.streak}-day ${g.title} streak</b><div>${res.week.map(w =>
      `<span class="${w.won ? 'on' : ''}" title="${w.day}">${new Date(w.day + 'T12:00').toLocaleDateString(undefined, { weekday: 'narrow' })}</span>`).join('')}</div></div>
    ${others.length ? `<h3>Play another</h3><div id="more">${others.map(tile).join('')}</div>` : ''}
    <div class="row center"><button class="btn ghost" id="next">All puzzles</button></div>
  </div>`;
  $('#next').onclick = home;
  $('#share').onclick = () => share(text, 'Result copied');
  $('#copy').onclick = () => copy(text, 'Result copied');
  $('#inv')?.addEventListener('click', () => share(`Play Grid Games with me: ${inviteLink()}`, 'Invite link copied'));
  $('#more')?.addEventListener('click', openTile);
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('Copy failed — select the text and copy it'); }
}
async function share(text, copied) {
  try { await navigator.share({ text }); } catch (e) { if (e.name !== 'AbortError') copy(text, copied); }
}

// ---------- boards: build DOM once, then draw() only touches what changed; draw() -> { win, rules } ----------
const COLORS = ['#f9c7a8', '#b9d6f2', '#c8e6b0', '#f5e19a', '#d9c2ef', '#f2b8c6', '#a8e3d8', '#e0e0e0', '#ffd8a8', '#c5cae9', '#dcedc8'];
const cellAt = (grid, e, n) => {
  const r = grid.getBoundingClientRect(), x = Math.floor(((e.clientX - r.left) / r.width) * n), y = Math.floor(((e.clientY - r.top) / r.height) * n);
  return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
};
const setText = (c, t) => { if (c.textContent !== t) c.textContent = t; };
const setHtml = (c, h) => { if (c.dataset.h !== h) { c.innerHTML = h; c.dataset.h = h; } };
const gridHtml = (n, cls, cell) => `<div class="grid ${cls}" style="--n:${n}">${Array.from({ length: n * n }, (_, i) => cell(i)).join('')}</div>`;

const BOARDS = {
  queens(el, p, ctx) {
    const { n, regions } = p;
    let marks = Array(n * n).fill(0); // 0 empty, 1 ✕, 2 queen
    el.innerHTML = gridHtml(n, 'queens', i => {
      const bt = i >= n && regions[i - n] !== regions[i], bl = i % n && regions[i - 1] !== regions[i];
      return `<div class="c${bt ? ' bt' : ''}${bl ? ' bl' : ''}" style="background-color:${COLORS[regions[i]]}"></div>`;
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
        const rules = G.queensRules(p, queens()), bad = new Set(rules.flatMap(v => v.bad));
        cells.forEach((c, i) => { setText(c, ['', '✕', '♛'][marks[i]]); c.classList.toggle('q', marks[i] === 2); c.classList.toggle('bad', bad.has(i)); });
        return { win: G.queensCheck(p, queens()).win, rules };
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
        const rules = G.tangoRules(p, g), bad = new Set(rules.flatMap(v => v.bad));
        cells.forEach((c, i) => { const v = String(g[i] ?? ''); if (c.dataset.v !== v) c.dataset.v = v; c.classList.toggle('bad', bad.has(i)); });
        return { win: G.tangoCheck(p, g).win, rules };
      },
      get: () => g, set: s => (g = s.map((v, i) => p.given[i] ?? v)), reset: () => (g = [...p.given]), answer: () => g,
      hint(h) { if (h.wrong != null) return ctx.flash(h.wrong); ctx.before(); g[h.cell] = h.value; ctx.after(); ctx.flash(h.cell); },
    };
  },

  sudoku(el, p, ctx) {
    let g = [...p.given], notes = Array(36).fill(0), sel = g.indexOf(null), noting = false; // notes: bitmask of pencilled digits
    el.innerHTML = gridHtml(6, 'sudoku', i => `<div class="c${p.given[i] != null ? ' given' : ''}"></div>`) +
      `<div class="pad">${[1, 2, 3, 4, 5, 6].map(d => `<button class="btn ghost" data-n="${d}">${d}</button>`).join('')}
      <button class="btn ghost" data-n="" aria-label="Erase">⌫</button><button class="btn ghost" id="notes" aria-pressed="false">✏️ Notes</button></div>`;
    const grid = el.firstChild, cells = [...grid.children], keys = [...el.querySelectorAll('[data-n]')], notesBtn = el.querySelector('#notes');
    const toggleNotes = () => { noting = !noting; notesBtn.setAttribute('aria-pressed', noting); };
    const put = v => {
      if (sel < 0 || p.given[sel] != null) return;
      ctx.before();
      if (noting && v) { if (g[sel] == null) notes[sel] ^= 1 << v; }
      else { g[sel] = v; notes[sel] = 0; if (v) G.sudokuPeers(sel).forEach(x => (notes[x] &= ~(1 << v))); }
      ctx.after();
    };
    grid.onpointerdown = e => { const i = cellAt(grid, e, 6); if (i >= 0) { sel = i; ctx.after(); } };
    el.querySelector('.pad').onclick = e => { const b = e.target.closest('button'); if (b === notesBtn) toggleNotes(); else if (b?.dataset.n != null) put(b.dataset.n ? +b.dataset.n : null); };
    onKey = e => {
      if (/^[1-6]$/.test(e.key)) put(+e.key);
      else if (e.key === 'Backspace' || e.key === 'Delete') put(null);
      else if (e.key === 'n') toggleNotes();
      else if (e.key.startsWith('Arrow')) {
        const d = { ArrowUp: -6, ArrowDown: 6, ArrowLeft: -1, ArrowRight: 1 }[e.key];
        sel = Math.min(35, Math.max(0, sel + d)); e.preventDefault(); ctx.after();
      }
    };
    return {
      draw() {
        const rules = G.sudokuRules(g), bad = new Set(rules.flatMap(v => v.bad)), hl = new Set(sel >= 0 ? G.sudokuPeers(sel) : []);
        cells.forEach((c, i) => {
          setHtml(c, g[i] != null ? String(g[i]) : notes[i] ? `<span class="notes">${[1, 2, 3, 4, 5, 6].map(d => `<i>${notes[i] & (1 << d) ? d : ''}</i>`).join('')}</span>` : '');
          c.classList.toggle('bad', bad.has(i)); c.classList.toggle('sel', i === sel); c.classList.toggle('hl', hl.has(i));
        });
        keys.forEach(k => { if (k.dataset.n) k.disabled = g.filter(v => v === +k.dataset.n).length >= 6; }); // digit used up
        return { win: G.sudokuCheck(g).win, rules };
      },
      get: () => ({ g, notes }),
      set: s => { g = (Array.isArray(s) ? s : s.g).map((v, i) => p.given[i] ?? v); notes = s.notes || Array(36).fill(0); },
      reset: () => { g = [...p.given]; notes = Array(36).fill(0); }, answer: () => g,
      hint(h) { if (h.wrong != null) { sel = h.wrong; ctx.after(); return ctx.flash(h.wrong); } sel = h.cell; ctx.before(); g[h.cell] = h.value; notes[h.cell] = 0; ctx.after(); ctx.flash(h.cell); },
    };
  },

  zip(el, p, ctx) {
    const { n, nums, walls } = p, moves = G.zipMoves(p);
    const wr = new Set(walls.filter(([a, b]) => b === a + 1).map(([a]) => a)), wb = new Set(walls.filter(([a, b]) => b === a + n).map(([a]) => a));
    let path = [];
    el.innerHTML = gridHtml(n, 'zip', i => `<div class="c${wr.has(i) ? ' wr' : ''}${wb.has(i) ? ' wb' : ''}">${nums[i] ? `<b>${nums[i]}</b>` : ''}</div>`);
    const grid = el.firstChild, cells = [...grid.children];
    grid.insertAdjacentHTML('beforeend', `<svg viewBox="0 0 ${n} ${n}"><g></g></svg>`);
    const band = grid.querySelector('svg g');
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
    // wide band whose colour runs red -> orange along the path, one segment per step
    const xy = i => [(i % n) + 0.5, Math.floor(i / n) + 0.5];
    const hue = k => `hsl(${(350 + (45 * k) / (n * n - 1)) % 360} 82% 54%)`;
    let shown = '';
    return {
      draw() {
        const key = path.join();
        if (key !== shown) {
          shown = key;
          band.innerHTML = path.length === 1 ? `<circle cx="${xy(path[0])[0]}" cy="${xy(path[0])[1]}" r=".28" fill="${hue(0)}"/>`
            : path.slice(1).map((x, k) => { const [x1, y1] = xy(path[k]), [x2, y2] = xy(x); return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hue(k)}"/>`; }).join('');
        }
        const on = new Set(path);
        cells.forEach((c, i) => c.classList.toggle('on', on.has(i)));
        return { win: G.zipCheck(p, path).win };
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
