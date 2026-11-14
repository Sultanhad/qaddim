// The signed-in shell: filters at the top of the jobs, three tabs at the bottom, and an account
// screen that holds the CV and the way out. Run against a built site:
//   node apps/web/tests/shell.test.mjs http://localhost:4173
// A temporary account is made for it and removed at the end, CV folder included.
import { testEnv, siteMatches } from '../../../scripts/test-env.mjs';
import { chromium } from 'playwright';

const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const base = process.argv[2] || 'http://localhost:4173';
const shots = process.argv[3] || '/tmp';
await siteMatches(base, env);
const ref = new URL(URL_).hostname.split('.')[0];
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const email = `audit-shell-${Date.now()}@example.com`, password = 'Sh-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
try {
  const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
  await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({
    full_name: 'مختبِر الواجهة', roles: ['product', 'operations'], skill_areas: ['product', 'ops'], cities: ['riyadh'],
    years_experience: 2, onboarded: true, min_score: 0 }) });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([k, v]) => { localStorage.setItem(k, v); localStorage.setItem('qaddim:view', 'list'); localStorage.removeItem('qaddim:filters'); },
    [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);
  await page.goto(base + '/#jobs', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.filters-count', { timeout: 20000 });

  // ١) الفلاتر فوق
  check('بحث وستة فلاتر فوق الوظائف', (await page.locator('.filters-search input').count()) === 1 && (await page.locator('.filters-row .pick').count()) === 6);
  const countText = async () => (await page.locator('.filters-count').textContent()).trim();
  await page.screenshot({ path: `${shots}/shell-jobs.png` });

  await page.locator('select[aria-label="المدينة"]').selectOption('jeddah');
  await page.waitForFunction(() => /وظيف|وظائف/.test(document.querySelector('.filters-count')?.textContent || ''), null, { timeout: 20000 });
  await page.waitForTimeout(800);
  const where = await page.locator('article.card p.muted').allTextContents();
  check('اختيار جدة يعرض وظائف جدة فقط', where.length > 0 && where.every((w) => /جدة/.test(w)),
    `${await countText()} · ${where.slice(0, 3).join(' | ')}`);
  check('الفلتر المختار يظهر أزرق', await page.locator('.pick.on').count() === 1);

  await page.locator('select[aria-label="الخبرة"]').selectOption('fresh');
  await page.waitForTimeout(500);
  check('فلتر الخبرة يجيب بعدد', /وظيف|وظائف/.test(await countText()), await countText());
  await page.screenshot({ path: `${shots}/shell-filtered.png` });

  await page.locator('.filters-search input').fill('zzqqxx-nothing');
  await page.waitForTimeout(300);
  check('بحث بلا نتائج يقول ذلك', /لا وظائف/.test(await countText()));
  await page.locator('.filters-count .linkish').click();
  await page.waitForTimeout(800);
  check('«مسح الفلاتر» يعيد كل شيء', (await page.locator('.pick.on').count()) === 0 && (await page.locator('.filters-search input').inputValue()) === '');
  check('الفلاتر تُذكر بلا كلمات البحث', await page.evaluate(() => JSON.parse(localStorage.getItem('qaddim:filters') || '{}').q === ''));

  // عرض «وظيفة وحدة بزرّين» — الافتراضي لأغلب الناس
  await page.evaluate(() => localStorage.setItem('qaddim:view', 'deck'));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.deck .filters', { timeout: 20000 });
  check('الفلاتر فوق في عرض البطاقة الواحدة، بلا تمرير جانبي للصفحة',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: `${shots}/shell-deck.png` });

  // ٢) الشريط السفلي
  const tabs = (await page.locator('.tabbar a').allTextContents()).map((t) => t.trim());
  check('الشريط السفلي: وظائف · طلباتي · الحساب', JSON.stringify(tabs) === JSON.stringify(['وظائف', 'طلباتي', 'الحساب']), tabs.join(' · '));
  check('لا زر قائمة فوق', (await page.locator('.appbar .burger').count()) === 0);

  // ٣) الحساب
  await page.locator('.tabbar a', { hasText: 'الحساب' }).click();
  await page.waitForSelector('.account', { timeout: 10000 });
  check('الحساب يعرض البريد', (await page.locator('.account-who').textContent()).includes(email));
  check('فيه خانة السيرة الذاتية', (await page.locator('.cv-card').count()) === 1 && /لم ترفعها/.test(await page.locator('.cv-card').textContent()));
  check('وفيه «تسجيل الخروج»', (await page.locator('.account-out').textContent()).includes('تسجيل الخروج'));
  await page.screenshot({ path: `${shots}/shell-account.png`, fullPage: true });

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
  await page.locator('.cv-card input[type=file]').setInputFiles({ name: 'cv-test.pdf', mimeType: 'application/pdf', buffer: pdf });
  await page.waitForFunction(() => /محفوظة/.test(document.querySelector('.cv-card')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  const stored = await admin(`/rest/v1/profiles?id=eq.${me.id}&select=cv_path`).then((r) => r.json());
  const toastSaid = (await page.locator('.toasts').textContent().catch(() => '')).trim();
  if (!/cv-test/.test(stored[0]?.cv_path || '')) console.log('    toast:', toastSaid, '| card:', (await page.locator('.cv-card').textContent()).trim());
  check('رفع السيرة من الحساب يحفظها فوراً', /محفوظة/.test(await page.locator('.cv-card').textContent()) && /cv-test\.pdf$/.test(stored[0]?.cv_path || ''), stored[0]?.cv_path);
  check('وزر «اعرضها» ظهر', (await page.locator('.cv-card button', { hasText: 'اعرضها' }).count()) === 1);
  const big = Buffer.alloc(5 * 1024 * 1024 + 10);
  await page.locator('.cv-card input[type=file]').setInputFiles({ name: 'big.pdf', mimeType: 'application/pdf', buffer: big });
  await page.waitForTimeout(600);
  check('ملف فوق ٥ ميغا يُرفض قبل الرفع', /٥ ميغابايت/.test(await page.locator('body').textContent()));

  await page.locator('.account-list a[href="#profile"]').click();
  await page.waitForTimeout(500);
  check('صفحة من الحساب: «الحساب» مضاء ورجوع فوق',
    (await page.locator('.tabbar a[aria-current="page"]').textContent()).includes('الحساب') && (await page.locator('.appbar-back').count()) === 1);
  await page.locator('.appbar-back').click();
  await page.waitForSelector('.account');

  // ٤) سطح المكتب: التبويبات فوق
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(300);
  const top = (await page.locator('.appbar-tabs a').allTextContents()).map((t) => t.trim());
  check('على الشاشة العريضة الثلاثة فوق', top.length === 3, top.join(' · '));
  await page.screenshot({ path: `${shots}/shell-account-desk.png` });
  await page.setViewportSize({ width: 390, height: 844 });

  await page.locator('.account-out').click();
  await page.waitForSelector('.lp-nav', { timeout: 10000 }).catch(() => {});
  check('تسجيل الخروج يرجع للصفحة الرئيسية', (await page.locator('.lp-nav').count()) === 1);

  check('لا أخطاء في المتصفح', errs.length === 0, errs.slice(0, 2).join(' | '));
  await browser.close();
} finally {
  // The CV folder first (the storage API, not SQL), then the account.
  const list = await admin(`/storage/v1/object/list/cvs`, { method: 'POST', body: JSON.stringify({ prefix: me.id, limit: 100 }) }).then((r) => r.json()).catch(() => []);
  const paths = (Array.isArray(list) ? list : []).map((o) => `${me.id}/${o.name}`);
  if (paths.length) await admin('/storage/v1/object/cvs', { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) });
  await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
}
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ كل فحوص الواجهة نجحت');
process.exit(fails ? 1 : 0);
