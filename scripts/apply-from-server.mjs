// The server's browser: applies for the people who asked for it, with no computer of theirs on.
//
//   node scripts/apply-from-server.mjs          # what .github/workflows/apply.yml runs
//
// It adds no new way of applying. It *is* the extension — the same files, the same rules, the
// same record of every press — loaded into a browser on this machine instead of the person's
// own, and handed their session the way their own browser hands it over: by opening the site
// signed in as them. Everything the extension refuses to do, it refuses here: no press without
// a record, no "sent" without the employer's page saying so, nothing sent twice, nothing at all
// while its owner has stopped everything.
//
// Who it acts for: only people who switched on «وقدّم من الخادم» (answers._settings.server),
// only while something of theirs is waiting in the queue, and only for the minutes that takes.
// To act as someone it opens a session for them with a one-time link it issues itself (the
// service key allows that; no mail is sent) and ends that session when it is done.
//
// What it does not do: get past a check. A form that wants a human, or an employer that turns
// a server's browser away, ends as what it is — "needs you", or "pressed, not confirmed".
//
// Nothing printed here names a person, an employer or a job: where this runs, the log is public.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadEnv, projectRef } from './env.mjs';
import { isPaused } from '../packages/engine/src/applications.js';
import { autoApplyable } from '../packages/engine/src/sources.js';

// ── what an employer's site said back ──
// When the server presses send and the page never says "thank you", the question is whether
// the application reached the employer at all. The page cannot be shown to anyone (it holds
// the person's details, and this log is public), so what is kept is its shape: which kind of
// request the page sent, and the status it got back — ids taken out of the address, nothing
// of the body. A 403 to the apply endpoint says "turned away"; a 200 says "taken".
// Only generic words survive; any other part of the address (an employer's name, a job id) is ':x'.
const WORDS = new Set(['api', 'v1', 'v2', 'v3', 'jobs', 'job', 'j', 'apply', 'application', 'applications', 'candidates', 'candidate', 'submit', 'form', 'forms', 'upload', 'uploads', 'files', 'resume', 'questions', 'answers', 'graphql', 'postings', 'non-user-graphql', 'embed']);
const shapeOf = (url) => { try { const u = new URL(url); return u.host + u.pathname.split('/').map((x) => (!x || WORDS.has(x.toLowerCase()) ? x : ':x')).join('/'); } catch { return '?'; } };
function watchSends(ctx) {
  const seen = [];
  ctx.on('response', (res) => {
    const req = res.request();
    if (!['POST', 'PUT'].includes(req.method()) || !autoApplyable(req.url())) return;
    seen.push(`${req.method()} ${shapeOf(req.url())} → ${res.status()}`);
  });
  ctx.on('requestfailed', (req) => {
    if (['POST', 'PUT'].includes(req.method()) && autoApplyable(req.url())) seen.push(`${req.method()} ${shapeOf(req.url())} → failed (${req.failure()?.errorText ?? '?'})`);
  });
  return seen;
}
/** Each employer tab still open at the end — the extension leaves one open after an unconfirmed press. */
async function lookAt(ctx) {
  const out = [];
  for (const pg of ctx.pages()) {
    if (!autoApplyable(pg.url())) continue;
    out.push(await pg.evaluate(() => {
      const val = (sel) => { const el = document.querySelector(sel); return el ? (el.value ? 'passed' : 'empty') : 'none'; };
      const t = document.body ? document.body.innerText : '';
      const btn = Array.from(document.querySelectorAll('button[type=submit], button')).find((b) => /submit|apply|send|إرسال|قدّم/i.test(b.textContent || ''));
      return [
        `turnstile ${val('input[name="cf-turnstile-response"]')}`, `recaptcha ${val('textarea[name="g-recaptcha-response"]')}`,
        `hcaptcha ${val('textarea[name="h-captcha-response"]')}`,
        `errors on page ${(t.match(/is required|please (fix|correct|complete)|something went wrong|there (was|were) (an? )?(error|problem)|try again/gi) || []).length}`,
        `bot wording ${/verify (that )?you are (a )?human|are you a robot|unusual (traffic|activity)|blocked|suspicious|captcha/i.test(t) ? 'yes' : 'no'}`,
        `send button ${btn ? (btn.disabled ? 'there, disabled' : 'still there') : 'gone'}`
      ].join(' · ');
    }).catch(() => 'could not read the page'));
  }
  return out;
}

const env = await loadEnv();
const API = env.VITE_SUPABASE_URL, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY, SRV = env.SUPABASE_SERVICE_KEY;
if (!API || !PUB || !SRV) { console.error('VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SERVICE_KEY must be set'); process.exit(2); }
const SITE = (env.QADDIM_SITE || 'https://sultanhad.github.io/qaddim/').replace(/\/?$/, '/');
const EXT = fileURLToPath(new URL('../extension', import.meta.url));
const PER_PERSON_MS = Math.max(2, Number(env.QADDIM_APPLY_MINUTES) || 15) * 60_000;
// For trying this out, and only for that:
//   QADDIM_ONLY_USER     act for this one account, even with nothing queued
//   QADDIM_NEVER_SUBMIT  the extension's own lock: it fills and never presses
const ONLY = env.QADDIM_ONLY_USER || null;
// Systems the server does not send on, measured: on Workable the page disables its send button
// after the press and sends no application — it waits on a bot check a server does not pass,
// and this does not try to get past it. Those applications stay queued for the person's own
// Chrome, which sends them (the first confirmed application, Mozn, went that way).
export const SERVER_SKIPS = ['apply.workable.com'];
const NEVER = env.QADDIM_NEVER_SUBMIT === '1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hide = (secret) => { if (process.env.GITHUB_ACTIONS && secret) console.log('::add-mask::' + secret); };
async function call(path, { key = SRV, token = SRV, ...init } = {}) {
  const res = await fetch(API + path, { ...init, headers: { apikey: key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  const text = await res.text();
  let body = null; try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }
  // Never the body in an error: it can carry an address.
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path.split('?')[0]}`);
  return body;
}

// ── who ──
const asked = await call('/rest/v1/profiles?select=id,auto_apply,answers&onboarded=eq.true&answers->_settings->>server=eq.true' + (ONLY ? `&id=eq.${ONLY}` : ''));
const people = [];
for (const p of asked ?? []) {
  if (!p.auto_apply || isPaused(p)) continue;
  const waiting = (await call(`/rest/v1/applications?select=id,job:jobs(url)&user_id=eq.${p.id}&status=eq.saved&auto_status=eq.queued`) ?? [])
    .filter((a) => { try { return !SERVER_SKIPS.includes(new URL(a.job?.url).hostname); } catch { return true; } });
  if (waiting?.length || ONLY) people.push(p);
}
console.log(`${asked?.length ?? 0} asked for the server · ${people.length} with something waiting${NEVER ? ' · fill only, nothing is pressed' : ''}`);
if (!people.length) process.exit(0);

/** A session as this person, from a one-time link nobody is sent. */
async function sessionFor(userId) {
  const user = await call(`/auth/v1/admin/users/${userId}`);
  const link = await call('/auth/v1/admin/generate_link', { method: 'POST', body: JSON.stringify({ type: 'magiclink', email: user.email }) });
  const hashed = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!hashed) throw new Error('no one-time link was issued');
  const session = await call('/auth/v1/verify', { method: 'POST', key: PUB, token: PUB, body: JSON.stringify({ type: 'magiclink', token_hash: hashed }) });
  if (!session?.access_token) throw new Error('the one-time link did not open a session');
  hide(session.access_token); hide(session.refresh_token);
  return session;
}

const tally = { people: 0, handled: 0, confirmed: 0, unverified: 0, code: 0, rejected: 0, needs_you: 0, failed: 0 };
for (const [i, person] of people.entries()) {
  const who = `person ${i + 1} of ${people.length}`;
  const began = new Date().toISOString();
  let ctx = null, dir = null, session = null;
  try {
    session = await sessionFor(person.id);
    dir = await mkdtemp(join(tmpdir(), 'qaddim-apply-'));
    ctx = await chromium.launchPersistentContext(dir, {
      headless: true, channel: 'chromium',
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
    });
    const sends = watchSends(ctx);
    const sw = ctx.serviceWorkers().find((w) => w.url().endsWith('src/background.js')) ?? await ctx.waitForEvent('serviceworker', { timeout: 20000 });
    await sw.evaluate(([never, skip]) => chrome.storage.local.set({ settings: { ...(never ? { neverSubmit: true } : {}), skipHosts: skip } }), [NEVER, SERVER_SKIPS]);

    // Signed in the way the site itself remembers a sign-in, then opened where it hands the
    // session to the extension. From there the extension is on its own.
    const page = await ctx.newPage();
    await page.goto(SITE, { waitUntil: 'domcontentloaded' });
    await page.evaluate(([k, v]) => localStorage.setItem(k, v),
      [`sb-${projectRef(API)}-auth-token`, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600) })]);
    await page.goto(SITE + '#jobs', { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const state = () => sw.evaluate(() => chrome.storage.local.get(['session', 'running', 'log']));
    let handed = false;
    for (const until = Date.now() + 60_000; Date.now() < until && !handed; await sleep(1500)) handed = !!(await state()).session?.token;
    if (!handed) throw new Error('the site did not hand the session to the extension');

    // The handover starts a run. Wait for it — and for any the extension's own two-minute poll
    // starts after it — to finish, within this person's share of the time.
    const deadline = Date.now() + PER_PERSON_MS;
    await sleep(8000);
    for (let idle = 0; Date.now() < deadline && idle < 3; await sleep(5000)) idle = (await state()).running ? 0 : idle + 1;

    const done = await call(`/rest/v1/applications?select=auto_status,auto_report&user_id=eq.${person.id}&auto_at=gte.${encodeURIComponent(began)}`);
    tally.people++;
    for (const a of done ?? []) {
      tally.handled++;
      const outcome = a.auto_report?.sent?.outcome;
      if (outcome && outcome in tally) tally[outcome]++;
      else if (a.auto_status === 'failed') tally.failed++;
      else if (a.auto_status === 'needs_you') tally.needs_you++;
    }
    for (const line of sends) console.log(`  sent by the page: ${line}`);
    for (const line of await lookAt(ctx)) console.log(`  left open after a press: ${line}`);
    const last = (await state()).log?.[0];
    console.log(`${who}: session handed over · ${done?.length ?? 0} application(s) handled${last?.status === 'error' ? ' · the extension said: ' + String(last.reason).slice(0, 80) : ''}`);
  } catch (e) {
    console.log(`${who}: stopped — ${String(e?.message ?? e).slice(0, 120)}`);
  } finally {
    await ctx?.close().catch(() => { });
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => { });
    // The session this made is ended; the person's own sign-ins are not touched.
    if (session?.access_token) await call('/auth/v1/logout?scope=local', { method: 'POST', key: PUB, token: session.access_token }).catch(() => { });
  }
}

console.log(`\n${tally.people} person(s) · ${tally.handled} application(s): ${tally.confirmed} confirmed by the employer's page · ${tally.unverified} pressed, not confirmed · `
  + `${tally.code} waiting for a code · ${tally.rejected} handed back by the form · ${tally.needs_you} need their owner · ${tally.failed} failed`);
