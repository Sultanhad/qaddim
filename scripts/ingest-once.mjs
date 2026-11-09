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
import { fetchAll, fingerprintOf } from '../packages/engine/src/sources.js';
import { BOARDS } from '../packages/engine/src/boards.js';
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


const db = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });
const t0 = Date.now();

console.log(`reading ${BOARDS.length} boards…`);
const { jobs, errors } = await fetchAll(BOARDS, { pauseMs: 150 });
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

// A posting the board still lists is a posting that still exists — that is what verifies it.
// Rows carrying the lifecycle columns are only written when the database has them, so this
// worker keeps running against a project where migration 007 has not been pasted yet.
const HAS_LIFECYCLE = await db.from('jobs').select('status').limit(1)
  .then(({ error }) => !error).catch(() => false);
if (HAS_LIFECYCLE) {
  await db.from('jobs').update({ status: 'verified', verified_at: now, checked_at: now, check_status: 200 })
    .in('id', rows.map((r) => r.id));
}

// Close anything that has disappeared from a board that did answer us.
const lived = new Set(jobs.map((j) => j.source));
const seen = new Set(jobs.map((j) => j.id));
const { data: known } = await db.from('jobs').select('id, source').eq('is_open', true);
const gone = (known ?? []).filter((k) => lived.has(k.source) && !seen.has(k.id)).map((k) => k.id);
if (gone.length) {
  await db.from('jobs').update({ is_open: false, ...(HAS_LIFECYCLE ? { status: 'closed', closed_at: now } : {}) }).in('id', gone);
}

// Postings whose board stopped answering are not closed — we simply did not hear. But one
// that has not been seen for a month is not a live vacancy either, and 94 of them were being
// offered to users, some dated 2021.
const STALE_DAYS = 30;
const staleBefore = new Date(Date.now() - STALE_DAYS * 864e5).toISOString();
const { data: stale } = await db.from('jobs').select('id').eq('is_open', true).lt('last_seen', staleBefore);
if (stale?.length) {
  await db.from('jobs').update({ is_open: false, ...(HAS_LIFECYCLE ? { status: 'expired', closed_at: now } : {}) })
    .in('id', stale.map((x) => x.id));
  console.log(`  ${stale.length} expired (unseen for ${STALE_DAYS} days)`);
}

// And postings the board still lists but published over a year ago. An applicant tracking
// system rarely deletes anything, so an evergreen advert from 2021 sits there for ever — 27
// of them were being offered as current openings.
const AGE_LIMIT_DAYS = 365;
const bornBefore = new Date(Date.now() - AGE_LIMIT_DAYS * 864e5).toISOString().slice(0, 10);
const { data: ancient } = await db.from('jobs').select('id').eq('is_open', true).lt('published_at', bornBefore);
if (ancient?.length) {
  await db.from('jobs').update({ is_open: false, ...(HAS_LIFECYCLE ? { status: 'expired', closed_at: now } : {}) })
    .in('id', ancient.map((x) => x.id));
  console.log(`  ${ancient.length} expired (published over a year ago)`);
}

// An employer that re-posts a role leaves the old advert on the board. Both are "open" and
// both reach users, so the 2024 posting is offered beside the 2026 one. Only the newest of a
// fingerprint stays open; the rest are closed as superseded, not deleted.
const REPOST_GAP_DAYS = 45;
const { data: openNow } = await db.from('jobs')
  .select('id, title, company, city, published_at, first_seen')
  .eq('is_open', true);
const groups = new Map();
for (const j of openNow ?? []) {
  const k = fingerprintOf(j);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(j);
}
const when = (j) => new Date(j.published_at || j.first_seen || 0).getTime();
const superseded = [];
for (const list of groups.values()) {
  if (list.length < 2) continue;
  const sorted = [...list].sort((a, b) => when(b) - when(a));
  const newest = sorted[0];
  for (const old of sorted.slice(1)) {
    // Two genuine openings for the same title are posted around the same time; a gap of
    // weeks is a re-post. Below the gap, both stay — being wrong here hides a real job.
    if (when(newest) - when(old) >= REPOST_GAP_DAYS * 864e5) superseded.push(old.id);
  }
}
if (superseded.length) {
  await db.from('jobs').update({ is_open: false, ...(HAS_LIFECYCLE ? { status: 'closed', closed_at: now } : {}) })
    .in('id', superseded);
  console.log(`  ${superseded.length} superseded by a newer posting of the same role`);
}

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

// Tables that migration 007 adds. Until it is pasted these writes fail, and saying so once
// is more useful than two stack-shaped warnings in a cron log.
const pending = [];

// A pulse, so a stall is visible. The worker ran only three times in 46 hours while the Mac
// slept and nothing said so; anything that can read this row can now tell how long it has been.
await db.from('ops_heartbeat').upsert({
  name: 'ingest',
  at: new Date().toISOString(),
  detail: { boards: BOARDS.length, jobs: jobs.length, closed: gone.length, matches: written,
            errors: errors.map((e) => e.source), seconds: +((Date.now() - t0) / 1000).toFixed(1) }
}, { onConflict: 'name' }).then(({ error }) => { if (error) pending.push('ops_heartbeat'); });

// Keep the editable source list in step with the code's list, so an admin screen has rows to
// show the day it exists. Does nothing until migration 007 is applied.
await db.from('job_sources').upsert(
  BOARDS.map((b) => ({ system: b.system, slug: b.slug, label: b.label, country: b.country ?? null })),
  { onConflict: 'system,slug', ignoreDuplicates: true }
).then(({ error }) => { if (error) pending.push('job_sources'); });

if (pending.length) console.log(`  (${pending.join(' + ')} not in the database yet — apply migration 007)`);
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${jobs.length} jobs · ${gone.length} closed · ${written} matches`);
