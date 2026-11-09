// The hand of the platform.
//
// The site decides *what* to apply to; this decides *when*, and does it inside the user's own
// browser — the only place a CAPTCHA sees a real browser and lets the submission through.
//
// It keeps the queue in the database, not in the extension, so the site can show honest status:
// queued → filling → submitted, or needs_you with the reason.

const DEFAULTS = { autoSubmit: false, delayMs: 9000, maxPerRun: 10 };
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
  const next = { ...session, token: j.access_token, refresh_token: j.refresh_token ?? session.refresh_token };
  await chrome.storage.local.set({ session: next });
  return next;
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

async function applyOne(item, profile, settings, session) {
  // Whether to press submit is decided by the database, not here: the caps and the
  // first-three rule have to hold no matter what this copy of the extension believes.
  const submit = item.submit === true && settings.autoSubmit !== false;
  await markApplication(session, item.application_id, { auto_status: 'filling', auto_at: new Date().toISOString() });

  // Opened in the background so a run does not steal focus while you work.
  const tab = await chrome.tabs.create({ url: APPLY_URL(item.url), active: false });
  await tabReady(tab.id);

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: 'qaddim:apply', profile, autoSubmit: submit });
  } catch {
    result = { status: 'needs_you', reason: 'الصفحة لم تستجب' };
  }
  const status = result?.status === 'submitted' ? 'submitted'
    : result?.status === 'filled' ? 'needs_you'
      : 'needs_you';

  await markApplication(session, item.application_id, {
    auto_status: status,
    auto_reason: result?.reason ?? (status === 'needs_you' ? 'الاستمارة مفتوحة وتنتظرك' : null),
    auto_at: new Date().toISOString(),
    auto_report: result?.report ?? null,
    auto_attempts: (item.auto_attempts ?? 0) + 1,
    ...(status === 'submitted' ? { status: 'applied' } : {})
  });
  await note({ job: item, status, reason: result?.reason ?? '', report: result?.report ?? null });

  if (status === 'submitted') {
    setTimeout(() => chrome.tabs.remove(tab.id).catch(() => { }), 2500);
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

// ── the run ──────────────────────────────────────────────────────────────────
async function run() {
  const { session, profile, settings, running } = await state();
  if (running) return;
  if (!session || !profile) { await note({ status: 'error', reason: 'افتح المنصة مرة لمزامنة حسابك' }); return; }

  let queue = [];
  try { queue = await fetchQueue(session); } catch (e) {
    await note({ status: 'error', reason: 'تعذّر قراءة الطابور: ' + e.message });
    return;
  }
  if (!queue.length) return;

  await chrome.storage.local.set({ running: true });
  try {
    const cv_file = await fetchCv(session, profile).catch(() => null);
    if (!cv_file && profile.cv_path) await note({ status: 'warn', reason: 'تعذّر تحميل سيرتك — ستتوقّف الطلبات عند المرفق' });
    const withCv = { ...profile, cv_file };
    for (const item of queue.slice(0, settings.maxPerRun)) {
      const s = await state();
      if (!s.running) break;
      const status = await applyOne(item, withCv, settings, session);
      // One form nobody can answer should not hold up the nineteen that are fine. Before
      // the first three are approved we still stop, because each of those wants a person.
      if (status === 'needs_you' && !item.submit) break;
      await new Promise((r) => setTimeout(r, settings.delayMs));   // be a polite visitor
    }
  } finally {
    await chrome.storage.local.set({ running: false });
  }
}

chrome.alarms.create('qaddim:poll', { periodInMinutes: POLL_MINUTES });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'qaddim:poll') run(); });

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type === 'qaddim:run') { run().then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'qaddim:stop') { chrome.storage.local.set({ running: false }).then(() => reply({ ok: true })); return true; }
  if (msg?.type === 'qaddim:sync') {
    chrome.storage.local.set({ session: msg.session, profile: msg.profile })
      .then(() => run())
      .then(() => reply({ ok: true }));
    return true;
  }
});
