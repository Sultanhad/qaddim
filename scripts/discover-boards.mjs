// Finds hiring boards worth reading: tries candidates and reports which exist and how many
// of their postings are in this region.
//
//   node scripts/discover-boards.mjs candidates.txt          # one candidate per line
//   node scripts/discover-boards.mjs candidates.txt --json out.json
//
// A candidate line is either a precise guess or a company name to guess from:
//
//   greenhouse:stripe  Stripe            ← system:slug, then the label
//   workday:nvidia.wd5/NVIDIAExternalCareerSite  NVIDIA
//   name: Property Finder                ← tried on every system under the usual spellings
//
// Nothing is added to boards.js by this script. It only reads — the same public feeds, through
// the same adapters and the same host allow-list as the worker — and prints what it found, so
// that a board is listed because it was fetched and counted, not because someone remembered it.
import { readFile, writeFile } from 'node:fs/promises';
import { fetchSource, servesRegion, searchJson, getJson, placeOf, REGION } from '../packages/engine/src/sources.js';
import { BOARDS } from '../packages/engine/src/boards.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/discover-boards.mjs <candidates.txt> [--json out.json]'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const have = new Set(BOARDS.map((b) => `${b.system}:${b.slug}`.toLowerCase()));
const NAME_SYSTEMS = ['greenhouse', 'lever', 'ashby', 'workable', 'smartrecruiters', 'recruitee'];

/** The spellings a company name usually takes as a board's address. */
function spellings(name, system) {
  const words = name.replace(/&/g, ' and ').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim().split(/\s+/);
  const lower = words.map((w) => w.toLowerCase());
  const out = new Set([lower.join(''), lower.join('-')]);
  if (system === 'smartrecruiters') {
    // SmartRecruiters identifiers are the company's name as it capitalises it.
    out.add(words.map((w) => w[0].toUpperCase() + w.slice(1)).join(''));
    out.add(words.join(''));
  }
  if (lower.length > 1) out.add(lower[0]);
  return [...out].filter((s) => s.length >= 2);
}

const lines = (await readFile(file, 'utf8')).split('\n').map((l) => l.replace(/#.*$/, '').trim()).filter(Boolean);
const candidates = [];
for (const line of lines) {
  const named = /^name:\s*(.+)$/i.exec(line);
  if (named) {
    for (const system of NAME_SYSTEMS) for (const slug of spellings(named[1], system)) candidates.push({ system, slug, label: named[1].trim(), guessed: true });
    continue;
  }
  const m = /^([a-z]+):(\S+)\s*(.*)$/.exec(line);
  if (m) candidates.push({ system: m[1], slug: m[2], label: m[3].trim() || m[2] });
}
const seen = new Set();
const todo = candidates.filter((c) => {
  const k = `${c.system}:${c.slug}`.toLowerCase();
  if (seen.has(k) || have.has(k)) return false;
  seen.add(k); return true;
});
console.log(`${todo.length} candidate(s) to try (${candidates.length - todo.length} already listed or repeated)\n`);

const inRegion = (text) => { const p = placeOf(String(text || '')); return !!(p.country && REGION.includes(p.country)); };

/** Workday is asked by place, so a count there costs two searches rather than a page per job. */
async function workdayCount(slug) {
  const [tenantHost, site] = slug.split('/');
  const base = `https://${tenantHost}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(tenantHost.split('.')[0])}/${encodeURIComponent(site)}`;
  const paths = new Set(); let total = null;
  for (const term of ['Saudi Arabia', 'Dubai', 'Egypt']) {
    const page = await searchJson(`${base}/jobs`, { limit: 20, offset: 0, searchText: term });
    if (total === null) total = (await searchJson(`${base}/jobs`, { limit: 1, offset: 0, searchText: '' }))?.total ?? null;
    for (const x of page?.jobPostings ?? []) if (inRegion(x.locationsText) || /saudi|riyadh|jeddah|dubai|abu dhabi|uae|emirates|egypt|cairo|qatar|doha|kuwait|bahrain|oman|jordan/i.test(`${x.locationsText} ${x.title}`)) paths.add(x.externalPath);
  }
  return { total, region: paths.size };
}

/** SmartRecruiters answers per country, and says how many there are without sending them. */
async function smartCount(slug) {
  let region = 0, exists = false;
  for (const c of REGION) {
    const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?country=${c}&limit=1`);
    if (typeof j?.totalFound === 'number') { exists = true; region += j.totalFound; }
  }
  if (!exists) throw new Error('not found');
  const all = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=1`);
  if (!all?.totalFound) throw new Error('empty');       // an unknown company answers with an empty list, not a 404
  return { total: all.totalFound, region };
}

async function probe(c) {
  if (c.system === 'workday') return workdayCount(c.slug);
  if (c.system === 'smartrecruiters') return smartCount(c.slug);
  const jobs = await fetchSource(c, {});
  if (!jobs.length) throw new Error('empty');
  return { total: jobs.length, region: jobs.filter(servesRegion).length, named: jobs[0]?.company };
}

// Two at a time per hiring system: quick enough, and no one host sees a burst.
const hits = [], bySystem = new Map();
for (const c of todo) { if (!bySystem.has(c.system)) bySystem.set(c.system, []); bySystem.get(c.system).push(c); }
await Promise.all([...bySystem.values()].map(async (list) => {
  const queue = [...list];
  await Promise.all([0, 1].map(async () => {
    for (let c; (c = queue.shift());) {
      try {
        const r = await probe(c);
        const hit = { ...c, ...r };
        hits.push(hit);
        if (r.region > 0) console.log(`  ✓ ${c.system}:${c.slug}`.padEnd(58) + `${String(r.region).padStart(4)} here of ${r.total ?? '?'}   ${c.label}`);
      } catch { /* not there, or not readable: not a board for us */ }
      await new Promise((r) => setTimeout(r, 250));
    }
  }));
}));

const found = hits.filter((h) => h.region > 0).sort((a, b) => b.region - a.region);
console.log(`\n${found.length} board(s) with postings in the region · ${found.reduce((n, h) => n + h.region, 0)} postings · ${hits.length - found.length} exist with none here`);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ at: new Date().toISOString(), found, elsewhere: hits.filter((h) => !h.region) }, null, 1));
