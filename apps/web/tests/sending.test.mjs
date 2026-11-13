// After send is pressed: does the site say what is known and no more, does it refuse to offer
// "try again" on a send nobody confirmed, and do the stop and the cancel do what they say?
//
//   npm run test:sending [url]
//
// The applications are seeded as the extension would leave them, on a throwaway account that
// is deleted at the end; no employer's site is opened and nothing is sent anywhere.
import { testEnv, siteMatches } from '../../../scripts/test-env.mjs';
import { chromium } from 'playwright';

const root = new URL('../../../', import.meta.url).pathname;
const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const base = (process.argv[2] || 'http://localhost:4173').replace(/\/$/, '');
await siteMatches(base, env);
const shots = process.env.QADDIM_SHOTS || '/tmp';
const ref = new URL(URL_).hostname.split('.')[0];
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const email = `sending-${Date.now()}@example.com`, password = 'Sd-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
  headers: { apikey: PUB, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then((r) => r.json());
const asMe = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: PUB, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json', ...o.headers } });
await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({
  full_name: 'مختبِر الإرسال', roles: ['product'], cities: ['riyadh'], years_experience: 3, onboarded: true, min_score: 0,
  email_for_applications: email, phone: '0500000000', cv_path: `${me.id}/cv.pdf`, auto_apply: true, auto_submit: true,
  answers: { _facts: { gender: 'ذكر' }, 'Are you based in the GCC?': 'Yes' } }) });

// Five open jobs on systems the extension sends on, each at a different company.
const pool = await admin('/rest/v1/jobs?select=id,company,url&is_open=eq.true&url=like.*greenhouse.io*&limit=200').then((r) => r.json());
const jobs = [];
for (const j of pool) { if (!jobs.some((x) => x.company === j.company)) jobs.push(j); if (jobs.length === 5) break; }
if (jobs.length < 5) { console.log('✗ لا خمس وظائف مفتوحة على Greenhouse للاختبار'); await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' }); process.exit(1); }
const [quiet, code, waiting, asks, probe] = jobs;

const UNVERIFIED = 'ضُغط الإرسال ولم يظهر تأكيد — تحقق من بريدك قبل أي إعادة';
const pressedAt = new Date(Date.now() - 2 * 3600e3).toISOString();
const seed = (job, row) => admin('/rest/v1/applications', { method: 'POST', body: JSON.stringify({ user_id: me.id, job_id: job.id, status: 'saved', ...row }) });
await seed(quiet, { auto_status: 'needs_you', auto_reason: UNVERIFIED, auto_attempts: 1, auto_at: pressedAt,
  auto_report: { filled: [{ q: 'First Name', v: 'T' }], missing: [], sent: { pressed_at: pressedAt, by: '1.6.0', outcome: 'unverified', evidence: null } } });
await seed(code, { auto_status: 'needs_you', auto_reason: 'الشركة أرسلت رمز تحقق إلى بريدك — أدخله في تبويبها المفتوح', auto_attempts: 1, auto_at: pressedAt,
  auto_report: { filled: [], missing: [], sent: { pressed_at: pressedAt, by: '1.6.0', outcome: 'code', evidence: { kind: 'text', said: 'Enter the verification code' } } } });
await seed(waiting, { auto_status: 'queued' });
await seed(asks, { auto_status: 'needs_you', auto_reason: 'أسئلة إلزامية بلا إجابة منك', auto_attempts: 1,
  auto_report: { filled: [], missing: [{ q: 'Why do you want to work here?', kind: 'text', why: 'لا إجابة عندك لهذا السؤال' }] } });
const rowOf = async (job) => (await admin(`/rest/v1/applications?user_id=eq.${me.id}&job_id=eq.${job.id}&select=*`).then((r) => r.json()))[0];
const answers = async () => (await admin(`/rest/v1/profiles?id=eq.${me.id}&select=answers`).then((r) => r.json()))[0].answers;
// Is migration 011 in this database? Its one new function answers the question.
const guarded = await asMe('/rest/v1/rpc/sent_unverified', { method: 'POST', body: JSON.stringify({ report: {} }) }).then((r) => r.ok);

// The write the extension makes the instant before it presses, against the real API: it must
// land only on a row that is still saved and still being filled, and must say whether it did.
console.log('تسجيل الضغطة، كما تكتبه الإضافة');
{
  await seed(probe, { auto_status: 'queued' });
  const id = (await rowOf(probe)).id;
  const takenAt = new Date().toISOString();
  const press = (at = takenAt) => asMe(`/rest/v1/applications?id=eq.${id}&status=eq.saved&auto_status=eq.filling&auto_at=eq.${encodeURIComponent(at)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ auto_reason: 'ضُغط الإرسال — بانتظار تأكيد الصفحة', auto_report: { filled: [], sent: { pressed_at: new Date().toISOString(), by: 'test' } } })
  }).then(async (r) => ({ status: r.status, rows: await r.json() }));
  const early = await press();
  check('على طلب لم يعد «يُعبّأ»: لا يُكتب شيء، ويُعرف ذلك', early.status === 200 && Array.isArray(early.rows) && early.rows.length === 0 && !(await rowOf(probe)).auto_report, JSON.stringify(early).slice(0, 90));
  // taken the way the extension takes it: only if still queued, and the row handed back
  const take = () => asMe(`/rest/v1/applications?id=eq.${id}&status=eq.saved&auto_status=eq.queued`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ auto_status: 'filling', auto_at: takenAt, auto_attempts: 1 }) }).then((r) => r.json());
  const first = await take(), second = await take();
  check('الطلب يُؤخذ مرة واحدة: الثاني لا يأخذ شيئاً', first.length === 1 && Array.isArray(second) && second.length === 0, `${first.length} ثم ${second.length}`);
  const overtaken = await press(new Date(Date.now() + 5000).toISOString());
  check('ومن سُبق إليه لا تُقبل ضغطته', overtaken.rows.length === 0 && !(await rowOf(probe)).auto_report, JSON.stringify(overtaken).slice(0, 80));
  const ok = await press();
  check('وعلى طلب يُعبّأ: يُكتب، ويعود المكتوب', ok.rows.length === 1 && !!ok.rows[0].auto_report?.sent?.pressed_at && ok.rows[0].auto_status === 'filling', JSON.stringify(ok).slice(0, 90));
  const note = await asMe('/rest/v1/application_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ application_id: id, user_id: me.id, kind: 'auto', detail: 'ضُغط الإرسال' }) });
  check('وحدث الضغطة يُقبل في سجل الطلب', note.status === 201, String(note.status));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
await page.evaluate(([k, v]) => (localStorage.setItem(k, v), localStorage.setItem('qaddim:apps-view', 'full'), localStorage.setItem('qaddim:view', 'list')),
  [`sb-${ref}-auth-token`, JSON.stringify({ ...sess, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in })]);
await page.goto(base + '/#applications', { waitUntil: 'networkidle' });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.card', { timeout: 15000 });
const cardOf = (job) => page.locator('article.card', { hasText: job.company }).first();
const settle = () => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(400));

console.log('\nضُغط ولم يتأكد');
{
  check('والذي ضُغط لتوّه يُقال عنه «يُرسل الآن» — لا «أُرسل»', (await cardOf(probe).textContent()).includes('يُرسل الآن') && !(await cardOf(probe).textContent()).includes('أُرسل تلقائياً'));
  const c = cardOf(quiet);
  check('يتصدّر «يحتاج منك شيئاً»', (await page.locator('.section').first().textContent()).includes('يحتاج منك شيئاً') && await c.count() === 1);
  check('ويُقال ما هو: ضُغط ولم يتأكد — لا «أُرسل»', (await c.textContent()).includes('ضُغط الإرسال ولم يتأكد') && !(await c.textContent()).includes('أُرسل تلقائياً'));
  check('ولا زر «أعد المحاولة» عليه', await c.locator('button', { hasText: 'أعد المحاولة' }).count() === 0);
  check('ويُنصح بالبريد قبل أي شيء', (await c.locator('.unverified').textContent()).includes('ابحث في بريدك'));
  check('والطلب الذي أوقفه سؤال ما زال له «أسئلة تنتظرك»', await page.locator('.questions .field', { hasText: 'Why do you want to work here?' }).count() === 1);
  await page.screenshot({ path: `${shots}/sending-1.png`, fullPage: true });

  await c.locator('button', { hasText: 'لم يصل' }).click();
  check('«لم يصل» لا تعيد شيئاً بضغطة واحدة', (await rowOf(quiet)).auto_status === 'needs_you' && await c.locator('button', { hasText: 'تأكدتُ من بريدي — أعد الإرسال' }).count() === 1);

  // The ordinary retry, asked of the database directly, as a stale screen or an old build would.
  await asMe('/rest/v1/rpc/retry_application', { method: 'POST', body: JSON.stringify({ app_id: (await rowOf(quiet)).id }) });
  if (guarded) check('والقاعدة ترفض «أعد المحاولة» العادية عليه', (await rowOf(quiet)).auto_status === 'needs_you', (await rowOf(quiet)).auto_status);
  else {
    console.log('  ! الترحيل 011 لم يُطبَّق على هذه القاعدة بعد — حارس القاعدة لم يُفحص هنا (فُحص محلياً في check-migrations)');
    await admin(`/rest/v1/applications?id=eq.${(await rowOf(quiet)).id}`, { method: 'PATCH', body: JSON.stringify({ auto_status: 'needs_you', auto_reason: UNVERIFIED, auto_attempts: 1 }) });
  }

  await c.locator('button', { hasText: 'تأكدتُ من بريدي — أعد الإرسال' }).click();
  await settle();
  const r = await rowOf(quiet);
  check('بكلمة صاحبه الصريحة: يعود للطابور', r.auto_status === 'queued' && r.auto_attempts === 0, r.auto_status);
  check('والضغطة الأولى باقية في سجله، ومعها متى أُعيد', r.auto_report?.sent?.pressed_at === pressedAt && !!r.auto_report.sent.rearmed && r.auto_report.filled?.length === 1, JSON.stringify(r.auto_report?.sent));
  const events = await admin(`/rest/v1/application_events?application_id=eq.${r.id}&select=kind,detail&order=at.asc`).then((x) => x.json());
  check('والسجل يحفظ أنه قالها', events.some((e) => e.kind === 'note' && /لم يصل/.test(e.detail ?? '')), events.map((e) => e.detail).join(' | '));
}
{
  const c = cardOf(code);
  check('رمز تحقق: يُقال أين يُدخَل', (await c.locator('.unverified').textContent()).includes('رمز تحقق'));
  await c.locator('button', { hasText: 'وصل' }).click();
  await settle();
  const r = await rowOf(code);
  check('«وصل»: يصير «قدّمت» ويخرج من يد الأتمتة', r.status === 'applied' && r.auto_status === null, `${r.status}/${r.auto_status}`);
  check('وسجل الضغطة لا يُمحى', r.auto_report?.sent?.pressed_at === pressedAt);
  check('ولا يُقال عنه «أُرسل تلقائياً ✓»: الصفحة لم تؤكّده', !(await cardOf(code).textContent()).includes('أُرسل تلقائياً'));
}

console.log('\nالإخراج من الطابور');
{
  let c = cardOf(waiting);
  check('ما في الطابور يُخرَج بضغطة', await c.locator('button', { hasText: 'أخرجه من الطابور' }).count() === 1);
  await c.locator('button', { hasText: 'أخرجه من الطابور' }).click();
  await settle();
  check('فيخرج ويبقى محفوظاً', (await rowOf(waiting)).auto_status === null && (await rowOf(waiting)).status === 'saved');
  c = cardOf(waiting);
  await c.locator('button', { hasText: 'قدّم عليه تلقائياً' }).click();
  await settle();
  check('ويُعاد متى شاء صاحبه', (await rowOf(waiting)).auto_status === 'queued');
  check('ما ضُغط إرساله لا «أخرجه» عليه ولا «قدّم عليه»', await cardOf(code).locator('button', { hasText: /أخرجه من الطابور|قدّم عليه تلقائياً/ }).count() === 0);
}

console.log('\nالإيقاف الشامل');
{
  await page.locator('.runbar-stop').click();
  await page.waitForSelector('.runbar-stopped', { timeout: 15000 });
  let a = await answers();
  check('«أوقف كل شيء» يُحفظ في ضبط صاحبه', a._settings?.paused === true);
  check('ولا يمسّ ما في ملفه', a._facts?.gender === 'ذكر' && a['Are you based in the GCC?'] === 'Yes');
  check('والشريط يقولها صريحة', (await page.locator('.runbar-stopped').textContent()).includes('الأتمتة موقوفة'));
  check('والطابور يحتفظ بما فيه', (await rowOf(waiting)).auto_status === 'queued' && (await rowOf(quiet)).auto_status === 'queued');
  await settle();
  check('وما في الطابور مكتوب عليه أنه موقوف', (await cardOf(waiting).textContent()).includes('في الطابور — موقوف'));
  const queue = await asMe('/rest/v1/rpc/my_apply_queue', { method: 'POST', body: '{}' }).then((r) => r.json());
  if (guarded) check('والقاعدة لا تسلّم شيئاً وهو موقوف', Array.isArray(queue) && queue.length === 0, JSON.stringify(queue).slice(0, 80));
  else console.log('  ! الترحيل 011 لم يُطبَّق: القاعدة ما زالت تسلّم الطابور وهو موقوف — الإضافة هي من يمتنع (فُحص في test:background)');
  await page.screenshot({ path: `${shots}/sending-2.png`, fullPage: true });

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.runbar-stopped', { timeout: 15000 });
  check('ويبقى موقوفاً بعد إعادة الفتح', true);
  await page.locator('.runbar-stopped .btn').click();
  await page.waitForSelector('.runbar-stop', { timeout: 15000 });
  a = await answers();
  check('«استأنف» يعيده', a._settings?.paused === false && a._facts?.gender === 'ذكر');
}
check('لا أخطاء في الصفحة', errors.length === 0, errors.join(' | '));

await browser.close();
await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ الموقع يقول ما يُعرف فقط، وما لم يتأكد لا يعود إلا بكلمة صاحبه');
process.exit(fails ? 1 : 0);
