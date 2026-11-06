// Maps a form field's visible label to one of YOUR answers.
//
// The one rule: it only ever returns something you wrote yourself. No defaults, no "sensible value".
// An unmatched required field is a blocker, and the extension stops rather than inventing anything.
//
// Plain script (no modules) because content scripts share one global scope.

var FursaFields = (function () {
  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/ /g, ' ')
      .normalize('NFD').replace(/\p{M}+/gu, '')
      .toLowerCase()
      .replace(/[\/\\|,.;()\[\]{}]/g, ' ')
      .replace(/[*_:•·]/g, ' ')
      .replace(/\(\s*(required|optional|اختياري|مطلوب)\s*\)/g, ' ')
      .replace(/[^\p{L}\p{N}+#\- ]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Most specific first: "current company" must win over "company".
  var RULES = [
    { key: 'cover_letter', any: ['cover letter', 'motivation letter', 'خطاب التقديم'] },
    { key: 'cv', any: ['resume', 'cv', 'curriculum vitae', 'السيرة الذاتية'] },
    { key: 'first_name', any: ['first name', 'given name', 'forename', 'الاسم الأول'] },
    { key: 'last_name', any: ['last name', 'family name', 'surname', 'اسم العائلة'] },
    { key: 'full_name', any: ['full name', 'your name', 'name', 'الاسم'],
      not: ['company', 'employer', 'school', 'university', 'reference', 'file', 'user'] },
    { key: 'email_for_applications', any: ['email', 'e mail', 'البريد'] },
    { key: 'phone', any: ['phone', 'mobile', 'telephone', 'جوال', 'هاتف'] },
    { key: 'linkedin_url', any: ['linkedin'] },
    { key: 'current_company', any: ['current company', 'current employer', 'present employer'] },
    { key: 'current_title', any: ['current title', 'current position', 'current job title'] },
    { key: 'years_experience', any: ['years of experience', 'years experience', 'total experience', 'سنوات الخبرة'] },
    { key: 'salary_expectation', any: ['salary expectation', 'expected salary', 'desired salary', 'salary requirement', 'الراتب المتوقع'] },
    { key: 'current_salary', any: ['current salary', 'present salary', 'الراتب الحالي'] },
    { key: 'notice_period', any: ['notice period', 'when can you start', 'start date', 'availability', 'فترة الإشعار'] },
    { key: 'nationality', any: ['nationality', 'citizenship', 'الجنسية'] },
    { key: 'requires_sponsorship', any: ['sponsorship', 'require a visa', 'need a visa', 'visa support'] },
    { key: 'work_authorization', any: ['work authorization', 'authorized to work', 'legally authorized', 'right to work', 'eligible to work', 'iqama', 'الإقامة'] },
    { key: 'city', any: ['city', 'town', 'المدينة'] },
    { key: 'location', any: ['location', 'address', 'where are you based', 'العنوان'] },
    { key: 'education_degree', any: ['degree', 'education level', 'highest qualification', 'المؤهل'] },
    { key: 'university', any: ['university', 'school', 'college', 'institution', 'الجامعة'] },
    { key: 'graduation_year', any: ['graduation year', 'year of graduation', 'سنة التخرج'] }
  ];

  function matchKey(label) {
    var t = ' ' + norm(label) + ' ';
    if (!t.trim()) return null;
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (r.not && r.not.some(function (n) { return t.indexOf(' ' + n) >= 0; })) continue;
      for (var j = 0; j < r.any.length; j++) {
        var a = norm(r.any[j]);
        if (t.indexOf(' ' + a + ' ') >= 0 || t.indexOf(' ' + a) >= 0) return r.key;
      }
    }
    return null;
  }

  // A long compound question ("how many years in PM, and how many in B2B SaaS?") is not answered
  // by a short stored key. Only something you wrote for that question counts.
  var SHORT_LIMIT = 70;
  var UNFINISHED = /\[[^\]]*\]|⛔|TODO/;
  var CURRENCIES = [
    ['usd', 'dollar', 'dollars'], ['sar', 'riyal', 'riyals', 'ريال'], ['eur', 'euro'],
    ['gbp', 'pound'], ['aed', 'dirham'], ['egp'], ['kwd'], ['qar'], ['bhd'], ['omr'], ['jod']
  ];
  function currencyOf(s) {
    var t = ' ' + norm(s) + ' ';
    for (var i = 0; i < CURRENCIES.length; i++) {
      for (var j = 0; j < CURRENCIES[i].length; j++) {
        if (t.indexOf(' ' + CURRENCIES[i][j]) >= 0) return CURRENCIES[i][0];
      }
    }
    return null;
  }

  /** @returns {{key,value,source,why}|null} — value null means "cannot answer this honestly". */
  function answerFor(label, profile) {
    var t = norm(label);
    var key = t.length <= SHORT_LIMIT ? matchKey(label) : null;
    var blocked = null;

    if (key && profile[key] != null && String(profile[key]).trim() !== '') {
      var value = String(profile[key]).trim();
      var asked = currencyOf(label), held = currencyOf(value);
      if ((key === 'salary_expectation' || key === 'current_salary') && asked && held && asked !== held) {
        blocked = { key: key, value: null, source: key, why: 'يسأل بـ' + asked.toUpperCase() + ' وإجابتك بـ' + held.toUpperCase() };
      } else if (UNFINISHED.test(value)) {
        blocked = { key: key, value: null, source: key, why: 'إجابتك فيها فراغ لم تملأه' };
      } else {
        return { key: key, value: value, source: key };
      }
    }

    var extra = profile.answers || {};
    for (var q in extra) {
      var nq = norm(q), v = String(extra[q] || '').trim();
      if (!nq || !v) continue;
      var fwd = nq.length >= 10 && t.indexOf(nq) >= 0;
      var back = t.length >= 14 && nq.indexOf(t) >= 0;
      if (!fwd && !back) continue;
      if (UNFINISHED.test(v)) return { key: 'answers', value: null, source: q, why: 'إجابتك فيها فراغ لم تملأه' };
      return { key: 'answers', value: v, source: q };
    }
    if (blocked) return blocked;
    return key ? { key: key, value: null, source: key, why: 'لم تكتب هذه البيانات في ملفك' } : null;
  }

  return { norm: norm, matchKey: matchKey, answerFor: answerFor };
})();
