// Every question a hiring form asks, in one place.
//
// Three screens read this list: the editor that collects the answers, the sheet that hands
// them to you to paste, and the readiness meter that decides whether applying is possible
// at all. They used to disagree — the extension asked for fifteen fields and no screen
// collected any of them — so the list lives here and nowhere else.
//
// `need` says when an answer is required:
//   'apply' — no application can be sent without it. A form will reject you.
//   'auto'  — the robot stops and asks you if it is blank; you can still apply by hand.
//   none    — useful when asked, never blocking.

export const APPLY_FIELDS = [
  { key: 'full_name',              label: 'الاسم الكامل',          type: 'text',  need: 'apply', ph: 'كما في الهوية' },
  { key: 'email_for_applications', label: 'البريد للتقديم',        type: 'email', need: 'apply', ph: 'you@example.com', dir: 'ltr' },
  { key: 'phone',                  label: 'الجوال',                type: 'tel',   need: 'apply', ph: '05xxxxxxxx', dir: 'ltr' },

  { key: 'nationality',            label: 'الجنسية',               type: 'text',  need: 'auto',  ph: 'سعودي' },
  { key: 'work_authorization',     label: 'وضعك النظامي للعمل',    type: 'select', need: 'auto',
    options: ['مواطن', 'إقامة قابلة للنقل', 'إقامة غير قابلة للنقل', 'أحتاج تأشيرة عمل'] },
  { key: 'current_title',          label: 'مسمّاك الحالي',         type: 'text',  need: 'auto',  ph: 'محلل منتجات' },
  { key: 'current_company',        label: 'جهة عملك الحالية',      type: 'text',  ph: 'أو اتركها فارغة إن كنت تبحث' },
  { key: 'salary_expectation',     label: 'الراتب المتوقع',        type: 'text',  need: 'auto',  ph: '15500 ريال شهرياً' },
  { key: 'current_salary',         label: 'راتبك الحالي',          type: 'text',  ph: 'يُسأل كثيراً — اتركه إن لم ترد' },
  { key: 'notice_period',          label: 'متى تستطيع المباشرة',   type: 'select', need: 'auto',
    options: ['فوراً', 'أسبوعان', 'شهر', 'شهران', 'ثلاثة أشهر'] },

  { key: 'education_degree',       label: 'المؤهل',                type: 'select', need: 'auto',
    options: ['ثانوية', 'دبلوم', 'بكالوريوس', 'ماجستير', 'دكتوراه'] },
  { key: 'university',             label: 'الجامعة',               type: 'text',  ph: 'جامعة الملك سعود' },
  { key: 'graduation_year',        label: 'سنة التخرج',            type: 'number', ph: '2025', dir: 'ltr' },
  { key: 'linkedin_url',           label: 'لينكدإن',               type: 'url',   need: 'auto',  ph: 'https://linkedin.com/in/…', dir: 'ltr' }
];

const has = (profile, key) => String(profile?.[key] ?? '').trim() !== '';

/** What this profile can do right now, and exactly what is missing for the next step up. */
export function readiness(profile, { extension = false } = {}) {
  const missingApply = APPLY_FIELDS.filter((f) => f.need === 'apply' && !has(profile, f.key));
  if (!profile?.cv_path) missingApply.push({ key: 'cv_path', label: 'سيرتك الذاتية' });

  const missingAuto = APPLY_FIELDS.filter((f) => f.need === 'auto' && !has(profile, f.key));

  return {
    canApply: missingApply.length === 0,
    canAutoApply: missingApply.length === 0 && missingAuto.length === 0 && extension,
    missingApply,
    missingAuto,
    // Four rungs, so the meter can say "3 من 4" instead of a vague percentage.
    done: [
      (profile?.roles?.length ?? 0) > 0 && (profile?.cities?.length ?? 0) > 0,
      missingApply.length === 0,
      missingAuto.length === 0,
      extension
    ]
  };
}

export const RUNGS = ['مجالك ومدنك', 'ما يكفي للتقديم', 'ما يكفي ليقدّم عنك', 'إضافة المتصفح'];
