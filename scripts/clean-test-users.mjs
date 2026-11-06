// Removes the accounts the test suites create.
//
// Each suite deletes its own account at the end — but a suite that throws never reaches that
// line, and the rows pile up in a live database. This is the sweep, and `npm test` can call it.

import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname;
const env = Object.fromEntries((await readFile(root + '.env.local', 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

// The prefixes every suite uses. A real address never starts with one.
const TEST = [/^exttest\+/, /^flowtest\+/, /^authtest\+/, /^rls-/, /^auto-/, /^loop-/, /^probe-/];

const api = (p, o = {}) => fetch(env.VITE_SUPABASE_URL + p, { ...o,
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json', ...o.headers } });

const users = (await api('/auth/v1/admin/users?per_page=200').then((r) => r.json())).users ?? [];
const stale = users.filter((u) => TEST.some((re) => re.test(u.email ?? '')));

for (const u of stale) {
  await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
  console.log('  removed ' + u.email);
}

// A profile outlives its account only if something deleted the account another way.
const live = users.filter((u) => !stale.includes(u)).map((u) => u.id);
const orphans = live.length
  ? await api(`/rest/v1/profiles?select=id&id=not.in.(${live.join(',')})`).then((r) => r.json())
  : [];
for (const p of orphans) {
  await api(`/rest/v1/profiles?id=eq.${p.id}`, { method: 'DELETE' });
  console.log('  removed orphaned profile ' + p.id.slice(0, 8));
}

console.log(stale.length || orphans.length
  ? `\n${stale.length} test account(s), ${orphans.length} orphan(s) removed`
  : 'nothing left behind ✓');
