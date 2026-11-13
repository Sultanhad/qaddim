// The free engine for «أجب عني ما لا جواب له»: Google's Gemini, on its free tier.
//
// Same job as the Claude path in answer-questions.mjs, same instructions, same checks on what
// comes back (`accept` there): only the call is different. The free tier gives each model a
// small daily allowance (about twenty requests on this kind of key), and one request answers
// every question of one application — so the models are tried in turn, and a model that says
// "not today" (429) or "not here" (404) hands over to the next.
//
// What is sent: the instructions, the profile, the CV (as a PDF), the job and the questions.
// On the free tier Google may use what it is sent to improve its products; the settings page
// says so where the switch is.

// Strongest first: these answers go to employers under the applicant's name.
// (Read from the key's own model list on 2026-11-13; the 2.0 models are gone from it.)
export const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite'];

// The shape of the reply, in the subset of OpenAPI that Gemini's structured output accepts.
const SCHEMA = {
  type: 'OBJECT',
  properties: {
    answers: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER', description: 'The number of the question, as given.' },
          answer: { type: 'STRING', nullable: true, description: 'The answer exactly as it should be entered in the form, or null when it cannot be answered without stating a fact the documents do not contain.' },
          basis: { type: 'STRING', enum: ['cv', 'profile', 'estimate', 'none'], description: 'cv: stated in the CV. profile: stated in the profile. estimate: worked out from them. none: not answered.' }
        },
        required: ['n', 'answer', 'basis']
      }
    }
  },
  required: ['answers']
};

/**
 * Ask Gemini to answer one application's questions.
 * @returns {{ parsed: object|null, model: string|null, stopped: 'rate'|'auth'|null, why: string|null }}
 */
export async function geminiAnswer({ key, system, text, cv, models = GEMINI_MODELS, fetchImpl = fetch, timeoutMs = 90_000 }) {
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [...(cv ? [{ inlineData: { mimeType: 'application/pdf', data: cv } }] : []), { text }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.2, maxOutputTokens: 8192 }
  });
  let why = null;
  const tried = [];           // every model's answer, for the one log line if none of them works
  for (const model of models) {
    if (why) tried.push(why);
    let res;
    try {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', body, signal: AbortSignal.timeout(timeoutMs),
        // The key goes in a header, not the address, so it never lands in anyone's request log.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }
      });
    } catch (e) { why = `${model}: ${e?.name === 'TimeoutError' ? 'timed out' : 'no answer'}`; continue; }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      const msg = await res.text().catch(() => '');
      // A key Google does not accept is the same for every model: stop asking.
      if (res.status !== 400 || /API[_ ]KEY|api key/i.test(msg)) return { parsed: null, model: null, stopped: 'auth', why: `HTTP ${res.status}` };
      why = `${model}: HTTP 400`; continue;
    }
    if (res.status === 429 || res.status === 404 || res.status >= 500) { why = `${model}: HTTP ${res.status}`; continue; }
    if (!res.ok) { why = `${model}: HTTP ${res.status}`; continue; }
    const out = await res.json().catch(() => null);
    const cand = out?.candidates?.[0];
    const raw = cand?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (cand?.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) { why = `${model}: ${cand.finishReason}`; continue; }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.answers)) return { parsed, model, stopped: null, why: null };
    } catch { /* fall through */ }
    why = `${model}: reply was not the expected shape`;
  }
  // Every model out of today's allowance (or not answering) is not a failure of this
  // application: the questions wait for the next pass, or for the person.
  return { parsed: null, model: null, stopped: /429/.test(why ?? '') ? 'rate' : null, why: [...tried, why].filter(Boolean).join(' · ') };
}
