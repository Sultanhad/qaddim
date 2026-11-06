// Runs one ingestion pass from your own machine: read the boards, store the jobs, score them.
// Same code the scheduled worker runs — this is just a way to watch it work before deploying.
//
//   node scripts/ingest-once.mjs
//
// Needs SUPABASE_SERVICE_KEY in .env.local, because writing to `jobs` has to bypass row-level
// security. That key never belongs in the browser or in git; .env.local is gitignored and chmod 600.

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';   // Node 20 has no native WebSocket; this script never uses realtime, but the client wants one
import { fetchAll } from '../packages/engine/src/sources.js';
import { scoreJob, filterReason, normaliseProfile } from '../packages/engine/src/score.js';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await readFile(new URL('.env.local', root), 'utf8')).split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);

const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY;
if (!key) {
  console.error('\nSUPABASE_SERVICE_KEY is missing from .env.local.');
  console.error('Supabase dashboard → Project Settings → API Keys → service_role → copy, then add one line:');
  console.error('  SUPABASE_SERVICE_KEY=eyJ...\n');
  process.exit(2);
}

const SOURCES = [
  { system: 'workable', slug: 'mozn-ai', label: 'Mozn' },
  { system: 'workable', slug: 'lucidya', label: 'Lucidya' },
  { system: 'workable', slug: 'foodics', label: 'Foodics' },
  { system: 'workable', slug: 'mrsool-3', label: 'Mrsool' },
  { system: 'ashby', slug: 'leantech', label: 'Lean Technologies' },
  { system: 'lever', slug: 'flowlife', label: 'Flow' },
  { system: 'lever', slug: 'dlocal', label: 'dLocal' },
  { system: 'lever', slug: 'rewaatech', label: 'Rewaa' },
  { system: 'greenhouse', slug: 'tamara', label: 'Tamara' }
];

const db = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });
const t0 = Date.now();

console.log(`reading ${SOURCES.length} boards…`);
const { jobs, errors } = await fetchAll(SOURCES, { pauseMs: 150 });
for (const e of errors) console.warn('  ! ' + e.source + ': ' + e.error);
console.log(`  ${jobs.length} postings`);

const now = new Date().toISOString();
const rows = jobs.map((j) => ({
  id: j.id, title: j.title, company: j.company, location: j.location, city: j.city,
  country: j.country, arrangement: j.arrangement, salary_published: j.salary_published,
  description: j.description, url: j.url, canonical_url: j.canonical_url,
  source: j.source, source_type: j.source_type, source_job_id: j.source_job_id,
  published_at: j.published_at, last_seen: now, is_open: true
}));
const { error: upErr } = await db.from('jobs').upsert(rows, { onConflict: 'id' });
if (upErr) { console.error('upsert failed:', upErr.message); process.exit(1); }
console.log(`  stored`);

// Close anything that has disappeared from a board that did answer us.
const lived = new Set(jobs.map((j) => j.source));
const seen = new Set(jobs.map((j) => j.id));
const { data: known } = await db.from('jobs').select('id, source').eq('is_open', true);
const gone = (known ?? []).filter((k) => lived.has(k.source) && !seen.has(k.id)).map((k) => k.id);
if (gone.length) await db.from('jobs').update({ is_open: false }).in('id', gone);

const { data: profiles } = await db.from('profiles').select('*').eq('onboarded', true);
console.log(`scoring for ${profiles?.length ?? 0} user(s)…`);
let written = 0;
for (const p of profiles ?? []) {
  const profile = normaliseProfile(p);
  const { data: already } = await db.from('matches').select('job_id').eq('user_id', p.id);
  const had = new Set((already ?? []).map((m) => m.job_id));
  const batch = [];
  for (const j of jobs) {
    if (had.has(j.id) || filterReason(j, profile)) continue;
    const s = scoreJob(j, profile);
    if (s.total < profile.min_score) continue;
    batch.push({ user_id: p.id, job_id: j.id, score: s.total, reasons: s.reasons, gaps: s.gaps, flags: s.flags, breakdown: s.breakdown });
  }
  if (batch.length) {
    const { error } = await db.from('matches').upsert(batch, { onConflict: 'user_id,job_id' });
    if (error) console.warn('  ! matches:', error.message); else written += batch.length;
  }
  console.log(`  ${p.full_name || p.id}: ${batch.length} new match(es)`);
}

console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${jobs.length} jobs · ${gone.length} closed · ${written} matches`);
