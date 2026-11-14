// What the extension does around a form: whether it may send, what it records when it does,
// what it refuses to open — and above all that a send whose outcome is unknown is never made
// a second time.
//
// Nothing here reaches Supabase or an employer. The database is a stand-in served from this
// machine. So is the "employer": a form at a hiring-system address that the test browser is
// told to resolve to this machine, with every other name on the internet made unresolvable —
// so even a mistake in this file has nowhere to send anything.
//
//   npm run test:background
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// QADDIM_EXT points the same checks at another copy of the extension — a deliberately broken
// one, to see that these checks notice.
const ext = process.env.QADDIM_EXT || new URL('../', import.meta.url).pathname.replace(/\/$/, '');
let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };
const tmp = await mkdtemp(join(tmpdir(), 'qbg-'));

// ── the stand-in database ──
const db = {
  maySubmit: true, queue: [], seen: [], rows: {}, events: [], answers: { _for: {} },
  refusePress: false, expired: null, refreshes: 0
};
const row = (id, extra = {}) => (db.rows[id] = { id, user_id: 'u-1', status: 'saved', auto_status: 'queued', auto_attempts: 0, auto_report: null, auto_reason: null, auto_at: null, ...extra });
const PDF = Buffer.from('%PDF-1.4\n% a stand-in CV\n%%EOF\n');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
    const url = decodeURIComponent(req.url);
    const sent = body ? JSON.parse(body) : null;
    const json = (v, code = 200) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    const done = () => { res.writeHead(204, cors); res.end(); };

    if (url.startsWith('/auth/v1/token')) { db.refreshes++; return json({ access_token: 't2', refresh_token: 'r2' }); }
    if (db.expired && req.headers.authorization === 'Bearer ' + db.expired) return json({ message: 'JWT expired' }, 401);
    db.seen.push({ at: Date.now(), method: req.method, url, body: sent });

    if (url.startsWith('/storage/v1/object/cvs/')) { res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' }); res.end(PDF); return; }
    if (url.startsWith('/rest/v1/rpc/my_may_submit')) return json(db.maySubmit);
    if (url.startsWith('/rest/v1/rpc/my_apply_queue')) return json(db.queue);
    if (url.startsWith('/rest/v1/profiles')) return json([{ answers: db.answers, auto_submit: true }]);
    if (url.startsWith('/rest/v1/jobs')) return json([{ country: 'sa' }]);
    if (url.startsWith('/rest/v1/application_events') && req.method === 'POST') { db.events.push(sent); res.writeHead(201, cors); res.end(); return; }
    if (url.startsWith('/rest/v1/applications')) {
      const q = Object.fromEntries(url.split('?')[1].split('&').map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
      const hit = Object.values(db.rows).filter((r) =>
        (!q.id || 'eq.' + r.id === q.id) && (!q.status || 'eq.' + r.status === q.status) &&
        (!q.auto_status || 'eq.' + r.auto_status === q.auto_status) && (!q.auto_reason || 'eq.' + r.auto_reason === q.auto_reason) &&
        (!q.auto_at || (q.auto_at.startsWith('eq.') ? 'eq.' + r.auto_at === q.auto_at : (r.auto_at && r.auto_at < q.auto_at.replace(/^lt\./, '')))));
      if (req.method === 'GET') return json(hit);
      if (req.method === 'PATCH' && q.auto_status === 'eq.queued' && sent.auto_status === 'filling' && db.beforeClaim) {
        // another browser gets there first: by the time this write lands, the row is taken
        db.beforeClaim(); db.beforeClaim = null;
        return json(Object.values(db.rows).filter((r) => 'eq.' + r.id === q.id && r.auto_status === 'queued'));
      }
      if (req.method === 'PATCH') {
        // the record of a press, as distinct from the record of what came after it
        const press = sent.auto_report?.sent?.pressed_at && !sent.auto_report.sent.outcome;
        if (press && db.refusePress) return json({ message: 'database is down' }, 500);
        for (const r of hit) Object.assign(r, sent);
        return /return=representation/.test(req.headers.prefer ?? '') ? json(hit) : done();
      }
    }
    json({ message: 'not here' }, 404);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${server.address().port}`;

// ── the stand-in employer ──
const HOST = 'qaddim-sandbox.greenhouse.io';
const FORM = `https://${HOST}/acme/jobs/1`;
const employer = { mode: 'confirm', posts: [], forms: 0, onForm: null, complain: false };
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="qaddim-sandbox" content="1"><title>Acme</title></head><body>${body}</body></html>`;
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${HOST}`,
  '-keyout', join(tmp, 'key.pem'), '-out', join(tmp, 'cert.pem')], { stdio: 'ignore' });
const site = https.createServer({ key: await readFile(join(tmp, 'key.pem')), cert: await readFile(join(tmp, 'cert.pem')) }, (req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const html = (body, code = 200) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page(body)); };
    const path = req.url.split('?')[0];
    if (req.method === 'POST' && path === '/acme/jobs/1') {
      employer.posts.push({ at: Date.now(), body: Buffer.concat(chunks).toString('latin1') });
      employer.complain = employer.mode === 'refuse';
      // confirm: a receipt page · silent: somewhere that says nothing · bounce: the same form again
      res.writeHead(303, { Location: employer.mode === 'confirm' ? '/acme/jobs/1/confirmation' : employer.mode === 'bounce' || employer.mode === 'refuse' ? '/acme/jobs/1' : '/acme' });
      res.end();
      return;
    }
    if (path === '/acme/jobs/1') {
      employer.forms++;
      employer.onForm?.();
      // The sentence above the form is on purpose: read after a press, it must not pass for a receipt.
      return html(`<h1>Analyst</h1>
        <p>Thank you for your interest in Acme. Once your application is submitted, our team will review it.</p>
        <form method="post" action="/acme/jobs/1" enctype="multipart/form-data">
          ${employer.complain ?'<p class="error">There was a problem with your submission. This field is required.</p>' : ''}
          <div class="field"><label for="first">First Name *</label><input id="first" name="first" required></div>
          <div class="field"><label for="last">Last Name *</label><input id="last" name="last" required></div>
          <div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
          <div class="field"><label for="tel">Phone *</label><input id="tel" name="tel" type="tel" required></div>
          <div class="field"><label for="cv">Resume/CV *</label><input id="cv" name="cv" type="file" required></div>
          <button type="submit">Submit application</button>
        </form>`);
    }
    if (path === '/acme/jobs/1/confirmation') return html('<h1>Thank you for applying</h1><p>We have received your application.</p>');
    if (path === '/acme') return html('<h1>Open roles at Acme</h1><p>Analyst · Riyadh</p>');
    html('<h1>Not here</h1>', 404);
  });
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));

const ctx = await chromium.launchPersistentContext(join(tmp, 'profile'), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--ignore-certificate-errors',
    // the sandbox address comes here; no other name resolves at all
    `--host-resolver-rules=MAP ${HOST} 127.0.0.1:${site.address().port}, MAP * ~NOTFOUND, EXCLUDE 127.0.0.1`]
});
const sw = ctx.serviceWorkers().find((w) => w.url().endsWith('src/background.js')) ?? await ctx.waitForEvent('serviceworker', { timeout: 10000 });
const id = new URL(sw.url()).host;
const popup = await ctx.newPage();

// Before anything is asked to fill or send: is the form this browser sees really the one
// served above? If the resolver rule did not take, stop here.
{
  const probe = await ctx.newPage();
  const ours = await probe.goto(FORM).then(() => probe.locator('meta[name="qaddim-sandbox"]').count()).catch(() => 0);
  const outside = await probe.goto('https://example.com/').then(() => true).catch(() => false);
  await probe.close();
  if (!ours || outside) {
    console.log(`✗ المتصفح ليس معزولاً (استمارة الاختبار: ${!!ours} · يصل للخارج: ${outside}) — أُوقف الاختبار قبل أي تعبئة`);
    await ctx.close(); server.close(); site.close(); await rm(tmp, { recursive: true, force: true });
    process.exit(1);
  }
  employer.forms = 0;
}

const VERSION = JSON.parse(await readFile(join(ext, 'manifest.json'), 'utf8')).version;
const WAITING = 'الاستمارة مفتوحة وتنتظرك';
const UNVERIFIED = 'ضُغط الإرسال ولم يظهر تأكيد — تحقق من بريدك قبل أي إعادة';
const PROFILE = {
  full_name: 'Sara Ahmed', first_name: 'Sara', last_name: 'Ahmed', email_for_applications: 'sara@example.com',
  phone: '+966500000000', city: 'Riyadh', country: 'Saudi Arabia', cv_path: 'u-1/1_cv.pdf', auto_submit: true, answers: {}
};
const item = (appId) => ({ application_id: appId, job_id: 'j-' + appId, url: FORM, title: 'Analyst', company: 'Acme', submit: true });
const released = () => db.seen.find((r) => r.method === 'PATCH' && r.url.includes('auto_status=eq.needs_you') && r.url.includes(WAITING));
const asked = (what) => db.seen.some((r) => r.url.includes(what));
const openTabs = () => ctx.pages().filter((p) => p.url().includes(HOST));

/** One run of the extension, from the button in its popup to the moment it stops. */
async function cycle({ settings = {}, profile = { full_name: 'T', auto_submit: true, answers: {} }, token = 't' } = {}) {
  db.seen.length = 0;
  await sw.evaluate(([api, settings, profile, token]) => chrome.storage.local.set({
    session: { url: api, key: 'k', token, refresh_token: 'r' }, profile,
    // short waits: the page here answers at once or never
    settings: { delayMs: 10, maxPerRun: 5, waitMs: 6000, proofMs: 6000, patienceS: 3, ...settings },
    running: false, running_since: 0, log: [] }), [api, settings, profile, token]);
  await popup.goto(`chrome-extension://${id}/src/popup.html`);
  const tabsBefore = ctx.pages().length;
  await popup.click('#run');
  await popup.waitForTimeout(1500);
  for (const until = Date.now() + 90000; Date.now() < until;) {
    const { running } = await sw.evaluate(() => chrome.storage.local.get('running'));
    if (!running) break;
    await popup.waitForTimeout(300);
  }
  return { opened: ctx.pages().length - tabsBefore };
}
const closeTabs = async () => { for (const p of openTabs()) await p.close(); };

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
{
  // Taken out of the queue, or marked applied by its owner, after the queue was read.
  row('c-1', { auto_status: null }); row('c-2', { status: 'applied', auto_status: 'queued' });
  db.queue = [item('c-1'), item('c-2')];
  employer.forms = 0; employer.posts.length = 0;
  await cycle({ profile: PROFILE });
  check('ما أُلغي قبل دوره لا تُفتح استمارته', employer.forms === 0 && employer.posts.length === 0, `forms ${employer.forms}`);
  check('وما علّمه صاحبه «قدّمت» يخرج من الطابور', db.rows['c-2'].auto_status === null && db.rows['c-2'].status === 'applied');
}

console.log('\nالضغطة: تُسجَّل قبل أن تقع، و«أُرسل» بدليل');
{
  row('s-1'); db.queue = [item('s-1')];
  employer.mode = 'confirm'; employer.forms = 0; employer.posts.length = 0; db.events.length = 0;
  await cycle({ profile: PROFILE });
  const r = db.rows['s-1'];
  const press = db.seen.find((x) => x.method === 'PATCH' && x.body?.auto_report?.sent?.pressed_at && !x.body.auto_report.sent.outcome);
  check('الاستمارة أُرسلت مرة واحدة', employer.posts.length === 1, `posts ${employer.posts.length} · ${r.auto_status} · ${r.auto_reason}`);
  check('وفيها ما في الملف، والسيرة', /Sara/.test(employer.posts[0]?.body ?? '') && /%PDF-1\.4/.test(employer.posts[0]?.body ?? ''));
  check('الضغطة كُتبت في القاعدة قبل أن تصل الشركة', !!press && press.at <= employer.posts[0]?.at, press ? `${employer.posts[0]?.at - press.at}ms قبلها` : 'لا تسجيل');
  check('ومعها ما عُبّئ', (press?.body.auto_report.filled?.length ?? 0) >= 5 && press?.body.auto_report.sent.by === VERSION);
  check('الصفحة انتقلت — والتأكيد قُرئ من الصفحة الجديدة', r.auto_status === 'submitted' && r.status === 'applied' && r.auto_report?.sent?.outcome === 'confirmed', JSON.stringify(r.auto_report?.sent));
  check('والدليل محفوظ: ما قالته الصفحة وعنوانها', /confirmation/.test(r.auto_report?.sent?.evidence?.url ?? '') && !!r.auto_report?.sent?.verified_at, JSON.stringify(r.auto_report?.sent?.evidence));
  check('والمحاولة عُدّت', r.auto_attempts === 1);
  check('والسجل يقول الحدثين', db.events.some((e) => e.detail === 'ضُغط الإرسال') && db.events.some((e) => /^بعد الضغط: الموقع أكّد الاستلام/.test(e.detail)), db.events.map((e) => e.detail).join(' | '));
  await popup.waitForTimeout(3000);
  check('والتبويب أُغلق', openTabs().length === 0);
}

console.log('\nضُغط ولم يتأكد: لا إرسال ثانٍ');
{
  row('u-1'); db.queue = [item('u-1')];
  employer.mode = 'silent'; employer.forms = 0; employer.posts.length = 0;
  await cycle({ profile: PROFILE });
  const r = db.rows['u-1'];
  check('الصفحة انتقلت بلا كلمة تأكيد: لا يُقال «أُرسل»', employer.posts.length === 1 && r.auto_status === 'needs_you' && r.status === 'saved', `${r.auto_status} · ${r.status}`);
  check('بل «ضُغط ولم يتأكد»، والضغطة باقية في السجل', r.auto_reason === UNVERIFIED && r.auto_report?.sent?.outcome === 'unverified' && !!r.auto_report.sent.pressed_at, r.auto_reason);
  check('والتبويب يبقى مفتوحاً لصاحبه', openTabs().length === 1);
  const firstPress = r.auto_report.sent.pressed_at;
  await closeTabs();

  // Something puts it back in the queue — a retry button, a worker, a bug. It must not go out.
  r.auto_status = 'queued'; r.auto_reason = null;
  employer.forms = 0;
  await cycle({ profile: PROFILE });
  check('أُعيد للطابور خطأً: لا تُفتح استمارته ولا تُرسل', employer.forms === 0 && employer.posts.length === 1, `forms ${employer.forms} · posts ${employer.posts.length}`);
  check('ويعود لصاحبه بالسبب نفسه', r.auto_status === 'needs_you' && r.auto_reason === UNVERIFIED);
  check('ثلاث دورات أخرى: ما زال إرسالاً واحداً', await (async () => {
    for (let i = 0; i < 3; i++) { r.auto_status = 'queued'; await cycle({ profile: PROFILE }); }
    return employer.posts.length === 1 && employer.forms === 0;
  })());

  // Only its owner can say "it did not arrive — send it again".
  r.auto_status = 'queued'; r.auto_reason = null; r.auto_report = { ...r.auto_report, sent: { ...r.auto_report.sent, rearmed: new Date().toISOString() } };
  employer.mode = 'confirm';
  await cycle({ profile: PROFILE });
  check('صاحبه قال «لم يصل»: يُرسل من جديد', employer.posts.length === 2 && r.auto_status === 'submitted', `${r.auto_status} · posts ${employer.posts.length}`);
  check('والضغطة الأولى تبقى في السجل', r.auto_report?.sent?.previous?.pressed_at === firstPress && r.auto_report.sent.previous.outcome === 'unverified', JSON.stringify(r.auto_report?.sent?.previous));
  await popup.waitForTimeout(3000);
}

console.log('\nالاستمارة رجعت كما هي');
{
  // The employer's server answers the send with the same form at the same address — a
  // rejection it explains nowhere. The page still carries "once your application is submitted".
  row('b-1'); db.queue = [item('b-1')];
  employer.mode = 'bounce'; employer.forms = 0; employer.posts.length = 0;
  await cycle({ profile: PROFILE });
  const r = db.rows['b-1'];
  check('لا تُحسب تأكيداً بكلام كان فيها قبل الضغط', employer.posts.length === 1 && r.auto_status === 'needs_you' && r.auto_report?.sent?.outcome === 'unverified', `${r.auto_status} · ${JSON.stringify(r.auto_report?.sent?.evidence)}`);
  check('ولا يُقال عنها «قدّمت»', r.status === 'saved');
  await closeTabs();

  // …and when it comes back saying what was wrong, that is known: it was not taken.
  row('b-2'); db.queue = [item('b-2')];
  employer.mode = 'refuse'; employer.complain = false; employer.posts.length = 0;
  await cycle({ profile: PROFILE });
  const x = db.rows['b-2'];
  check('رجعت بخطأ جديد: «لم تُرسل» — معلوم لا مجهول', employer.posts.length === 1 && x.auto_report?.sent?.outcome === 'rejected' && /لم تُرسل/.test(x.auto_reason ?? ''), `${x.auto_report?.sent?.outcome} · ${x.auto_reason}`);
  await closeTabs();
  x.auto_status = 'queued'; x.auto_reason = null; employer.mode = 'confirm'; employer.complain = false;
  await cycle({ profile: PROFILE });
  check('فتُعاد بلا سؤال، لأن الأولى لم تصل', employer.posts.length === 2 && x.auto_status === 'submitted', `${x.auto_status} · posts ${employer.posts.length}`);
  await popup.waitForTimeout(3000);
}

console.log('\nلا تسجيل، لا ضغط');
{
  row('n-1'); db.queue = [item('n-1')];
  employer.mode = 'confirm'; employer.forms = 0; employer.posts.length = 0; db.refusePress = true;
  await cycle({ profile: PROFILE });
  db.refusePress = false;
  const r = db.rows['n-1'];
  check('القاعدة لم تقبل تسجيل الضغطة: لم يُضغط', employer.forms === 1 && employer.posts.length === 0, `forms ${employer.forms} · posts ${employer.posts.length}`);
  check('وقيل لماذا', r.auto_status === 'needs_you' && /تعذّر تسجيل الضغطة/.test(r.auto_reason ?? '') && !r.auto_report?.sent, r.auto_reason);
  await popup.waitForTimeout(2000);
}

console.log('\nالإيقاف الشامل');
{
  row('p-1'); db.queue = [item('p-1')];
  db.answers = { _for: {}, _settings: { paused: true } };
  employer.forms = 0; employer.posts.length = 0;
  await cycle({ profile: PROFILE });
  check('موقوف: لا يُقرأ الطابور ولا تُفتح استمارة', !asked('/rpc/my_apply_queue') && employer.forms === 0);
  check('والطلب يحتفظ بمكانه', db.rows['p-1'].auto_status === 'queued');
  check('والنافذة تقول إنه موقوف', /أوقفتَ الأتمتة/.test(await popup.textContent('#log')));

  // Stopped while the form is already open and being filled: the last check is at the press.
  db.answers = { _for: {} };
  employer.onForm = () => { db.answers = { _for: {}, _settings: { paused: true } }; };
  await cycle({ profile: PROFILE });
  employer.onForm = null;
  const r = db.rows['p-1'];
  check('أُوقف والاستمارة تُعبّأ: لا تُرسل', employer.forms === 1 && employer.posts.length === 0, `forms ${employer.forms} · posts ${employer.posts.length}`);
  check('وتعود لمكانها دون أن تُحسب محاولة', r.auto_status === 'queued' && r.auto_attempts === 0 && !r.auto_report?.sent, `${r.auto_status} · ${r.auto_attempts}`);

  db.answers = { _for: {} };
  await cycle({ profile: PROFILE });
  check('استأنف: تخرج', employer.posts.length === 1 && db.rows['p-1'].auto_status === 'submitted', db.rows['p-1'].auto_reason ?? '');
  await popup.waitForTimeout(3000);
}

console.log('\nأُخرج من الطابور والاستمارة تُعبّأ');
{
  row('x-1'); db.queue = [item('x-1')];
  employer.mode = 'confirm'; employer.forms = 0; employer.posts.length = 0;
  // its owner takes it out of the queue the moment the form is served
  employer.onForm = () => { Object.assign(db.rows['x-1'], { auto_status: null, auto_reason: 'أخرجتَه من الطابور' }); };
  await cycle({ profile: PROFILE });
  employer.onForm = null;
  const r = db.rows['x-1'];
  check('لا تُرسل', employer.forms === 1 && employer.posts.length === 0, `forms ${employer.forms} · posts ${employer.posts.length}`);
  check('ويبقى كما تركه صاحبه', r.auto_status === null && r.auto_reason === 'أخرجتَه من الطابور' && !r.auto_report?.sent, `${r.auto_status} · ${r.auto_reason}`);

  row('x-2'); db.queue = [item('x-2')];
  employer.forms = 0;
  employer.onForm = () => { Object.assign(db.rows['x-2'], { status: 'applied', auto_status: null }); };
  await cycle({ profile: PROFILE });
  employer.onForm = null;
  check('وما علّمه «قدّمت» أثناء التعبئة لا يُرسل ثانية', employer.forms === 1 && employer.posts.length === 0 && db.rows['x-2'].status === 'applied' && db.rows['x-2'].auto_status === null,
    `posts ${employer.posts.length} · ${db.rows['x-2'].status}/${db.rows['x-2'].auto_status}`);
  await popup.waitForTimeout(1500);
}

console.log('\nمتصفحان على الطابور نفسه');
{
  // The same application, reachable from this browser and from one on a server.
  row('w-1'); db.queue = [item('w-1')];
  employer.mode = 'confirm'; employer.forms = 0; employer.posts.length = 0;
  db.beforeClaim = () => { Object.assign(db.rows['w-1'], { auto_status: 'filling', auto_at: '2026-11-12T00:00:00.000Z', auto_attempts: 1 }); };
  await cycle({ profile: PROFILE });
  check('أخذه متصفح آخر قبل لحظة: لا تُفتح استمارته هنا', employer.forms === 0 && employer.posts.length === 0, `forms ${employer.forms}`);
  check('ولا يُمسّ ما كتبه الآخر', db.rows['w-1'].auto_status === 'filling' && db.rows['w-1'].auto_at === '2026-11-12T00:00:00.000Z' && db.rows['w-1'].auto_attempts === 1);

  // Overtaken while filling: a slow browser whose application was handed to another.
  row('w-2'); db.queue = [item('w-2')];
  employer.forms = 0;
  employer.onForm = () => { db.rows['w-2'].auto_at = '2026-11-12T00:00:01.000Z'; };
  await cycle({ profile: PROFILE });
  employer.onForm = null;
  check('سُبق والاستمارة تُعبّأ: لا يضغط', employer.forms === 1 && employer.posts.length === 0 && !db.rows['w-2'].auto_report?.sent, `forms ${employer.forms} · posts ${employer.posts.length}`);
  check('ويترك الطلب لمن أخذه', db.rows['w-2'].auto_status === 'filling' && db.rows['w-2'].auto_at === '2026-11-12T00:00:01.000Z');
  await popup.waitForTimeout(1500);
}

console.log('\nأنظمة يتركها هذا المتصفح');
{
  row('k-1'); db.queue = [item('k-1')];
  employer.forms = 0; employer.posts.length = 0;
  await cycle({ profile: PROFILE, settings: { skipHosts: ['qaddim-sandbox.greenhouse.io'] } });
  check('نظام في قائمة الترك: لا تُفتح استمارته', employer.forms === 0 && employer.posts.length === 0, `forms ${employer.forms}`);
  check('ويبقى الطلب في الطابور كما هو لمتصفح آخر', db.rows['k-1'].auto_status === 'queued' && db.rows['k-1'].auto_attempts === 0);
  await cycle({ profile: PROFILE });
  check('ومتصفح بلا هذه القائمة يرسله', employer.posts.length === 1 && db.rows['k-1'].auto_status === 'submitted', db.rows['k-1'].auto_status);
  await popup.waitForTimeout(3000);
}

console.log('\nالجلسة ودورة ماتت');
{
  row('t-1'); db.queue = [item('t-1')];
  employer.mode = 'confirm'; employer.posts.length = 0; db.expired = 't'; db.refreshes = 0;
  await cycle({ profile: PROFILE });
  db.expired = null;
  check('انتهت الجلسة وسط الدورة: تُجدَّد مرة واحدة ويكتمل الطلب', db.refreshes === 1 && db.rows['t-1'].auto_status === 'submitted', `جُدّدت ${db.refreshes} · ${db.rows['t-1'].auto_status}`);
  await popup.waitForTimeout(3000);
}
{
  const longAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString(), justNow = new Date(Date.now() - 60 * 1000).toISOString();
  row('d-1', { auto_status: 'filling', auto_at: longAgo, auto_report: { filled: [], sent: { pressed_at: longAgo } } });
  row('d-2', { auto_status: 'filling', auto_at: longAgo });
  row('d-3', { auto_status: 'filling', auto_at: justNow });
  row('d-4', { auto_status: 'filling', auto_at: longAgo, auto_attempts: 3 });
  db.queue = [];
  await cycle({ profile: PROFILE });
  check('ماتت بعد الضغط: «ضُغط ولم يتأكد»، لا تعود للطابور', db.rows['d-1'].auto_status === 'needs_you' && db.rows['d-1'].auto_reason === UNVERIFIED && db.rows['d-1'].auto_report.sent.outcome === 'unverified');
  check('ماتت قبل الضغط: تعود لمكانها', db.rows['d-2'].auto_status === 'queued');
  check('وما يُعبّأ الآن لا يُمسّ', db.rows['d-3'].auto_status === 'filling');
  check('وما انقطع ثلاثاً لا يُترك في طابور لا يسلّمه', db.rows['d-4'].auto_status === 'needs_you' && /ثلاث مرات/.test(db.rows['d-4'].auto_reason));
}

await ctx.close();
server.close(); site.close();
await rm(tmp, { recursive: true, force: true });
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ الضغطة تُسجَّل قبل وقوعها، «أُرسل» بدليل، وما لم يتأكد لا يُرسل مرتين');
process.exit(fails ? 1 : 0);
