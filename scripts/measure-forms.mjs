// How many employer forms could be sent with nobody touching them — measured, not assumed.
//
//   node scripts/measure-forms.mjs                  # 20 jobs per hiring system, bundled Chromium
//   node scripts/measure-forms.mjs --browser chrome # the same, in the installed Google Chrome
//   node scripts/measure-forms.mjs --per 5 --only lever,ashby
//   node scripts/measure-forms.mjs --like docs/قياس-الاستمارات.chromium.json   # the same jobs again
//
// Twenty forms per system means one form is five points of that system: new jobs arriving
// between two runs move the result by more than most fixes do. `--like` re-reads the jobs of an
// earlier run, so a before and an after are the same forms and the difference is the change.
//
// READ-ONLY. It opens each open job's application page in a headless browser — the conditions
// a worker on a server would have — and looks: it types nothing, ticks nothing, attaches
// nothing, and presses nothing. The only thing it ever does to a page is load it, the way the
// ingest worker already loads these same sites every fifteen minutes.
//
// It reads with the extension's own reader (extension/src/read.js) and answers with its own
// rules (fields.js), against the profile shape the site really sends (extension-profile.js) —
// so a change to any of the three shows up here as a number.
//
// What it can see: whether the form could be read, which required questions a finished
// profile has no answer for, and whether a human check is on the page. What it cannot see is
// whether an *invisible* check would refuse a send — that only shows when a real application
// goes out, so those forms are counted on their own rather than guessed into either column.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/node_modules/playwright/index.mjs';
import { forExtension } from '../apps/web/src/extension-profile.js';

const root = new URL('../', import.meta.url).pathname;
const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const PER = Number(arg('per', 20));
const BROWSER = arg('browser', 'chromium');
const ONLY = arg('only', '').split(',').filter(Boolean);
const LIKE = arg('like', '');
const SAME = LIKE ? new Set(JSON.parse(await readFile(LIKE, 'utf8')).rows.map((r) => r.id)) : null;

const env = Object.fromEntries((await readFile(root + '.env.local', 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const API = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The same systems, and the same address rules, as extension/src/background.js.
const SYSTEMS = [
  ['workable', /apply\.workable\.com/],
  ['greenhouse', /(^|\.)greenhouse\.io$/],
  ['lever', /jobs\.lever\.co/],
  ['ashby', /jobs\.ashbyhq\.com/],
  ['smartrecruiters', /(jobs|careers)\.smartrecruiters\.com/],
  ['recruitee', /\.recruitee\.com$/]
];
const systemOf = (url) => {
  let host = ''; try { host = new URL(url).hostname; } catch { return null; }
  return SYSTEMS.find(([, re]) => re.test(host))?.[0] ?? null;
};
const APPLY_URL = (url) => {
  if (/jobs\.lever\.co/.test(url)) return /\/apply\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/apply';
  if (/jobs\.ashbyhq\.com/.test(url)) return /\/application\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/application';
  if (/apply\.workable\.com/.test(url)) return /\/apply\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/apply/';
  return url;
};

// A finished profile as it sits in the database, passed through the same function the site
// uses to hand it to the extension. It is only ever compared against labels, never typed.
const PROFILE = forExtension({
  full_name: 'Test Applicant', email_for_applications: 'applicant@example.com', phone: '+966500000000',
  cities: ['riyadh'], nationality: 'سعودي', work_authorization: 'مواطن',
  salary_expectation: '15500 ريال شهرياً', current_salary: '', notice_period: 'شهر',
  current_company: 'Example Co', current_title: 'Product Analyst', years_experience: 5,
  linkedin_url: 'https://linkedin.com/in/example', education_degree: 'بكالوريوس',
  university: 'King Saud University', graduation_year: 2020,
  answers: { _facts: { gender: 'ذكر', date_of_birth: '1995-03-10', marital_status: 'أعزب',
    worked_here_before: 'لا', relatives_here: 'لا' } }
});

// The extension's reader and rules, loaded as they are. Both only look; they are scoped so the
// page's globals stay a visitor's globals.
const HOOK = '__qf' + Math.random().toString(36).slice(2);
const RULES = `(function(){
  ${await readFile(root + 'extension/src/fields.js', 'utf8')}
  ${await readFile(root + 'extension/src/read.js', 'utf8')}
  window['${HOOK}'] = { F: QaddimFields, R: QaddimRead };
})()`;

const CHECKS = [
  ['turnstile', /challenges\.cloudflare\.com|turnstile/i],
  ['recaptcha', /recaptcha/i],
  ['hcaptcha', /hcaptcha\.com/i],
  ['datadome', /datadome|captcha-delivery\.com/i],
  ['other', /perimeterx|px-cdn|arkoselabs|funcaptcha|geetest/i]
];
const WALL = /just a moment|attention required|access denied|verify (that )?you are (a )?human|checking your browser|unusual traffic/i;
const GONE = /no longer (available|accepting|open)|position (has been|is) (filled|closed)|job (is )?(closed|not found|expired)|page not found|doesn'?t exist/i;

async function allJobs() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${API}/rest/v1/jobs?is_open=eq.true&select=id,title,company,url,country,published_at&order=published_at.desc.nullslast`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${from}-${from + 999}` } });
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error('jobs: ' + JSON.stringify(rows).slice(0, 200));
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

/** A form is configured per company, so twenty jobs from one employer measure one form. */
function sample(jobs, n) {
  const byCompany = new Map();
  for (const j of jobs) { if (!byCompany.has(j.company)) byCompany.set(j.company, []); byCompany.get(j.company).push(j); }
  const queues = [...byCompany.values()], out = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) { if (q.length && out.length < n) out.push(q.shift()); }
  }
  return out;
}

/**
 * The extension's questions, each put to the extension's rules — stopping where fill.js would
 * start writing. A choice counts as answered when the profile has an answer for it; whether
 * that answer is among the options only shows once the list is opened, which this never does.
 */
function readForm([hook, profile, ctx]) {
  const { F, R } = window[hook];
  const out = { inputs: 0, required: 0, answered: 0, unanswered: [] };
  for (const item of R.questions()) {
    const { kind, el, q, required } = item;
    out.inputs += item.els ? item.els.length : 1;
    if (kind === 'file') continue;
    if (kind === 'checks') {
      if (!required || item.els.some((c) => c.checked)) continue;
      out.required++;
      const consent = /agree|consent|accept|acknowledge|confirm|privacy|terms|policy|gdpr|أوافق|أقر|الموافقة|الخصوصية|الشروط/i.test(q);
      if (item.els.length > 1 || !consent) out.unanswered.push({ q: q.slice(0, 140), kind, why: 'يختاره صاحبه' });
      else out.answered++;
      continue;
    }
    if (kind === 'text' && el.value && String(el.value).trim() !== '') continue;
    if (required) out.required++;
    const ans = F.answerFor(q, profile, { ...ctx, type: item.type });
    if (ans && ans.value) { out.answered++; continue; }
    if (required) out.unanswered.push({ q: q.slice(0, 140), kind, why: (ans && ans.why) || 'لا إجابة في الملف لهذا السؤال' });
  }
  out.cv_asked = Array.from(document.querySelectorAll('input[type=file]'))
    .some((f) => /resume|cv|curriculum|السيرة|سيرة/i.test(R.labelOf(f) + ' ' + (f.name || '') + ' ' + (f.id || '')));
  const c = R.checks();
  out.widget = c.widget; out.badge = c.silent;
  // A form that is one link away. Followed only when it is a plain address; nothing is clicked.
  const OPEN = /^\s*(apply for this job|apply now|apply|i am interested|i'?m interested)\s*$/i;
  const open = Array.from(document.querySelectorAll('a[href]')).find((a) => OPEN.test(R.txt(a.textContent)) && R.visible(a));
  out.next = out.inputs < 3 && open ? open.href : null;
  out.behind_button = out.inputs < 3 && !open && Array.from(document.querySelectorAll('button')).some((b) => OPEN.test(R.txt(b.textContent)));
  return out;
}

async function readBest(page, ctx) {
  let best = null;
  for (const f of page.frames()) {
    if (f !== page.mainFrame() && !/^https?:/.test(f.url())) continue;
    try {
      await f.evaluate(RULES);
      const r = await f.evaluate(readForm, [HOOK, PROFILE, ctx]);
      if (!best || r.inputs > best.inputs) best = r;
    } catch { /* a frame that went away while we looked */ }
  }
  return best ?? { inputs: 0, required: 0, answered: 0, unanswered: [], cv_asked: false, widget: false, badge: false, next: null };
}

async function measure(ctx, job) {
  const page = await ctx.newPage();
  const seen = new Set();
  page.on('request', (r) => { for (const [k, re] of CHECKS) if (re.test(r.url())) seen.add(k); });
  const row = { id: job.id, company: job.company, title: job.title, url: APPLY_URL(job.url) };
  const t0 = Date.now();
  try {
    const resp = await page.goto(row.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    row.http = resp?.status() ?? null;
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    const ctx = { country: job.country ?? null, company: job.company ?? null };
    let form = await readBest(page, ctx);
    if (form.next) {
      await page.goto(form.next, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      form = await readBest(page, ctx);
    }
    const state = await page.evaluate(() => ({ title: document.title, text: (document.body?.innerText || '').slice(0, 1500) }))
      .catch(() => ({ title: '', text: '' }));
    const widgetFrames = page.frames().map((f) => f.url())
      .filter((u) => /challenges\.cloudflare\.com|recaptcha\/(api2|enterprise)\/(anchor|bframe)|hcaptcha\.com\/captcha/i.test(u));

    Object.assign(row, {
      final: page.url(), inputs: form.inputs, required: form.required, answered: form.answered,
      unanswered: form.unanswered, cv_asked: form.cv_asked,
      widget: !!form.widget, badge: !!form.badge || widgetFrames.length > 0, checks: [...seen],
      behind_button: !!form.behind_button
    });
    // SmartRecruiters answers a headless browser with a DataDome challenge instead of the page:
    // no title to match, no text, only the challenge's own frame.
    const challenged = page.frames().some((f) => /captcha-delivery\.com|challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\/.*\/managed/i.test(f.url()));
    row.wall = WALL.test(state.title) || (form.inputs < 3 && (WALL.test(state.text) || challenged));
    row.gone = row.http === 404 || row.http === 410 || (form.inputs < 3 && GONE.test(state.text));
    row.verdict = row.wall ? 'wall'
      : row.gone ? 'gone'
        : form.inputs < 3 ? (form.behind_button ? 'behind_button' : 'unreadable')
          : row.widget ? 'human_check'
            : row.unanswered.length ? 'needs_answers'
              : (row.checks.length || row.badge) ? 'silent_check'
                : 'clear';
  } catch (e) {
    row.verdict = 'error'; row.error = String(e.message || e).split('\n')[0].slice(0, 160);
  }
  row.ms = Date.now() - t0;
  await page.close().catch(() => {});
  return row;
}

const jobs = await allJobs();
const bySystem = new Map();
for (const j of jobs) {
  const s = systemOf(j.url);
  if (!s || (ONLY.length && !ONLY.includes(s))) continue;
  if (!bySystem.has(s)) bySystem.set(s, []);
  bySystem.get(s).push(j);
}

const browser = await chromium.launch(BROWSER === 'chrome' ? { channel: 'chrome', headless: true } : { headless: true });
console.log(`${jobs.length} وظيفة مفتوحة · ${BROWSER} ${browser.version()} · ${PER} من كل نظام · قراءة فقط\n`);

const rows = [];
await Promise.all([...bySystem].map(async ([system, list]) => {
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  for (const job of SAME ? list.filter((j) => SAME.has(j.id)) : sample(list, PER)) {
    const row = { system, ...(await measure(ctx, job)) };
    rows.push(row);
    console.log(`${system.padEnd(16)} ${row.verdict.padEnd(14)} ${String(row.unanswered?.length ?? '-').padStart(2)} بلا جواب  ${(row.checks || []).join('+').padEnd(10)} ${row.company}`);
    await new Promise((r) => setTimeout(r, 2500));       // one visitor's pace, not a crawler's
  }
  await ctx.close();
}));
await browser.close();

// ── the table ────────────────────────────────────────────────────────────────
const VERDICTS = ['clear', 'needs_answers', 'silent_check', 'human_check', 'wall', 'behind_button', 'unreadable', 'gone', 'error'];
const summary = {};
for (const [system, list] of bySystem) {
  const mine = rows.filter((r) => r.system === system);
  const read = mine.filter((r) => (r.inputs ?? 0) >= 3);
  const mid = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  summary[system] = {
    open_jobs: list.length, measured: mine.length, read: read.length,
    ...Object.fromEntries(VERDICTS.map((v) => [v, mine.filter((r) => r.verdict === v).length])),
    widget_pct: read.length ? Math.round(100 * read.filter((r) => r.widget).length / read.length) : null,
    any_check_pct: read.length ? Math.round(100 * read.filter((r) => r.widget || r.badge || r.checks.length).length / read.length) : null,
    no_check_pct: read.length ? Math.round(100 * read.filter((r) => !r.widget && !r.badge && !r.checks.length).length / read.length) : null,
    checks: [...new Set(read.flatMap((r) => r.checks))],
    all_answered_pct: read.length ? Math.round(100 * read.filter((r) => !r.unanswered.length).length / read.length) : null,
    median_unanswered: mid(read.map((r) => r.unanswered.length))
  };
}
// The questions that stopped the most forms: each is one profile field away from never stopping one again.
const asked = new Map();
for (const r of rows) for (const u of r.unanswered ?? []) {
  const k = u.q.toLowerCase().replace(/[*:?\s]+/g, ' ').trim().slice(0, 90);
  if (!asked.has(k)) asked.set(k, { q: u.q, kind: u.kind, forms: 0, systems: new Set() });
  const a = asked.get(k); a.forms++; a.systems.add(r.system);
}
const questions = [...asked.values()].sort((a, b) => b.forms - a.forms).slice(0, 60)
  .map((a) => ({ q: a.q, kind: a.kind, forms: a.forms, systems: [...a.systems] }));

const out = `${root}docs/قياس-الاستمارات.${BROWSER}.json`;
await writeFile(out, JSON.stringify({ at: new Date().toISOString(), browser: BROWSER, per: PER, summary, questions, rows }, null, 1));
console.log('\n' + ['النظام'.padEnd(16), ...VERDICTS.map((v) => v.padEnd(14))].join(''));
for (const [s, x] of Object.entries(summary)) console.log([s.padEnd(16), ...VERDICTS.map((v) => String(x[v]).padEnd(14))].join(''));
console.log('\n← ' + out);
