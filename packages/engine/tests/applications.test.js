// Where an application stands. Run: node packages/engine/tests/applications.test.js
import { stateOf, awaitingProof, mayQueue, isPaused, STATES, STATE_AR } from '../src/applications.js';

const results = [];
const check = (g, n, c, d) => results.push({ g, n, pass: !!c, detail: c ? '' : String(d ?? '') });
const app = (status, auto_status, auto_report) => ({ status, auto_status, auto_report });
const pressed = (extra = {}) => ({ sent: { pressed_at: '2026-11-11T01:42:10Z', ...extra } });

const CASES = [
  [null, 'DISCOVERED'],
  [app('saved', null, null), 'MATCHED'],
  [app('saved', 'queued', null), 'READY'],
  [app('saved', 'filling', null), 'PREPARING'],
  [app('saved', 'filling', pressed()), 'SUBMITTING'],
  [app('applied', 'submitted', pressed({ outcome: 'confirmed' })), 'SUBMITTED'],
  [app('applied', null, null), 'SUBMITTED'],                          // the person says they applied by hand
  [app('interview', 'submitted', null), 'SUBMITTED'],
  [app('rejected', 'submitted', null), 'SUBMITTED'],                  // it was sent; the answer was no
  [app('saved', 'needs_you', { missing: [{ q: 'Why?' }] }), 'ACTION_REQUIRED'],
  [app('saved', 'needs_you', pressed({ outcome: 'unverified' })), 'ACTION_REQUIRED'],
  [app('saved', 'needs_you', pressed({ outcome: 'code' })), 'ACTION_REQUIRED'],
  [app('saved', 'failed', null), 'FAILED'],
  [app('saved', null, { duplicate: true }), 'DUPLICATE'],
  [app('closed', null, null), 'CANCELLED'],
  [app('withdrawn', 'submitted', null), 'SUBMITTED'],                 // sent first, withdrawn after: it did go
  [app('saved', null, { cancelled: true }), 'CANCELLED']
];
// Fifty seconds after the press in `pressed()`: inside the time a page is given to answer.
const NOW = Date.parse('2026-11-11T01:43:00Z');
for (const [a, want] of CASES) {
  const got = stateOf(a, NOW);
  check('State', `${a ? `${a.status}/${a.auto_status ?? '—'}${a.auto_report?.sent ? '+pressed' : ''}` : 'no application'} → ${want}`, got === want, got);
}
check('State', 'Every answer is one of the eleven', CASES.every(([a]) => STATES.includes(stateOf(a, NOW))) && STATES.length === 11);
check('State', '"Sending" for an hour is a run that died: it needs its owner',
  stateOf(app('saved', 'filling', pressed()), NOW + 60 * 60 * 1000) === 'ACTION_REQUIRED');
check('State', 'And every state has a name a person reads', STATES.every((s) => STATE_AR[s]));

// The rule this file exists for: after a press, nothing automatic touches it.
check('Proof', 'Pressed, nothing known: waiting for proof', awaitingProof(app('saved', 'needs_you', pressed())));
check('Proof', 'Pressed, page went quiet: waiting for proof', awaitingProof(app('saved', 'needs_you', pressed({ outcome: 'unverified' }))));
check('Proof', 'A code step is still waiting for proof', awaitingProof(app('saved', 'needs_you', pressed({ outcome: 'code' }))));
check('Proof', 'The form came back with errors: nothing went', !awaitingProof(app('saved', 'needs_you', pressed({ outcome: 'rejected' }))));
check('Proof', 'Confirmed needs no more proof', !awaitingProof(app('applied', 'submitted', pressed({ outcome: 'confirmed' }))));
check('Proof', 'The person re-armed it: theirs to send again', !awaitingProof(app('saved', 'needs_you', pressed({ outcome: 'unverified', rearmed: true }))));
check('Proof', 'Never pressed: nothing to prove', !awaitingProof(app('saved', 'needs_you', { missing: [] })) && !awaitingProof(null));

check('Queue', 'A saved job may be queued', mayQueue(app('saved', null, null)));
check('Queue', 'A stopped one may be queued again', mayQueue(app('saved', 'needs_you', { missing: [] })) && mayQueue(app('saved', 'failed', null)));
check('Queue', 'An unconfirmed send may not', !mayQueue(app('saved', 'needs_you', pressed({ outcome: 'unverified' }))));
check('Queue', 'Nor one that is sent, in the queue, being filled, or closed',
  !mayQueue(app('applied', 'submitted', null)) && !mayQueue(app('saved', 'queued', null)) && !mayQueue(app('saved', 'filling', null)) && !mayQueue(app('closed', null, null)));
check('Queue', 'And nothing may while everything is paused', !mayQueue(app('saved', null, null), { paused: true }));
check('Pause', 'Paused is a setting the person holds', isPaused({ answers: { _settings: { paused: true } } }) && !isPaused({ answers: {} }) && !isPaused(null));

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + (r.g + '          ').slice(0, 12) + r.n + (r.pass ? '' : '  <-- ' + r.detail));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
