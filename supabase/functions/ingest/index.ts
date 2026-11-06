// Runs every 15 minutes: read the boards, store new postings, score them for every user.
//
// Deployed as a Supabase Edge Function and called by pg_cron. It is the only thing that writes
// to `jobs` and `matches`, and it uses the service-role key — which therefore never reaches a browser.
//
//   supabase functions deploy ingest --no-verify-jwt
//
// Protected by a shared secret so only the cron job can trigger it.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchAll } from '../_shared/sources.js';
import { scoreJob, filterReason, normaliseProfile } from '../_shared/score.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const INGEST_SECRET = Deno.env.get('INGEST_SECRET') ?? '';

type Source = { system: string; slug: string; label: string };

/** The boards we read. Adding a company is one line here. */
const SOURCES: Source[] = [
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

Deno.serve(async (req) => {
  if (INGEST_SECRET && req.headers.get('x-ingest-secret') !== INGEST_SECRET) {
    return json({ error: 'forbidden' }, 403);
  }
  const started = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // 1. Read every board. A broken one is recorded, never fatal.
  const { jobs, errors } = await fetchAll(SOURCES, { pauseMs: 150 });

  // 2. Store the postings. Seeing one again only refreshes last_seen.
  const now = new Date().toISOString();
  const rows = jobs.map((j: any) => ({
    id: j.id, title: j.title, company: j.company, location: j.location, city: j.city,
    country: j.country, arrangement: j.arrangement, salary_published: j.salary_published,
    description: j.description, url: j.url, canonical_url: j.canonical_url,
    source: j.source, source_type: j.source_type, source_job_id: j.source_job_id,
    published_at: j.published_at, last_seen: now, is_open: true
  }));
  const { error: upsertErr } = await db.from('jobs').upsert(rows, { onConflict: 'id' });
  if (upsertErr) return json({ error: upsertErr.message, stage: 'upsert' }, 500);

  // A posting that has vanished from its own board is closed, but only when that board answered.
  const livedSources = new Set(jobs.map((j: any) => j.source));
  const seenIds = new Set(jobs.map((j: any) => j.id));
  const { data: known } = await db.from('jobs').select('id, source').eq('is_open', true);
  const gone = (known ?? []).filter((k) => livedSources.has(k.source) && !seenIds.has(k.id)).map((k) => k.id);
  if (gone.length) await db.from('jobs').update({ is_open: false }).in('id', gone);

  // 3. Score for every user who finished onboarding.
  const { data: profiles } = await db.from('profiles').select('*').eq('onboarded', true);
  let written = 0;
  for (const p of profiles ?? []) {
    const profile = normaliseProfile({
      roles: p.roles, skill_areas: p.skill_areas, extra_skills: p.extra_skills,
      years_experience: p.years_experience, cities: p.cities, countries: p.countries,
      accept_remote: p.accept_remote, avoid_software_roles: p.avoid_software_roles,
      exclude_companies: p.exclude_companies, exclude_title_words: p.exclude_title_words,
      min_score: p.min_score
    });
    // Only score what this user has not been shown yet.
    const { data: already } = await db.from('matches').select('job_id').eq('user_id', p.id);
    const seen = new Set((already ?? []).map((m) => m.job_id));
    const batch: any[] = [];
    for (const j of jobs) {
      if (seen.has(j.id)) continue;
      if (filterReason(j, profile)) continue;
      const s = scoreJob(j, profile);
      if (s.total < profile.min_score) continue;
      batch.push({
        user_id: p.id, job_id: j.id, score: s.total, reasons: s.reasons,
        gaps: s.gaps, flags: s.flags, breakdown: s.breakdown
      });
    }
    if (batch.length) {
      const { error } = await db.from('matches').upsert(batch, { onConflict: 'user_id,job_id' });
      if (!error) written += batch.length;
    }
  }

  return json({
    ok: true,
    sources: SOURCES.length,
    fetched: jobs.length,
    closed: gone.length,
    users: profiles?.length ?? 0,
    matches_written: written,
    errors,
    ms: Date.now() - started
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}
