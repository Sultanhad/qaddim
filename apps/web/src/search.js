// Search over job titles: what a person types, in Arabic or English, against what boards write.
// Pure — no network, no React — so it is tested in Node against real titles.
import { FIELD_AR } from '../../../packages/engine/src/fields.js';

// ── search ──────────────────────────────────────────────────────────────────
/**
 * One spelling for Arabic and Latin text: no case, no diacritics, one alef, ta marbuta as ha,
 * alef maqsura as ya, and nothing but letters and digits between the words. Decomposed, «إ» is a
 * bare alef and a hamza mark (U+0655); the marks' range runs to U+0655 so the hamza goes with them.
 */
export function fold(s) {
  return String(s ?? '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u0655\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ـ/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Arabic job words and the English the boards write them in. Each value is a list of word
// beginnings: "محاسب" finds Accountant and Accounting; "مضيف" finds Cabin Crew and Host.
// Phrases are listed before their single words so "خدمة عملاء" is read as one thing.
const SYNONYMS = [
  ['ضيافه جويه', ['cabin crew', 'purser']], ['مضيف جوي', ['cabin crew']], ['مضيفه جويه', ['cabin crew']],
  ['خدمه عملاء', ['customer', 'call center', 'contact center']], ['خدمه العملاء', ['customer']],
  ['موارد بشريه', ['hr ', 'human resource', 'people ']], ['الموارد البشريه', ['hr ', 'human resource', 'people ']],
  ['ذكاء اصطناعي', ['ai ', 'machine learning', 'ml ', 'llm']], ['علاقات عامه', ['pr ', 'public relations', 'communication']],
  ['فني تكييف', ['hvac', 'ac technician', 'air condition', 'refrigeration']], ['تكييف', ['hvac', 'ac ', 'air condition', 'refrigeration']],
  ['تدريب تعاوني', ['coop', 'co op', 'intern']], ['حديث تخرج', ['graduate', 'fresh graduate']], ['حديثي التخرج', ['graduate']],
  ['تجربه المستخدم', ['ux', 'user experience']], ['امن سيبراني', ['cyber', 'information security', 'soc ', 'security engineer', 'security analyst']],
  ['الامن السيبراني', ['cyber', 'information security', 'soc ', 'security engineer', 'security analyst']],
  ['مدير مشروع', ['project manager']], ['مدير مشاريع', ['project manager']], ['مدير منتج', ['product manager']],
  ['محلل بيانات', ['data analyst']], ['عالم بيانات', ['data scientist']], ['محلل اعمال', ['business analyst']],
  ['سلاسل الامداد', ['supply chain']], ['سلسله الامداد', ['supply chain']],
  ['محاسب', ['accountant', 'accounting', 'accounts payable', 'accounts receivable']], ['محاسبه', ['accounting', 'accountant']], ['مالي', ['finance', 'financial']],
  ['ماليه', ['finance', 'financial']], ['مدقق', ['audit']], ['تدقيق', ['audit']], ['مراجع', ['audit']], ['ضرائب', ['tax']],
  ['صيدلي', ['pharmac']], ['صيدليه', ['pharmac']], ['صيدله', ['pharmac']], ['ممرض', ['nurs']], ['ممرضه', ['nurs']], ['تمريض', ['nurs']],
  ['طبيب', ['doctor', 'physician', 'registrar', 'consultant']], ['اسنان', ['dent']], ['مختبر', ['laborator', 'lab']], ['اشعه', ['radiolog', 'x ray']],
  ['مهندس', ['engineer']], ['هندسه', ['engineer']], ['مدني', ['civil']], ['ميكانيكا', ['mechanical']], ['كهربا', ['electrical']],
  ['مبرمج', ['developer', 'software', 'programmer']], ['مطور', ['developer', 'software']], ['برمجه', ['software', 'developer']],
  ['برمجيات', ['software']], ['بيانات', ['data']], ['شبكات', ['network']], ['سحابه', ['cloud']],
  ['محلل', ['analyst']], ['مدير', ['manager', 'director', 'head']], ['مشرف', ['supervisor']], ['مساعد', ['assistant']],
  ['منسق', ['coordinator']], ['اخصائي', ['specialist']], ['تنفيذي', ['executive']], ['رئيس', ['head', 'chief', 'lead']],
  ['مبيعات', ['sales']], ['مندوب', ['sales', 'representative']], ['تطوير اعمال', ['business development']], ['تسويق', ['marketing']],
  ['توظيف', ['recruit', 'talent']], ['استقبال', ['receptionist', 'reception', 'front desk', 'front office']],
  ['سكرتير', ['secretary', 'executive assistant']], ['سكرتيره', ['secretary']], ['اداري', ['admin']], ['اداريه', ['admin']],
  ['كاشير', ['cashier']], ['بائع', ['sales associate', 'store associate']], ['متجر', ['store', 'retail']], ['تجزئه', ['retail']],
  ['طاهي', ['chef', 'cook', 'commis']], ['شيف', ['chef', 'commis']], ['طباخ', ['cook', 'chef']], ['نادل', ['waiter', 'waitress', 'server']],
  ['باريستا', ['barista']], ['فندق', ['hotel', 'front office', 'housekeeping']], ['تدبير منزلي', ['housekeeping']],
  ['مضيف', ['cabin crew', 'host', 'steward']], ['مضيفه', ['cabin crew', 'hostess']], ['طيار', ['pilot', 'first officer', 'captain']],
  ['طيران', ['aviation', 'aircraft', 'airline', 'flight']],
  ['فني', ['technician']], ['كهربائي', ['electrician', 'electrical']], ['سباك', ['plumber']], ['ميكانيكي', ['mechanic']],
  ['سائق', ['driver']], ['لحام', ['welder']], ['نجار', ['carpenter']], ['دهان', ['painter']], ['صيانه', ['maintenance']],
  ['حارس', ['security', 'guard']], ['امن', ['security']], ['سلامه', ['safety', 'hse']],
  ['معلم', ['teacher']], ['معلمه', ['teacher']], ['مدرس', ['teacher', 'instructor']], ['مدرب', ['trainer', 'coach', 'instructor']],
  ['تدريب', ['training', 'trainer']], ['مصمم', ['designer']], ['تصميم', ['design']], ['جرافيك', ['graphic']],
  ['محامي', ['lawyer', 'counsel', 'legal']], ['قانوني', ['legal', 'counsel']], ['امتثال', ['compliance']], ['مخاطر', ['risk']],
  ['مشتريات', ['procurement', 'purchasing', 'buyer']], ['مستودع', ['warehouse', 'storekeeper']], ['مخزن', ['warehouse', 'store', 'inventory']],
  ['لوجستي', ['logistic']], ['عمليات', ['operations']], ['مشروع', ['project']], ['مشاريع', ['project']],
  ['جوده', ['quality', 'qa ', 'qc ']], ['تمهير', ['tamheer']], ['طاقات', ['tamheer']], ['انتاج', ['production']], ['متدرب', ['intern', 'trainee']], ['خريج', ['graduate']],
  ['منتج', ['product']], ['محتوى', ['content']], ['عقار', ['real estate', 'property']], ['مستشار', ['consultant', 'advisor']],
  ['استشاري', ['consultant']], ['لياقه', ['fitness', 'trainer', 'gym']], ['رياضه', ['sports', 'fitness']]
].map(([ar, en]) => [fold(ar), en]);

// The boards' own abbreviations, read both ways: "hr" is also "Human Resources".
const LATIN = new Map([
  ['hr', ['hr ', 'hrbp', 'hrms', 'human resource', 'people ']], ['ai', ['ai ', 'artificial intelligence', 'machine learning']],
  ['it', ['it ', 'information technology']], ['ux', ['ux ', 'user experience']], ['ui', ['ui ', 'user interface']],
  ['qa', ['qa ', 'quality assurance']], ['qc', ['qc ', 'quality control']], ['pr', ['pr ', 'public relations']],
  ['pm', ['project manager', 'product manager', 'pm ']], ['ba', ['business analyst']], ['hse', ['hse', 'health and safety', 'safety']],
  ['f&b', ['f b', 'food and beverage']], ['fnb', ['f b', 'food and beverage']]
]);

// Words that say nothing about the job: "وظيفة محاسب في الرياض" is a search for "محاسب".
const SKIP = new Set(['في', 'من', 'الى', 'على', 'و', 'وظيفه', 'وظائف', 'job', 'jobs', 'in', 'at', 'the', 'a', 'an', 'of', 'for']);

/**
 * The query, as groups of alternatives: every group must be found in the job, and a group is
 * found when any one of its alternatives begins a word of the job's title, company, field or
 * place. An alternative ending in a space is a whole word: "soc " is SOC, never "Social".
 *
 * Arabic words are read one at a time (or as a known phrase), each through its synonyms, since
 * "مهندس مدني" is "Civil Engineer" in the other order. Latin words typed together are a phrase:
 * "project manager" is a project manager, not a contract manager on a project.
 */
export function parseQuery(q) {
  let rest = ` ${fold(q)} `;
  const groups = [];
  for (const [ar, en] of SYNONYMS) {
    if (!ar.includes(' ')) continue;
    if (rest.includes(` ${ar} `)) { groups.push({ said: ar, alts: [ar, ...en] }); rest = rest.replace(` ${ar} `, ' '); }
  }
  let latin = [];
  const flush = () => {
    if (!latin.length) return;
    const phrase = latin.join(' ');
    const abbr = latin.length === 1 ? LATIN.get(phrase) : null;
    groups.push({ said: phrase, alts: abbr ?? [phrase] });
    latin = [];
  };
  for (const word of rest.split(' ').filter(Boolean)) {
    if (SKIP.has(word)) { flush(); continue; }
    if (/^[a-z0-9&]+$/.test(word)) { latin.push(word); continue; }
    flush();
    // "الصيدلي" is "صيدلي": the article is not part of the word anyone means.
    const bare = word.length > 4 && word.startsWith('ال') ? word.slice(2) : word;
    const syn = SYNONYMS.find(([ar]) => ar === word || ar === bare);
    groups.push({ said: word, alts: [...new Set([word, bare, ...(syn ? syn[1] : [])])] });
  }
  flush();
  return groups;
}

// Arabic names for the cities, so "محاسب في الرياض" finds Riyadh. Kept beside the search rather
// than imported from the app so this file stays testable on its own.
export const CITY_AR = {
  riyadh: 'الرياض', jeddah: 'جدة', dammam: 'الدمام', khobar: 'الخبر', dhahran: 'الظهران', mecca: 'مكة', medina: 'المدينة',
  neom: 'نيوم', tabuk: 'تبوك', abha: 'أبها', qassim: 'القصيم', dubai: 'دبي', 'abu dhabi': 'أبوظبي', sharjah: 'الشارقة',
  doha: 'الدوحة', manama: 'المنامة', kuwait: 'الكويت', muscat: 'مسقط', cairo: 'القاهرة', amman: 'عمّان'
};

/** Every word of the job a query can land on, folded once and kept on the job. */
function wordsOf(job) {
  if (!job._words) {
    job._words = ` ${fold(`${job.title} ${job.company} ${FIELD_AR[job.field] ?? ''} ${job.location ?? ''} ${job.city ?? ''} ${CITY_AR[job.city] ?? ''}`)} `;
  }
  return job._words;
}

const found = (w, alt) => w.includes(` ${fold(alt)}${alt.endsWith(' ') ? ' ' : ''}`);

/** Does this job answer every group of the query? */
export function matches(job, groups) {
  if (!groups.length) return true;
  const w = wordsOf(job);
  return groups.every((g) => g.alts.some((a) => found(w, a)));
}

/**
 * The groups that find something somewhere in `jobs`, and the words that found nothing. A word
 * no job contains — a misspelling, a term no board uses — would empty the whole search; it is
 * set aside and named instead, so the rest of the query still answers. A Latin phrase that is
 * nowhere ("accountant riyadh") is tried again word by word before anything is set aside.
 * `nothing` is true when no word of the query found anything: the answer is then no jobs, never
 * all of them.
 */
export function usable(groups, jobs) {
  const anywhere = (g) => jobs.some((j) => g.alts.some((a) => found(wordsOf(j), a)));
  const kept = [], dropped = [];
  for (const g of groups) {
    if (anywhere(g)) { kept.push(g); continue; }
    const words = g.said.split(' ');
    if (words.length > 1 && /^[a-z0-9& ]+$/.test(g.said)) {
      for (const w of words) {
        const one = { said: w, alts: LATIN.get(w) ?? [w] };
        (anywhere(one) ? kept : dropped).push(one);
      }
    } else dropped.push(g);
  }
  return { kept, dropped: dropped.map((g) => g.said), nothing: groups.length > 0 && kept.length === 0 };
}
