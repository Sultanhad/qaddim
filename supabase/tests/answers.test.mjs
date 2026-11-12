// Answering by estimate: what is asked, what is held back, what is kept of the reply, and what
// happens to the application afterwards. The model is a stand-in here — this is about
// everything around it, against the real database, because that is where the answers are
// stored and where the application goes back in the queue.
//
//   npm run test:answers
import { testEnv } from '../../scripts/test-env.mjs';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { answerPending, planFor, requestFor, accept, settled, MAX_ROUNDS, MODEL_DEFAULT } from '../../scripts/answer-questions.mjs';

const root = new URL('../../', import.meta.url).pathname;
const env = await testEnv();
const URL_ = env.VITE_SUPABASE_URL, SRV = env.SUPABASE_SERVICE_KEY;
const db = createClient(URL_, SRV, { auth: { persistSession: false }, realtime: { transport: ws } });
const admin = (p, o = {}) => fetch(`${URL_}${p}`, { ...o,
  headers: { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json', ...o.headers } });

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const YEARS = 'How many years of professional Linux experience do you currently have?';
const WHY = 'Why do you want to work here?';
const STATUS = 'What is your current employment status?';
const SALARY = 'What is your current monthly salary?';
const EXPORT = 'Does the deemed export rule affect your employment?';
const VETERAN = 'Veteran status';
const MISSING = [
  { q: YEARS, kind: 'text' },
  { q: WHY, kind: 'text' },
  { q: STATUS, kind: 'combo', options: ['Employed full-time', 'Between jobs', 'Student'] },
  { q: SALARY, kind: 'text' },
  { q: EXPORT, kind: 'combo', options: ['Yes', 'No'] },
  { q: VETERAN, kind: 'select', options: ['I am a veteran', 'I am not a veteran', 'I do not wish to answer'] },
  { q: 'Headline', kind: 'text' }
];

console.log('ما يُسأل وما يُحجب');
{
  const profile = { answers: { Headline: 'Product analyst', _settings: { guess: true } } };
  const plan = planFor(profile, { job_id: 'j1', auto_report: { missing: MISSING } });
  check('ما أجابه صاحبه لا يُسأل عنه', !plan.ask.some((x) => x.q === 'Headline'));
  check('الإقرار النظامي يُحجب', plan.held.some((x) => x.q === EXPORT) && !plan.ask.some((x) => x.q === EXPORT));
  check('السؤال الإحصائي يُجاب بالامتناع بلا نموذج', plan.declined[VETERAN]?.a === 'I do not wish to answer');
  check('والباقي يُسأل مرقّماً', plan.ask.map((x) => x.n).join() === '1,2,3,4' && plan.ask[2].options.length === 3);
  const manual = planFor(profile, { job_id: 'j1', auto_report: { missing: [{ q: 'Resume', manual: true }, { q: YEARS }] } });
  check('ما يُكمَل في صفحة الشركة يُعدّ ولا يُسأل', manual.manual === 1 && manual.ask.length === 1);

  const req = requestFor({ profile: { ...profile, full_name: 'Sara', cities: ['riyadh'], current_salary: '' }, cv: 'JVBERi0=', job: { title: 'Analyst', company: 'Acme', description: 'SQL and Linux.' }, ask: plan.ask });
  const text = req.messages[0].content.at(-1).text;
  check('الطلب يحمل السيرة وثيقةً', req.messages[0].content[0].type === 'document' && req.messages[0].content[0].source.media_type === 'application/pdf');
  check('والأسئلة بخياراتها', text.includes(`1. ${YEARS}`) && text.includes('"Between jobs"'));
  check('وما كتبه بنفسه سياقاً', text.includes('Q: Headline') && text.includes('A: Product analyst'));
  check('ولا يحمل حقلاً فارغاً', !text.includes('current_salary'));
  check('النموذج والمخرج المقيَّد والبديل عند الرفض', req.model === MODEL_DEFAULT && !!req.output_config.format && req.fallbacks === 'default' && req.betas.includes('server-side-fallback-2026-07-01'));
  check('بلا سيرة: يُقال ذلك ولا تُرسل وثيقة', (() => { const r = requestFor({ profile, cv: null, job: {}, ask: plan.ask }); return r.messages[0].content.length === 1 && r.messages[0].content[0].text.includes('No CV could be attached'); })());

  const kept = accept(plan.ask, { answers: [
    { n: 1, answer: ' 3 ', basis: 'estimate' },
    { n: 2, answer: 'I have spent three years on reporting pipelines, which is most of what this role asks for.', basis: 'cv' },
    { n: 3, answer: 'between jobs', basis: 'profile' },
    { n: 4, answer: null, basis: 'none' }
  ] });
  check('الجواب يُقصّ ويُحفظ بأساسه', kept[YEARS].a === '3' && kept[YEARS].basis === 'estimate');
  check('الخيار يُردّ بحروف الاستمارة', kept[STATUS].a === 'Between jobs');
  check('«لا أعرف» تبقى بلا جواب', kept[SALARY].a === null && kept[SALARY].basis === 'none');
  const bad = accept(plan.ask, { answers: [{ n: 3, answer: 'Freelancing', basis: 'estimate' }, { n: 1, answer: '5', basis: 'none' }] });
  check('خيار ليس من الخيارات يُسقط', bad[STATUS].a === null);
  check('وجواب بلا أساس يُسقط', bad[YEARS].a === null);
  check('وسؤال لم يُجَب عنه يُسجَّل محاولةً', bad[WHY].a === null);
}

console.log('\nعلى القاعدة');
const email = `auto-answers-${Date.now()}@example.com`, password = 'An-' + Math.random().toString(36).slice(2) + '!A9';
const me = await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email, password, email_confirm: true }) }).then((r) => r.json());
try {
  const jobs = await admin('/rest/v1/jobs?select=id,company&is_open=eq.true&limit=40').then((r) => r.json());
  const [one, two, three] = [jobs[0], jobs.find((j) => j.company !== jobs[0].company), jobs.findLast((j) => j.company !== jobs[0].company)];
  const seed = (job, missing) => admin('/rest/v1/applications', { method: 'POST', body: JSON.stringify({
    user_id: me.id, job_id: job.id, status: 'saved', auto_status: 'needs_you', auto_attempts: 2,
    auto_reason: 'أسئلة إلزامية بلا إجابة منك', auto_report: { filled: [], missing } }) });
  const setProfile = (answers) => admin(`/rest/v1/profiles?id=eq.${me.id}`, { method: 'PATCH', body: JSON.stringify({ full_name: 'مختبِر التقدير', onboarded: true, answers }) });
  const state = async () => ({
    answers: (await admin(`/rest/v1/profiles?id=eq.${me.id}&select=answers`).then((r) => r.json()))[0].answers,
    apps: Object.fromEntries((await admin(`/rest/v1/applications?user_id=eq.${me.id}&select=job_id,auto_status,auto_attempts,auto_reason`).then((r) => r.json())).map((a) => [a.job_id, a]))
  });
  // Stands in for the model: answers what it is told to, and records what it was sent.
  const calls = [];
  const model = (reply) => ({ beta: { messages: { parse: async (params) => { calls.push(params); return reply(params); } } } });
  const answering = (table) => model((params) => {
    const text = params.messages[0].content.at(-1).text;
    const asked = [...text.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), q: m[2] }));
    return { stop_reason: 'end_turn', parsed_output: { answers: asked.map(({ n, q }) => ({ n, answer: table[q] ?? null, basis: table[q] ? 'estimate' : 'none' })) } };
  });
  const quiet = () => {};

  await seed(one, [{ q: YEARS, kind: 'text' }, { q: STATUS, kind: 'combo', options: ['Employed full-time', 'Between jobs'] }]);
  await seed(two, [{ q: YEARS, kind: 'text' }, { q: EXPORT, kind: 'combo', options: ['Yes', 'No'] }]);
  await seed(three, [{ q: WHY, kind: 'text' }, { q: 'Resume', kind: 'file', manual: true }]);

  // 1) nobody asked for this → nothing happens
  await setProfile({ Headline: 'Product analyst' });
  let r = await answerPending({ db, client: answering({}), only: me.id, log: quiet });
  check('من لم يطلب التقدير لا يُجاب عنه', calls.length === 0 && r.people === 0);

  // 2) asked for it
  await setProfile({ Headline: 'Product analyst', _settings: { guess: true } });
  r = await answerPending({ db, only: me.id, log: quiet,
    client: answering({ [YEARS]: '3', [STATUS]: 'Between jobs', [WHY]: 'Because the work matches what I have done.' }) });
  let s = await state();
  check('سُئل النموذج مرة لكل طلب', calls.length === 3, String(calls.length));
  check('الأجوبة حُفظت للطلب نفسه لا لغيره', s.answers._for[one.id].answers[YEARS].a === '3' && s.answers._for[one.id].answers[STATUS].a === 'Between jobs');
  check('ولم تدخل أجوبته المحفوظة', s.answers[YEARS] === undefined && s.answers.Headline === 'Product analyst' && s.answers._settings.guess === true);
  check('طلب اكتملت أسئلته عاد للطابور بمحاولات مصفَّرة', s.apps[one.id].auto_status === 'queued' && s.apps[one.id].auto_attempts === 0);
  check('طلب فيه إقرار نظامي يبقى لصاحبه', s.apps[two.id].auto_status === 'needs_you' && s.answers._for[two.id].answers[EXPORT] === undefined, s.apps[two.id].auto_reason);
  check('ويُقال له ما بقي', /أُجيب عن 1 بالتقدير، وبقي 1/.test(s.apps[two.id].auto_reason ?? ''), s.apps[two.id].auto_reason);
  check('ما يُكمَل في صفحة الشركة لا يمنع المحاولة التالية', s.apps[three.id].auto_status === 'queued' && s.answers._for[three.id].answers[WHY].a.startsWith('Because'));
  check('والنتيجة تُحصى', r.answered === 4 && r.requeued === 2, JSON.stringify(r));

  // 3) the next pass has nothing new to ask
  calls.length = 0;
  await answerPending({ db, only: me.id, log: quiet, client: answering({}) });
  check('الدورة التالية لا تسأل عمّا سُئل', calls.length === 0, String(calls.length));

  // 4) the form came back with one more question → answered, within the limit of rounds
  await admin(`/rest/v1/applications?user_id=eq.${me.id}&job_id=eq.${one.id}`, { method: 'PATCH', body: JSON.stringify({
    auto_status: 'needs_you', auto_report: { filled: [], missing: [{ q: WHY, kind: 'text' }] } }) });
  await answerPending({ db, only: me.id, log: quiet, client: answering({ [WHY]: 'It fits.' }) });
  s = await state();
  check('سؤال جديد في المحاولة التالية يُجاب', s.answers._for[one.id].answers[WHY].a === 'It fits.' && s.answers._for[one.id].rounds === 2 && s.apps[one.id].auto_status === 'queued');
  check('وأجوبة الجولة الأولى باقية', s.answers._for[one.id].answers[YEARS].a === '3');

  const worn = { ...s.answers, _for: { ...s.answers._for, [one.id]: { ...s.answers._for[one.id], rounds: MAX_ROUNDS } } };
  await setProfile(worn);
  await admin(`/rest/v1/applications?user_id=eq.${me.id}&job_id=eq.${one.id}`, { method: 'PATCH', body: JSON.stringify({
    auto_status: 'needs_you', auto_report: { filled: [], missing: [{ q: 'One more thing?', kind: 'text' }] } }) });
  calls.length = 0;
  await answerPending({ db, only: me.id, log: quiet, client: answering({ 'One more thing?': 'Yes' }) });
  check(`بعد ${MAX_ROUNDS} جولات يتوقف التقدير عن ذلك الطلب`, calls.length === 0);

  // 5) a refusal, and a reply that is not usable, leave everything as it was
  await setProfile({ _settings: { guess: true } });
  await admin(`/rest/v1/applications?user_id=eq.${me.id}&job_id=eq.${two.id}`, { method: 'PATCH', body: JSON.stringify({
    auto_status: 'needs_you', auto_report: { filled: [], missing: [{ q: YEARS, kind: 'text' }] } }) });
  await answerPending({ db, only: me.id, log: quiet, client: model(() => ({ stop_reason: 'refusal', parsed_output: null })) });
  s = await state();
  check('رفض النموذج لا يُعيد الطلب ولا يخترع جواباً', s.apps[two.id].auto_status === 'needs_you' && !s.answers._for?.[two.id]?.answers?.[YEARS]?.a);

  check('«اكتمل» تعني: كل سؤال له جواب', settled({ _for: { j: { answers: { [YEARS]: { a: '3' } } } } }, { job_id: 'j', auto_report: { missing: [{ q: YEARS }] } })
    && !settled({ _for: { j: { answers: { [YEARS]: { a: null } } } } }, { job_id: 'j', auto_report: { missing: [{ q: YEARS }] } })
    && settled({ _for: { j: { answers: { [YEARS]: { a: '3' } } } } }, { job_id: 'j', auto_report: { missing: [{ q: YEARS }, { q: 'CV', manual: true }] } })
    && !settled({}, { job_id: 'j', auto_report: { missing: [{ q: YEARS }, { q: 'CV', manual: true }] } }));

  // 6) no key, no client → says so and does nothing
  const said = [];
  const had = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const none = await answerPending({ db, env: {}, only: me.id, log: (m) => said.push(m) });
  if (had) process.env.ANTHROPIC_API_KEY = had;
  check('بلا مفتاح: لا شيء، ويُقال', (none.skipped === 'no-key' && /ANTHROPIC_API_KEY/.test(said.join(' '))) || !!process.env.ANTHROPIC_AUTH_TOKEN);
} finally {
  await admin(`/auth/v1/admin/users/${me.id}`, { method: 'DELETE' });
}

console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ التقدير يجيب ما يحقّ له، ويحفظه لطلبه، ويترك الباقي لصاحبه');
process.exit(fails ? 1 : 0);
