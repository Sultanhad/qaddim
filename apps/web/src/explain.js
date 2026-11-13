// The engine scores in codes; this writes those codes in Arabic.
//
// A number on its own is not an explanation, and an explanation in a language the reader did
// not choose is not one either. The engine stays language-free so the same score can be told
// in Arabic here and in English elsewhere.

import { ROLE_FAMILIES, SKILL_AREAS } from '@engine/taxonomy.js';
import { normaliseArrangement } from '@engine/score.js';

const familyAr = Object.fromEntries(ROLE_FAMILIES.map((f) => [f.id, f.label_ar || f.label]));
const areaAr = Object.fromEntries(SKILL_AREAS.map((a) => [a.id, a.label_ar || a.label]));

const AR_CITY = {
  riyadh: 'الرياض', jeddah: 'جدة', dammam: 'الدمام', khobar: 'الخبر', dhahran: 'الظهران',
  mecca: 'مكة', medina: 'المدينة', neom: 'نيوم', tabuk: 'تبوك', abha: 'أبها', qassim: 'القصيم',
  dubai: 'دبي', 'abu dhabi': 'أبوظبي', sharjah: 'الشارقة', doha: 'الدوحة', manama: 'المنامة',
  kuwait: 'الكويت', muscat: 'مسقط', cairo: 'القاهرة', amman: 'عمّان'
};
const AR_ARRANGEMENT = { Remote: 'عن بُعد', Hybrid: 'هجين', 'On-site': 'من المقر' };
const AR_EVIDENCE = {
  'official employer board': 'لوحة صاحب العمل نفسه',
  'full description': 'وصف كامل',
  'salary published': 'الراتب معلن',
  'job-alert email': 'تنبيه بريدي',
  feed: 'تغذية'
};

const ordinal = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'];

/** One reason object from scoreJob, as a sentence. */
export function reasonAr(r) {
  if (typeof r === 'string') return r;            // a score stored before codes existed
  switch (r.code) {
    case 'path':
      return r.rank === 0
        ? `مجالك الأول: ${familyAr[r.familyId] ?? ''}`
        : `اختيارك ${ordinal[r.rank] ?? `رقم ${r.rank + 1}`}: ${familyAr[r.familyId] ?? ''}`;
    case 'skills': {
      const names = (r.areaIds || []).map((id) => areaAr[id] ?? id);
      return `تستخدم ${names.length === 1 ? 'مهارة' : `${names.length} من مهاراتك`}: ${names.join('، ')}`;
    }
    case 'in_city': {
      const city = AR_CITY[String(r.city).toLowerCase()] ?? r.city;
      const how = AR_ARRANGEMENT[r.arrangement];
      return how ? `في ${city} · ${how}` : `في ${city}`;
    }
    case 'remote_ok': return 'عن بُعد — مفتوحة من مكانك';
    case 'coding_low': return 'لا تتطلّب برمجة تُذكر';
    case 'seniority_fit': return 'مستواها يناسب خبرتك';
    case 'evidence':
      return `إعلان واضح: ${(r.notes || []).map((n) => AR_EVIDENCE[n] ?? n.replace(/posted (\d+)d ago/, 'نُشرت قبل $1 يوم')).join('، ')}`;
    default: return r.text ?? '';
  }
}

/** "onsite", "OnSite", "On-site" — however the board spelled it — in the reader's language, or ''. */
export function arrangementAr(a) {
  return AR_ARRANGEMENT[normaliseArrangement(a)] || '';
}

export function flagAr(f) {
  if (typeof f === 'string') return f;
  return {
    no_description: 'بلا وصف منشور — قُيّمت من العنوان والموقع فقط',
    remote_confirm: 'عن بُعد — تأكّد أنها مفتوحة من بلدك',
    location_unknown: 'الموقع غير مذكور',
    saudi_only: 'تذكر اشتراط الجنسية السعودية — تأكّد أنك مؤهّل',
    no_salary: 'الراتب غير معلن'
  }[f.code] ?? f.text ?? '';
}

/** Gaps are mostly proper nouns (SQL, Figma); only the two English suffixes need turning. */
export function gapAr(g) {
  return String(g)
    .replace(/^(\d+)\+ years of experience$/, 'خبرة $1 سنوات فأكثر')
    .replace(/ certification$/, ' (شهادة)');
}
