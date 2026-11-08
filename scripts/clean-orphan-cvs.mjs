// Removes CV files whose owner no longer exists.
//
// Account deletion removes the auth user, and the profile goes with it by cascade — but
// storage is not a table, so nothing cascades there. Postgres is also forbidden from deleting
// storage rows directly ("Use the Storage API instead"), which is exactly what this does.
//
//   node scripts/clean-orphan-cvs.mjs            # dry run: lists what would go
//   node scripts/clean-orphan-cvs.mjs --delete   # removes them

import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname;
const env = Object.fromEntries((await readFile(root + '.env.local', 'utf8')).split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const api = (p, o = {}) => fetch(env.VITE_SUPABASE_URL + p, { ...o,
  headers: { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type': 'application/json', ...o.headers } });

// Every account, not just the first page — a sweep that stops at page one would call every
// later user an orphan.
const users = new Set();
for (let page = 1; ; page++) {
  const r = await api(`/auth/v1/admin/users?page=${page}&per_page=200`).then((x) => x.json());
  const batch = r.users ?? [];
  for (const u of batch) users.add(u.id);
  if (batch.length < 200) break;
}

const top = await api('/storage/v1/object/list/cvs', { method: 'POST', body: JSON.stringify({ prefix: '', limit: 1000 }) }).then((x) => x.json());
const folders = (Array.isArray(top) ? top : []).map((o) => o.name).filter((n) => n && !n.includes('.'));
const orphans = folders.filter((f) => !users.has(f));

let files = [];
for (const f of orphans) {
  const inner = await api('/storage/v1/object/list/cvs', { method: 'POST', body: JSON.stringify({ prefix: f + '/', limit: 1000 }) }).then((x) => x.json());
  for (const o of (Array.isArray(inner) ? inner : [])) files.push({ path: `${f}/${o.name}`, size: o.metadata?.size ?? 0 });
}

console.log(`${users.size} account(s) · ${folders.length} CV folder(s) · ${orphans.length} orphaned · ${files.length} file(s), ${files.reduce((s, f) => s + f.size, 0)} bytes`);
for (const f of files) console.log(`  ${String(f.size).padStart(8)}  ${f.path}`);

if (!process.argv.includes('--delete')) { console.log('\ndry run — pass --delete to remove them'); process.exit(0); }
if (files.length) {
  const r = await api('/storage/v1/object/cvs', { method: 'DELETE', body: JSON.stringify({ prefixes: files.map((f) => f.path) }) });
  console.log(r.ok ? `\nremoved ${files.length} file(s)` : `\nfailed: ${r.status} ${await r.text()}`);
}
