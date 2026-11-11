// Which questions may be answered on someone's behalf by estimate, and which never are.
//
// A person can ask for the questions their profile cannot answer to be answered for them, from
// their CV, without reading the answers first. That is a reasonable thing to delegate for
// "how many years of SQL?" — and not for a declaration. Some questions are not asking what you
// are like; they are asking you to state something with consequences if it is wrong: that you
// may work in a country, that you have no conviction, that no relative works there, that
// everything above is true. An estimate is the wrong instrument for those, however good, so
// they are held for the person whatever the setting says. They are few, and once answered by
// the person most are remembered.
//
// Shared by the worker that drafts the answers and the screen that says what is waiting, so
// the two cannot disagree about which questions are whose.

const HELD = [
  ['work_right', 'جوابه إقرار نظامي عن حقك في العمل',
    /sponsor|visa\b|work (permit|authori[sz]ation)|authori[sz]ed to work|right to work|eligible to work|legally (able|permitted|entitled)|كفالة|تأشيرة|تصريح عمل|إقامة/i],
  ['export', 'جوابه إقرار نظامي عن قيود التصدير',
    /deemed export|export control|export administration|\bitar\b|\bear\b|sanction/i],
  ['record', 'جوابه إقرار عن سجلك',
    /convict|criminal|felony|misdemeanou?r|\barrest|background check|drug (test|screen)|\bcourt\b|disciplinary action|dismissed from|terminated for|سجل جنائي|سوابق/i],
  ['conflict', 'جوابه إقرار عن صلة لك بالشركة',
    /\brelatives?\b|family members?|related to (any|an?|a current|someone)|\bspouse\b|conflict of interest|government official|public official|politically exposed|أقارب|قريب|تضارب مصالح/i],
  ['declaration', 'إقرار يوقّعه صاحبه',
    /\b(certify|declare|attest|affirm|acknowledge|undertake)\b|true(,| and) (complete|accurate|correct)|is (true|accurate|correct) (and|to the best)|to the best of my knowledge|signature|sign (here|below)|non[- ]?compete|non[- ]?disclosure|\bnda\b|i agree|i consent|i understand that|أقر|أتعهد|إقرار|أوافق/i],
  ['identity', 'رقم لا يُقدَّر',
    /national id|id number|iqama (number|no)|passport (number|no)|social security|\bssn\b|tax (id|number)|bank (account|details)|\biban\b|date of birth|رقم الهوية|رقم الإقامة|رقم الجواز|آيبان/i],
  ['health', 'سؤال عن صحتك',
    /medical (condition|history|leave|exam|reason)|health (condition|issue|problem)|\billness|\bmedication|pregnan|حالة صحية|مرض مزمن/i]
];

// Asked for statistics, never for assessment — and the one answer that is always true of
// anyone is declining to say. Chosen when it is offered; left alone when it is not.
const PROTECTED = /disabilit|veteran|\brace\b|ethnic|religio|sexual orientation|gender identity|pronoun|transgender|\bcaste\b|إعاقة|ديانة|عرق/i;
const DECLINE = /prefer not|decline|do not wish|don'?t wish|rather not|choose not|not to (say|answer|disclose|self)|لا أرغب|أفضّل عدم/i;

/**
 * @returns {{ok: true} | {ok: false, why: string, decline?: string}}
 *   `decline`, when present, is the offered option that says "I would rather not say".
 */
export function mayGuess(question, options) {
  const q = String(question ?? '');
  if (!q.trim()) return { ok: false, why: 'لا سؤال' };
  if (PROTECTED.test(q)) {
    const decline = (options ?? []).find((o) => DECLINE.test(String(o)));
    return { ok: false, why: 'سؤال إحصائي عنك — لا يُقدَّر', ...(decline ? { decline } : {}) };
  }
  for (const [, why, re] of HELD) if (re.test(q)) return { ok: false, why };
  return { ok: true };
}

/** The same question, however its spacing and punctuation were typed. */
export const sameWords = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
