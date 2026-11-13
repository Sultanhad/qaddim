// The free engine, against a stand-in for Google's API: no network, no key.
import { geminiAnswer } from '../answer-gemini.mjs';
import { accept } from '../answer-questions.mjs';

let fails = 0;
const check = (w, ok, x = '') => { console.log(`  ${ok ? '✓' : '✗'} ${w}${x ? ' · ' + x : ''}`); if (!ok) fails++; };
const reply = (obj, finishReason = 'STOP') => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(obj) }] } }] }), text: async () => '' });
const status = (n, text = '') => ({ ok: false, status: n, json: async () => ({}), text: async () => text });
const ask = [{ n: 1, q: 'How many years of SQL?', options: null }, { n: 2, q: 'Are you fluent in English?', options: ['Yes', 'No'] }];
const good = { answers: [{ n: 1, answer: 'About 3 years', basis: 'estimate' }, { n: 2, answer: 'yes', basis: 'cv' }] };

const seen = [];
const r = await geminiAnswer({ key: 'k', system: 'S', text: 'T', cv: 'JVBERi0=', models: ['a', 'b', 'c'],
  fetchImpl: async (url, init) => { seen.push({ url, init }); return url.includes('/a:') ? status(429) : url.includes('/b:') ? status(404) : reply(good); } });
check('a model out of today\'s allowance hands over to the next', r.model === 'c' && seen.length === 3, r.model);
check('the key travels in a header, never in the address', seen.every((s) => !s.url.includes('k') || !/key=/.test(s.url)) && seen[0].init.headers['x-goog-api-key'] === 'k');
const body = JSON.parse(seen[0].init.body);
check('the CV goes as a PDF beside the questions', body.contents[0].parts[0].inlineData.mimeType === 'application/pdf' && body.contents[0].parts[1].text === 'T');
check('the instructions go as the system instruction', body.systemInstruction.parts[0].text === 'S');
check('the reply is asked for as JSON in a fixed shape', body.generationConfig.responseMimeType === 'application/json' && body.generationConfig.responseSchema.required[0] === 'answers');
const kept = accept(ask, r.parsed);
check('and what comes back passes the same checks as Claude\'s', kept['How many years of SQL?'].a === 'About 3 years' && kept['Are you fluent in English?'].a === 'Yes', JSON.stringify(kept));

const all429 = await geminiAnswer({ key: 'k', system: 'S', text: 'T', models: ['a', 'b'], fetchImpl: async () => status(429) });
check('every model used up: "rate", and nothing invented', all429.stopped === 'rate' && all429.parsed === null);
const bad = await geminiAnswer({ key: 'k', system: 'S', text: 'T', models: ['a', 'b'], fetchImpl: async () => status(400, 'API key not valid. Please pass a valid API key.') });
check('a key Google refuses stops at once', bad.stopped === 'auth');
const blocked = await geminiAnswer({ key: 'k', system: 'S', text: 'T', models: ['a', 'b'], fetchImpl: async (u) => (u.includes('/a:') ? reply(good, 'SAFETY') : reply(good)) });
check('a reply stopped for safety is not used; the next model is asked', blocked.model === 'b');
const junk = await geminiAnswer({ key: 'k', system: 'S', text: 'T', models: ['a'], fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] }) }) });
check('a reply that is not the shape asked for is dropped', junk.parsed === null);

console.log(fails ? `\n✗ ${fails}` : '\n✓ Gemini engine');
process.exit(fails ? 1 : 0);
