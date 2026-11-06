// The edge function cannot import from outside its folder, so the engine is copied in.
// This keeps the copy honest: `--check` fails if the two ever drift apart.
import { readFile, writeFile } from 'node:fs/promises';
const FILES = ['text.js', 'taxonomy.js', 'score.js', 'sources.js'];
const root = new URL('../', import.meta.url);
const from = (f) => new URL(`packages/engine/src/${f}`, root);
const to = (f) => new URL(`supabase/functions/_shared/${f}`, root);
const check = process.argv.includes('--check');
let drift = [];
for (const f of FILES) {
  const src = await readFile(from(f), 'utf8');
  let dst = '';
  try { dst = await readFile(to(f), 'utf8'); } catch {}
  if (src === dst) continue;
  if (check) drift.push(f); else await writeFile(to(f), src);
}
if (check && drift.length) {
  console.error('Engine copy is stale: ' + drift.join(', ') + '\nRun: npm run sync:engine');
  process.exit(1);
}
console.log(check ? 'engine copy in sync ✓' : 'engine copied to the edge function ✓');
