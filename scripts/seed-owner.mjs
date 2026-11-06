// Creates the owner's own account and fills the profile from the answer bank he already wrote,
// then hands back a one-click sign-in link. Admin API only — run from your machine, never the browser.
//
//   node scripts/seed-owner.mjs you@example.com
//
// Re-running is safe: an existing account is reused, the profile is updated, the CV is replaced.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await readFile(new URL('.env.local', root), 'utf8')).split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws }
});

const email = process.argv[2];
if (!email) { console.error('usage: node scripts/seed-owner.mjs you@example.com'); process.exit(2); }

// What he already told the job agent — reused rather than asked again.
const ANSWERS = '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/answers.json';
const a = existsSync(ANSWERS) ? JSON.parse(await readFile(ANSWERS, 'utf8')) : {};

const profile = {
  full_name: a.full_name ?? null,
  phone: a.phone ?? null,
  email_for_applications: a.email ?? email,
  nationality: a.nationality ?? null,
  work_authorization: a.work_authorization ?? null,
  requires_sponsorship: a.requires_sponsorship ? /^y|yes|نعم/i.test(a.requires_sponsorship) : false,
  salary_expectation: a.salary_expectation ?? null,
  current_salary: a.current_salary ?? null,
  notice_period: a.notice_period ?? null,
  current_company: a.current_company ?? null,
  current_title: a.current_title ?? null,
  linkedin_url: a.linkedin ?? null,
  education_degree: a.education_degree ?? null,
  university: a.university ?? null,
  graduation_year: a.graduation_year ? Number(a.graduation_year) : null,
  years_experience: a.years_experience ? Number(a.years_experience) : 0,
  answers: a.extra ?? {},
  // the shape of his search, as established with the job agent
  roles: ['product', 'business_analysis', 'data', 'digital_transformation', 'product_ops', 'tech_ops'],
  skill_areas: ['product', 'ba', 'data', 'ai', 'dt', 'ops', 'design'],
  extra_skills: [],
  cities: ['riyadh'],
  countries: ['sa'],
  accept_remote: true,
  avoid_software_roles: true,
  min_score: 70,
  ui_language: 'ar',
  onboarded: true,
  updated_at: new Date().toISOString()
};

// 1. the account
let { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
let user = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  const { data, error } = await db.auth.admin.createUser({
    email, email_confirm: true, user_metadata: { full_name: profile.full_name }
  });
  if (error) { console.error('createUser:', error.message); process.exit(1); }
  user = data.user;
  console.log('account created');
} else {
  console.log('account already existed');
}

// 2. the profile (the signup trigger made the row; this fills it)
const { error: pErr } = await db.from('profiles').upsert({ id: user.id, ...profile }, { onConflict: 'id' });
if (pErr) { console.error('profile:', pErr.message); process.exit(1); }
console.log('profile filled:', Object.values(profile).filter((v) => v !== null && v !== '' ).length, 'fields');

// 3. the CV
const cv = a.cv_path;
if (cv && existsSync(cv)) {
  const bytes = await readFile(cv);
  const key = `${user.id}/${Date.now()}_${cv.split('/').pop()}`;
  const { error: sErr } = await db.storage.from('cvs').upload(key, bytes, { contentType: 'application/pdf', upsert: true });
  if (sErr) console.warn('cv upload:', sErr.message);
  else {
    await db.from('profiles').update({ cv_path: key, cv_uploaded_at: new Date().toISOString() }).eq('id', user.id);
    console.log('cv uploaded:', cv.split('/').pop());
  }
} else {
  console.log('no cv found to upload');
}

// 4. a link he can click once, instead of waiting on email delivery
const { data: link, error: lErr } = await db.auth.admin.generateLink({
  type: 'magiclink', email, options: { redirectTo: process.env.REDIRECT ?? 'http://localhost:5190' }
});
if (lErr) console.warn('link:', lErr.message);
else console.log('\nsign in with this link (valid once):\n' + link.properties.action_link);
