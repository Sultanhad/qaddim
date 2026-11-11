// Does every file of the extension still parse?
//
// The owner's Chrome loads the extension straight from this folder, so a file saved with a
// syntax error is not a failing test somewhere — it is an extension that stops working the next
// time it is reloaded, silently. This is the cheapest possible guard against that, run first.
import { readdir, readFile } from 'node:fs/promises';
import vm from 'node:vm';

const dir = new URL('../extension/src/', import.meta.url);
let bad = 0;
for (const f of (await readdir(dir)).filter((n) => n.endsWith('.js'))) {
  try { new vm.Script(await readFile(new URL(f, dir), 'utf8'), { filename: f }); }
  catch (e) { bad++; console.error(`extension/src/${f}: ${e.message}`); }
}
JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
if (bad) process.exit(1);
console.log('extension parses ✓');
