import { testEnv, siteMatches } from '../../../scripts/test-env.mjs';
import { chromium } from 'playwright';

const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const base = process.argv[2] || 'http://localhost:4173';
await siteMatches(base, env);
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

// ١) هل الرمز المكوّن من ستة أرقام يسجّل الدخول فعلاً؟
const email = `authtest+${Date.now()}@example.com`;
const link = await admin('/auth/v1/admin/generate_link', {
  method: 'POST', body: JSON.stringify({ type: 'magiclink', email })
}).then((r) => r.json());
check('الخادم يصدر رمزاً مع الرابط', !!link.email_otp, link.email_otp ? `طوله ${link.email_otp.length}` : JSON.stringify(link).slice(0, 80));

if (link.email_otp) {
  const v = await fetch(`${URL_}/auth/v1/verify`, {
    method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'email', email, token: link.email_otp })
  }).then((r) => r.json());
  check('الرمز يفتح جلسة', !!v.access_token, v.error_description || v.msg || '');
  if (v.user?.id) await admin(`/auth/v1/admin/users/${v.user.id}`, { method: 'DELETE' });
}

// ٢) واجهة الدخول
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 940 }, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message));

await page.goto(`${base}/?error=access_denied&error_description=Email+link+is+invalid+or+has+expired`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const expired = await page.locator('.err').first().textContent().catch(() => '');
check('الرابط المنتهي يظهر بالعربي ويقول السبب الصحيح',
  /انتهت صلاحية الرابط/.test(expired || ''), (expired || 'لا رسالة').trim());
await page.screenshot({ path: '/tmp/auth-1-expired.png', fullPage: false });

// مربع الدخول لم يعد في وسط الصفحة: «الدخول» في الشريط يفتحه فوقها، كما يفعل الزائر.
const openBox = async () => {
  if (!(await page.locator('.lp-signin').count())) await page.locator('.lp-nav button.btn-white').first().click();
  await page.waitForSelector('.lp-signin input', { timeout: 5000 });
};
check('«الدخول» يفتح مربعاً بعنوان وشرح وزرّ لا يبدو معطّلاً',
  await (async () => {
    await page.goto(base, { waitUntil: 'networkidle' }); await openBox();
    const h = await page.locator('.lp-signin-h').textContent().catch(() => '');
    const disabled = await page.locator('.signin-boxed button').isDisabled();
    return /قدّم/.test(h || '') && !disabled && (await page.locator('.lp-signin-sub').count()) === 1;
  })());

// الإرسال الحقيقي محدود بساعة، والمقصود هنا الواجهة لا البريد
await page.route('**/auth/v1/otp*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await page.goto(base, { waitUntil: 'networkidle' });
await openBox();
await page.locator('.lp-signin input').first().fill('flow-ui@example.com');
await page.locator('.lp-signin form button').first().click();
await page.waitForSelector('.sent', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(600);
check('شاشة «افتح بريدك» ظهرت', await page.locator('.sent').count() > 0);
check('فيها خانة رمز', await page.locator('.code-row input').count() > 0);
const resend = await page.locator('.sent-actions button').first();
check('إعادة الإرسال محجوبة بعدّاد', await resend.isDisabled(), (await resend.textContent() || '').trim());
check('يمكن تغيير البريد', await page.locator('.sent-actions button').nth(1).isVisible());
await page.screenshot({ path: '/tmp/auth-2-sent.png', fullPage: false });

await page.locator('.code-row input').fill('000000');
await page.locator('.code-row button').click();
await page.waitForTimeout(2500);
const bad = await page.locator('.sent .err').first().textContent().catch(() => '');
check('الرمز الخاطئ يُرفض بالعربي', /غير صحيح|انتهت/.test(bad || ''), (bad || 'لا رسالة').trim());

await page.locator('.sent-actions button').nth(1).click();
await page.waitForTimeout(400);
check('«غيّر البريد» يعيد النموذج', await page.locator('.signin-boxed input').count() > 0);

// ٣) هل يتذكّر البريد؟
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await openBox();
check('يتذكّر آخر بريد', (await page.locator('.lp-signin input').first().inputValue()) === 'flow-ui@example.com');

console.log(errs.length ? '\n✗ أخطاء: ' + errs.slice(0, 3).join(' | ') : '\n✓ لا أخطاء في المتصفح');
await browser.close();
console.log(fails ? `✗ ${fails} إخفاق` : '✓ كل فحوص الدخول نجحت');
process.exit(fails ? 1 : 0);
