// Publishes the built site to a public Supabase Storage bucket, so it has a real URL today
// without adding another provider. The app uses hash routing, so no rewrite rules are needed.
//
//   npm run build && node scripts/deploy-supabase.mjs
//
// Netlify remains the better long-term home (custom domain, headers); this is the fast path.

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

const root = new URL('../', import.meta.url);
const env = Object.fromEntries(
  (await readFile(new URL('.env.local', root), 'utf8')).split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
);
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }, realtime: { transport: ws }
});

const BUCKET = 'site';
const DIST = new URL('apps/web/dist/', root).pathname;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'
};

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p); else yield p;
  }
}

// A public bucket: these are the files of a public website.
const { data: buckets } = await db.storage.listBuckets();
if (!buckets?.some((b) => b.id === BUCKET)) {
  const { error } = await db.storage.createBucket(BUCKET, { public: true });
  if (error) { console.error('createBucket:', error.message); process.exit(1); }
  console.log('bucket created');
}

let n = 0;
for await (const file of walk(DIST)) {
  const key = relative(DIST, file);
  const body = await readFile(file);
  const contentType = TYPES[extname(file)] ?? 'application/octet-stream';
  // hashed asset names can cache forever; index.html must not
  const cacheControl = key === 'index.html' ? '60' : '31536000';
  const { error } = await db.storage.from(BUCKET).upload(key, body, { contentType, cacheControl, upsert: true });
  if (error) { console.error(key, '→', error.message); process.exit(1); }
  console.log('  ' + key);
  n++;
}

const url = `${env.VITE_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/index.html`;
console.log(`\n${n} files published\n\n${url}\n`);
console.log('One setting to finish: Supabase → Authentication → URL Configuration →');
console.log('add that URL under "Redirect URLs", or sign-in links will bounce elsewhere.');
