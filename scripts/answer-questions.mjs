// Answers, by estimate, the questions that stopped an application — for people who asked for that.
//
//   node scripts/answer-questions.mjs        # one pass, on its own
//   (ingest-once.mjs runs the same pass at the start of every cycle)
//
// Nine forms in ten ask something no profile field answers. A person can answer each once in
// the draft screen — or switch on «وأجب عني ما لا جواب له» and have them answered from their
// CV, unread, so that applying needs nobody at all. This is the part that writes those
// answers. It never touches an employer's site: it reads the questions the extension reported,
// asks the model, and saves what comes back for that one application; the extension picks the
// answers up on its next pass and fills the form with them.
//
// Three things it will not do, whatever the setting:
//   • answer a declaration — the right to work, export rules, convictions, relatives at the
//     company, "everything above is true". Those are held for the person (see answering.js).
//   • state a fact the CV and profile do not contain. The model may estimate ("about three
//     years of SQL", from the roles and dates); it may not supply an employer, a certificate
//     or a salary. Where only an invented fact would answer, it returns nothing and the
//     question waits for the person.
//   • keep an estimate as if it were the person's own answer. Estimates are stored against the
//     one application they were written for (profiles.answers._for[job]), never in the saved
//     answers that are reused on every form — so "why this company?" written for one employer
//     is not sent to the next, and the person's own words always outrank an estimate.
//
// Needs a model to ask: GEMINI_API_KEY (free — aistudio.google.com; see answer-gemini.mjs), or
// ANTHROPIC_API_KEY (paid), which is used instead when both are set. On the server both come
// from the repository's Actions secrets; here, from .env.local. Without either this does
// nothing and says so once.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { mayGuess, sameWords } from '../packages/engine/src/answering.js';
import { awaitingProof, isPaused } from '../packages/engine/src/applications.js';
import { geminiAnswer, GEMINI_MODELS } from './answer-gemini.mjs';

export const MODEL_DEFAULT = 'claude-opus-5-5';
// A form can reveal more questions once the first ones are answered. Three rounds is enough
// for that and few enough that a form which keeps asking stops being retried.
export const MAX_ROUNDS = 3;

const Drafted = z.object({
  answers: z.array(z.object({
    n: z.number().int().describe('The number of the question, as given.'),
    answer: z.string().nullable().describe('The answer exactly as it should be entered in the form, or null when it cannot be answered without stating a fact the documents do not contain.'),
    basis: z.enum(['cv', 'profile', 'estimate', 'none']).describe('cv: stated in the CV. profile: stated in the profile. estimate: worked out from them. none: not answered.')
  }))
});

const SYSTEM = `You are completing the questions on a job application on behalf of the applicant.

The applicant has asked for this and will not read your answers before they are sent. Each one goes to an employer under their name, so it has to be something they could repeat in an interview without correcting it.

You are given their profile, their CV when there is one, the job they are applying to, and the questions on the employer's form that their saved answers did not cover.

Answer as the applicant, in the first person, in the language the question is written in.

Every answer comes from the CV and the profile. Where they state what is asked, state it. Where the question asks for a judgement about the applicant — years of experience with something, how proficient they are, whether they have done a kind of work — work it out from the roles, dates and descriptions on the CV and give the honest estimate. Count only what the documents show: if nothing in them suggests experience with what is asked, the honest answer is none, or no, even when the job plainly wants a yes. An application that overstates is worse for this person than one that is turned down.

Do not supply facts the documents do not contain: no employer, qualification, certificate, reference, date, identity number or pay figure that is not in them. For questions about pay, use only figures the profile gives, converting currency or period if the question needs it. When a question can only be answered with such a fact, return null for it and basis "none" — a person will answer that one. Returning null is always better than inventing.

Multiple-choice questions list their options. Return exactly one of them, character for character. If none is true of the applicant, return null.

For questions about where they would work, the profile lists the cities they have chosen to look in; a job in one of those cities is one they are willing to work in. Their notice period, where given, answers when they could start.

Open questions — why this company, tell us about a project, anything else we should know — get two to four plain sentences that connect what the CV actually shows to what this job actually asks. No flattery, no enthusiasm for its own sake, no claim the CV cannot support. Keep to any length the question states.

Return one entry for every question you were given, with its number.`;

/** What is open on one stopped application, and whose each question is. */
export function planFor(profile, app) {
  const mine = new Set(Object.keys(profile.answers ?? {}).filter((k) => !k.startsWith('_')).map(sameWords));
  const before = profile.answers?._for?.[app.job_id]?.answers ?? {};
  const tried = new Set(Object.keys(before).map(sameWords));
  const plan = { ask: [], held: [], declined: {}, manual: 0 };
  for (const m of app.auto_report?.missing ?? []) {
    if (!m?.q) continue;
    if (m.manual) { plan.manual++; continue; }
    const k = sameWords(m.q);
    if (mine.has(k) || tried.has(k)) continue;
    const verdict = mayGuess(m.q, m.options);
    if (verdict.ok) plan.ask.push({ n: plan.ask.length + 1, q: m.q, kind: m.kind ?? 'text', options: m.options ?? null });
    else if (verdict.decline) plan.declined[m.q] = { a: verdict.decline, basis: 'declined' };
    else plan.held.push({ q: m.q, why: verdict.why });
  }
  return plan;
}

const FIELDS = ['full_name', 'nationality', 'work_authorization', 'current_title', 'current_company',
  'years_experience', 'salary_expectation', 'current_salary', 'notice_period', 'education_degree',
  'university', 'graduation_year', 'linkedin_url', 'roles', 'skill_areas', 'extra_skills', 'cities'];

/** The words of the request — the same whichever model is asked. */
export function promptFor({ profile, cv, job, ask }) {
  const about = Object.fromEntries(FIELDS.map((k) => [k, profile[k]]).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
  const said = Object.entries(profile.answers ?? {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string');
  const text = [
    '<profile>', JSON.stringify(about, null, 1), '</profile>',
    said.length ? `<answers_they_wrote_themselves>\n${said.map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n')}\n</answers_they_wrote_themselves>` : '',
    cv ? '' : '<note>No CV could be attached. Only the profile is available; answer from it and return null where it is not enough.</note>',
    '<job>', JSON.stringify({ title: job?.title, company: job?.company, location: job?.location, city: job?.city, country: job?.country }), '',
    job?.description ?? '', '</job>',
    '<questions>',
    ...ask.map((x) => `${x.n}. ${x.q}${x.options ? `\n   Options: ${x.options.map((o) => JSON.stringify(o)).join(' | ')}` : ''}`),
    '</questions>'
  ].filter((line) => line !== '').join('\n');
  return text;
}

export function requestFor({ profile, cv, job, ask, model = MODEL_DEFAULT }) {
  const text = promptFor({ profile, cv, job, ask });
  return {
    model,
    max_tokens: 16000,
    // On this model the default effort is medium; said out loud so a model change does not move it.
    output_config: { effort: 'medium', format: betaZodOutputFormat(Drafted) },
    // If a safety classifier declines the request, the API retries it on the model Anthropic
    // recommends for that kind of decline instead of handing back the refusal.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        // The CV is the same for every application of the same person in a run; cached, the
        // second and later ones read it at a fraction of the price.
        ...(cv ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: cv }, cache_control: { type: 'ephemeral' } }] : []),
        { type: 'text', text }
      ]
    }]
  };
}

/** What came back, checked against what was asked. Anything that does not fit is dropped. */
export function accept(ask, drafted) {
  const out = {};
  for (const x of ask) {
    const got = (drafted?.answers ?? []).find((a) => a.n === x.n);
    let a = got && got.basis !== 'none' && typeof got.answer === 'string' ? got.answer.trim() : null;
    if (a && x.options) {
      // A choice has to be one of the choices, as the form wrote it.
      a = x.options.find((o) => o === a) ?? x.options.find((o) => sameWords(o) === sameWords(a)) ?? null;
    }
    if (a && a.length > 2000) a = null;
    out[x.q] = { a: a || null, basis: a ? got.basis : 'none' };
  }
  return out;
}

/**
 * Whether every question on an application now has an answer. What the extension marked as
 * "finish this on the employer's page" does not count against it: much of that is something it
 * could not do on that attempt, and trying again is the only way to tell. A form that still
 * stops there stops for good — nothing new is left to answer, so nothing sends it back.
 */
export function settled(answers, app) {
  const mine = new Set(Object.keys(answers ?? {}).filter((k) => !k.startsWith('_')).map(sameWords));
  const drafted = answers?._for?.[app.job_id]?.answers ?? {};
  const have = new Set(Object.entries(drafted).filter(([, v]) => v?.a).map(([q]) => sameWords(q)));
  return (app.auto_report?.missing ?? []).every((m) => !m?.q || m.manual || mine.has(sameWords(m.q)) || have.has(sameWords(m.q)));
}

async function cvOf(db, profile) {
  if (!profile.cv_path) return null;
  const { data, error } = await db.storage.from('cvs').download(profile.cv_path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  // The API reads PDFs as documents. A Word file is not sent as something it is not.
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-' ? bytes.toString('base64') : null;
}

/**
 * One pass over everyone who asked for this.
 * @param client  injected by tests; in use it is built from the key in .env.local
 * @param only    limit the pass to one user id (tests)
 */
// (No line logged here names a company or a person: which employer someone is applying to is
// not for a log that may be public.)
export async function answerPending({ db, env = {}, client, gemini, log = console.log, only } = {}) {
  const key = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const gemKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  // Claude when there is a key for it (or a stand-in, in tests); otherwise Gemini's free tier.
  const useClaude = !!(client || key || process.env.ANTHROPIC_AUTH_TOKEN);
  if (!useClaude && !gemKey && !gemini) {
    log('  answers: no GEMINI_API_KEY or ANTHROPIC_API_KEY set — nothing is answered by estimate');
    return { skipped: 'no-key' };
  }
  const ai = useClaude ? (client ?? new Anthropic(key ? { apiKey: key } : {})) : null;
  const gemModels = String(env.QADDIM_GEMINI_MODELS || '').split(',').map((m) => m.trim()).filter(Boolean);
  let model = useClaude ? (env.QADDIM_AI_MODEL || MODEL_DEFAULT) : 'gemini';

  let q = db.from('profiles').select('*').eq('onboarded', true);
  if (only) q = q.eq('id', only);
  const { data: profiles, error } = await q;
  if (error) throw new Error('profiles: ' + error.message);
  const tally = { people: 0, asked: 0, answered: 0, left: 0, requeued: 0 };

  // Someone who has stopped everything has stopped this too: no questions are sent to the
  // model on their behalf, and nothing of theirs is put back in the queue.
  for (const profile of (profiles ?? []).filter((p) => p.answers?._settings?.guess === true && !isPaused(p))) {
    tally.people++;
    const { data: apps } = await db.from('applications')
      .select('id, job_id, auto_status, auto_report, job:jobs(id, title, company, location, city, country, description, is_open)')
      .eq('user_id', profile.id).eq('auto_status', 'needs_you');
    let cv, cvRead = false;
    let answers = profile.answers ?? {};

    for (const app of apps ?? []) {
      if (app.job?.is_open === false) continue;
      // Send was pressed on this one and never confirmed: it is waiting for its owner's word,
      // not for an answer, and nothing here may queue it.
      if (awaitingProof(app)) continue;
      const rounds = answers._for?.[app.job_id]?.rounds ?? 0;
      const plan = planFor({ ...profile, answers }, app);
      const declined = Object.keys(plan.declined).length;
      if (!plan.ask.length && !declined) continue;
      if (rounds >= MAX_ROUNDS) continue;

      let drafted = {};
      if (plan.ask.length) {
        if (!cvRead) { cv = await cvOf(db, profile).catch(() => null); cvRead = true; }
        tally.asked += plan.ask.length;
        if (!useClaude) {
          const r = await geminiAnswer({ key: gemKey, system: SYSTEM, text: promptFor({ profile: { ...profile, answers }, cv, job: app.job, ask: plan.ask }), cv,
            models: gemModels.length ? gemModels : GEMINI_MODELS, ...(gemini ?? {}) });
          if (r.stopped === 'auth') { log('  answers: Google refused the key — check GEMINI_API_KEY'); return { ...tally, stopped: 'auth' }; }
          if (r.stopped === 'rate') { log('  answers: today\'s free allowance is used up on every model — the rest waits for tomorrow'); return { ...tally, stopped: 'rate' }; }
          if (!r.parsed) { log(`  answers: no usable reply for one application (${r.why})`); continue; }
          drafted = accept(plan.ask, r.parsed);
          model = r.model;
        } else try {
          const response = await ai.beta.messages.parse(requestFor({ profile: { ...profile, answers }, cv, job: app.job, ask: plan.ask, model }));
          if (response.stop_reason === 'refusal') {
            log('  answers: declined by the model for one application — left for the person');
          } else if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
            log(`  answers: no usable reply for one application (${response.stop_reason})`);
          } else {
            drafted = accept(plan.ask, response.parsed_output);
          }
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) { log('  answers: the API key was refused — check ANTHROPIC_API_KEY'); return { ...tally, stopped: 'auth' }; }
          if (e instanceof Anthropic.RateLimitError) { log('  answers: rate limited — the rest waits for the next pass'); return { ...tally, stopped: 'rate' }; }
          if (e instanceof Anthropic.APIError) { log(`  answers: API error ${e.status} for one application — ${e.message}`); continue; }
          throw e;
        }
      }

      // Read again just before writing: the person may have answered something in the
      // meantime, and their answers are in the same column.
      const { data: fresh } = await db.from('profiles').select('answers').eq('id', profile.id).single();
      answers = fresh?.answers ?? answers;
      const prior = answers._for?.[app.job_id] ?? {};
      const merged = { ...(prior.answers ?? {}), ...plan.declined, ...drafted };
      answers = {
        ...answers,
        _for: { ...(answers._for ?? {}), [app.job_id]: { at: new Date().toISOString(), model, rounds: rounds + 1, answers: merged } }
      };
      const { error: wErr } = await db.from('profiles').update({ answers }).eq('id', profile.id);
      if (wErr) { log('  answers: could not save — ' + wErr.message); continue; }

      const got = Object.values(drafted).filter((v) => v.a).length + declined;
      const none = Object.values(drafted).filter((v) => !v.a).length;
      tally.answered += got; tally.left += none + plan.held.length;

      if (got && settled(answers, app)) {
        await db.from('applications').update({ auto_status: 'queued', auto_reason: null, auto_attempts: 0 }).eq('id', app.id);
        tally.requeued++;
      } else if (got) {
        const rest = none + plan.held.length + plan.manual;
        await db.from('applications').update({ auto_reason: `أُجيب عن ${got} بالتقدير، وبقي ${rest} لا يجيبه إلا أنت` }).eq('id', app.id);
      }
    }
  }
  if (tally.people) log(`  answers: ${tally.answered} answered by estimate, ${tally.left} left for the person, ${tally.requeued} application(s) back in the queue`);
  return tally;
}

// Run directly: one pass, then exit.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { createClient } = await import('@supabase/supabase-js');
  const { default: ws } = await import('ws');
  const { loadEnv } = await import('./env.mjs');
  const env = await loadEnv();
  const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });
  const result = await answerPending({ db, env });
  if (result.skipped) process.exit(0);
}
