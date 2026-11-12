// One vocabulary for where an application stands.
//
// The database keeps two fields that grew separately — `status`, which the person moves, and
// `auto_status`, which the extension moves — plus what the extension reported. Neither field
// could say the thing that matters most once sending is automatic: *send was pressed, and
// nobody knows yet whether it arrived*. That used to be recorded as "the page did not
// respond", with a retry button beside it — which is how an application gets sent twice.
//
// `stateOf` reads all three and answers with exactly one of eleven states. Everything that
// decides what may happen next — may this be queued again, may it be shown as sent — asks
// here, so the site, the worker and the extension cannot each hold a different opinion.

export const STATES = [
  'DISCOVERED',        // the job is known; this person has done nothing with it
  'MATCHED',           // saved by the person; nothing is being prepared
  'ELIGIBILITY_CHECK', // being checked just before a form is opened (never stored: it lasts a moment)
  'PREPARING',         // the form is open and being filled
  'READY',             // in the queue, or filled and waiting for its turn
  'SUBMITTING',        // send was pressed; the page has not answered yet
  'SUBMITTED',         // the employer's page confirmed it, or the person says it went
  'ACTION_REQUIRED',   // only the person can move it: a question, a check, an unconfirmed send
  'FAILED',            // it could not be done, and trying again as it is will not help
  'DUPLICATE',         // the same role was already applied to
  'CANCELLED'          // the person stopped it, or closed it
];

/** What is recorded about the moment send was pressed, if it ever was. */
export const sentOf = (app) => app?.auto_report?.sent ?? null;

/**
 * Send was pressed and it is not known to have failed. Until the person says otherwise this
 * application must never be queued, retried or reopened by anything automatic: the next press
 * could be the second copy of an application that already arrived.
 */
export function awaitingProof(app) {
  const s = sentOf(app);
  if (!s?.pressed_at || s.rearmed) return false;
  // `rejected` is the one outcome that proves nothing went: the form came back with errors.
  return s.outcome !== 'rejected' && s.outcome !== 'confirmed';
}

const AFTER_SENDING = new Set(['applied', 'under_review', 'assessment', 'interview', 'offer', 'rejected']);
const STOPPED = new Set(['closed', 'withdrawn']);

// How long "send was pressed, the page has not answered yet" can be true. The extension waits
// about a minute for the page and under a minute more for whatever replaced it; an application
// still saying "sending" after this is one whose run died, and it needs its owner.
export const SENDING_FOR_MS = 5 * 60 * 1000;

export function stateOf(app, now = Date.now()) {
  if (!app) return 'DISCOVERED';
  const report = app.auto_report ?? {};
  if (report.duplicate) return 'DUPLICATE';
  if (AFTER_SENDING.has(app.status) || app.auto_status === 'submitted') return 'SUBMITTED';
  if (STOPPED.has(app.status) || report.cancelled) return 'CANCELLED';
  if (awaitingProof(app)) {
    const since = Date.parse(sentOf(app).pressed_at);
    const live = app.auto_status === 'filling' && Number.isFinite(since) && now - since < SENDING_FOR_MS;
    return live ? 'SUBMITTING' : 'ACTION_REQUIRED';
  }
  switch (app.auto_status) {
    case 'filling': return 'PREPARING';
    case 'queued': return 'READY';
    case 'needs_you': return 'ACTION_REQUIRED';
    case 'failed': return 'FAILED';
    default: return 'MATCHED';
  }
}

/** May anything automatic put this application (back) in the queue? */
export function mayQueue(app, { paused = false } = {}) {
  if (paused) return false;
  const s = stateOf(app);
  return s === 'MATCHED' || s === 'ACTION_REQUIRED' && !awaitingProof(app) || s === 'FAILED';
}

/** Has the person stopped all automation? Kept with their other settings. */
export const isPaused = (profile) => profile?.answers?._settings?.paused === true;

export const STATE_AR = {
  DISCOVERED: 'جديدة', MATCHED: 'محفوظة', ELIGIBILITY_CHECK: 'تُفحص', PREPARING: 'تُعبّأ الآن',
  READY: 'في الطابور', SUBMITTING: 'يُرسل الآن', SUBMITTED: 'أُرسل', ACTION_REQUIRED: 'يحتاجك',
  FAILED: 'تعذّر', DUPLICATE: 'مكرّر', CANCELLED: 'أُلغي'
};
