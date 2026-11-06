// Publishes the built site to Netlify through its API, using the token the CLI already
// stored on this machine. No CLI install, no interactive login.
//
//   node scripts/deploy-netlify.mjs            — publish
//   node scripts/deploy-netlify.mjs --create   — create the site first, then publish
//
// Netlify's deploy is digest based: you declare every file with its SHA1, it answers with
// the ones it does not already hold, and only those are uploaded.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';

const SITE = 'qaddim';
const root = new URL('../', import.meta.url);
const DIST = new URL('apps/web/dist/', root).pathname;

const cfg = JSON.parse(await readFile(join(homedir(), 'Library/Preferences/netlify/config.json'), 'utf8'));
const token = Object.values(cfg.users ?? {}).map((u) => u?.auth?.token).find(Boolean);
if (!token) { console.error('No Netlify token stored. Run: netlify login'); process.exit(1); }

const api = async (path, opts = {}) => {
  const r = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...opts, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...opts.headers }
  });
  const body = r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { console.error(`${r.status} ${path}:`, body); process.exit(1); }
  return body;
};

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

let site = (await api('/sites?per_page=100')).find((s) => s.name === SITE);
if (!site) {
  if (!process.argv.includes('--create')) {
    console.error(`No site called "${SITE}". Re-run with --create to make it.`); process.exit(1);
  }
  site = await api('/sites', { method: 'POST', body: JSON.stringify({ name: SITE }) });
  console.log('site created:', site.ssl_url);
  // Netlify defaults new sites to team-only viewing; this is a public job board.
  await api(`/sites/${site.id}`, { method: 'PATCH', body: JSON.stringify({ sso_login: false }) });
}

const files = {}, bytes = {};
for await (const f of walk(DIST)) {
  const buf = await readFile(f);
  const key = '/' + relative(DIST, f);
  files[key] = createHash('sha1').update(buf).digest('hex');
  bytes[key] = buf;
}

const deploy = await api(`/sites/${site.id}/deploys`, {
  method: 'POST', body: JSON.stringify({ files, draft: false })
});
const needed = new Set(deploy.required ?? []);
const toSend = Object.keys(files).filter((k) => needed.has(files[k]));
console.log(`${Object.keys(files).length} files · ${toSend.length} to upload`);

for (const key of toSend) {
  const r = await fetch(`https://api.netlify.com/api/v1/deploys/${deploy.id}/files${key}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: bytes[key]
  });
  if (!r.ok) { console.error('upload', key, r.status, await r.text()); process.exit(1); }
  console.log('  ' + key);
}

// Wait for it to go live rather than reporting a URL that is still building.
let state = deploy.state;
for (let i = 0; i < 40 && state !== 'ready' && state !== 'error'; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  ({ state } = await api(`/deploys/${deploy.id}`));
}
console.log(state === 'ready' ? `\n✓ ${site.ssl_url}` : `\n✗ deploy ${state}`);
if (state !== 'ready') process.exit(1);
