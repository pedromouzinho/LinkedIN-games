import * as G from './games.js';

const $ = s => document.querySelector(s);
const LOCALE = 'en-GB'; // the site is in English whatever the browser's language
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
addEventListener('unhandledrejection', e => toast(e.reason?.message || 'Something went wrong')); // failed clicks say so

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
  queens: { title: 'Kings', icon: '👑', theme: '#6f4bb7',
    rules: 'One ♚ in each row, column and color region. Kings can’t touch, not even diagonally. Tap for ✕, tap again for ♚. Drag to mark ✕.',
    msgs: { row: 'Each row can only have one ♚.', col: 'Each column can only have one ♚.', region: 'Each color region can only have one ♚.', touch: 'Two ♚ can’t touch, not even diagonally.' } },
  tango: { title: 'Solo', icon: '🌗', theme: '#22314f',
    rules: 'Fill with suns and moons. Each row and column has 3 of each, never 3 in a row. = means same, × means opposite.',
    msgs: { three: 'No more than 2 ☀ or ☾ can be next to each other.', count: 'Each row and column has exactly 3 ☀ and 3 ☾.', sign: 'Cells joined by = must match, cells joined by × must differ.' } },
  zip: { title: 'Unzip', icon: '🔗', theme: '#d9541e', rules: 'Drag one path through the numbers in order. Fill every cell. Thick lines are walls.' },
  patches: { title: 'Holes', icon: '🕳️', theme: '#c2417a',
    rules: 'Fill the grid with rectangles. Each one covers exactly one clue and takes its shape (square, wide, tall or any); a number is its area. Drag to draw, tap a rectangle to remove it.',
    msgs: { clues: 'Each rectangle must cover exactly one clue.', shape: 'A rectangle must have the shape shown on its clue.', size: 'A rectangle’s area must match its number.' } },
  sudoku: { title: 'Maxi Sudoku', icon: '🔢', theme: '#2f8f5b',
    rules: 'Fill 1–6 so every row, column and 2×3 box has each number once. Turn on ✏️ Notes to pencil in candidates.',
    msgs: { row: 'Each row can only have one of each number.', col: 'Each column can only have one of each number.', box: 'Each 2×3 box can only have one of each number.' } },
};

// Football trivia: answers stay on the server, the board renders whatever view the server sends back.
Object.assign(GAMES, {
  whoami: { kind: 'f', title: 'Who Am I', icon: '🕵️', theme: '#1f6f50', search: true, skip: 'Skip · next club',
    rules: 'I played for these 4 clubs. Who am I? You start with one club; each miss or skip reveals the next. Four tries.' },
  clues: { kind: 'f', title: 'Clues', icon: '📊', theme: '#2b4c7e', search: true, skip: 'Skip · 2 more clues',
    rules: 'Guess the player from one club spell. Two clues are shown; each miss or skip reveals two more. Four tries.' },
  grid: { kind: 'f', title: 'Grid', icon: '⚽', theme: '#0f766e', search: true,
    rules: 'Fill the 3×3 grid: each square needs a player who fits its row and its column. 12 guesses; a player can only be used once.' },
  links: { kind: 'f', title: 'Links', icon: '🧶', theme: '#7c3aed',
    rules: 'Find four groups of four players with something in common. Pick four and submit. Four mistakes and it’s over.' },
  bingo: { kind: 'f', title: 'Bingo', icon: '🎯', theme: '#b45309',
    rules: 'Players appear one by one: tap a square they fit, or skip. Fill all 12 squares in 90 seconds. A wrong square loses that player.' },
  hotcold: { kind: 'f', title: 'Hot or Cold', icon: '🌡️', theme: '#c2410c', search: true,
    rules: 'Find the secret player in 10 guesses. Every guess shows what matches: nation, position, age, height, league and clubs in common.' },
  top10: { kind: 'f', title: 'Top 10', icon: '🔟', theme: '#334155', search: true,
    rules: 'Name the ten players on today’s list. Each row has a hint. Three wrong names and the round ends.' },
});

let cfg, me;
const inviteLink = () => `${location.origin}/?invite=${me.uid}`;

// ---------- shell ----------
async function boot() {
  cfg = await api('/api/config');
  $('#today').textContent = new Date(cfg.day + 'T12:00').toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' });
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
    <h2>Two-minute puzzles at work</h2>
    <p class="muted">Logic and football puzzles, new every day. Keep your streak and see how your colleagues did.</p>
    <div id="gbtn"></div>
    <p class="muted small">By continuing you agree to the <a href="/terms">Terms</a> and the <a href="/privacy">Privacy</a> page.</p>
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
    <button class="link small muted" id="delete">Delete account</button>
  </div>`;
  $('#invite').onclick = () => share(`Play Games@Work with me: ${inviteLink()}`, 'Invite link copied');
  $('#logout').onclick = async () => { await api('/api/logout', {}); boot(); };
  $('#delete').onclick = async () => {
    if (!(await ask('Delete your account?', 'This removes your profile, every result and your connections, right away. It can’t be undone.', 'Delete'))) return;
    await api('/api/delete-account', {});
    try { localStorage.clear(); } catch {} // unfinished moves kept on this device
    toast('Your account was deleted');
    boot();
  };
}

const lbRows = rows => rows.map(r => `<li class="${r.me ? 'me' : ''}${r.won === false ? ' lost' : ''}">${avatar(r)}<span class="nm">${esc(r.name)}</span>${r.hints ? `<i title="hints used">💡${r.hints}</i>` : ''}<b>${r.won === false ? '✗' : fmt(r.secs)}</b></li>`).join('');

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
  const ids = Object.keys(GAMES), logic = ids.filter(id => !GAMES[id].kind), ball = ids.filter(id => GAMES[id].kind === 'f');
  $('#center').innerHTML = `<div class="card"><h2>Today’s puzzles</h2><p class="muted">Win one every day to keep your streak.</p></div>
    <h3 class="sec">🧠 Logic</h3>${logic.map(tile).join('')}
    <h3 class="sec">⚽ Football</h3>${ball.map(tile).join('')}
    ${past.length ? `<div class="card"><h3>Archive</h3><p class="muted small">Practice past puzzles. They don’t count for the leaderboard.</p>
      ${past.map(day => `<div class="arch"><span>${new Date(day + 'T12:00').toLocaleDateString(LOCALE, { month: 'short', day: 'numeric' })}</span>
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
  $('#start').onclick = async () => {
    $('#start').disabled = true;
    const data = await api(`/api/puzzle?game=${id}&day=${day}`);
    (data.football ? playFootball : play)(id, data);
  };
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
      <h2>${res.won === false ? 'Practice over' : 'Practice solved!'}</h2><div class="res-inner"><span class="pill">${fmt(res.secs)}</span><span class="muted small">Archive puzzles don’t count for the leaderboard.</span></div></div>
      <div class="row center"><button class="btn ghost" id="next">More puzzles</button></div></div>`;
    return ($('#next').onclick = home);
  }
  if (!res.stats) res = await api(`/api/result?game=${id}`);
  const headline = !res.won ? 'Not this time' : res.pct == null ? 'First to finish today!' : res.pct >= 90 ? 'Lightning fast ⚡' : res.pct >= 60 ? 'Faster than most' : res.pct >= 30 ? 'Nicely done' : 'Solved!';
  const sub = !res.won ? 'A new one is waiting tomorrow.' : res.pct == null ? 'Nobody else has finished yet.' : `Faster than ${res.pct}% of today’s players`;
  const line = g.kind === 'f' ? res.share : fmt(res.secs);
  const text = `${g.title} #${cfg.num} ${g.icon}\n${line}${g.kind === 'f' ? ` · ${fmt(res.secs)}` : ''}${res.hints ? ` · 💡${res.hints}` : ''}\n🔥 ${res.streak}-day streak\nPlay with me: ${inviteLink()}`;
  const s = res.stats, others = Object.keys(GAMES).filter(k => k !== id && !me.played[k]);
  $('#center').innerHTML = `<div class="card result" style="--theme:${g.theme}">
    <div class="res-hero">
      <div class="big pop">${g.icon}</div>
      <div class="small">${g.title} #${cfg.num}</div>
      <h2>See you tomorrow.</h2>
      <div class="res-inner">
        <span class="pill">${res.won ? `Solved in ${fmt(res.secs)}` : 'Round over'}</span>${g.kind === 'f' && res.share ? `<pre class="share">${esc(res.share)}</pre>` : ''}
        <b>${headline}</b><span class="muted small">${sub}</span>
        <div class="row center"><button class="btn" id="share">Share</button><button class="btn ghost" id="copy">Copy</button></div>
      </div>
    </div>
    <h3>Your network</h3>
    ${res.board.length > 1 ? `<ol class="lb">${lbRows(res.board)}</ol>` : `<p class="muted">Invite connections to compare times here. <button class="link" id="inv">Invite</button></p>`}
    <div class="stats">${[[s.played, 'played'], [s.winPct + '%', 'win rate'], [s.best != null ? fmt(s.best) : '–', 'best time'], [s.maxStreak, 'max streak']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')}</div>
    <div class="week"><b>🔥 ${s.streak}-day ${g.title} streak</b><div>${res.week.map(w =>
      `<span class="${w.won ? 'on' : ''}" title="${w.day}">${new Date(w.day + 'T12:00').toLocaleDateString(LOCALE, { weekday: 'narrow' })}</span>`).join('')}</div></div>
    ${others.length ? `<h3>Play another</h3><div id="more">${others.map(tile).join('')}</div>` : ''}
    <div class="row center"><button class="btn ghost" id="next">All puzzles</button></div>
  </div>`;
  $('#next').onclick = home;
  $('#share').onclick = () => share(text, 'Result copied');
  $('#copy').onclick = () => copy(text, 'Result copied');
  $('#inv')?.addEventListener('click', () => share(`Play Games@Work with me: ${inviteLink()}`, 'Invite link copied'));
  $('#more')?.addEventListener('click', openTile);
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('Copy failed — select the text and copy it'); }
}
async function share(text, copied) {
  try { await navigator.share({ text }); } catch (e) { if (e.name !== 'AbortError') copy(text, copied); }
}

// ---------- football: shared frame, player search, one renderer per game ----------
const HOME_NATIONS = { 'GB-ENG': 'England', 'GB-SCT': 'Scotland', 'GB-WLS': 'Wales', 'GB-NIR': 'Northern Ireland' };
const regionName = new Intl.DisplayNames(LOCALE, { type: 'region' });
const nation = c => (c ? HOME_NATIONS[c] || regionName.of(c.slice(0, 2)) : '');
const flag = c => !c ? '' : c.startsWith('GB-')
  ? '🏴' + [...('gb' + c.slice(3).toLowerCase())].map(ch => String.fromCodePoint(0xe0000 + ch.charCodeAt(0))).join('') + '\u{e007f}'
  : [...c.slice(0, 2)].map(ch => String.fromCodePoint(0x1f1a5 + ch.charCodeAt(0))).join('');
const hue = s => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
const shirt = (colors = [], name = '') => {
  const [a, b] = colors.length ? colors.map(x => '#' + x) : [`hsl(${hue(name)} 55% 42%)`];
  return `<svg class="shirt" viewBox="0 0 40 40" aria-hidden="true"><g stroke="#0004" stroke-width="1">
    <path d="M11 9 16 5q4 3 8 0l5 4v28H11z" fill="${a}"/><path d="M11 9 4 13l3 7 4-3zM29 9l7 4-3 7-4-3z" fill="${b || a}"/></g></svg>`;
};
const catHtml = c => (c.t === 'club' ? `${shirt(c.colors, c.name)}<span>${esc(c.name)}</span>`
  : c.t === 'nat' ? `<span class="flag">${flag(c.id)}</span><span>${esc(c.name)}</span>` : `<span class="flag">🧤</span><span>${esc(c.name)}</span>`);
const norm = t => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

let playerList;
const players = () => (playerList ??= api('/api/players').then(list => list.map(([id, name, nat, club]) => ({ id, name, nat, club, key: norm(name) }))));

// Type-ahead over every player in the database; most famous first, accents ignored.
function searchBox(el, onPick) {
  el.innerHTML = `<div class="search"><input placeholder="Type a player’s name…" autocomplete="off" spellcheck="false" aria-label="Player name">
    <ul role="listbox"></ul></div>`;
  const input = el.querySelector('input'), list = el.querySelector('ul');
  let items = [], active = 0;
  const paint = () => (list.innerHTML = items.map((p, i) => `<li role="option" data-i="${i}" data-id="${p.id}" class="${i === active ? 'on' : ''}">
    <span class="flag">${flag(p.nat)}</span>${esc(p.name)}<span class="muted small born">${esc(p.club)}</span></li>`).join(''));
  const choose = i => { const p = items[i]; if (!p) return; items = []; paint(); input.value = ''; onPick(p); };
  input.oninput = async () => {
    const toks = norm(input.value.trim()).split(/\s+/).filter(Boolean);
    items = [];
    if (toks.join('').length >= 2) for (const p of await players()) if (toks.every(t => p.key.includes(t)) && items.push(p) >= 7) break;
    active = 0;
    paint();
  };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { choose(active); e.preventDefault(); }
  };
  list.onpointerdown = e => { const li = e.target.closest('li'); if (li) { e.preventDefault(); choose(+li.dataset.i); } };
  return input;
}

function playFootball(id, data) {
  stop();
  const g = GAMES[id], practice = !data.play, ui = FBOARDS[id], local = {};
  let view = data.view, busy = false, finished = data.done;
  $('#center').innerHTML = `<div class="card game f-${id}" style="--theme:${g.theme}">
    <div class="row"><button class="btn ghost small" id="back" aria-label="Back">←</button><b>${g.icon} ${g.title} ${practice ? data.day : '#' + data.num}</b><span id="timer">0:00</span></div>
    <div id="fboard"></div>
    <div id="fmsg" aria-live="polite"></div>
    <div id="fask"></div>
    <div class="row center tools">${g.skip ? `<button class="btn ghost small" id="skip">${g.skip}</button>` : ''}<button class="btn ghost small" id="giveup">Give up</button></div>
    <p class="muted small">${g.rules}</p>
  </div>`;
  $('#back').onclick = () => { stop(); home(); };
  const t0 = Date.now() - (data.elapsed || 0) * 1000, timer = $('#timer');
  const show = () => { timer.textContent = fmt(Math.floor((Date.now() - t0) / 1000)); ui.tick?.(local, (Date.now() - t0) / 1000, act); };
  if (!finished) { show(); tick = setInterval(show, 250); }

  const say = r => { if (r?.msg) { $('#fmsg').textContent = r.msg; $('#fmsg').className = r.ok ? 'ok' : r.neutral ? '' : 'no'; } };
  const draw = () => ui.render($('#fboard'), view, act, local);
  async function act(action) {
    if (busy || finished) return;
    busy = true;
    try {
      const r = await api('/api/move', { game: id, day: data.day, action });
      view = r.view;
      say(r.reply);
      local.choices = r.reply?.choices || null;
      local.pending = r.reply?.guess || null;
      draw();
      if (r.done) end(r);
    } catch (e) { say({ msg: e.message }); } finally { busy = false; }
  }
  function end(r) {
    finished = true;
    stop();
    $('#fask').innerHTML = '';
    $('#giveup')?.remove();
    $('#skip')?.remove();
    const res = practice ? { practice: true, secs: r.elapsed, won: r.won } : r.result;
    if (!practice) { me.played[id] = { secs: res.secs, won: res.won, score: res.score }; me.streak = res.streak; left(); right(); }
    $('#fmsg').insertAdjacentHTML('afterend', `<div class="row center"><button class="btn" id="seeres">See results →</button></div>`);
    $('#seeres').onclick = () => result(id, data.day, res);
  }
  if (g.search && !finished) searchBox($('#fask'), p => act({ guess: p.id }));
  if (g.search) $('#fask input')?.focus();
  $('#skip')?.addEventListener('click', () => act({ skip: true }));
  $('#giveup').onclick = async () => { if (await ask('Give up?', 'The answer will be revealed and today’s round ends.', 'Give up')) act({ giveUp: true }); };
  draw();
  if (finished) practice ? end({ elapsed: data.elapsed, won: data.won }) : result(id, data.day, {});
}

const yrs = (a, b) => (a === b || b === a + 1 ? `${a}` : `${a}–${b ?? 'now'}`);
const FBOARDS = {
  whoami: {
    render(el, v, act) {
      const slot = k => { const c = v.clubs[k];
        return c ? `<div class="club">${shirt(c.colors, c.name)}<b>${esc(c.name)}</b><span class="muted small">${yrs(c.from, c.to)}${c.more ? ' +' : ''}</span></div>`
          : `<div class="club empty"><b>${k + 1}</b></div>`; };
      el.innerHTML = `<div class="who">${[0, 1, 3, 2].map(slot).join('')}
        <div class="face">${v.answer ? `<span class="av big-av">${esc(v.answer.name[0])}</span><b>${esc(v.answer.name)}</b>` : '?'}</div></div>
        <p class="center muted">I played for these ${v.total} clubs. Who am I?</p>
        ${v.guesses.length ? `<p class="tries">${v.guesses.map(n => `<s>${esc(n || 'skip')}</s>`).join(' ')}</p>` : ''}`;
    },
  },

  clues: {
    render(el, v) {
      const label = { apps: 'Games', goals: 'Goals', height: 'Height', pos: 'Position', age: 'Age', caps: 'Caps', nat: 'Nation', club: 'Club' };
      const val = ({ k, v: x }) => (k === 'club' ? `${shirt(x.colors, x.name)}<b>${esc(x.name)}</b>` : k === 'nat' ? `<span class="flag">${flag(x)}</span><b>${esc(nation(x))}</b>`
        : `<b>${esc(k === 'height' ? `${x} cm` : x)}</b>`);
      el.innerHTML = `<div class="banner">${esc(v.banner.league)} · ${yrs(v.banner.from, v.banner.to)}</div>
        <div class="statgrid">${v.tiles.map(t => `<div class="stat on">${val(t)}<span>${label[t.k]}</span></div>`).join('')}
        ${v.hidden.map(k => `<div class="stat"><b>?</b><span>${label[k]}</span></div>`).join('')}</div>
        <div class="pills">${Array.from({ length: v.attempts }, (_, i) => `<i class="${i < v.used ? 'used' : ''}"></i>`).join('')}</div>
        ${v.answer ? `<p class="center reveal">It was <b>${esc(v.answer.name)}</b> ${flag(v.answer.nat)}</p>` : ''}
        ${v.guesses.length ? `<p class="tries">${v.guesses.map(n => `<s>${esc(n || 'skip')}</s>`).join(' ')}</p>` : ''}`;
    },
  },

  grid: {
    render(el, v, act, local) {
      const head = c => `<div class="hd">${catHtml(c)}</div>`;
      const cell = i => { const c = v.cells[i], pick = local.choices?.includes(i);
        return `<button class="sq${c ? (c.ok ? ' ok' : ' miss') : ''}${pick ? ' pick' : ''}" data-cell="${i}" ${pick ? '' : 'tabindex="-1"'}>${c ? esc(c.name) : pick ? 'Here?' : ''}</button>`; };
      el.innerHTML = `<div class="fgrid"><div class="hd corner"><b>${v.guessesLeft}</b><span class="small muted">guesses left</span></div>
        ${v.cats.slice(3).map(head).join('')}
        ${[0, 1, 2].map(r => head(v.cats[r]) + [0, 1, 2].map(c => cell(r * 3 + c)).join('')).join('')}</div>`;
      el.onclick = e => { const b = e.target.closest('[data-cell]'); if (b && local.choices?.includes(+b.dataset.cell)) act({ guess: local.pending, cell: +b.dataset.cell }); };
    },
  },

  links: {
    render(el, v, act, local) {
      local.sel ??= new Set();
      local.order ??= v.cards.map(c => c.id);
      const cards = local.order.map(id => v.cards.find(c => c.id === id)).filter(Boolean);
      el.innerHTML = `${v.solved.map(g => `<div class="group l${g.level}${g.found ? '' : ' missed'}"><b>${esc(g.title)}</b><span>${g.names.map(esc).join(', ')}</span></div>`).join('')}
        <div class="cards">${cards.map(c => `<button class="pcard${local.sel.has(c.id) ? ' sel' : ''}" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>
        ${cards.length ? `<div class="row center"><span class="muted small">Mistakes left: ${'●'.repeat(v.maxMistakes - v.mistakes)}${'○'.repeat(v.mistakes)}</span></div>
        <div class="row center tools"><button class="btn ghost small" id="shuf">Shuffle</button><button class="btn ghost small" id="desel">Deselect</button>
        <button class="btn small" id="submit" ${local.sel.size === 4 ? '' : 'disabled'}>Submit</button></div>` : ''}`;
      el.onclick = e => {
        const c = e.target.closest('[data-id]');
        if (c) { const id = c.dataset.id; local.sel.has(id) ? local.sel.delete(id) : local.sel.size < 4 && local.sel.add(id); return this.render(el, v, act, local); }
        if (e.target.id === 'desel') { local.sel.clear(); this.render(el, v, act, local); }
        if (e.target.id === 'shuf') { local.order = local.order.map(x => [Math.random(), x]).sort((a, b) => a[0] - b[0]).map(x => x[1]); this.render(el, v, act, local); }
        if (e.target.id === 'submit') { const pick = [...local.sel]; local.sel.clear(); act({ submit: pick }); }
      };
    },
  },

  bingo: {
    render(el, v, act, local) {
      local.end ??= Date.now() + v.remaining * 1000;
      el.innerHTML = `<div class="bingo-top"><div class="ring" id="ring">${Math.ceil(v.remaining)}</div>
        <div class="now">${v.current ? `<span class="muted small">Where does he fit?</span><b>${esc(v.current.name)}</b><span class="muted small">${v.left} players left</span>` : '<b>Done</b>'}</div>
        ${v.current ? '<button class="btn small" id="bskip">Skip</button>' : ''}</div>
        <div class="bingo">${v.cats.map((c, i) => `<button class="bq${v.cells[i] ? ' ok' : ''}${v.wrong === i ? ' wrong' : ''}" data-cell="${i}" ${v.cells[i] ? 'disabled' : ''}>
          ${v.cells[i] ? `<b>${esc(v.cells[i])}</b><span class="muted">${esc(c.name)}</span>` : catHtml(c)}</button>`).join('')}</div>`;
      el.onclick = e => {
        if (e.target.id === 'bskip') return act({ skip: true });
        const b = e.target.closest('[data-cell]');
        if (b && !b.disabled) act({ cell: +b.dataset.cell });
      };
    },
    tick(local, secs, act) {
      if (!local.end) return;
      const left = Math.max(0, Math.ceil((local.end - Date.now()) / 1000)), ring = $('#ring');
      if (ring) { ring.textContent = left; ring.classList.toggle('low', left <= 15); }
      if (left === 0 && !local.sent && Date.now() > local.end + 1500) { local.sent = true; act({ timeout: true }); }
    },
  },

  hotcold: {
    render(el, v) {
      const arrow = d => (d > 0 ? '↑' : d < 0 ? '↓' : '=');
      const chip = (ok, html, title) => `<span class="chip ${ok ? 'yes' : 'no'}" title="${title}">${html}</span>`;
      el.innerHTML = `${v.answer ? `<p class="center reveal">It was <b>${esc(v.answer.name)}</b> ${flag(v.answer.nat)}</p>` : ''}
        <p class="center muted small">${v.max - v.guesses.length} guesses left · ↑ / ↓: the secret player’s birth year or height is higher / lower</p>
        <div class="hc">${[...v.guesses].reverse().map(x => `<div class="guess">
          <div class="row"><b>${esc(x.name)}</b><span class="meter"><i style="width:${x.score}%"></i></span><b>${x.score}</b></div>
          <div class="chips">${chip(x.nat.ok, `${flag(x.nat.v)} ${esc(nation(x.nat.v))}`, 'Nation')}${chip(x.pos.ok, esc(x.pos.v), 'Position')}
            ${chip(x.born.dir === 0, `${x.born.v} ${arrow(x.born.dir)}`, 'Born')}${x.height.v ? chip(x.height.dir === 0, `${x.height.v} cm ${arrow(x.height.dir)}`, 'Height') : ''}
            ${chip(x.league.ok, esc(x.league.v), 'League of current club')}
            ${chip(x.shared.length > 0, x.shared.length ? `🤝 ${x.shared.map(esc).join(', ')}` : 'No clubs in common', 'Clubs in common')}</div>
        </div>`).join('')}</div>`;
    },
  },

  top10: {
    render(el, v) {
      el.innerHTML = `<h3 class="center">${esc(v.title)}</h3>
        <ol class="top">${v.rows.map(r => `<li class="${r.name ? (r.found ? 'found' : 'missed') : ''}"><span class="rk">${r.rank}</span>
          <span class="hint">${r.nat ? flag(r.nat) + ' ' : ''}${esc(r.hint)}</span><b>${r.name ? esc(r.name) : ''}</b><span class="v">${r.v ?? ''}</span></li>`).join('')}</ol>
        <p class="center muted small">Lives: ${'❤️'.repeat(v.lives)}${'🤍'.repeat(Math.max(0, 3 - v.lives))}${v.wrong.length ? ` · not on the list: ${v.wrong.map(esc).join(', ')}` : ''}</p>`;
    },
  },
};

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
        cells.forEach((c, i) => { setText(c, ['', '✕', '♚'][marks[i]]); c.classList.toggle('q', marks[i] === 2); c.classList.toggle('bad', bad.has(i)); });
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

// Patches: rectangles live in an overlay layer above the cells; colour comes from the clue they cover.
const PCOLORS = ['#e2423b', '#2aa198', '#d4a017', '#8a5cf6', '#e86fa8', '#3d7fe0', '#f08a24', '#5bb85b', '#8d6e63', '#16a3c4', '#c0457a', '#7c8b2e'];
Object.assign(BOARDS, {
  patches(el, p, ctx) {
    const { n, clues } = p, clueAt = new Map(clues.map((c, k) => [c.cell, k]));
    const badge = (c, k) => `<span class="clue" style="--pc:${PCOLORS[k % PCOLORS.length]}"><i class="shape ${c.shape}"></i>${c.size ?? ''}</span>`;
    let rects = [];
    el.innerHTML = gridHtml(n, 'patches', i => `<div class="c">${clueAt.has(i) ? badge(clues[clueAt.get(i)], clueAt.get(i)) : ''}</div>`);
    const grid = el.firstChild;
    grid.insertAdjacentHTML('beforeend', '<div class="layer"></div><div class="patch ghost" hidden></div>');
    const layer = grid.querySelector('.layer'), ghost = grid.querySelector('.ghost');
    const box = (a, b) => { const [r1, c1, r2, c2] = [Math.floor(a / n), a % n, Math.floor(b / n), b % n];
      return [Math.min(r1, r2), Math.min(c1, c2), Math.abs(r1 - r2) + 1, Math.abs(c1 - c2) + 1]; };
    const place = (el, [t, l, h, w]) => Object.assign(el.style, { top: `${(t / n) * 100}%`, left: `${(l / n) * 100}%`, height: `${(h / n) * 100}%`, width: `${(w / n) * 100}%` });
    const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
    const add = rect => { rects = rects.filter(r => !overlaps(r, rect)); rects.push(rect); };
    let start = -1;
    grid.onpointerdown = e => { start = cellAt(grid, e, n); if (start < 0) return; grid.setPointerCapture(e.pointerId); ghost.hidden = false; place(ghost, box(start, start)); };
    grid.onpointermove = e => { if (start < 0) return; const i = cellAt(grid, e, n); if (i >= 0) place(ghost, box(start, i)); };
    grid.onpointerup = e => {
      if (start < 0) return;
      const end = cellAt(grid, e, n), rect = box(start, end < 0 ? start : end), at = rects.findIndex(r => overlaps(r, rect));
      ghost.hidden = true;
      ctx.before();
      if (end === start && at >= 0) rects.splice(at, 1); // tap on a patch removes it
      else add(rect);
      start = -1;
      ctx.after();
    };
    grid.onpointercancel = () => { start = -1; ghost.hidden = true; };
    let shown = '';
    return {
      draw() {
        const rules = G.patchesRules(p, rects), bad = new Set(rules.map(v => v.area[0]));
        const key = JSON.stringify(rects) + [...bad];
        if (key !== shown) {
          shown = key;
          layer.innerHTML = rects.map(r => {
            const cells = G.rectCells(r, n), k = clues.findIndex(c => cells.includes(c.cell));
            return `<div class="patch${bad.has(cells[0]) ? ' bad' : ''}" style="--pc:${k >= 0 ? PCOLORS[k % PCOLORS.length] : '#9e9e9e'};--d:${(r[0] + r[1]) * 45}ms"></div>`;
          }).join('');
          [...layer.children].forEach((d, k) => place(d, rects[k]));
        }
        return { win: G.patchesCheck(p, rects).win, rules };
      },
      get: () => rects, set: s => (rects = s.map(r => [...r])), reset: () => (rects = []), answer: () => rects,
      hint(h) { if (h.wrong != null) return ctx.flash(h.wrong); if (h.rect) { ctx.before(); add(h.rect); ctx.after(); ctx.flash(h.rect[0] * n + h.rect[1]); } },
    };
  },
});

boot().catch(e => { $('#center').innerHTML = `<div class="card">Couldn’t load: ${esc(e.message)}</div>`; });
