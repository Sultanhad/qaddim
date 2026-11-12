// Walks a brand-new account through the whole product, the way a stranger would,
// and photographs each step. Nothing here touches the real owner's data.
import { testEnv, siteMatches } from '../../../scripts/test-env.mjs';
import { chromium } from 'playwright';

const env = await testEnv();

const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ref = new URL(URL_).hostname.split('.')[0];
const email = `flowtest+${Date.now()}@example.com`, password = 'Test-' + Math.random().toString(36).slice(2) + '!A9';

const api = (path, opts = {}) => fetch(`${URL_}${path}`, {
  ...opts, headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...opts.headers }
});

const made = await api('/auth/v1/admin/users', {
  method: 'POST', body: JSON.stringify({ email, password, email_confirm: true })
}).then((r) => r.json());
if (!made.id) { console.error('createUser:', made); process.exit(1); }
console.log('مستخدم اختبار:', email);

const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
}).then((r) => r.json());
if (!sess.access_token) { console.error('signIn:', sess); process.exit(1); }

const base = process.argv[2] || 'http://localhost:4173';
await siteMatches(base, env);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 940 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

await page.goto(base, { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, v]) => localStorage.setItem(k, v),
  [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);

const shot = async (name, ms = 1200) => {
  await page.waitForTimeout(ms);
  await page.screenshot({ path: `/tmp/flow-${name}.png`, fullPage: true });
  console.log('  ✓', name);
};

await page.goto(base, { waitUntil: 'networkidle' });
await shot('1-firstrun');

// الخطوة الأولى: اختيار مجال ومدينة ورؤية العدّاد
await page.getByLabel('اسمك').fill('سلطان التجربة');
await page.getByRole("button", { name: "إدارة وتحليل المنتجات" }).click();
await page.getByRole("button", { name: "المنتج", exact: true }).click().catch(() => {});
await page.getByRole("button", { name: "تحليل الأعمال", exact: true }).first().click().catch(() => {});
await page.waitForTimeout(600);
await shot('2-chose-role', 400);

const tally = await page.locator('.tally').first().textContent().catch(() => null);
console.log('  العدّاد الحي:', (tally || 'لم يظهر').trim());

await page.getByRole('button', { name: 'أرني الوظائف' }).click();
await page.waitForSelector('article.card, .ladder', { timeout: 15000 });
await page.waitForFunction(() => !document.querySelector('.skeleton'), { timeout: 15000 });
await shot('3-jobs');

const cards = await page.locator('article.card').count();
const ladder = await page.locator('.ladder-text').first().textContent().catch(() => null);
console.log('  وظائف معروضة:', cards);
console.log('  السلّم:', (ladder || 'لم يظهر').replace(/\s+/g, ' ').trim());

// الضغط على «يهمني» وهو ملف فارغ — يجب أن يطلب الناقص لا أن يفشل صامتاً
if (cards) {
  await page.getByRole('button', { name: /^يهمني/ }).first().click();
  await shot('4-needs-info');
  const ask = await page.locator('.card').filter({ hasText: 'قبل أن نقدّم' }).first().textContent().catch(() => null);
  console.log('  عند «يهمني»:', (ask || 'لا شيء').replace(/\s+/g, ' ').slice(0, 120));
}

// أكمل الناقص وتابع التقديم من حيث توقّف
if (cards) {
  await page.getByLabel('البريد للتقديم').fill('flow@example.com');
  await page.getByLabel('الجوال').fill('0500000000');
  await page.locator('input[type=file]').setInputFiles({ name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await page.locator('.card').filter({ hasText: 'قبل أن نقدّم' }).getByRole('button', { name: 'احفظ' }).click();
  await shot('4b-after-save', 2500);
  const still = await page.locator('.card').filter({ hasText: 'قبل أن نقدّم' }).count();
  console.log('  بعد الحفظ، هل عاد يطلبها؟', still ? '✗ نعم — حلقة' : '✓ لا');
  const sheet = await page.locator('text=ورقة التعبئة, .sheet, text=نسخ').count();
  console.log('  ظهرت ورقة التعبئة؟', sheet ? '✓ نعم' : '— لا');
}

await page.goto(base + '#applications', { waitUntil: 'networkidle' });
await shot('7-applications');
console.log('  طلبات مسجّلة:', await page.locator('article.card').count());

await page.goto(base + '#settings', { waitUntil: 'networkidle' });
await shot('5-settings');
await page.goto(base + '#profile', { waitUntil: 'networkidle' });
await shot('6-profile');

console.log(errors.length ? '\n✗ أخطاء المتصفح:\n' + errors.slice(0, 8).join('\n') : '\n✓ لا أخطاء في المتصفح');
await browser.close();
await api(`/auth/v1/admin/users/${made.id}`, { method: 'DELETE' });
console.log('✓ حُذف حساب الاختبار');
