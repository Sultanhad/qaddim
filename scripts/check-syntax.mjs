// Parses every script the servers run, without running any of them.
//
// The worker is not imported by any test, so a file that cannot even be parsed passed the
// whole suite: a second `const STALE_DAYS` reached main on 14 Nov 2026 and every pass after it
// died in its first millisecond. A parse costs nothing and catches that whole class.
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const dirs = ['scripts', 'scripts/tests', 'extension/src'];
let bad = 0, n = 0;
for (const d of dirs) {
  let files = [];
  try { files = await readdir(new URL(`../${d}/`, import.meta.url)); } catch { continue; }
  for (const f of files.filter((x) => /\.(mjs|js)$/.test(x))) {
    n++;
    try { execFileSync(process.execPath, ['--check', `${d}/${f}`], { stdio: 'pipe' }); }
    catch (e) { bad++; console.error(`✗ ${d}/${f}\n${String(e.stderr).split('\n').slice(0, 5).join('\n')}`); }
  }
}
if (bad) process.exit(1);
console.log(`${n} script(s) parse`);
