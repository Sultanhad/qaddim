// Does a failed write say so? The screens used to move as if every request succeeded, so the
// only way to know this works is to make a request fail and look at what the page does.
import { testEnv, siteMatches } from '../../../scripts/test-env.mjs';
import { chromium } from 'playwright';

const root = new URL('../../../', import.meta.url).pathname;
const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const base = process.argv[2] || 'http://localhost:4173';
await siteMatches(base, env);
const ref = new URL(URL_).hostname.split('.')[0];
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const email = `audit-st-${Date.now()}@example.com`, password = 'St-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
  headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({
  full_name: 'مختبِر الحالات', roles: ['product'], skill_areas: ['product'], cities: ['riyadh'],
  years_experience: 2, onboarded: true, min_score: 0 }) });
const jobs = await admin('/rest/v1/jobs?select=id&is_open=eq.true&limit=1').then((r) => r.json());
await admin('/rest/v1/applications', { method: 'POST', body: JSON.stringify({ user_id: me.id, job_id: jobs[0].id, status: 'saved' }) });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, v]) => localStorage.setItem(k, v),
  [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);

// ١) تغيير حالة طلب يفشل
await page.route('**/rest/v1/applications?id=eq.*', (r) =>
  r.request().method() === 'PATCH' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : r.continue());
await page.goto(base + '/#applications', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('select.status-pill', { timeout: 15000 });
const before = await page.locator('select.status-pill').first().inputValue();
await page.locator('select.status-pill').first().selectOption('interview');
await page.waitForTimeout(2200);
check('فشل تغيير الحالة يظهر للمستخدم', await page.locator('.toast-bad').count() > 0);
check('وفيه زر إعادة المحاولة', await page.locator('.toast-bad .btn').count() > 0);
const after = await page.locator('select.status-pill').first().inputValue();
check('والقائمة ترجع لما كانت عليه', after === before, `${before} → ${after}`);
await page.screenshot({ path: '/tmp/state-fail.png' });

// ٢) ونجاحها صامت لأنها مرئية أصلاً
// لافتة الفشل تبقى حتى يُغلقها صاحبها — فتُغلق أولاً وإلا عدّها الفحص التالي
await page.locator('.toast-bad .toast-x').first().click();
await page.waitForTimeout(300);
await page.unroute('**/rest/v1/applications?id=eq.*');
await page.locator('select.status-pill').first().selectOption('interview');
await page.waitForTimeout(2200);
check('النجاح لا يزعج', await page.locator('.toast-bad').count() === 0);
const row = await admin(`/rest/v1/applications?user_id=eq.${me.id}&select=status`).then((r) => r.json());
check('والحالة حُفظت فعلاً', row[0]?.status === 'interview', row[0]?.status);

// ٣) انقطاع الشبكة يُقال قبل أن يضغط شيئاً
// الصفحة تُفتح أولاً ثم تُقطع الشبكة — القطع قبل التحميل يعطي صفحة خطأ المتصفح لا تطبيقنا
await page.goto(base + '/#jobs', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('article.card, .ladder', { timeout: 15000 });
await page.context().setOffline(true);
await page.evaluate(() => dispatchEvent(new Event('offline')));
await page.waitForTimeout(800);
check('انقطاع الشبكة يُعلن', (await page.locator('text=/لا اتصال بالشبكة/').count()) > 0);
await page.context().setOffline(false);

await browser.close();
await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} إخفاق` : '\n✓ كل عملية تقول ما حدث لها');
process.exit(fails ? 1 : 0);
