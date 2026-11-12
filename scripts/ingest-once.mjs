// One pass of the worker: answer what can be answered, read the boards, store the jobs, settle
// what closed, score for every user, and leave a pulse saying it happened.
//
//   node scripts/ingest-once.mjs          # once, by hand
//   .github/workflows/worker.yml          # the same pass, every hour, on a hosted runner
//
// Needs SUPABASE_SERVICE_KEY, because writing to `jobs` has to bypass row-level security. On
// this machine it comes from .env.local (gitignored, chmod 600); on the server from the
// platform's secret store. It never belongs in the browser or in git. See scripts/env.mjs.
//
// Nothing printed here names a person. These lines end up in a host's log viewer, and who is
// looking for work is not that host's business: people are a short id, never a name.

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';   // Node 20 has no native WebSocket; this script never uses realtime, but the client wants one
import { fetchAll, fingerprintOf, checkLink, autoApplyable } from '../packages/engine/src/sources.js';
import { awaitingProof, isPaused } from '../packages/engine/src/applications.js';
import { BOARDS } from '../packages/engine/src/boards.js';
import { scoreJob, filterReason, normaliseProfile } from '../packages/engine/src/score.js';
import { answerPending } from './answer-questions.mjs';
import { loadEnv } from './env.mjs';

const env = await loadEnv();
const url = env.VITE_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('\nSUPABASE_SERVICE_KEY (and the project URL) are not set.');
  console.error('On this machine: Supabase dashboard → Project Settings → API Keys → service_role → copy,');
  console.error('then one line in .env.local:  SUPABASE_SERVICE_KEY=eyJ...');
  console.error('On the server: the same two names, in the platform\'s secret store.\n');
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });
const t0 = Date.now();
const who = (p) => 'user ' + String(p.id).slice(0, 8);

/**
 * Every row a query matches. One request stops at a thousand rows and says nothing about the
 * rest: with 1,370 open postings, 370 of them were never looked at when deciding what had
 * closed. `build` makes the query afresh for each page; `by` is a column that orders it.
 */
const PAGE = 1000;
async function everyRow(build, by = 'id') {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().order(by).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return out;
  }
}
/** The same patch for many rows — in slices, because a list of ids travels in the address. */
async function patchJobs(ids, patch) {
  for (let i = 0; i < ids.length; i += 150) {
    const { error } = await db.from('jobs').update(patch).in('id', ids.slice(i, i + 150));
    if (error) console.warn('  ! jobs update: ' + error.message);
  }
}

// ── one worker at a time ──
// The laptop and the server will both hold this script for a while, and two passes at once
// ask the model the same questions twice and race each other over what closed. A pass leaves
// a marker when it starts and takes it away when it ends; a marker older than a pass can last
// belongs to one that died, and is ignored.
const RUNNING = 'ingest:running', RUN_LIMIT_MIN = 30;
// How often a pass is meant to happen where this one runs — written into the pulse, because
// "late" means nothing without it: a quarter of an hour on the laptop, an hour on the runner.
const EVERY_MIN = Math.max(5, Number(env.QADDIM_EVERY_MIN) || 15);
{
  const { data: other } = await db.from('ops_heartbeat').select('at, detail').eq('name', RUNNING).maybeSingle();
  if (other && Date.now() - new Date(other.at).getTime() < RUN_LIMIT_MIN * 60_000) {
    console.log(`another pass started ${Math.round((Date.now() - new Date(other.at).getTime()) / 60000)} min ago (${other.detail?.host ?? 'elsewhere'}) — leaving it to finish`);
    process.exit(0);
  }
  await db.from('ops_heartbeat').upsert({ name: RUNNING, at: new Date().toISOString(), detail: { host: env.QADDIM_HOST || 'laptop' } }, { onConflict: 'name' });
}
const lastPulse = await db.from('ops_heartbeat').select('at').eq('name', 'ingest').maybeSingle().then(({ data }) => (data ? new Date(data.at).getTime() : 0));
const finish = async (code) => { await db.from('ops_heartbeat').delete().eq('name', RUNNING); process.exit(code); };
// Told to stop — the server is being replaced, or someone pressed ctrl-c. The marker goes with
// it, so the next pass does not wait half an hour for one that is no longer running.
for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => { console.log(`${sig} — stopping`); finish(130).catch(() => process.exit(130)); });

// First, before six minutes of reading boards: the questions that stopped someone's
// application, for the people who asked to have them answered by estimate. Whatever goes
// wrong here must not cost a cycle of ingestion.
try { await answerPending({ db, env }); } catch (e) { console.warn('  ! answers: ' + (e?.message ?? e)); }

console.log(`reading ${BOARDS.length} boards…`);
const { jobs, errors, partial } = await fetchAll(BOARDS, { pauseMs: 150 });
for (const e of errors) console.warn('  ! ' + e.source + ': ' + e.error);
for (const p of partial) console.warn('  ~ ' + p.source + ': ' + p.why);
console.log(`  ${jobs.length} postings`);
// Not one board answered: that is this machine's network, not fifty-six employers closing at
// once. Nothing is stored, nothing is closed, and no pulse is left — so the silence shows.
if (!jobs.length) { console.error('no board answered — nothing done'); await finish(1); }

const now = new Date().toISOString();
const rows = jobs.map((j) => ({
  id: j.id, title: j.title, company: j.company, location: j.location, city: j.city,
  country: j.country, arrangement: j.arrangement, salary_published: j.salary_published,
  description: j.description, url: j.url, canonical_url: j.canonical_url,
  source: j.source, source_type: j.source_type, source_job_id: j.source_job_id,
  published_at: j.published_at, last_seen: now, is_open: true
}));
const { error: upErr } = await db.from('jobs').upsert(rows, { onConflict: 'id' });
if (upErr) { console.error('upsert failed:', upErr.message); await finish(1); }
console.log(`  stored`);

// A posting the board still lists is a posting that still exists — that is what verifies it.
// Rows carrying the lifecycle columns are only written when the database has them, so this
// worker keeps running against a project where migration 007 has not been pasted yet.
const HAS_LIFECYCLE = await db.from('jobs').select('status').limit(1)
  .then(({ error }) => !error).catch(() => false);
if (HAS_LIFECYCLE) {
  await patchJobs(rows.map((r) => r.id), { status: 'verified', verified_at: now, checked_at: now, check_status: 200 });
}

// Close what has disappeared from a board — but only from a board that answered in full.
//
// "The board answered and this job was not in it" is the whole evidence, so the answer has to
// be a complete one. Three kinds of answer are not:
//   · the adapter said so itself (a page of the listing would not load);
//   · the board lists under half of what it listed last time. That is a failed read far more
//     often than a company closing most of its roles at once — and if it is real, it will
//     still be true in six hours, when it is believed;
//   · the pass before this one was long ago, so "last time" is too old to compare against.
const lived = new Set(jobs.map((j) => j.source));
const halfRead = new Set(partial.map((p) => p.source));
const seen = new Set(jobs.map((j) => j.id));
const known = await everyRow(() => db.from('jobs').select('id, source, last_seen').eq('is_open', true));
const listed = new Map(), missing = new Map();
for (const k of known) {
  listed.set(k.source, (listed.get(k.source) ?? 0) + 1);
  if (lived.has(k.source) && !seen.has(k.id)) { if (!missing.has(k.source)) missing.set(k.source, []); missing.get(k.source).push(k); }
}
const DOUBT_ABOVE = 0.5, DOUBT_MIN = 8, BELIEVE_AFTER_MS = 6 * 3600e3, FRESH_PULSE_MS = Math.max(2 * 3600e3, 3 * EVERY_MIN * 60e3);
const gone = [], doubted = [];
for (const [source, list] of missing) {
  if (halfRead.has(source)) { doubted.push(`${source} (incomplete read)`); continue; }
  const suspicious = listed.get(source) >= DOUBT_MIN && list.length / listed.get(source) > DOUBT_ABOVE;
  if (!suspicious) { gone.push(...list.map((k) => k.id)); continue; }
  // Believed only for what has been missing through six hours of regular passes.
  const settled = Date.now() - lastPulse < FRESH_PULSE_MS
    ? list.filter((k) => Date.now() - new Date(k.last_seen).getTime() > BELIEVE_AFTER_MS) : [];
  gone.push(...settled.map((k) => k.id));
  if (settled.length < list.length) doubted.push(`${source} (${list.length} of ${listed.get(source)} missing)`);
}
if (doubted.length) console.warn('  ~ not closing on: ' + doubted.join(', '));
if (gone.length) await patchJobs(gone, { is_open: false, ...(HAS_LIFECYCLE ? { status: 'closed', closed_at: now } : {}) });

// Postings whose board stopped answering are not closed — we simply did not hear. But one
// that has not been seen for a month is not a live vacancy either, and 94 of them were being
// offered to users, some dated 2021.
const STALE_DAYS = 30;
const staleBefore = new Date(Date.now() - STALE_DAYS * 864e5).toISOString();
const stale = await everyRow(() => db.from('jobs').select('id').eq('is_open', true).lt('last_seen', staleBefore));
if (stale?.length) {
  await patchJobs(stale.map((x) => x.id), { is_open: false, ...(HAS_LIFECYCLE ? { status: 'expired', closed_at: now } : {}) });
  console.log(`  ${stale.length} expired (unseen for ${STALE_DAYS} days)`);
}

// And postings the board still lists but published over a year ago. An applicant tracking
// system rarely deletes anything, so an evergreen advert from 2021 sits there for ever — 27
// of them were being offered as current openings.
const AGE_LIMIT_DAYS = 365;
const bornBefore = new Date(Date.now() - AGE_LIMIT_DAYS * 864e5).toISOString().slice(0, 10);
const ancient = await everyRow(() => db.from('jobs').select('id').eq('is_open', true).lt('published_at', bornBefore));
if (ancient?.length) {
  await patchJobs(ancient.map((x) => x.id), { is_open: false, ...(HAS_LIFECYCLE ? { status: 'expired', closed_at: now } : {}) });
  console.log(`  ${ancient.length} expired (published over a year ago)`);
}

// An employer that re-posts a role leaves the old advert on the board. Both are "open" and
// both reach users, so the 2024 posting is offered beside the 2026 one. Only the newest of a
// fingerprint stays open; the rest are closed as superseded, not deleted.
const REPOST_GAP_DAYS = 45;
const openNow = await everyRow(() => db.from('jobs')
  .select('id, title, company, city, published_at, first_seen')
  .eq('is_open', true));
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
  await patchJobs(superseded, { is_open: false, ...(HAS_LIFECYCLE ? { status: 'closed', closed_at: now } : {}) });
  console.log(`  ${superseded.length} superseded by a newer posting of the same role`);
}

// Is the posting still on the employer's page? A feed listing it is not evidence — boards
// keep advertising roles whose pages have gone. Oldest unchecked first, a bounded slice per
// run so a sweep stays short, and only an outright 404/410 closes anything.
if (HAS_LIFECYCLE) {
  const PER_RUN = 120;
  const { data: due } = await db.from('jobs')
    .select('id, url, source, source_job_id, checked_at')
    .eq('is_open', true)
    .order('checked_at', { ascending: true, nullsFirst: true })
    .limit(PER_RUN);

  let gone = 0, checked = 0, unknown = 0;
  for (const j of due ?? []) {
    const r = await checkLink(j);
    if (r.ok === null) { unknown++; continue; }          // a timeout decides nothing
    checked++;
    const patch = { checked_at: now, check_status: r.status };
    if (r.ok) Object.assign(patch, { status: 'verified', verified_at: now });
    else { Object.assign(patch, { is_open: false, status: 'rejected', closed_at: now }); gone++; }
    await db.from('jobs').update(patch).eq('id', j.id);
    await new Promise((r2) => setTimeout(r2, 120));      // be a polite visitor
  }
  console.log(`  links: ${checked} checked, ${gone} gone, ${unknown} no answer`);
}

// A queue nothing will ever drain. my_apply_queue only hands out open jobs, so an application
// whose posting closed while it waited sat at "في الطابور" for good, counted as pending work;
// and one on a system the extension cannot fill was opened, failed, and left as "needs you"
// with nothing a person could do about it. Both are settled here, every run.
{
  const waiting = await everyRow(() => db.from('applications')
    .select('id, auto_status, auto_report, job:jobs(url, is_open)').in('auto_status', ['queued', 'needs_you']));
  // Not the ones whose send was pressed and never confirmed. Marking one of those "closed" —
  // which means dismissed before applying — would bury an application that may well be in.
  const idle = (waiting ?? []).filter((a) => !awaitingProof(a));
  const shut = idle.filter((a) => a.job && a.job.is_open === false).map((a) => a.id);
  const byHand = idle.filter((a) => a.job && a.job.is_open !== false && !autoApplyable(a.job.url)).map((a) => a.id);
  if (shut.length) {
    await db.from('applications')
      .update({ status: 'closed', auto_status: null, auto_reason: 'أُغلق الإعلان قبل أن يُرسل الطلب' }).in('id', shut);
  }
  if (byHand.length) {
    await db.from('applications')
      .update({ auto_status: null, auto_reason: 'نظام يطلب حساباً عند الشركة — التقديم عليه من صفحته' }).in('id', byHand);
  }
  if (shut.length || byHand.length) console.log(`  queue: ${shut.length} closed posting(s) cleared, ${byHand.length} moved to apply-by-hand`);
}

const byId = new Map(jobs.map((j) => [j.id, j]));
const profiles = await everyRow(() => db.from('profiles').select('*').eq('onboarded', true));
console.log(`scoring for ${profiles?.length ?? 0} user(s)…`);
let written = 0, queuedAuto = 0;
for (const p of profiles ?? []) {
  const profile = normaliseProfile(p);
  const already = await everyRow(() => db.from('matches').select('job_id').eq('user_id', p.id), 'job_id');
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

  // Queue the strong ones without being asked, if that is what they asked for. The caps that
  // decide what actually gets sent live in my_apply_queue; this only decides what is offered
  // to it, so over-queueing here cannot turn into over-applying.
  let auto = 0;
  // (Not for someone who has stopped everything. What they would have been offered stays in
  // their matches, to be picked by hand.)
  if (p.auto_queue && p.auto_apply && !isPaused(p)) {
    const bar = Math.max(50, p.auto_queue_above ?? 75);
    // Strong, and on a system the extension can actually send on.
    const strong = batch.filter((m) => m.score >= bar && autoApplyable(byId.get(m.job_id)?.url));
    if (strong.length) {
      const have = await everyRow(() => db.from('applications').select('job_id').eq('user_id', p.id), 'job_id');
      const seenJobs = new Set((have ?? []).map((a) => a.job_id));
      const rows = strong.filter((m) => !seenJobs.has(m.job_id)).map((m) => ({
        user_id: p.id, job_id: m.job_id, status: 'saved',
        auto_status: 'queued', queued_by: 'auto'
      }));
      if (rows.length) {
        const { error } = await db.from('applications').upsert(rows, { onConflict: 'user_id,job_id', ignoreDuplicates: true });
        if (error) console.warn('  ! auto-queue:', error.message); else auto = rows.length;
      }
    }
  }

  queuedAuto += auto;
  if (env.QADDIM_VERBOSE) console.log(`  ${who(p)}: ${batch.length} new match(es)${auto ? ` · ${auto} queued automatically` : ''}`);
}
// One line for everyone together. Where this runs the log may be public, and "this person got
// four matches and two went out" is theirs to know, not a reader's — per-person lines are
// printed only when asked for (QADDIM_VERBOSE=1), on a machine whose log is private.
console.log(`  ${written} new match(es)${queuedAuto ? ` · ${queuedAuto} queued automatically` : ''}`);

// Bookkeeping that must never cost a pass: what went wrong is said in one line, in the
// database's own words. (It used to say "apply migration 007" whatever the reason — for weeks
// the real one was a constraint that did not know Workday, which migration 012 corrects.)
const pending = [];

// A pulse, so a stall is visible. The worker ran only three times in 46 hours while the Mac
// slept and nothing said so; anything that can read this row can now tell how long it has been.
await db.from('ops_heartbeat').upsert({
  name: 'ingest',
  at: new Date().toISOString(),
  detail: { boards: BOARDS.length, jobs: jobs.length, closed: gone.length, matches: written,
            errors: errors.map((e) => e.source), partial: partial.map((p) => p.source), doubted,
            host: env.QADDIM_HOST || 'laptop', every_min: EVERY_MIN, seconds: +((Date.now() - t0) / 1000).toFixed(1) }
}, { onConflict: 'name' }).then(({ error }) => { if (error) pending.push('ops_heartbeat: ' + error.message); });

// Keep the editable source list in step with the code's list, so an admin screen has rows to
// show the day it exists. Does nothing until migration 007 is applied.
await db.from('job_sources').upsert(
  BOARDS.map((b) => ({ system: b.system, slug: b.slug, label: b.label, country: b.country ?? null })),
  { onConflict: 'system,slug', ignoreDuplicates: true }
).then(({ error }) => { if (error) pending.push('job_sources: ' + error.message); });

for (const line of pending) console.log('  ! ' + line.slice(0, 200));
console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s · ${jobs.length} jobs · ${gone.length} closed · ${written} matches`);
await finish(0);
