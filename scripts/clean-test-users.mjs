// Removes the accounts the test suites create.
//
//   npm run clean:tests
//
// Each suite deletes its own account at the end — but a suite that throws never reaches that
// line, and the rows pile up in a live database. This is the sweep. The suites also call it
// themselves when they crash (scripts/test-env.mjs), so a dropped connection in the middle of
// a run no longer leaves an account behind until someone remembers this command.

import { pathToFileURL } from 'node:url';

// The prefixes every suite uses. A real address never starts with one.
export const TEST_ADDRESS = [
  /^exttest\+/, /^flowtest\+/, /^authtest\+/, /^rls-/, /^auto-/, /^loop-/, /^probe-/, /^audit-/,
  /^(questions|sending)-\d+@example\.com$/, /^(ui|facts|live)-\d+@example\.com$/,
  // Resend's own sink address, used when checking that sign-in mail actually goes out.
  /^delivered(\+[^@]*)?@resend\.dev$/
];

export async function sweepTestUsers(env, log = console.log) {
  const api = (p, o = {}) => fetch(env.VITE_SUPABASE_URL + p, { ...o,
    headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json', ...o.headers } });

  // Every page — and every page read for certain. Reading only the first and calling everyone
  // else an orphan is how a cleanup script deletes real accounts once the project passes two
  // hundred users; so is treating a page that failed to load as the last one. A listing that
  // cannot be completed deletes nothing.
  const users = [];
  for (let page = 1; ; page++) {
    const res = await api(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const body = res.ok ? await res.json() : null;
    if (!Array.isArray(body?.users)) throw new Error(`could not list accounts (page ${page}, HTTP ${res.status}) — nothing removed`);
    users.push(...body.users);
    if (body.users.length < 200) break;
  }
  const stale = users.filter((u) => TEST_ADDRESS.some((re) => re.test(u.email ?? '')));

  for (const u of stale) {
    await api(`/auth/v1/admin/users/${u.id}`, { method: 'DELETE' });
    log('  removed ' + u.email);
  }

  // A profile outlives its account only if something deleted the account another way.
  const live = new Set(users.filter((u) => !stale.includes(u)).map((u) => u.id));
  const profiles = live.size ? await api('/rest/v1/profiles?select=id&limit=1000').then((r) => (r.ok ? r.json() : [])) : [];
  // Only when every profile fits in one answer is "not among the accounts" a safe conclusion.
  const orphans = profiles.length < 1000 ? profiles.filter((p) => !live.has(p.id)) : [];
  for (const p of orphans) {
    await api(`/rest/v1/profiles?id=eq.${p.id}`, { method: 'DELETE' });
    log('  removed orphaned profile ' + p.id.slice(0, 8));
  }
  return { accounts: stale.length, orphans: orphans.length };
}

// Run directly: sweep the database the suites use, and say what was found.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { testEnv } = await import('./test-env.mjs');
  const r = await sweepTestUsers(await testEnv({ quiet: true }));
  console.log(r.accounts || r.orphans
    ? `\n${r.accounts} test account(s), ${r.orphans} orphan(s) removed`
    : 'nothing left behind ✓');
}
