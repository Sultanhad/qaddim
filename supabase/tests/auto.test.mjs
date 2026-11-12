// The limits that make automatic sending defensible — tested against the database, because
// that is where they have to hold. An extension can be edited; a policy in SQL cannot.
import { testEnv } from '../../scripts/test-env.mjs';

const root = new URL('../../', import.meta.url).pathname;
const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const email = `auto-${Date.now()}@example.com`, password = 'Au-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
const sess = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }) }).then((r) => r.json());
const as = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: PUB, Authorization: `Bearer ${sess.access_token}`, 'Content-Type': 'application/json', ...o.headers } });
const queue = () => as('/rest/v1/rpc/my_apply_queue', { method: 'POST', body: '{}' }).then((r) => r.json());
const stats = () => as('/rest/v1/rpc/my_apply_stats', { method: 'POST', body: '{}' }).then((r) => r.json()).then((d) => d[0]);

await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH',
  body: JSON.stringify({ onboarded: true, auto_apply: true, auto_submit: true, daily_cap: 3 }) });

// وظائف من شركتين: اثنتان من نفس الشركة وواحدة من غيرها
const jobs = await admin('/rest/v1/jobs?select=id,company&is_open=eq.true&limit=400').then((r) => r.json());
const byCo = {};
for (const j of jobs) (byCo[j.company] ??= []).push(j.id);
const pairs = Object.entries(byCo);
const twoSameEntry = pairs.find(([, v]) => v.length >= 2);
const twoSame = twoSameEntry?.[1];
const other = pairs.find(([c]) => c !== twoSameEntry?.[0])?.[1];
check('وجدنا وظيفتين من شركة وواحدة من أخرى', !!twoSame && !!other);

const queueJob = (id) => admin('/rest/v1/applications', { method: 'POST',
  body: JSON.stringify({ user_id: me.id, job_id: id, status: 'saved', auto_status: 'queued' }) });

await queueJob(twoSame[0]); await queueJob(twoSame[1]); await queueJob(other[0]);

let q = await queue();
check('الطابور يُقرأ', Array.isArray(q) && q.length === 3, `${q.length ?? 0} عناصر`);
check('لا يرسل قبل اعتماد ثلاثة بيدك', q.every((x) => x.submit === false), JSON.stringify(q[0]?.submit));

// اعتمد ثلاثة يدوياً
const old = await admin(`/rest/v1/applications?user_id=eq.${me.id}&select=id&limit=3`).then((r) => r.json());
for (const a of old) await admin(`/rest/v1/applications?id=eq.${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'applied' }) });
let st = await stats();
check('العدّاد يرى الثلاثة المعتمدة', st.approved >= 3, `approved=${st.approved}`);
check('وصار يرسل وحده', st.submitting === true, `submitting=${st.submitting}`);

// واحدة لكل شركة في الأسبوع
await admin(`/rest/v1/applications?user_id=eq.${me.id}`, { method: 'DELETE' });
await queueJob(twoSame[0]); await queueJob(twoSame[1]);
const first = await admin(`/rest/v1/applications?user_id=eq.${me.id}&job_id=eq.${twoSame[0]}&select=id`).then((r) => r.json());
await admin(`/rest/v1/applications?id=eq.${first[0].id}`, { method: 'PATCH',
  body: JSON.stringify({ auto_status: 'submitted', auto_at: new Date().toISOString() }) });
q = await queue();
check('لا يقدّم مرتين لنفس الشركة في أسبوع', q.length === 0, `${q.length} بقي في الطابور`);

// سقف اليوم
await admin(`/rest/v1/applications?user_id=eq.${me.id}`, { method: 'DELETE' });
for (const id of [twoSame[0], twoSame[1], other[0]]) await queueJob(id);
await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({ daily_cap: 1 }) });
q = await queue();
check('سقف اليوم يحدّ الطابور', q.length <= 1, `${q.length} عنصر والسقف ١`);

// إعادة المحاولة
await admin(`/rest/v1/applications?user_id=eq.${me.id}`, { method: 'DELETE' });
await queueJob(other[0]);
const one = await admin(`/rest/v1/applications?user_id=eq.${me.id}&select=id`).then((r) => r.json());
await admin(`/rest/v1/applications?id=eq.${one[0].id}`, { method: 'PATCH',
  body: JSON.stringify({ auto_status: 'needs_you', auto_attempts: 3, auto_reason: 'سؤال' }) });
check('المتوقّفة تخرج من الطابور', (await queue()).length === 0);
await as('/rest/v1/rpc/retry_application', { method: 'POST', body: JSON.stringify({ app_id: one[0].id }) });
await admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({ daily_cap: 20 }) });
check('وتعود بعد الإجابة', (await queue()).length === 1);

// العزل: لا أحد يقرأ طابور غيره
const other2 = await admin('/auth/v1/admin/users', { method: 'POST',
  body: JSON.stringify({ email: `auto-b-${Date.now()}@example.com`, password, email_confirm: true }) }).then((r) => r.json());
const s2 = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST',
  headers: { apikey: PUB, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: other2.email, password }) }).then((r) => r.json());
const q2 = await fetch(`${URL_}/rest/v1/rpc/my_apply_queue`, { method: 'POST',
  headers: { apikey: PUB, Authorization: `Bearer ${s2.access_token}`, 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
check('طابور كل شخص له وحده', Array.isArray(q2) && q2.length === 0, `${q2.length ?? '?'} `);

for (const u of [me, other2]) await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} إخفاق` : '\n✓ حدود الإرسال التلقائي كلها قائمة');
process.exit(fails ? 1 : 0);
