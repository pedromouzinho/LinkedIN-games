// Builds data/football.json from Wikidata (CC0) and English Wikipedia. Run: NODE_USE_ENV_PROXY=1 node scripts/football-data.mjs
// Men's players with articles in 30+ Wikipedias, their club/national-team stints (years, apps, goals),
// positions, nationality, clubs (country, league, colours) and leagues. Fame = English Wikipedia views over the
// last 12 months; for the most viewed players, club and national-team rows come from their Wikipedia infobox,
// which editors keep current (Wikidata's apps/goals are often years old).
import { writeFile, mkdir } from 'node:fs/promises';

const MIN_SITELINKS = 30, INFOBOX_TOP = 3000;
const UA = 'GamesAtWork/1.0 (https://gamesatwork.web.app/; football data builder)';
const POS = { Q201330: 'GK', Q336286: 'DF', Q193592: 'MF', Q280658: 'FW' };
// UK national teams share P17 = United Kingdom; flags need the home-nation codes.
const HOME_NATIONS = [[/England/, 'GB-ENG'], [/Scotland/, 'GB-SCT'], [/Wales/, 'GB-WLS'], [/Northern Ireland/, 'GB-NIR']];
const NOT_SENIOR = /under-?\s?\d|\bU-?\d{2}\b|olympic|women|youth|amateur|\bB\b|futsal|beach|universiade|military|student|reserve/i;
const NOT_FIRST_TEAM = /Castilla|Barcelona Atlètic|Sevilla Atlético|^Jong |Primavera|\bII$|\sB$|\sC$|Youth|Juvenil|Reserves|Academy|\bU-?\d{2}\b|under-\d{2}/i;

const FIX_NAMES = { Q222151: 'João Moutinho' }; // label typos found in Wikidata
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function sparql(query) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch('https://query.wikidata.org/sparql', {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (r.ok) return (await r.json()).results.bindings.map(b => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
      throw new Error(`${r.status} ${(await r.text()).slice(0, 300)}`);
    } catch (e) { // HTTP errors, timeouts and dropped connections all get retried
      if (i >= 4) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}
const qid = uri => uri.slice(uri.lastIndexOf('/') + 1);
const year = d => (d && /^\d{4}-/.test(d) ? +d.slice(0, 4) : null);
const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const values = ids => ids.map(id => `wd:${id}`).join(' ');
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ---------- players ----------
const players = new Map();
for (const [lo, hi] of [[30, 45], [45, 70], [70, 100000]]) {
  const rows = await sparql(`
    SELECT ?p ?name ?s (SAMPLE(?dob) AS ?born) (SAMPLE(?h) AS ?height) (GROUP_CONCAT(DISTINCT ?g) AS ?pos) (SAMPLE(?cc) AS ?cit) (SAMPLE(?t) AS ?title) WHERE {
      ?p wdt:P106 wd:Q937857; wdt:P21 wd:Q6581097; wikibase:sitelinks ?s . FILTER(?s >= ${Math.max(lo, MIN_SITELINKS)} && ?s < ${hi})
      ?p rdfs:label ?name FILTER(LANG(?name) = "en")
      OPTIONAL { ?p wdt:P569 ?dob }
      OPTIONAL { ?p p:P2048/psn:P2048/wikibase:quantityAmount ?h }
      OPTIONAL { VALUES ?g { ${values(Object.keys(POS))} } ?p wdt:P413/wdt:P279* ?g }
      OPTIONAL { ?p wdt:P27/wdt:P297 ?cc }
      OPTIONAL { ?art schema:about ?p; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?t }
    } GROUP BY ?p ?name ?s`);
  for (const r of rows)
    players.set(qid(r.p), {
      // The English article title is better watched than the Wikidata label (labels get vandalised: "Sancho Panza").
      id: qid(r.p), name: FIX_NAMES[qid(r.p)] || r.title?.replace(/ \(.*\)$/, '') || r.name, sl: +r.s, born: year(r.born),
      h: r.height ? Math.round(+r.height * 100) : null,
      pos: (r.pos || '').split(' ').filter(Boolean).map(u => POS[qid(u)]),
      cit: r.cit || null, title: r.title || null, v: 0, stints: [],
    });
  log('players', lo, hi, rows.length);
}

// ---------- stints ----------
for (const ids of chunks([...players.keys()], 300)) {
  const rows = await sparql(`
    SELECT ?p ?team ?start ?end ?apps ?goals WHERE {
      VALUES ?p { ${values(ids)} }
      ?p p:P54 ?st . ?st ps:P54 ?team .
      FILTER NOT EXISTS { ?st wikibase:rank wikibase:DeprecatedRank }
      OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
      OPTIONAL { ?st pq:P1350 ?apps } OPTIONAL { ?st pq:P1351 ?goals }
    }`);
  for (const r of rows)
    players.get(qid(r.p)).stints.push({ team: qid(r.team), from: year(r.start), to: year(r.end),
      apps: r.apps != null ? Math.round(+r.apps) : null, goals: r.goals != null ? Math.round(+r.goals) : null });
  log('stints', rows.length);
  await sleep(500);
}

// ---------- fame: English Wikipedia views over the last 12 full months ----------
const day = d => d.toISOString().slice(0, 10).replaceAll('-', '');
const now = new Date(), to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)), from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth() + 1, 1));
async function get(url) { // retries, and waits as long as Wikimedia asks when rate-limited
  for (let i = 0; ; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } }).catch(() => null);
    if (r?.ok || r?.status === 404) return r;
    if (i >= 8) throw new Error(`${r?.status} ${url}`);
    await sleep(r?.status === 429 ? 1000 * (+r.headers.get('retry-after') || 60) : 3000 * (i + 1));
  }
}
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) await fn(items[next++]); }));
}
let seen = 0;
await pool([...players.values()].filter(p => p.title), 4, async p => {
  if (++seen % 500 === 0) log('views', seen);
  const r = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(p.title.replaceAll(' ', '_'))}/monthly/${day(from)}/${day(to)}`);
  p.v = r.ok ? (await r.json()).items.reduce((s, x) => s + x.views, 0) : 0;
});
log('views', [...players.values()].sort((a, b) => b.v - a.v).slice(0, 5).map(p => `${p.name} ${p.v}`).join(', '));

// ---------- Wikipedia infobox: club and national-team rows of the most viewed players ----------
const wiki = params => sleep(1000).then(() => get('https://en.wikipedia.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: 2, ...params }))).then(r => r.json());
// Top-level "| key = value" params of {{Infobox football biography}}; values may contain [[a|b]] and {{x|y}}.
function infobox(text) {
  text = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  const start = text.search(/\{\{\s*Infobox football biography/i);
  if (start < 0) return null;
  const out = {};
  const add = s => { const m = /^\s*([\w-]+)\s*=([\s\S]*)$/.exec(s); if (m) out[m[1].toLowerCase()] = m[2].trim(); };
  let depth = 0, cur = '';
  for (let i = start + 2; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' || two === ']]') { if (depth === 0) break; depth--; cur += two; i++; continue; }
    if (text[i] === '|' && depth === 0) { add(cur); cur = ''; } else cur += text[i];
  }
  add(cur);
  return out;
}
const plain = v => (v || '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1'); // [[List of … 100 or more caps|234]] -> 234
const num = v => { const m = /\d+/.exec(plain(v)); return m ? +m[0] : null; };
const link = v => /\[\[([^\]|#]+)/.exec(v || '')?.[1].trim() || null;
function rows(box, prefix) { // years/clubs/caps/goals or nationalyears/nationalteam/nationalcaps/nationalgoals
  const out = [];
  for (let n = 1; n <= 40; n++) {
    const team = link(box[`${prefix ? 'nationalteam' : 'clubs'}${n}`]), years = plain(box[`${prefix}years${n}`]);
    const ys = years.match(/\d{4}/g);
    if (!team || !ys) continue;
    out.push({ title: team, from: +ys[0], to: ys[1] ? +ys[1] : /[–-]\s*$/.test(years.trim()) ? null : +ys[0],
      apps: num(box[`${prefix}caps${n}`]), goals: num(box[`${prefix}goals${n}`]) });
  }
  return out;
}
const top = [...players.values()].filter(p => p.title).sort((a, b) => b.v - a.v).slice(0, INFOBOX_TOP), boxRows = new Map();
for (const ids of chunks(top, 50)) {
  const byTitle = new Map(ids.map(p => [p.title, p]));
  const j = await wiki({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', rvsection: 0, titles: ids.map(p => p.title).join('|') });
  for (const pg of j.query.pages) {
    const box = pg.revisions && infobox(pg.revisions[0].slots.main.content), p = byTitle.get(pg.title);
    if (box && p) boxRows.set(p.id, [...rows(box, ''), ...rows(box, 'national')]);
  }
}
// Link targets -> Wikidata items, following redirects.
const qidOf = new Map(), linked = [...new Set([...boxRows.values()].flat().map(r => r.title))];
for (const titles of chunks(linked, 50)) {
  const j = await wiki({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', redirects: 1, titles: titles.join('|') });
  const back = new Map();
  for (const x of [...(j.query.normalized || []), ...(j.query.redirects || [])]) back.set(x.to, [...(back.get(x.to) || []), x.from]);
  for (const pg of j.query.pages) {
    if (!pg.pageprops?.wikibase_item) continue;
    const names = [pg.title];
    for (let k = 0; k < names.length; k++) names.push(...(back.get(names[k]) || []));
    for (const n of names) qidOf.set(n, pg.pageprops.wikibase_item);
  }
}
let fromBox = 0;
for (const [id, rs] of boxRows) {
  const stints = rs.filter(r => qidOf.has(r.title)).map(r => ({ team: qidOf.get(r.title), from: r.from, to: r.to, apps: r.apps, goals: r.goals }));
  if (stints.length) { players.get(id).stints = stints; fromBox++; }
}
log('infobox careers', fromBox, '/', top.length);

// ---------- teams ----------
const teamIds = [...new Set([...players.values()].flatMap(p => p.stints.map(s => s.team)))];
const teams = new Map();
for (const ids of chunks(teamIds, 400)) {
  const rows = await sparql(`
    SELECT ?t ?name ?short ?s ?nat ?club ?iso ?league ?hex WHERE {
      VALUES ?t { ${values(ids)} }
      OPTIONAL { ?t rdfs:label ?name FILTER(LANG(?name) = "en") }
      OPTIONAL { ?t wdt:P1813 ?short FILTER(LANG(?short) IN ("en", "mul")) }
      OPTIONAL { ?t wikibase:sitelinks ?s }
      BIND(EXISTS { ?t wdt:P31/wdt:P279* wd:Q6979593 } AS ?nat)
      BIND(EXISTS { ?t wdt:P31/wdt:P279* wd:Q476028 } AS ?club)
      OPTIONAL { ?t wdt:P17/wdt:P297 ?iso }
      OPTIONAL { ?t wdt:P118 ?league }
      OPTIONAL { ?t wdt:P6364/wdt:P465 ?hex }
    }`);
  for (const r of rows) {
    const id = qid(r.t);
    const t = teams.get(id) || { id, name: r.name || id, short: null, sl: +(r.s || 0), nat: r.nat === 'true', club: r.club === 'true', iso: null, leagues: new Set(), colors: [] };
    if (r.short && (!t.short || r.short.length < t.short.length)) t.short = r.short;
    if (r.iso) t.iso ??= r.iso;
    if (r.league) t.leagues.add(qid(r.league));
    if (r.hex && !t.colors.includes(r.hex.toUpperCase()) && t.colors.length < 2) t.colors.push(r.hex.toUpperCase());
    teams.set(id, t);
  }
  log('teams', teams.size, '/', teamIds.length);
  await sleep(500);
}

// ---------- leagues ----------
const leagueIds = [...new Set([...teams.values()].flatMap(t => [...t.leagues]))];
const leagues = new Map();
for (const ids of chunks(leagueIds, 400)) {
  const rows = await sparql(`
    SELECT ?l ?name ?s WHERE {
      VALUES ?l { ${values(ids)} }
      ?l rdfs:label ?name FILTER(LANG(?name) = "en")
      OPTIONAL { ?l wikibase:sitelinks ?s }
    }`);
  for (const r of rows) leagues.set(qid(r.l), { name: r.name, sl: +(r.s || 0) });
}
log('leagues', leagues.size);

// ---------- assemble ----------
const nationOf = t => HOME_NATIONS.find(([re]) => re.test(t.name))?.[1] || t.iso;
const clubName = t => t.short && /[a-z]/.test(t.short) ? t.short // a word, not an acronym like "NFO"
  : t.name.replace(/\s+(F\.?C\.?|A\.?F\.?C\.?|C\.?F\.?|S\.?C\.?|FK|SK|S\.?p\.?A\.?|Club de Fútbol|Football Club)$/i, '').trim();
const clubs = {}, out = [];
for (const p of players.values()) {
  const clubStints = [], caps = new Map();
  for (const s of p.stints) {
    const t = teams.get(s.team);
    if (!t || !s.from) continue;
    if (t.nat) {
      if (!NOT_SENIOR.test(t.name) && nationOf(t)) {
        const c = caps.get(nationOf(t)) || { apps: 0, goals: 0 };
        caps.set(nationOf(t), { apps: c.apps + (s.apps || 0), goals: c.goals + (s.goals || 0), from: Math.min(c.from ?? 9999, s.from) });
      }
    } else if (t.club && !NOT_FIRST_TEAM.test(t.name)) {
      clubStints.push([t.id, s.from, s.to, s.apps, s.goals]);
      clubs[t.id] ??= { name: clubName(t), country: t.iso, sl: t.sl, colors: t.colors,
        league: [...t.leagues].filter(l => leagues.has(l)).sort((a, b) => leagues.get(b).sl - leagues.get(a).sl)[0] || null };
    }
  }
  if (!clubStints.length) continue;
  clubStints.sort((a, b) => a[1] - b[1]);
  const [nat, nt] = [...caps].sort((a, b) => b[1].apps - a[1].apps)[0] || [p.cit, null];
  out.push({ id: p.id, name: p.name, sl: p.sl, v: p.v, born: p.born, h: p.h, pos: [...new Set(p.pos)], nat,
    caps: nt?.apps ?? 0, intGoals: nt?.goals ?? 0, clubs: clubStints });
}
const usedLeagues = Object.fromEntries([...new Set(Object.values(clubs).map(c => c.league).filter(Boolean))].map(l => [l, leagues.get(l).name]));
out.sort((a, b) => b.sl - a.sl);
await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/football.json', import.meta.url), JSON.stringify({
  source: 'Wikidata (CC0)', generated: new Date().toISOString().slice(0, 10), clubs, leagues: usedLeagues, players: out,
}));
log('done', out.length, 'players', Object.keys(clubs).length, 'clubs');
