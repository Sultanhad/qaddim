// Does the extension actually work? Loads it into a real Chrome, hands it a real session,
// and watches it take a job off the queue and fill the employer's form.
//
// Auto-submit is forced OFF: this opens a real hiring form and types into it, and nothing is
// ever sent to an employer from a test.
import { readFile } from 'node:fs/promises';
import { chromium } from '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/node_modules/playwright/index.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
const env = Object.fromEntries((await readFile(root + '.env.local', 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const site = process.argv[2] || 'http://localhost:4173';
const ref = new URL(URL_).hostname.split('.')[0];

const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

// حساب اختبار كامل الملف
const email = `exttest+${Date.now()}@example.com`, password = 'Ext-' + Math.random().toString(36).slice(2) + '!A9';
const made = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }) }).then((r) => r.json());

await admin(`/rest/v1/profiles?id=eq.${made.id}`, { method: 'PATCH', body: JSON.stringify({
  full_name: 'مختبِر الإضافة', email_for_applications: email, phone: '0500000000',
  nationality: 'سعودي', work_authorization: 'مواطن', current_title: 'محلل منتجات',
  salary_expectation: '15000 ريال', notice_period: 'شهر', education_degree: 'بكالوريوس',
  linkedin_url: 'https://linkedin.com/in/test', years_experience: 3,
  roles: ['product'], skill_areas: ['product'], cities: ['riyadh'],
  onboarded: true, auto_apply: true, min_score: 0, cv_path: `${made.id}/test.pdf`
}) });

// وظيفة حقيقية من لوحة ندعمها، لنرى التعبئة على استمارة فعلية
const jobs = await admin('/rest/v1/jobs?select=id,url,company,title&is_open=eq.true&url=like.*apply.workable.com*&limit=1').then((r) => r.json());
check('وُجدت وظيفة على لوحة مدعومة', jobs.length > 0, jobs[0]?.company || '');
if (!jobs.length) { await admin(`/auth/v1/admin/users/${made.id}`, { method: 'DELETE' }); process.exit(1); }

await admin('/rest/v1/applications', { method: 'POST', body: JSON.stringify({
  user_id: made.id, job_id: jobs[0].id, status: 'saved', auto_status: 'queued' }) });

const ext = root + 'extension';
const dir = await mkdtemp(join(tmpdir(), 'ext-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run']
});

// الإرسال يُطفأ قبل أن تُفتح الصفحة: مزامنة الجلسة تُشغّل دورة فوراً، وهذا هو
// السلوك الصحيح — فلا مجال لضبط الإعدادات بعدها.
const sw0 = ctx.serviceWorkers().length ? ctx.serviceWorkers()[0] : await ctx.waitForEvent('serviceworker', { timeout: 20000 });
await sw0.evaluate(() => chrome.storage.local.set({ settings: { autoSubmit: false, delayMs: 1000, maxPerRun: 1 } }));

// ١) هل الجسر يعلن عن نفسه في الموقع الحيّ؟
const page = await ctx.newPage();
await page.goto(site, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, v]) => localStorage.setItem(k, v),
  [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);

// The announcement fires on load, so the listener has to be in place before the page runs.
await page.addInitScript(() => {
  addEventListener('message', (e) => {
    if (e.data?.type === 'qaddim:extension-ready') window.__extVersion = e.data.version;
  });
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__extVersion, { timeout: 15000 }).catch(() => {});
const version = await page.evaluate(() => window.__extVersion || null);
check('الإضافة تعلن عن نفسها للموقع المنشور', !!version, version || 'لا إعلان');

await page.waitForTimeout(3000);
const connected = await page.locator('text=/التقديم التلقائي يعمل/').count();
check('الموقع يظهر «التقديم التلقائي يعمل»', connected > 0);

// ٢) اجبر الإرسال على الإطفاء ثم شغّل دورة
const sw = ctx.serviceWorkers()[0] ?? sw0;
check('عامل الخلفية يعمل', !!sw);
const stored = await sw.evaluate(() => chrome.storage.local.get(['session', 'profile']));
check('استلمت الجلسة من الصفحة', !!stored.session?.token);
check('ومعها رمز التجديد', !!stored.session?.refresh_token);
check('واستلمت الملف', !!stored.profile?.email_for_applications);

// الدورة بدأت وحدها عند المزامنة — نراقب الصف حتى يتحرّك
let row = [], st = null;
for (let i = 0; i < 24; i++) {
  row = await admin(`/rest/v1/applications?user_id=eq.${made.id}&select=auto_status,auto_reason,auto_report`).then((r) => r.json());
  st = row[0]?.auto_status;
  if (st && st !== 'queued' && st !== 'filling') break;
  await new Promise((r) => setTimeout(r, 5000));
}
check('التقطت الوظيفة وفتحت الاستمارة', st !== 'queued', st || 'لم تتحرّك');
check('تحرّكت الحالة عن «في الطابور»', st && st !== 'queued', `${st} · ${row[0]?.auto_reason || ''}`);
check('لم تُرسل شيئاً (الإرسال مطفأ)', st !== 'submitted', st || '');
const rep = row[0]?.auto_report;
if (rep) console.log('    عبّأت:', (rep.filled || []).length, 'حقل · ناقص:', (rep.missing || []).length);

// البوابة: ما دامت ثلاثة لم تُعتمد بيد صاحبها، القاعدة تقول «لا ترسل»
const q = await fetch(`${URL_}/rest/v1/rpc/my_apply_queue`, { method: 'POST',
  headers: { apikey: PUB, Authorization: `Bearer ${sess.access_token}`, 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.json()).catch(() => []);
const stats = await fetch(`${URL_}/rest/v1/rpc/my_apply_stats`, { method: 'POST',
  headers: { apikey: PUB, Authorization: `Bearer ${sess.access_token}`, 'content-type': 'application/json' }, body: '{}' })
  .then((r) => r.json()).then((d) => d?.[0]).catch(() => null);
check('القاعدة هي التي تقرّر الإرسال، لا الامتداد', stats && stats.submitting === false,
  stats ? `auto_submit=${stats.auto_submit} approved=${stats.approved}` : 'لا إحصاء');

await ctx.close();
await rm(dir, { recursive: true, force: true });
await admin(`/auth/v1/admin/users/${made.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} إخفاق` : '\n✓ سلسلة التقديم تعمل من طرف إلى طرف');
process.exit(fails ? 1 : 0);
