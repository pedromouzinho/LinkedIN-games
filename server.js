// HTTP server: static files + JSON API. Puzzles and their solutions live only here; the browser gets
// the puzzle without the solution, the server times every play and validates every answer.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import * as G from './games.js';
import { FOOTBALL as F, PLAYER_INDEX } from './football.js';

const { PORT = 8080, GOOGLE_CLIENT_ID = '', DEV_LOGIN, K_SERVICE, CONTACT_EMAIL = '', OPERATOR_NAME = 'the site operator' } = process.env;
if (DEV_LOGIN && K_SERVICE) throw new Error('DEV_LOGIN must never be enabled on Cloud Run');
const SECRET = process.env.SECRET || (DEV_LOGIN ? 'dev-secret' : null);
if (!SECRET) throw new Error('Set SECRET (a long random string) — it signs sessions and seeds puzzles');

const TZ = 'Europe/Lisbon', LAUNCH = '2026-10-01';
// On Cloud Run the project comes from the metadata server; the demo id is only for the local emulator.
const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || (process.env.FIRESTORE_EMULATOR_HOST ? 'demo-grid-games' : undefined),
  databaseId: process.env.FIRESTORE_DATABASE || '(default)', ignoreUndefinedProperties: true });
const google = new OAuth2Client();
const GAMES = [...Object.keys(G.GENERATORS), ...Object.keys(F)];
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/games.js': 'games.js', '/style.css': 'style.css', '/privacy': 'privacy.html', '/terms': 'terms.html',
  '/icon.svg': 'icon.svg', '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/og.jpg': 'og.jpg', '/manifest.webmanifest': 'manifest.webmanifest' };
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', jpg: 'image/jpeg', webmanifest: 'application/manifest+json' };
const escHtml = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dayNum = day => Math.round((Date.parse(day) - Date.parse('2024-01-01')) / 864e5);
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest();

// ---------- sessions: stateless signed cookie "uid.expiry.sig" ----------
// Named __session because Firebase Hosting, in front of Cloud Run, drops every other cookie.
const COOKIE = '__session';
const sign = (uid, exp) => hmac(`session:${uid}.${exp}`).toString('base64url');
const sessionCookie = (uid, secure) => {
  const exp = Date.now() + 30 * 864e5;
  return `${COOKIE}=${uid}.${exp}.${sign(uid, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}`;
};
function currentUid(req) {
  const m = /(?:^|;\s*)__session=([\w-]+)\.(\d+)\.([\w-]+)/.exec(req.headers.cookie || '');
  if (!m || +m[2] < Date.now()) return null;
  const good = Buffer.from(sign(m[1], m[2])), got = Buffer.from(m[3]);
  return good.length === got.length && crypto.timingSafeEqual(good, got) ? m[1] : null;
}

// ---------- puzzles: generated once per day+game, stored so every instance and deploy serves the same one ----------
const cache = new Map();
async function puzzle(day, game) {
  const key = `${day}_${game}`;
  if (!cache.has(key)) cache.set(key, (async () => {
    const ref = db.doc(`puzzles/${key}`);
    const snap = await ref.get();
    if (snap.exists) return JSON.parse(snap.get('json'));
    const p = (G.GENERATORS[game] || F[game].gen)(G.rng(hmac(`puzzle:${key}`).readInt32LE(0)));
    await ref.create({ json: JSON.stringify(p) }).catch(() => {}); // another instance won the race: use theirs
    return JSON.parse((await ref.get()).get('json'));
  })().catch(e => { cache.delete(key); throw e; }));
  return cache.get(key);
}
const publicPuzzle = ({ solution, score, ...p }) => p;

const list = a => (Array.isArray(a) ? a : []);
const grid = (p, a) => Array.from({ length: 36 }, (_, i) => p.given[i] ?? list(a)[i] ?? null); // givens can't be overridden
const checkers = {
  queens: (p, a) => G.queensCheck(p, list(a)),
  tango: (p, a) => G.tangoCheck(p, grid(p, a)),
  sudoku: (p, a) => G.sudokuCheck(grid(p, a)),
  zip: (p, a) => G.zipCheck(p, list(a)),
  patches: (p, a) => G.patchesCheck(p, a),
};

// Hint: first mistake if any, otherwise one correct move.
function hint(game, p, a) {
  a = list(a);
  const sol = p.solution;
  if (game === 'zip') {
    const ok = a.findIndex((x, i) => x !== sol[i]);
    return ok >= 0 ? { truncate: ok } : { cell: sol[a.length] };
  }
  if (game === 'patches') {
    const key = r => JSON.stringify(r), sol = new Set(p.solution.map(key)), placed = new Set(a.map(key));
    const wrong = a.find(r => !sol.has(key(r)));
    if (wrong) return { wrong: Array.isArray(wrong) && Number.isInteger(wrong[0]) && Number.isInteger(wrong[1]) ? wrong[0] * p.n + wrong[1] : 0 };
    return { rect: p.solution.find(r => !placed.has(key(r))) };
  }
  if (game === 'queens') {
    const wrong = a.find(x => !sol.includes(x));
    return wrong != null ? { wrong } : { cell: sol.find(x => !a.includes(x)) };
  }
  const g = grid(p, a), wrong = g.findIndex((v, i) => v != null && v !== sol[i]);
  if (wrong >= 0) return { wrong };
  const step = game === 'tango' ? G.tangoStep(g, p.edges) : G.sudokuStep(g);
  const cell = step ? step.cell : g.findIndex(v => v == null);
  return { cell, value: sol[cell] };
}

// ---------- users, plays, network ----------
const userDoc = uid => db.doc(`users/${uid}`);
const playRef = (day, game, uid) => db.doc(`plays/${day}_${game}_${uid}`);
const brief = (uid, u) => ({ uid, name: u?.name || '?', picture: u?.picture || '' });

const shift = (day, n) => new Date(Date.parse(day) + n * 864e5).toISOString().slice(0, 10);

// Running totals live on the user doc, so every page costs a handful of reads however long someone has played:
// stats.<game> = { played, wins, best, cur, max, last, recent }, streak = { cur, max, last }, today = { day, results }.
const live = s => (s && (s.last === today() || s.last === shift(today(), -1)) ? s.cur : 0); // a streak survives until a day is missed
function bump(s = {}, day, won, secs) {
  const n = { played: (s.played || 0) + 1, wins: (s.wins || 0) + (won ? 1 : 0), best: s.best ?? null, cur: s.cur || 0, max: s.max || 0, last: s.last ?? null, recent: s.recent || [] };
  if (!won) return n;
  if (n.last !== day) n.cur = n.last === shift(day, -1) ? n.cur + 1 : 1;
  return { ...n, best: n.best == null ? secs : Math.min(n.best, secs), max: Math.max(n.max, n.cur), last: day,
    recent: [...n.recent.filter(d => d >= shift(day, -13) && d !== day), day] };
}
// Inside the transaction that finishes today's play (the user doc must have been read in it first).
function record(tx, uid, user, day, game, result) {
  const g = bump(user.stats?.[game], day, result.won, result.secs), { cur, max, last } = bump(user.streak, day, result.won, result.secs);
  const results = user.today?.day === day ? user.today.results : {};
  tx.update(userDoc(uid), { [`stats.${game}`]: g, streak: { cur, max, last }, today: { day, results: { ...results, [game]: result } } });
}

// Today's times of everyone who finished a game, for "faster than X%". Cached a minute per instance.
const fieldCache = new Map();
async function field(day, game) {
  const key = `${day}_${game}`, hit = fieldCache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.list;
  // ponytail: reads every finished play of the game once a minute; keep a running histogram once days reach ~10k players
  const list = (await db.collection('plays').where('day', '==', day).where('game', '==', game).get()).docs
    .map(d => d.data()).filter(p => p.secs != null && p.won !== false).map(p => ({ uid: p.uid, secs: p.secs }));
  for (const k of fieldCache.keys()) if (!k.startsWith(day)) fieldCache.delete(k);
  fieldCache.set(key, { at: Date.now(), list });
  return list;
}

// Everything the results page shows for one finished play.
async function summary(uid, game, day) {
  const [usnap, psnap] = await db.getAll(userDoc(uid), playRef(day, game, uid));
  const u = usnap.data() || {}, play = psnap.data();
  if (!play || play.secs == null) throw Object.assign(new Error('not finished yet'), { status: 409 });
  const [board, everyone] = await Promise.all([leaderboard(uid, day, u), field(day, game)]);
  const st = u.stats?.[game] || {}, won = play.won !== false, others = everyone.filter(p => p.uid !== uid);
  return {
    secs: play.secs, won, score: play.score ?? null, hints: play.hints || 0, share: play.share ?? null, streak: live(u.streak),
    stats: { played: st.played || 0, winPct: st.played ? Math.round((100 * st.wins) / st.played) : 0, best: st.best ?? null, streak: live(st), maxStreak: st.max || 0 },
    week: Array.from({ length: 7 }, (_, i) => shift(day, i - 6)).map(d => ({ day: d, won: (st.recent || []).includes(d) })),
    pct: won && others.length ? Math.round((100 * others.filter(p => p.secs > play.secs).length) / others.length) : null,
    board: board[game],
  };
}

// Your circle's results today, straight from their user docs: 1 + connections reads.
async function leaderboard(uid, day, me) {
  me ??= (await userDoc(uid).get()).data() || {};
  const others = me.connections?.length ? await db.getAll(...me.connections.map(userDoc)) : [];
  const people = [[uid, me], ...others.map(d => [d.id, d.data()])].filter(([, u]) => u?.today?.day === day);
  const order = (a, b) => b.won - a.won || (b.score ?? 0) - (a.score ?? 0) || a.secs - b.secs;
  return Object.fromEntries(GAMES.map(g => [g, people.filter(([, u]) => u.today.results[g]).map(([id, u]) => {
    const r = u.today.results[g];
    return { ...brief(id, u), secs: r.secs, won: r.won !== false, score: r.score ?? null, hints: r.hints || 0, me: id === uid };
  }).sort(order)]));
}

async function login(res, secure, uid, profile) {
  await userDoc(uid).set(profile, { merge: true });
  res.setHeader('Set-Cookie', sessionCookie(uid, secure));
  return { ok: true };
}

// ---------- football: the server keeps each play's state; the browser only sends actions ----------
const stateRef = (day, game, uid) => (day === today() ? playRef(day, game, uid) : db.doc(`practice/${day}_${game}_${uid}`));
const elapsedOf = d => Math.floor(((d.solvedAt || Date.now()) - d.started) / 1000);

// Apply one action (or just time running out) inside a transaction; finishing records time, result and share line.
async function footballStep(uid, game, day, action) {
  const p = await puzzle(day, game), ref = stateRef(day, game, uid);
  return db.runTransaction(async tx => {
    const [snap, usnap] = await tx.getAll(ref, userDoc(uid)), d = snap.data();
    if (!d) throw Object.assign(new Error('open the puzzle first'), { status: 409 });
    let state = d.state ? JSON.parse(d.state) : F[game].init(p), reply = null;
    const elapsed = elapsedOf(d), expired = F[game].limit && elapsed > F[game].limit;
    if (!state.done && (action || expired)) {
      ({ state, reply = null } = F[game].move(p, state, action || {}, elapsed));
      const upd = { state: JSON.stringify(state) };
      if (state.done) Object.assign(upd, { solvedAt: Date.now(), secs: Math.max(1, elapsed), won: state.won, score: state.score, share: F[game].share(p, state) });
      tx.update(ref, upd);
      if (state.done && day === today() && usnap.exists) record(tx, uid, usnap.data(), day, game, { secs: upd.secs, won: !!state.won, score: state.score });
    }
    return { reply, done: !!state.done, won: !!state.won, view: F[game].view(p, state, elapsed), elapsed };
  });
}

// ---------- routes ----------
const routes = {
  'GET /api/config': async () => ({ clientId: GOOGLE_CLIENT_ID, devLogin: !!DEV_LOGIN, day: today(), num: dayNum(today()), launch: LAUNCH }),

  'POST /api/login': async ({ body, res, secure }) => {
    const t = await google.verifyIdToken({ idToken: String(body.credential), audience: GOOGLE_CLIENT_ID });
    const p = t.getPayload();
    return login(res, secure, `g${p.sub}`, { name: p.name || p.email, picture: p.picture || '' });
  },
  'POST /api/dev-login': async ({ body, res, secure }) => {
    if (!DEV_LOGIN) throw Object.assign(new Error('not found'), { status: 404 });
    const name = String(body.name || '').trim().slice(0, 30);
    if (!name) throw Object.assign(new Error('name required'), { status: 400 });
    return login(res, secure, `dev${hmac(name).toString('hex').slice(0, 12)}`, { name, picture: '' });
  },
  'POST /api/logout': async ({ res }) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`); return { ok: true }; },

  'GET /api/me': async ({ uid }) => {
    const u = (await userDoc(uid).get()).data();
    if (!u) throw Object.assign(new Error('sign in'), { status: 401 }); // account deleted on another device
    const res = u.today?.day === today() ? u.today.results : {};
    const played = Object.fromEntries(GAMES.map(g => [g, res[g] ? { secs: res[g].secs, won: res[g].won !== false, score: res[g].score ?? null } : null]));
    return { ...brief(uid, u), streak: live(u.streak), played, connections: u.connections || [] };
  },
  // GDPR erasure: the account, every play, and the links other people had to it.
  'POST /api/delete-account': async ({ uid, res }) => {
    const [plays, practice, fans] = await Promise.all(['plays', 'practice'].map(c => db.collection(c).where('uid', '==', uid).get())
      .concat(db.collection('users').where('connections', 'array-contains', uid).get()));
    const w = db.bulkWriter();
    [...plays.docs, ...practice.docs].forEach(d => w.delete(d.ref));
    fans.docs.forEach(d => w.update(d.ref, { connections: FieldValue.arrayRemove(uid) }));
    w.delete(userDoc(uid));
    await w.close();
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`);
    return { ok: true };
  },
  'GET /api/user': async ({ query }) => {
    const id = String(query.get('uid') || '');
    const u = /^[\w-]{1,64}$/.test(id) ? (await userDoc(id).get()).data() : null;
    if (!u) throw Object.assign(new Error('user not found'), { status: 404 });
    return brief(id, u);
  },
  'POST /api/connect': async ({ uid, body }) => {
    const other = String(body.uid || '');
    if (other === uid || !/^[\w-]{1,64}$/.test(other) || !(await userDoc(other).get()).exists) throw Object.assign(new Error('cannot connect'), { status: 400 });
    await db.batch()
      .update(userDoc(uid), { connections: FieldValue.arrayUnion(other) })
      .update(userDoc(other), { connections: FieldValue.arrayUnion(uid) })
      .commit();
    return { ok: true };
  },
  'GET /api/leaderboard': async ({ uid }) => leaderboard(uid, today()),
  'GET /api/result': async ({ uid, game }) => summary(uid, game, today()),

  'GET /api/players': async ({ res }) => { res.setHeader('Cache-Control', 'private, max-age=3600'); return PLAYER_INDEX; },

  'GET /api/puzzle': async ({ uid, game, day }) => {
    if (F[game]) {
      await stateRef(day, game, uid).create({ uid, day, game, started: Date.now(), secs: null }).catch(() => {});
      const step = await footballStep(uid, game, day, null);
      return { game, day, num: dayNum(day), football: true, ...step, play: day === today() ? { elapsed: step.elapsed } : null };
    }
    const p = await puzzle(day, game);
    let play = null;
    if (day === today()) { // timer starts the first time today's puzzle is opened, on the server clock
      const ref = playRef(day, game, uid);
      await ref.create({ uid, day, game, started: Date.now(), secs: null, hints: 0 }).catch(() => {});
      const d = (await ref.get()).data();
      play = { elapsed: Math.floor(((d.solvedAt || Date.now()) - d.started) / 1000), secs: d.secs, hints: d.hints };
    }
    return { game, day, num: dayNum(day), puzzle: publicPuzzle(p), play };
  },
  'POST /api/solve': async ({ uid, game, day, body }) => {
    if (!checkers[game]) throw Object.assign(new Error('not a logic puzzle'), { status: 400 });
    const p = await puzzle(day, game);
    if (!checkers[game](p, body.answer).win) return { win: false };
    if (day !== today()) return { win: true, practice: true };
    await db.runTransaction(async tx => {
      const ref = playRef(day, game, uid), [snap, usnap] = await tx.getAll(ref, userDoc(uid)), d = snap.data();
      if (!d) throw Object.assign(new Error('open the puzzle first'), { status: 409 });
      if (d.secs != null) return; // first solve counts
      const now = Date.now(), secs = Math.max(1, Math.round((now - d.started) / 1000));
      tx.update(ref, { secs, solvedAt: now, won: true });
      if (usnap.exists) record(tx, uid, usnap.data(), day, game, { secs, won: true, hints: d.hints || 0 });
    });
    return { win: true, ...(await summary(uid, game, day)) };
  },
  'POST /api/move': async ({ uid, game, day, body }) => {
    if (!F[game]) throw Object.assign(new Error('not a football game'), { status: 400 });
    const step = await footballStep(uid, game, day, body.action && typeof body.action === 'object' ? body.action : {});
    return step.done && day === today() ? { ...step, result: await summary(uid, game, day) } : step;
  },
  'POST /api/hint': async ({ uid, game, day, body }) => {
    if (!checkers[game]) throw Object.assign(new Error('no hints in this game'), { status: 400 });
    const p = await puzzle(day, game);
    if (day === today()) await playRef(day, game, uid).update({ hints: FieldValue.increment(1) }).catch(() => {});
    return hint(game, p, body.state);
  },
};
const PUBLIC = new Set(['GET /api/config', 'POST /api/login', 'POST /api/dev-login', 'POST /api/logout']);

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    if ((size += c.length) > 16e3) throw Object.assign(new Error('body too large'), { status: 413 });
    chunks.push(c);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (status, data, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': res.getHeader('Cache-Control') || 'no-cache' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const f = STATIC[url.pathname], type = TYPES[f.split('.').pop()];
      if (type.startsWith('image') || f.endsWith('webmanifest')) res.setHeader('Cache-Control', 'public, max-age=86400');
      if (!f.endsWith('.html')) return send(200, await readFile(new URL(f, import.meta.url)), type);
      // pages carry the site's own address (share previews need absolute URLs); invite links name the inviter
      const origin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
      let title = 'Games@Work: two-minute daily puzzles', inv = url.searchParams.get('invite');
      if (inv && /^[\w-]{1,64}$/.test(inv)) { const u = (await userDoc(inv).get()).data(); if (u) title = `${u.name} invited you to Games@Work`; }
      const contact = CONTACT_EMAIL ? `<a href="mailto:${escHtml(CONTACT_EMAIL)}">${escHtml(CONTACT_EMAIL)}</a>` : 'the contact address the operator publishes';
      const html = (await readFile(new URL(f, import.meta.url), 'utf8')).replaceAll('%ORIGIN%', escHtml(origin)).replaceAll('%TITLE%', escHtml(title)).replaceAll('%CONTACT%', contact).replaceAll('%OPERATOR%', escHtml(OPERATOR_NAME));
      return send(200, html, type);
    }
    const route = `${req.method} ${url.pathname}`, fn = routes[route];
    if (!fn) return send(404, { error: 'not found' });
    if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json'))
      return send(415, { error: 'json only' }); // with SameSite=Lax cookies this blocks cross-site form posts
    const uid = currentUid(req);
    if (!uid && !PUBLIC.has(route)) return send(401, { error: 'sign in' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    const game = String(url.searchParams.get('game') || body.game || ''), day = String(url.searchParams.get('day') || body.day || today());
    if (route.match(/puzzle|solve|hint|result|move/)) {
      if (!GAMES.includes(game)) return send(400, { error: 'unknown game' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < LAUNCH || day > today()) return send(400, { error: 'bad day' });
    }
    const secure = req.headers['x-forwarded-proto'] === 'https';
    send(200, await fn({ req, res, uid, body, query: url.searchParams, game, day, secure }));
  } catch (e) {
    const status = e.status || (e instanceof SyntaxError ? 400 : /token|audience|signature/i.test(e.message) ? 401 : 500);
    if (status === 500) console.error(e);
    if (!res.headersSent) send(status, { error: status === 500 ? 'server error' : e.message });
  }
});
server.listen(PORT, () => console.log(`listening on :${PORT}`));
