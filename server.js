// HTTP server: static files + JSON API. Puzzles and their solutions live only here; the browser gets
// the puzzle without the solution, the server times every play and validates every answer.
import http from 'node:http';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Firestore, FieldValue } from '@google-cloud/firestore';
import { OAuth2Client } from 'google-auth-library';
import * as G from './games.js';

const { PORT = 8080, GOOGLE_CLIENT_ID = '', DEV_LOGIN, K_SERVICE } = process.env;
if (DEV_LOGIN && K_SERVICE) throw new Error('DEV_LOGIN must never be enabled on Cloud Run');
const SECRET = process.env.SECRET || (DEV_LOGIN ? 'dev-secret' : null);
if (!SECRET) throw new Error('Set SECRET (a long random string) — it signs sessions and seeds puzzles');

const TZ = 'Europe/Lisbon', LAUNCH = '2026-10-01';
const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || 'demo-grid-games', ignoreUndefinedProperties: true });
const google = new OAuth2Client();
const GAMES = Object.keys(G.GENERATORS);
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/games.js': 'games.js', '/style.css': 'style.css' };
const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css' };

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const dayNum = day => Math.round((Date.parse(day) - Date.parse('2024-01-01')) / 864e5);
const hmac = s => crypto.createHmac('sha256', SECRET).update(s).digest();

// ---------- sessions: stateless signed cookie "uid.expiry.sig" ----------
const sign = (uid, exp) => hmac(`session:${uid}.${exp}`).toString('base64url');
const sessionCookie = (uid, secure) => {
  const exp = Date.now() + 30 * 864e5;
  return `sid=${uid}.${exp}.${sign(uid, exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}`;
};
function currentUid(req) {
  const m = /(?:^|;\s*)sid=([\w-]+)\.(\d+)\.([\w-]+)/.exec(req.headers.cookie || '');
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
    const p = G.GENERATORS[game](G.rng(hmac(`puzzle:${key}`).readInt32LE(0)));
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
// Current streak (ending today, or yesterday if today isn't won yet) and longest streak over a list of won days.
function runs(days) {
  const set = new Set(days);
  let cur = 0, max = 0;
  for (let d = set.has(today()) ? today() : shift(today(), -1); set.has(d); d = shift(d, -1)) cur++;
  for (const d of set) if (!set.has(shift(d, -1))) { let k = 1; while (set.has(shift(d, k))) k++; max = Math.max(max, k); }
  return { cur, max };
}
const finished = async uid => (await db.collection('plays').where('uid', '==', uid).get()).docs.map(d => d.data()).filter(p => p.secs != null);
const streak = async uid => runs((await finished(uid)).filter(p => p.won !== false).map(p => p.day)).cur;

// Everything the results page shows for one finished play.
async function summary(uid, game, day) {
  const [mine, board, field] = await Promise.all([finished(uid), leaderboard(uid, day),
    db.collection('plays').where('day', '==', day).where('game', '==', game).get()]);
  const play = mine.find(p => p.day === day && p.game === game);
  if (!play) throw Object.assign(new Error('not finished yet'), { status: 409 });
  const g = mine.filter(p => p.game === game), wins = g.filter(p => p.won !== false), r = runs(wins.map(p => p.day));
  const others = field.docs.map(d => d.data()).filter(p => p.secs != null && p.won !== false && p.uid !== uid);
  return {
    secs: play.secs, won: play.won !== false, score: play.score ?? null, hints: play.hints || 0, reveal: play.reveal ?? null,
    streak: runs(mine.filter(p => p.won !== false).map(p => p.day)).cur,
    stats: { played: g.length, winPct: Math.round((100 * wins.length) / g.length), best: wins.length ? Math.min(...wins.map(p => p.secs)) : null, streak: r.cur, maxStreak: r.max },
    week: Array.from({ length: 7 }, (_, i) => shift(day, i - 6)).map(d => ({ day: d, won: wins.some(p => p.day === d) })),
    pct: play.won !== false && others.length ? Math.round((100 * others.filter(p => p.secs > play.secs).length) / others.length) : null,
    board: board[game],
  };
}

async function leaderboard(uid, day) {
  const me = (await userDoc(uid).get()).data() || {};
  const circle = new Set([uid, ...(me.connections || [])]);
  // ponytail: reads every play of the day; switch to `where('uid','in',...)` chunks once a day has thousands of plays
  const plays = (await db.collection('plays').where('day', '==', day).get()).docs.map(d => d.data()).filter(p => circle.has(p.uid) && p.secs != null);
  const users = new Map(await Promise.all([...new Set(plays.map(p => p.uid))].map(async id => [id, (await userDoc(id).get()).data()])));
  return Object.fromEntries(GAMES.map(g => [g, plays.filter(p => p.game === g).sort((a, b) => a.secs - b.secs)
    .map(p => ({ ...brief(p.uid, users.get(p.uid)), secs: p.secs, hints: p.hints || 0, me: p.uid === uid }))]));
}

async function login(res, secure, uid, profile) {
  await userDoc(uid).set(profile, { merge: true });
  res.setHeader('Set-Cookie', sessionCookie(uid, secure));
  return { ok: true };
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
  'POST /api/logout': async ({ res }) => { res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); return { ok: true }; },

  'GET /api/me': async ({ uid }) => {
    const u = (await userDoc(uid).get()).data();
    const played = Object.fromEntries(await Promise.all(GAMES.map(async g => {
      const d = (await playRef(today(), g, uid).get()).data();
      return [g, d?.secs != null ? { secs: d.secs, won: d.won !== false, score: d.score ?? null } : null];
    })));
    return { ...brief(uid, u), streak: await streak(uid), played, connections: u?.connections || [] };
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

  'GET /api/puzzle': async ({ uid, game, day }) => {
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
    const p = await puzzle(day, game);
    if (!checkers[game](p, body.answer).win) return { win: false };
    if (day !== today()) return { win: true, practice: true };
    await db.runTransaction(async tx => {
      const ref = playRef(day, game, uid), d = (await tx.get(ref)).data();
      if (!d) throw Object.assign(new Error('open the puzzle first'), { status: 409 });
      if (d.secs != null) return; // first solve counts
      const now = Date.now();
      tx.update(ref, { secs: Math.max(1, Math.round((now - d.started) / 1000)), solvedAt: now, won: true });
    });
    return { win: true, ...(await summary(uid, game, day)) };
  },
  'POST /api/hint': async ({ uid, game, day, body }) => {
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
    res.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(type === 'application/json' ? JSON.stringify(data) : data);
  };
  try {
    if (req.method === 'GET' && STATIC[url.pathname]) {
      const f = STATIC[url.pathname];
      return send(200, await readFile(new URL(f, import.meta.url)), `${TYPES[f.split('.').pop()]}; charset=utf-8`);
    }
    const route = `${req.method} ${url.pathname}`, fn = routes[route];
    if (!fn) return send(404, { error: 'not found' });
    if (req.method === 'POST' && !String(req.headers['content-type']).startsWith('application/json'))
      return send(415, { error: 'json only' }); // with SameSite=Lax cookies this blocks cross-site form posts
    const uid = currentUid(req);
    if (!uid && !PUBLIC.has(route)) return send(401, { error: 'sign in' });
    const body = req.method === 'POST' ? await readBody(req) : {};
    const game = String(url.searchParams.get('game') || body.game || ''), day = String(url.searchParams.get('day') || body.day || today());
    if (route.match(/puzzle|solve|hint|result/)) {
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
