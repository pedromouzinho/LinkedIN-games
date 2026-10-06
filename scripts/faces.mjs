// Player photos from a Football Manager cut-out facepack (files named <FM unique id>.png).
// 1. Export FM people from a save:  fmsave export save.fm players --all -o players.csv  (and the same for staff)
// 2. node scripts/faces.mjs uids players.csv staff.csv > uids.txt   -> the facepack files we want
// 3. node scripts/faces.mjs build players.csv staff.csv <dir with the copied pngs> <out dir>
//    -> <out dir>/<wikidata id>.webp (128 px, needs ffmpeg) and data/faces.json; upload <out dir> to FACES_URL.
// Matching is by name and birth year; fmsave's birth dates come out one year early, hence SHIFT.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [cmd, players, staff, rawDir, outDir] = process.argv.slice(2), SHIFT = -1;
const norm = s => (s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const bag = s => norm(s).split(' ').sort().join(' ');
function parseCsv(text) { // RFC 4180: quoted fields may hold commas, quotes and newlines
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map(r => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

const idx = new Map(), add = (k, r) => idx.set(k, [...(idx.get(k) || []), r]);
for (const f of [players, staff]) for (const r of parseCsv(readFileSync(f, 'utf8'))) {
  const y = (r.birth_date || '').slice(0, 4);
  for (const v of [r.name, r.common_name, r.full_name, r.legal_name, `${r.first_name} ${r.last_name}`].filter(Boolean)) {
    add(`=${norm(v)}|${y}`, r); add(`~${bag(v)}|${y}`, r);
  }
  // Spelling variants (Andy/Andrew Robertson, Eberechi/Ebere Eze): surname + first initial, only for players with
  // some world reputation, so a famous retiree never borrows an unknown namesake's face.
  if (+r.reputation_world >= 2500) for (const t of new Set(norm(`${r.full_name} ${r.name}`).split(' '))) add(`?${t}|${norm(r.name)[0]}|${y}`, r);
}
const DATA = JSON.parse(readFileSync(new URL('../data/football.json', import.meta.url)));
const match = {}; // wikidata id -> FM unique id; namesakes go to the one with the highest world reputation
for (const p of DATA.players) {
  if (!p.born) continue;
  const y = p.born + SHIFT, n = norm(p.name).split(' ');
  const cands = idx.get(`=${norm(p.name)}|${y}`) || idx.get(`~${bag(p.name)}|${y}`) || idx.get(`?${n.at(-1)}|${n[0][0]}|${y}`);
  if (cands) match[p.id] = cands.reduce((a, b) => (+(b.reputation_world || 0) > +(a.reputation_world || 0) ? b : a)).unique_id;
}

if (cmd === 'uids') console.log(Object.values(match).join('\n'));
else if (cmd === 'build') {
  mkdirSync(outDir, { recursive: true });
  const have = [];
  for (const [id, uid] of Object.entries(match)) {
    const src = `${rawDir}/${uid}.png`;
    if (!existsSync(src)) continue;
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', src, '-vf', 'scale=128:128:force_original_aspect_ratio=decrease', '-quality', '80', `${outDir}/${id}.webp`]);
    have.push(id);
  }
  writeFileSync(new URL('../data/faces.json', import.meta.url), JSON.stringify(have.sort()));
  console.error(`matched ${Object.keys(match).length}, photos ${have.length}`);
} else console.error('usage: node scripts/faces.mjs uids|build players.csv staff.csv [raw dir] [out dir]');
