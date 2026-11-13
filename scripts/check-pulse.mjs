// Is the worker alive?
//
//   node scripts/check-pulse.mjs            # says so; exit 1 when two passes have been missed,
//                                           # or when a quarter of the boards did not answer
//   node scripts/check-pulse.mjs --github   # the same, and hands the answer to a workflow
//
// This is what raises the alarm when the worker stops, so it runs apart from it (its own
// workflow, .github/workflows/pulse.yml) and can be run from anywhere else as well. It needs
// nothing private — the pulse is public and so is the key that reads it (the one already in
// the site's bundle).
import { appendFile } from 'node:fs/promises';
import { loadEnv } from './env.mjs';

// Two passes missed, and ten minutes' patience — at whatever pace the worker says it runs.
const lateAfter = (everyMin) => 2 * (Number(everyMin) || 15) + 10;
const env = await loadEnv();
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) { console.error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are not set'); process.exit(2); }
const get = (path, init = {}) => fetch(url + path, { ...init, headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } });

let pulse = null, asked = false;
try {
  // The database's own answer first (migration 012), so "late" is defined in one place…
  const r = await get('/rest/v1/rpc/worker_health', { method: 'POST', body: '{}' });
  if (r.ok) {
    const row = (await r.json())[0] ?? null;
    asked = true;
    if (row) pulse = { at: row.last_pass, minutes: row.minutes_ago, late: row.late, host: row.host, jobs: row.jobs, boards: row.boards, down: row.boards_down };
  }
  // …and the pulse itself where that function is not there yet.
  if (!asked) {
    const t = await get('/rest/v1/ops_heartbeat?name=eq.ingest&select=at,detail');
    if (!t.ok) throw new Error('HTTP ' + t.status);
    const row = (await t.json())[0] ?? null;
    asked = true;
    if (row) {
      const minutes = Math.round((Date.now() - new Date(row.at).getTime()) / 60000);
      pulse = { at: row.at, minutes, late: minutes > lateAfter(row.detail?.every_min), host: row.detail?.host ?? null, jobs: row.detail?.jobs ?? null, boards: row.detail?.boards ?? null, down: row.detail?.errors?.length ?? 0 };
    }
  }
} catch (e) {
  // Not being able to ask is not the worker being down. It is said, and it is not an alarm:
  // an alarm that fires whenever this check's own network blinks is one nobody reads.
  console.log('could not read the pulse: ' + (e?.message ?? e));
  await out({ state: 'unknown', summary: 'could not read the pulse' });
  process.exit(0);
}

// Three answers. "Alive, but a quarter of the boards did not answer it" is its own: a hiring
// system that starts refusing the server's address looks exactly like that, and the worker
// would otherwise go on reporting itself healthy while a whole system's jobs went stale.
// And is GitHub still accepting the database's requests to start things (migration 013)?
// A token that expired or was revoked answers 401 or 403; the worker then quietly falls back to
// GitHub's own sparse schedule. Said here before it shows as lateness.
let refused = null;
try {
  const d = await get('/rest/v1/rpc/dispatch_health', { method: 'POST', body: '{}' });
  if (d.ok) refused = (await d.json()).find((x) => x.status != null && x.status !== 204) ?? null;
} catch { /* not set up yet: nothing to say */ }

const late = !pulse || pulse.late;
const thin = !late && pulse.boards > 0 && pulse.down * 4 >= pulse.boards;
const state = late ? 'down' : thin || refused ? 'degraded' : 'ok';
const summary = (!pulse ? 'the worker has never left a pulse'
  : `last pass ${pulse.minutes} min ago${pulse.host ? ' on ' + pulse.host : ''} · ${pulse.jobs ?? '?'} postings read · ${pulse.down} of ${pulse.boards ?? '?'} boards did not answer`)
  + (refused ? ` · GitHub refused to start ${refused.workflow} (HTTP ${refused.status}) — the dispatch token needs renewing` : '');
console.log({ down: '✗ ', degraded: '~ ', ok: '✓ ' }[state] + summary);
await out({ state, summary, minutes: pulse?.minutes ?? '' });
process.exit(state === 'ok' ? 0 : 1);

async function out(values) {
  if (!process.argv.includes('--github') || !process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}\n`).join(''));
}
