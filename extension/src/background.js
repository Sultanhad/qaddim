// The hand of the platform.
//
// The site decides *what* to apply to; this decides *when*, and does it inside the user's own
// browser — the only place a CAPTCHA sees a real browser and lets the submission through.
//
// It keeps the queue in the database, not in the extension, so the site can show honest status:
// queued → filling → submitted, or needs_you with the reason.

const DEFAULTS = { delayMs: 9000, maxPerRun: 10 };
// What an application says while its form sits filled and unsent.
const WAITING = 'الاستمارة مفتوحة وتنتظرك';
// …between the press and the page's answer, and when the answer never came.
const PRESSED = 'ضُغط الإرسال — بانتظار تأكيد الصفحة';
const UNVERIFIED = 'ضُغط الإرسال ولم يظهر تأكيد — تحقق من بريدك قبل أي إعادة';
const PAUSED = 'أوقفتَ الأتمتة';
const CANCELLED = 'أُخرج من الطابور قبل الإرسال';
// Must stay word for word what fill.js says when its press is not acknowledged.
const NOT_ALLOWED = 'لم يُؤذن بالإرسال — أعد تحميل الإضافة';
const STALE_FILL_MS = 10 * 60 * 1000;
const DONE_URL = /\/(confirmation|thank[-_]?you|thanks|success|submitted|applied)(\/|$)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The forms open right now, by tab. This is how a press announced by a page is tied to the
// application it belongs to — and how, when that page then vanishes, it is still known that
// a press was made.
const inFlight = new Map();
const POLL_MINUTES = 2;

async function state() {
  const s = await chrome.storage.local.get(['session', 'profile', 'log', 'settings', 'running']);
  return {
    session: s.session ?? null,          // { url, key, token, refresh_token }
    profile: s.profile ?? null,
    log: s.log ?? [],
    settings: { ...DEFAULTS, ...(s.settings ?? {}) },
    running: !!s.running
  };
}

async function note(entry) {
  const { log } = await state();
  log.unshift({ at: new Date().toISOString(), ...entry });
  await chrome.storage.local.set({ log: log.slice(0, 200) });
}

// ── the platform's database, through the user's own token ────────────────────
/**
 * An access token lasts an hour. Without renewing it, applying works for one hour after the
 * last visit to the site and then fails silently for ever — which is the whole feature gone,
 * reported as nothing. The refresh token the page handed over is what keeps it alive.
 */
async function refresh(session) {
  if (!session.refresh_token) throw new Error('انتهت الجلسة — افتح المنصة مرة واحدة');
  const res = await fetch(session.url + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    headers: { apikey: session.key, 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refresh_token })
  });
  if (!res.ok) throw new Error('انتهت الجلسة — افتح المنصة مرة واحدة');
  const j = await res.json();
  // Changed in place, not copied: a run holds this one object for as long as it lasts, and so
  // does every form open under it. A copy left them all on the old token — each later call
  // then tried to renew with a refresh token that had already been spent.
  Object.assign(session, { token: j.access_token, refresh_token: j.refresh_token ?? session.refresh_token });
  await chrome.storage.local.set({ session: { ...session } });
  return session;
}

async function api(session, path, init = {}, retried = false) {
  const res = await fetch(session.url + '/rest/v1' + path, {
    ...init,
    headers: {
      apikey: session.key, Authorization: 'Bearer ' + session.token,
      'content-type': 'application/json', ...(init.headers ?? {})
    }
  });
  if ((res.status === 401 || res.status === 403) && !retried) {
    return api(await refresh(session), path, init, true);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 120));
  return res.status === 204 ? null : res.json();
}

const fetchQueue = (s) => api(s, '/rpc/my_apply_queue', { method: 'POST', body: '{}' });

const markApplication = (s, id, patch) =>
  api(s, '/applications?id=eq.' + id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });

// ── one application ──────────────────────────────────────────────────────────
const APPLY_URL = (url) => {
  if (/jobs\.lever\.co/.test(url)) return /\/apply\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/apply';
  if (/jobs\.ashbyhq\.com/.test(url)) return /\/application\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/application';
  if (/apply\.workable\.com/.test(url)) return /\/apply\/?$/.test(url) ? url : url.replace(/\/+$/, '') + '/apply/';
  return url;
};

function tabReady(tabId, timeoutMs = 45000) {
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => { chrome.tabs.onUpdated.removeListener(fn); resolve(false); }, timeoutMs);
    function fn(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(fn);
      clearTimeout(giveUp);
      setTimeout(() => resolve(true), 3500);
    }
    chrome.tabs.onUpdated.addListener(fn);
  });
}

/**
 * The CV, as bytes the content script can hand to a file input.
 *
 * Every board we read demands a resume, so without this every queued application stopped at
 * "attach it yourself" and unattended sending was unreachable. Fetched once per run through
 * the user's own token from their own private folder.
 */
async function fetchCv(session, profile) {
  if (!profile?.cv_path) return null;
  const r = await fetch(`${session.url}/storage/v1/object/cvs/${profile.cv_path}`, {
    headers: { apikey: session.key, Authorization: 'Bearer ' + session.token }
  });
  if (!r.ok) return null;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return {
    name: profile.cv_path.split('/').pop().replace(/^\d+_/, '') || 'cv.pdf',
    type: r.headers.get('content-type') || 'application/pdf',
    b64: btoa(bin)
  };
}

// The pages this extension has a script on, read from its own manifest so the two cannot
// disagree. A Workday job used to be opened like any other; with no script there to answer,
// it came back as "the page did not respond" — true, and no use to anyone reading it.
const FILLABLE = chrome.runtime.getManifest().content_scripts[0].matches.map((m) =>
  new RegExp('^' + m.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
const fillable = (url) => FILLABLE.some((re) => re.test(url));

/**
 * Has the person stopped everything? Read fresh: it has to work the moment they press it.
 * Three answers, not two — `null` is "could not ask", and nothing is sent on a maybe.
 */
async function paused(session) {
  const rows = await api(session, '/profiles?select=answers&limit=1').catch(() => null);
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0].answers?._settings?.paused === true;
}

const logEvent = (session, row, detail) => api(session, '/application_events', {
  method: 'POST', headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({ application_id: row.id, user_id: row.user_id, kind: 'auto', detail })
}).catch(() => { });

/**
 * After a press, when the page that was pressed is gone: ask whatever page is there now.
 *
 * A send that works usually navigates, and navigation kills the script that was waiting for
 * the answer — which is exactly how the first two real sends were recorded as "the page did
 * not respond". The new page carries the same script, so it is asked; a page with no script
 * of ours has only its address to read. Forty-five seconds without either is "not known".
 */
async function proof(tabId, forMs = 45000, base = null) {
  for (const until = Date.now() + forMs; Date.now() < until;) {
    await sleep(1500);
    let now = null;
    // `base` is what the form's page looked like the instant before the press: the new page
    // is judged against it, so words that were already there are not taken for a receipt.
    try { now = await chrome.tabs.sendMessage(tabId, { type: 'qaddim:outcome', base }); } catch { /* not ready, or not ours */ }
    if (now?.outcome) return now;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) break;                                    // the tab itself is gone
    try {
      const at = new URL(tab.url);
      if (!now && tab.url !== base?.href && DONE_URL.test(at.pathname)) return { outcome: 'confirmed', evidence: { kind: 'url', url: at.origin + at.pathname } };
    } catch { /* an address that is not one */ }
  }
  return { outcome: 'unverified' };
}

const SAID = {
  confirmed: 'الموقع أكّد الاستلام',
  code: 'الشركة أرسلت رمز تحقق إلى بريدك — أدخله في تبويبها المفتوح',
  rejected: 'الاستمارة رجعت بخطأ بعد الضغط — لم تُرسل',
  unverified: UNVERIFIED
};

async function applyOne(item, profile, settings, session) {
  if (!fillable(APPLY_URL(item.url))) {
    const reason = 'نظام يطلب حساباً عند الشركة — التقديم عليه من صفحته';
    await markApplication(session, item.application_id, { auto_status: null, auto_reason: reason, auto_at: new Date().toISOString() });
    await note({ job: item, status: 'skipped', reason });
    return 'skipped';
  }

  // ── before anything is opened ──
  // The queue says this application is next. Three things can make that wrong by the time it
  // is read here, and each of them means: do not open the form.
  const row = await api(session, '/applications?select=id,user_id,status,auto_status,auto_attempts,auto_report&id=eq.' + encodeURIComponent(item.application_id))
    .then((rows) => rows?.[0] ?? null).catch(() => null);
  if (!row) return 'skipped';
  if (row.status !== 'saved') {
    // the person has since said it is applied, or closed it
    await markApplication(session, row.id, { auto_status: null });
    return 'skipped';
  }
  // Taken out of the queue since the queue was read — cancelled, or already being handled.
  if (row.auto_status !== 'queued') return 'skipped';
  const before = row.auto_report?.sent;
  if (before?.pressed_at && !before.rearmed && before.outcome !== 'rejected') {
    // Send was already pressed on this one and nobody has said it failed. Pressing again
    // could be the second copy of an application that arrived. Only its owner re-arms it.
    await markApplication(session, row.id, { auto_status: 'needs_you', auto_reason: UNVERIFIED });
    await note({ job: item, status: 'needs_you', reason: UNVERIFIED });
    return 'needs_you';
  }
  // Stopped: the application keeps its place in the queue and goes out when they resume.
  if ((await paused(session)) !== false) return 'paused';

  // Whether to press submit is decided in one place: the person's settings on the site, as
  // the database enforces them — the caps and the first-three rule have to hold no matter
  // what this copy of the extension believes.
  //
  // It used to be and-ed with a second switch in this extension's own popup, off by default.
  // Someone could turn sending on three times over on the site and every form would still
  // sit filled and unsent, with nothing on the site to say why: the first three real
  // applications that were ever fully filled stopped exactly there. One decision, one switch.
  //
  // `neverSubmit` is not that switch. It has no control anywhere; it is a lock that tests and
  // development set so that nothing they open can ever be sent.
  const submit = item.submit === true && settings.neverSubmit !== true;
  // Counted when the attempt starts, from what the database holds: the queue never carried
  // the count, so it was written as "1" every time and the three-attempt limit never tripped.
  await markApplication(session, item.application_id, {
    auto_status: 'filling', auto_at: new Date().toISOString(), auto_attempts: (row.auto_attempts ?? 0) + 1
  });

  // Where the job is decides what a truthful answer to "do you need sponsorship?" is, and
  // whose job it is decides whether "have you worked here before?" is about the employer at
  // all. The queue does not carry the country, so it is read here; if that read fails the
  // question is simply left for the person, which is what happened to it before.
  const job = await api(session, '/jobs?select=country&id=eq.' + encodeURIComponent(item.job_id))
    .then((rows) => ({ id: item.job_id, country: rows?.[0]?.country ?? null, company: item.company ?? null }))
    .catch(() => ({ id: item.job_id, country: null, company: item.company ?? null }));

  // Opened in the background so a run does not steal focus while you work.
  const tab = await chrome.tabs.create({ url: APPLY_URL(item.url), active: false });
  await tabReady(tab.id);

  inFlight.set(tab.id, { item, session, row, pressed: false, report: null, sent: null, base: null });
  let result = null;
  try {
    result = await chrome.tabs.sendMessage(tab.id, {
      type: 'qaddim:apply', profile, job, autoSubmit: submit,
      ...(settings.waitMs ? { waitMs: settings.waitMs } : {}), ...(settings.patienceS ? { patienceS: settings.patienceS } : {})
    });
  } catch { /* the page went away before answering — why, depends on whether it was pressed */ }
  const flight = inFlight.get(tab.id);
  inFlight.delete(tab.id);

  if (!result) {
    result = flight?.pressed
      ? { pressed: true, report: flight.report, ...(await proof(tab.id, settings.proofMs, flight.base)) }
      : { status: 'needs_you', reason: 'الصفحة لم تستجب' };
  }

  // "Sent" is said on the page's own evidence and nothing else. Whatever else followed a
  // press is recorded as what it was, with the press itself kept on the record.
  const pressed = result.pressed === true || flight?.pressed === true;

  // Stopped by its owner in the seconds between filling and sending. Nothing was pressed, so
  // nothing is wrong with it: it goes back to its place and this attempt is not counted.
  if (!pressed && String(result.reason ?? '').startsWith(PAUSED)) {
    await markApplication(session, item.application_id, { auto_status: 'queued', auto_reason: null, auto_attempts: row.auto_attempts ?? 0 });
    chrome.tabs.remove(tab.id).catch(() => { });
    return 'paused';
  }
  // Taken back by its owner while it was being filled: the row already says what they want
  // it to say, and nothing is written over it.
  if (!pressed && result.reason === CANCELLED) {
    chrome.tabs.remove(tab.id).catch(() => { });
    await note({ job: item, status: 'skipped', reason: CANCELLED });
    return 'skipped';
  }
  const outcome = pressed ? (result.outcome || (result.status === 'submitted' ? 'confirmed' : 'unverified')) : null;
  const status = outcome === 'confirmed' ? 'submitted' : 'needs_you';
  const reason = pressed ? SAID[outcome] : (result.reason ?? (result.status === 'filled' ? WAITING : 'الصفحة لم تستجب'));
  const now = new Date().toISOString();
  // An attempt that never reached the button still carries what an earlier one recorded: a
  // press, once made, is not something a later report may write over.
  const sent = pressed
    ? { ...(flight?.sent ?? { pressed_at: now }), outcome, evidence: result.evidence ?? null, ...(outcome === 'confirmed' ? { verified_at: now } : {}) }
    : (row.auto_report?.sent ?? null);
  const report = result.report ?? flight?.report ?? null;

  const final = {
    auto_status: status,
    auto_reason: reason,
    auto_at: now,
    auto_report: report || sent ? { ...(report ?? {}), ...(sent ? { sent } : {}) } : null,
    ...(status === 'submitted' ? { status: 'applied' } : {})
  };
  // After a press this write is the only place the page's answer is kept, so a dropped
  // connection gets more than one chance. (If all of them fail the press itself is already on
  // the row, and the next run hands it to its owner as "pressed, never confirmed".)
  for (let tries = pressed ? 3 : 1; tries > 0; tries--) {
    try { await markApplication(session, item.application_id, final); break; } catch (e) {
      if (tries === 1) throw e;
      await sleep(2000);
    }
  }
  if (pressed) await logEvent(session, row, `بعد الضغط: ${reason}${sent.evidence?.url ? ' · ' + sent.evidence.url : ''}`.slice(0, 1900));
  await note({ job: item, status, reason, report });

  if (status === 'submitted') {
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => { }), 2500);
  } else if (pressed) {
    // Send was pressed and the page did not confirm — a code mailed to the applicant, a
    // check, a slow server. Closing this tab would throw away an application that may be one
    // step from done, or already in; it stays open, in front, with what happened said plainly.
    await chrome.tabs.update(tab.id, { active: true }).catch(() => { });
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/128.png', title: item.company + ' — ضُغط الإرسال ولم يتأكد',
      message: reason + '\nالتبويب مفتوح: أكمل ما يطلبه، أو تحقق من بريدك.'
    });
  } else if (submit) {
    // Running unattended: leave the tab closed and the reason on the row. Twenty half-filled
    // tabs across the screen is not "automatic", it is a mess to clean up later.
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => { }), 1500);
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/128.png', title: item.company + ' — يحتاجك',
      message: (result?.reason || 'سؤال بلا إجابة') + '\nافتح «طلباتي» وأجب مرة واحدة.'
    });
  } else {
    await chrome.tabs.update(tab.id, { active: true }).catch(() => { });
    chrome.notifications.create({
      type: 'basic', iconUrl: 'icons/128.png', title: item.company + ' — راجع وأرسل',
      message: (result?.reason || 'الاستمارة معبّأة وتنتظر ضغطتك') +
        (result?.report?.missing?.length ? '\n' + result.report.missing.map((m) => m.q).slice(0, 2).join(' · ') : '')
    });
  }
  return status;
}

/**
 * Forms that were filled and left unsent because sending was off at the time. Once the person
 * has turned sending on, those are applications they asked to go out — not something to sit
 * until "retry" is pressed on each one. The database is asked, because it is what decides.
 */
async function releaseWaiting(session) {
  const may = await api(session, '/rpc/my_may_submit', { method: 'POST', body: '{}' });
  if (may !== true) return;
  // Only what is still merely saved: one the person has since marked as applied — because
  // they pressed send in the open tab themselves — must not go out a second time.
  // (The second reason is what a form was given while this extension's page script was newer
  // than its background: filled, never pressed, and waiting for nothing but the reload.)
  for (const reason of [WAITING, NOT_ALLOWED]) {
    await api(session, '/applications?status=eq.saved&auto_status=eq.needs_you&auto_reason=eq.' + encodeURIComponent(reason),
      // attempts start over: the queue stops handing out anything tried three times, and
      // these were not failures — they were waiting for a switch
      { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ auto_status: 'queued', auto_reason: null, auto_attempts: 0 }) });
  }
}

/**
 * Applications left at "being filled" by a run that died — the browser closed, the worker
 * was killed. Nothing else ever moves them, so they sat there for good. What they become
 * depends on the one thing that matters: was send pressed.
 */
async function recoverStale(session) {
  const before = new Date(Date.now() - STALE_FILL_MS).toISOString();
  const rows = await api(session, '/applications?select=id,auto_attempts,auto_report&status=eq.saved&auto_status=eq.filling&auto_at=lt.' + encodeURIComponent(before));
  for (const r of rows ?? []) {
    const s = r.auto_report?.sent;
    const open = s?.pressed_at && !s.rearmed && s.outcome !== 'rejected';
    await markApplication(session, r.id, open
      ? { auto_status: 'needs_you', auto_reason: UNVERIFIED, auto_report: { ...r.auto_report, sent: { ...s, outcome: s.outcome ?? 'unverified' } } }
      // The queue never hands out a third-time failure, so one put back there would sit at
      // "in the queue" for good. It goes to its owner instead.
      : (r.auto_attempts ?? 0) >= 3
        ? { auto_status: 'needs_you', auto_reason: 'انقطعت تعبئته ثلاث مرات — جرّب «أعد المحاولة»، أو قدّم من صفحة الشركة' }
        : { auto_status: 'queued', auto_reason: null });
  }
}

// ── the run ──────────────────────────────────────────────────────────────────
/**
 * MV3 kills an idle service worker after about thirty seconds. If it dies mid-run the
 * `running` flag stays true in storage, and every later run returns here immediately — auto
 * apply stops for good, silently, until someone finds the stop button. A flag that cannot be
 * cleared by a crash is not a lock; this one expires.
 */
const RUN_STALE_MS = 10 * 60 * 1000;

async function run() {
  const { session, profile, settings, running } = await state();
  if (running) {
    const { running_since = 0 } = await chrome.storage.local.get('running_since');
    if (Date.now() - running_since < RUN_STALE_MS) return;
    await note({ status: 'warn', reason: 'دورة سابقة توقّفت دون أن تُغلق — استؤنف العمل' });
    await chrome.storage.local.set({ running: false });
  }
  if (!session || !profile) { await note({ status: 'error', reason: 'افتح المنصة مرة لمزامنة حسابك' }); return; }

  // The kill switch. Checked before the queue is even read, again before every form, and once
  // more at the last moment before a press.
  const stopped = await paused(session);
  if (stopped === null) { await note({ status: 'error', reason: 'تعذّر الوصول إلى حسابك — لا شيء يُفتح حتى يعود الاتصال' }); return; }
  if (stopped) {
    // said once, not every two minutes for as long as the pause lasts
    const { log } = await state();
    if (!String(log[0]?.reason ?? '').startsWith(PAUSED)) await note({ status: 'warn', reason: PAUSED + ' — لا شيء يُفتح ولا يُرسل' });
    return;
  }
  await recoverStale(session).catch(() => { });
  if (settings.neverSubmit !== true) await releaseWaiting(session).catch(() => { });

  let queue = [];
  try { queue = await fetchQueue(session); } catch (e) {
    await note({ status: 'error', reason: 'تعذّر قراءة الطابور: ' + e.message });
    return;
  }
  if (!queue.length) return;

  await chrome.storage.local.set({ running: true, running_since: Date.now() });
  // A background that goes quiet for thirty seconds is put to sleep by the browser — and a
  // form waiting a minute for the employer's page to answer is exactly that quiet. Asleep, it
  // would lose which application the open tab belongs to. This keeps it awake for the length
  // of a run and not a moment longer.
  const awake = setInterval(() => { chrome.runtime.getPlatformInfo(() => { }); }, 20000);
  try {
    // Answers change without this browser ever opening the site: the person answers from
    // their phone, the worker writes estimates. The copy handed over by the page is whatever
    // it was the last time the page was open here — so the answers are read again, each run.
    // Row-level security returns exactly one profile: the owner's.
    // (And whether sending is on, so the popup says what is true now rather than what was
    // true when the page was last open — it is display only; the queue carries the decision.)
    const fresh = await api(session, '/profiles?select=answers,auto_submit&limit=1').then((rows) => rows?.[0] ?? null).catch(() => null);
    const current = fresh ? { ...profile, answers: fresh.answers ?? profile.answers, auto_submit: !!fresh.auto_submit } : profile;
    if (fresh) await chrome.storage.local.set({ profile: current });

    const cv_file = await fetchCv(session, current).catch(() => null);
    if (!cv_file && current.cv_path) await note({ status: 'warn', reason: 'تعذّر تحميل سيرتك — ستتوقّف الطلبات عند المرفق' });
    const withCv = { ...current, cv_file };
    for (const item of queue.slice(0, settings.maxPerRun)) {
      const s = await state();
      if (!s.running) break;
      const status = await applyOne(item, withCv, settings, session);
      // One form nobody can answer should not hold up the nineteen that are fine. Before
      // the first three are approved we still stop, because each of those wants a person.
      if (status === 'paused') break;
      if (status === 'needs_you' && !item.submit) break;
      await new Promise((r) => setTimeout(r, settings.delayMs));   // be a polite visitor
    }
  } finally {
    clearInterval(awake);
    await chrome.storage.local.set({ running: false, running_since: 0 });
  }
}

const clearStale = () => chrome.storage.local.set({ running: false, running_since: 0 });
chrome.runtime.onStartup.addListener(clearStale);
chrome.runtime.onInstalled.addListener(clearStale);

chrome.alarms.create('qaddim:poll', { periodInMinutes: POLL_MINUTES });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'qaddim:poll') run(); });

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'qaddim:pressing') {
    // A form is about to be sent. It is written down first — in the database, not in memory —
    // and only then allowed: if this record cannot be made, the press is not made either.
    const flight = sender.tab && inFlight.get(sender.tab.id);
    if (!flight) { reply({ ok: false, why: 'طلب غير معروف — لم يُرسل شيء' }); return; }
    // One form, one press. Claimed here, before anything is awaited, so that two frames of the
    // same page asking in the same instant cannot both be told yes.
    if (flight.claimed) { reply({ ok: false, why: 'ضُغط الإرسال في هذه الاستمارة مرة — لا يُضغط ثانية' }); return; }
    flight.claimed = true;
    (async () => {
      const stopped = await paused(flight.session);
      if (stopped !== false) {
        reply({ ok: false, why: stopped ? PAUSED + ' قبل الإرسال' : 'تعذّر الوصول إلى حسابك لحظة الإرسال — لم يُرسل شيء' });
        return;
      }
      const earlier = flight.row.auto_report?.sent;
      const sent = {
        pressed_at: new Date().toISOString(), by: chrome.runtime.getManifest().version,
        ...(earlier ? { previous: { pressed_at: earlier.pressed_at, outcome: earlier.outcome ?? null } } : {})
      };
      // Written only onto a row that is still saved and still being filled, and the database
      // is made to hand back what it wrote. A write that matched nothing is not an error to
      // the database — but it means this application is no longer the extension's to send:
      // its owner took it out of the queue, or marked it applied by hand, while the form was
      // being filled. Either way there is no record, and so no press.
      let wrote = null;
      try {
        wrote = await api(flight.session,
          '/applications?id=eq.' + encodeURIComponent(flight.item.application_id) + '&status=eq.saved&auto_status=eq.filling',
          { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ auto_reason: PRESSED, auto_report: { ...(msg.report ?? {}), sent } }) });
      } catch {
        reply({ ok: false, why: 'تعذّر تسجيل الضغطة — لم يُرسل شيء' });
        return;
      }
      if (!Array.isArray(wrote) || wrote.length !== 1 || wrote[0].auto_report?.sent?.pressed_at !== sent.pressed_at) {
        reply({ ok: false, why: CANCELLED });
        return;
      }
      flight.pressed = true; flight.report = msg.report ?? null; flight.sent = sent; flight.base = msg.base ?? null;
      logEvent(flight.session, flight.row, 'ضُغط الإرسال');
      reply({ ok: true });
    })();
    return true;
  }
  if (msg?.type === 'qaddim:run') { run().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'qaddim:stop') { chrome.storage.local.set({ running: false }).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'qaddim:sync') {
    chrome.storage.local.set({ session: msg.session, profile: msg.profile })
      .then(() => run())
      .then(() => reply({ ok: true }));
    return true;
  }
});
