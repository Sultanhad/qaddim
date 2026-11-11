// What the extension does around a form: whether it may send, what it does with forms that
// were left waiting, and what it refuses to open. The database is a stand-in served from this
// machine, so nothing here reaches Supabase or an employer.
//
//   npm run test:background
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/node_modules/playwright/index.mjs';

const ext = new URL('../', import.meta.url).pathname.replace(/\/$/, '');
let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

// ── the stand-in database ──
const db = { maySubmit: true, queue: [], seen: [] };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = decodeURIComponent(req.url);
    db.seen.push({ method: req.method, url, body: body ? JSON.parse(body) : null });
    const json = (v, code = 200) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (url.startsWith('/rest/v1/rpc/my_may_submit')) return json(db.maySubmit);
    if (url.startsWith('/rest/v1/rpc/my_apply_queue')) return json(db.queue);
    if (url.startsWith('/rest/v1/profiles')) return json([{ answers: { _for: {} }, auto_submit: true }]);
    if (url.startsWith('/rest/v1/jobs')) return json([{ country: 'sa' }]);
    if (req.method === 'PATCH') { res.writeHead(204, cors); res.end(); return; }
    json({ message: 'not here' }, 404);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}`;

const profileDir = await mkdtemp(join(tmpdir(), 'qbg-'));
const ctx = await chromium.launchPersistentContext(profileDir, { headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith('src/background.js')) ?? await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const id = new URL(sw.url()).host;
const popup = await ctx.newPage();

const WAITING = 'الاستمارة مفتوحة وتنتظرك';
const released = () => db.seen.find((r) => r.method === 'PATCH' && r.url.includes('auto_status=eq.needs_you') && r.url.includes(WAITING));
const asked = (what) => db.seen.some((r) => r.url.includes(what));
async function cycle({ settings = {}, profile = { full_name: 'T', auto_submit: true, answers: {} } } = {}) {
  db.seen.length = 0;
  await sw.evaluate(([api, settings, profile]) => chrome.storage.local.set({
    session: { url: api, key: 'k', token: 't', refresh_token: 'r' }, profile,
    settings: { delayMs: 10, maxPerRun: 5, ...settings }, running: false, running_since: 0, log: [] }), [api, settings, profile]);
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  const tabsBefore = ctx.pages().length;
  await popup.click('#run');
  await popup.waitForTimeout(1500);
  return { opened: ctx.pages().length - tabsBefore };
}

console.log('الإرسال يُقرَّر في مكان واحد');
{
  db.maySubmit = true; db.queue = [];
  await cycle();
  const r = released();
  check('الإضافة تسأل القاعدة: هل يحقّ الإرسال؟', asked('/rpc/my_may_submit'));
  check('والاستمارات المعبّأة المنتظرة تعود للطابور', !!r && r.body.auto_status === 'queued' && r.body.auto_reason === null, r?.url.slice(0, 90));
  check('إلا ما علّمه صاحبه «قدّمت» بنفسه', r?.url.includes('status=eq.saved'));
  check('قبل قراءة الطابور، فتخرج في الدورة نفسها',
    db.seen.findIndex((x) => x === r) < db.seen.findIndex((x) => x.url.includes('/rpc/my_apply_queue')));
  check('والنافذة تقول ما هو صحيح', (await popup.textContent('#sends')) === 'يرسل بنفسه');
  check('ولا مفتاح فيها يُطفئ ما شُغّل في الموقع', await popup.locator('input[type=checkbox]').count() === 0);
}
{
  db.maySubmit = false;
  await cycle({ profile: { full_name: 'T', auto_submit: false, answers: {} } });
  check('من لم يشغّل الإرسال: تبقى استماراته تنتظره', !released() && asked('/rpc/my_apply_queue'));
  check('والنافذة تقول له أين يُغيَّر', (await popup.textContent('#sends')) === 'يعبّي ويترك الإرسال لك' && (await popup.textContent('#autoNote')).includes('الضبط في قدّم'));
}
{
  db.maySubmit = true;
  await cycle({ settings: { neverSubmit: true } });
  check('قفل الاختبار: لا يُسأل ولا يُعاد شيء', !asked('/rpc/my_may_submit') && !released());
  check('والنافذة لا تدّعي الإرسال', (await popup.textContent('#sends')) === 'يعبّي ويترك الإرسال لك');
}

console.log('\nما لا تفتحه');
{
  db.maySubmit = true;
  db.queue = [{ application_id: 'a-1', job_id: 'j-1', url: 'https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/X_1', title: 'Account Executive', company: 'Cisco', submit: true }];
  const { opened } = await cycle();
  const mark = db.seen.find((r) => r.method === 'PATCH' && r.url.includes('id=eq.a-1'));
  check('وظيفة على Workday لا يُفتح لها تبويب', opened === 0);
  check('وتُعاد لصاحبها بسببها', mark?.body.auto_status === null && /حساباً عند الشركة/.test(mark?.body.auto_reason ?? ''), JSON.stringify(mark?.body));
}

await ctx.close();
server.close();
await rm(profileDir, { recursive: true, force: true });
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ الإضافة ترسل حين يُقال لها في الموقع، ولا تفتح ما لا تعبّيه');
process.exit(fails ? 1 : 0);
