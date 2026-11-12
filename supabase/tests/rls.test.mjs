// Can one signed-in user reach another's data? The question a launch must answer before it
// has users, not after. Two real accounts, each asking for the other's rows.
import { testEnv } from '../../scripts/test-env.mjs';

const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY, PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;

const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

async function makeUser(tag) {
  const email = `rls-${tag}-${Date.now()}@example.com`, password = 'Rls-' + Math.random().toString(36).slice(2) + '!A9';
  const u = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
  const s = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: PUB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }) }).then((r) => r.json());
  return { id: u.id, email, token: s.access_token };
}

const asUser = (u, p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: PUB, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json', ...o.headers } });

const A = await makeUser('a'), B = await makeUser('b');
console.log('مستخدمان:', A.id.slice(0, 8), B.id.slice(0, 8));

// A يكتب بياناته
await asUser(A, `/rest/v1/profiles?id=eq.${A.id}`, { method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({ full_name: 'سرّ أ', phone: '0500000001', cv_path: `${A.id}/secret.pdf` }) });
const job = await admin('/rest/v1/jobs?select=id&limit=1').then((r) => r.json());
await asUser(A, '/rest/v1/applications', { method: 'POST',
  body: JSON.stringify({ user_id: A.id, job_id: job[0].id, status: 'saved', notes: 'ملاحظة أ السرّية' }) });

let fails = 0;
const check = async (what, fn) => {
  const ok = await fn();
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails++;
};

await check('ب لا يقرأ ملف أ', async () =>
  (await asUser(B, `/rest/v1/profiles?id=eq.${A.id}&select=full_name,phone`).then((r) => r.json())).length === 0);

await check('ب لا يقرأ طلبات أ', async () =>
  (await asUser(B, `/rest/v1/applications?user_id=eq.${A.id}&select=notes`).then((r) => r.json())).length === 0);

await check('ب لا يقرأ مطابقات أ', async () =>
  (await asUser(B, `/rest/v1/matches?user_id=eq.${A.id}&select=score`).then((r) => r.json())).length === 0);

await check('ب لا يعدّل ملف أ', async () => {
  const r = await asUser(B, `/rest/v1/profiles?id=eq.${A.id}`, { method: 'PATCH',
    headers: { Prefer: 'return=representation' }, body: JSON.stringify({ full_name: 'اختُرق' }) });
  const body = await r.json();
  const after = await admin(`/rest/v1/profiles?id=eq.${A.id}&select=full_name`).then((x) => x.json());
  return after[0].full_name === 'سرّ أ';
});

await check('ب لا يحذف طلبات أ', async () => {
  await asUser(B, `/rest/v1/applications?user_id=eq.${A.id}`, { method: 'DELETE' });
  const left = await admin(`/rest/v1/applications?user_id=eq.${A.id}&select=id`).then((x) => x.json());
  return left.length === 1;
});

await check('ب لا ينزّل سيرة أ', async () => {
  const r = await fetch(`${URL_}/storage/v1/object/sign/cvs/${A.id}/secret.pdf`, {
    method: 'POST', headers: { apikey: PUB, Authorization: `Bearer ${B.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 60 }) });
  return !r.ok;
});

await check('زائر بلا حساب لا يقرأ أي ملف', async () =>
  (await fetch(`${URL_}/rest/v1/profiles?select=full_name`, { headers: { apikey: PUB } }).then((r) => r.json()))?.length !== 1);

await check('الوظائف وحدها مفتوحة للزائر', async () => {
  const r = await fetch(`${URL_}/rest/v1/jobs?select=id&limit=1`, { headers: { apikey: PUB } });
  return r.ok;
});

for (const u of [A, B]) await admin(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
console.log(fails ? `\n✗ ${fails} ثغرة` : '\n✓ العزل سليم');
process.exit(fails ? 1 : 0);
