// The draft screen: do the questions that stopped an application reach the person, once each,
// and does answering them save the answer and send the application back?
//
//   npm run test:questions [url]
//
// This flow existed for weeks without ever being seen — the list of applications never asked
// the database for the report that carries the questions — so the first check here is simply
// that they appear. The applications are seeded as the extension would leave them; no
// employer's site is opened.
import { readFile } from 'node:fs/promises';
import { chromium } from '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/node_modules/playwright/index.mjs';

const root = new URL('../../../', import.meta.url).pathname;
const env = Object.fromEntries((await readFile(root + '.env.local', 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
const ref = new URL(URL_).hostname.split('.')[0];
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const email = `questions-${Date.now()}@example.com`, password = 'Qs-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
  headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({
  full_name: 'مختبِر المسودة', roles: ['product'], cities: ['riyadh'], years_experience: 3,
  onboarded: true, min_score: 0, answers: { _facts: { gender: 'ذكر' } } }) });

const jobs = await admin('/rest/v1/jobs?select=id,company&is_open=eq.true&limit=40').then((r) => r.json());
const [one, two] = [jobs[0], jobs.find((j) => j.company !== jobs[0].company) ?? jobs[1]];
const GCC = { q: 'Are you based in the GCC?', kind: 'radio', why: 'لا إجابة عندك لهذا السؤال', options: ['Yes', 'No'] };
const seed = (job, missing) => admin('/rest/v1/applications', { method: 'POST', body: JSON.stringify({
  user_id: me.id, job_id: job.id, status: 'saved', auto_status: 'needs_you', auto_attempts: 3,
  auto_reason: 'أسئلة إلزامية بلا إجابة منك', auto_report: { filled: [], agreed: [], skipped: [], captcha: false, missing } }) });
await seed(one, [GCC,
  { q: 'Why do you want to work here?', kind: 'text', why: 'لا إجابة عندك لهذا السؤال' },
  { q: 'How did you hear about us? *', kind: 'checks', manual: true, why: 'سؤال خيارات إلزامي — اختر بنفسك' }]);
const WORKED = `Have you previously worked at ${two.company}?`;
await seed(two, [GCC,
  { q: 'What is your current employment status?', kind: 'combo', why: 'لا إجابة عندك لهذا السؤال',
    options: ['Employed full-time', 'Employed part-time', 'Self-employed', 'Student', 'Between jobs', 'Contractor', 'Other'] },
  { q: WORKED, kind: 'combo', key: 'worked_here_before', options: ['Yes', 'No'], why: 'سؤال عن هذه الشركة — أجبه هنا، أو ضع جوابك المعتاد في ملفك' },
  { q: 'Will you now or in the future require sponsorship for employment visa status?', kind: 'combo', key: 'requires_sponsorship',
    manual: true, why: 'يعتمد على بلد الوظيفة، وملفك يصف وضعك في السعودية فقط' }]);
const apps = () => admin(`/rest/v1/applications?user_id=eq.${me.id}&select=job_id,auto_status,auto_attempts`).then((r) => r.json());
const statusOf = async (job) => (await apps()).find((a) => a.job_id === job.id)?.auto_status;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, v]) => localStorage.setItem(k, v),
  [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);
await page.goto(base + '/#applications', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.card', { timeout: 15000 });

const panel = page.locator('.questions');
check('الأسئلة ظاهرة أصلاً', await panel.count() === 1);
check('كل سؤال مرة واحدة ولو سألته استمارتان', await panel.locator('.field').count() === 4, await panel.locator('.questions-h').textContent().catch(() => ''));
const gcc = panel.locator('.field', { hasText: 'Are you based in the GCC?' });
check('وتحته الشركتان اللتان سألتاه', (await gcc.locator('.hint').textContent()).includes(one.company) && (await gcc.locator('.hint').textContent()).includes(two.company));
check('خياران يُعرضان أزراراً', await gcc.locator('.pick .chip').count() === 2);
check('وسبعة تُعرض قائمة', await panel.locator('.field', { hasText: 'employment status' }).locator('select option').count() === 8);
check('ما يُكمَل باليد ليس سؤالاً هنا', await panel.locator('.field', { hasText: 'hear about us' }).count() === 0);
check('بل مذكور عند طلبه', await page.locator('.blocked', { hasText: 'يُكمَل في صفحة الشركة' }).locator('li', { hasText: 'hear about us' }).count() === 1);
await page.screenshot({ path: '/tmp/questions-1.png', fullPage: true });

check('سؤال الكفالة ليس هنا: جوابه يختلف من بلد لآخر', await panel.locator('.field', { hasText: 'sponsorship' }).count() === 0);
const worked = panel.locator('.field', { hasText: 'previously worked at' });
check('«اجعلها جوابي الدائم» لا تظهر قبل أن يُقال «لا»', await worked.locator('.usual').count() === 0);
await worked.locator('.chip', { hasText: 'No' }).click();
check('وتظهر بعدها، مختارة', await worked.locator('.usual input').isChecked());
await gcc.locator('.chip', { hasText: 'Yes' }).click();
await panel.locator('.field', { hasText: 'employment status' }).locator('select').selectOption('Between jobs');
await panel.locator('.formbar .btn-go').click();
await page.waitForFunction(() => document.querySelectorAll('.questions .field').length === 1, null, { timeout: 15000 }).catch(() => {});

const saved = (await admin(`/rest/v1/profiles?id=eq.${me.id}&select=answers`).then((r) => r.json()))[0].answers;
check('الجوابان حُفظا بنصّ السؤال', saved['Are you based in the GCC?'] === 'Yes' && saved['What is your current employment status?'] === 'Between jobs');
check('وما كان في الملف لم يُمسّ', saved._facts?.gender === 'ذكر');
check('و«لا» صارت جوابه المعتاد لكل شركة', saved._facts?.worked_here_before === 'لا' && saved[WORKED] === 'No');
check('الطلب الذي اكتملت أسئلته عاد للطابور', await statusOf(two) === 'queued', await statusOf(two));
check('والذي بقي له سؤال ينتظر', await statusOf(one) === 'needs_you', await statusOf(one));
check('والسؤال المُجاب اختفى من القائمة', await panel.locator('.field').count() === 1);

await panel.locator('.field input[type=text]').fill('Because the product is used by people I know.');
await panel.locator('.formbar .btn-go').click();
await page.waitForFunction(() => !document.querySelector('.questions'), null, { timeout: 15000 }).catch(() => {});
check('بعد آخر جواب: لا أسئلة تنتظر', await panel.count() === 0);
check('والطلب الأول عاد للطابور', await statusOf(one) === 'queued', await statusOf(one));
check('ومحاولاته صُفّرت', (await apps()).every((a) => a.auto_attempts === 0));
check('لا أخطاء في الصفحة', errors.length === 0, errors.join(' | '));

await browser.close();
await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ الأسئلة تصل، تُجاب مرة، وتُعيد طلباتها');
process.exit(fails ? 1 : 0);
