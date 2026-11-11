// Maps a form field's visible label to one of YOUR answers.
//
// The one rule: it only ever returns something you wrote yourself. No defaults, no "sensible value".
// An unmatched required field is a blocker, and the extension stops rather than inventing anything.
//
// Plain script (no modules) because content scripts share one global scope.

var QaddimFields = (function () {
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
    // "name" alone is dangerous: forms ask for the name of a relative who works here, a
    // referrer, an emergency contact. Answering those with your own name states a fact about
    // you that you never stated — and the point of this file is that it never does that.
    { key: 'full_name', any: ['full name', 'your name', 'name', 'الاسم'],
      not: ['company', 'employer', 'school', 'university', 'reference', 'referral', 'referred',
            'file', 'user', 'relative', 'friend', 'family member', 'spouse', 'guardian',
            'emergency', 'contact person', 'manager', 'supervisor', 'recruiter', 'colleague',
            'قريب', 'صديق', 'معرف', 'الطوارئ', 'مرجع'] },
    { key: 'email_for_applications', any: ['email', 'e mail', 'البريد'], not: ['relative','friend','emergency','reference','referral','manager','company','الطوارئ','قريب'] },
    { key: 'phone', any: ['phone', 'mobile', 'telephone', 'جوال', 'هاتف'], not: ['relative','friend','emergency','reference','referral','manager','company','country code','dial','الطوارئ','قريب'] },
    { key: 'linkedin_url', any: ['linkedin'] },
    { key: 'current_company', any: ['current company', 'current employer', 'present employer', 'most recent employer', 'most recent company'] },
    { key: 'current_title', any: ['current title', 'current position', 'current job title', 'most recent title', 'most recent job title', 'most recent position'] },
    { key: 'years_experience', any: ['years of experience', 'years experience', 'total experience', 'سنوات الخبرة'] },
    { key: 'salary_expectation', any: ['salary expectation', 'expected salary', 'desired salary', 'salary requirement', 'الراتب المتوقع'] },
    { key: 'current_salary', any: ['current salary', 'present salary', 'الراتب الحالي'] },
    { key: 'notice_period', any: ['notice period', 'when can you start', 'start date', 'availability', 'فترة الإشعار'] },
    // Asked as a yes/no, not as "what is your nationality" — the answer follows from it.
    { key: 'saudi_national', any: ['saudi national', 'saudi citizen', 'are you saudi', 'هل أنت سعودي'] },
    { key: 'nationality', any: ['nationality', 'citizenship', 'الجنسية'] },
    { key: 'date_of_birth', any: ['date of birth', 'birth date', 'birthdate', 'dob', 'تاريخ الميلاد'] },
    // "Sex" also begins "sexual orientation", and a gender question is not an identity
    // questionnaire: those are the reader's to answer, never ours.
    { key: 'gender', any: ['gender', 'sex', 'الجنس'], not: ['sexual', 'orientation', 'identity', 'identify', 'pronoun', 'transgender', 'الجنسية'] },
    { key: 'marital_status', any: ['marital status', 'الحالة الاجتماعية'] },
    { key: 'requires_sponsorship', any: ['sponsorship', 'require a visa', 'need a visa', 'visa support'] },
    { key: 'work_authorization', any: ['work authorization', 'authorized to work', 'legally authorized', 'right to work', 'eligible to work', 'iqama', 'الإقامة'] },
    // Where you live, not where you are from: "home country", "country of birth" and the
    // dialling code beside a phone box are different questions with different answers.
    { key: 'country', any: ['country of residence', 'current country', 'where do you currently live', 'country', 'الدولة'],
      not: ['home country', 'birth', 'citizenship', 'nationality', 'origin', 'passport', 'code', 'phone', 'countries', 'which country'] },
    { key: 'city', any: ['city', 'town', 'المدينة'] },
    { key: 'location', any: ['location', 'address', 'where are you based', 'العنوان'] },
    { key: 'education_degree', any: ['degree', 'education level', 'level of education', 'highest education', 'highest qualification', 'المؤهل'] },
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

  function matchAmong(label, keys) {
    var t = ' ' + norm(label) + ' ';
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i];
      if (!keys[r.key]) continue;
      for (var j = 0; j < r.any.length; j++) if (t.indexOf(' ' + norm(r.any[j])) >= 0) return r.key;
    }
    return null;
  }

  // A long compound question ("how many years in PM, and how many in B2B SaaS?") is not answered
  // by a short stored key. Only something you wrote for that question counts.
  var SHORT_LIMIT = 70;
  // Two questions are long by nature and still one question: "Will you now or in the future
  // require employer sponsorship to work in the country where this role is based?" is asked in
  // a dozen wordings, all over seventy characters, and it stopped more forms than any other.
  var LONG_LIMIT = 240;
  var LONG_OK = { requires_sponsorship: 1, work_authorization: 1 };

  /** A label that swallowed its own help text: "Current location ✱No location found. Try…". */
  function headOf(label) {
    var parts = String(label).split(/[✱*]/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); });
    for (var i = 0; i < parts.length; i++) if (parts[i].length >= 3) return parts[i];
    return '';
  }

  function keyFor(label) {
    var t = norm(label);
    if (t.length <= SHORT_LIMIT) return matchKey(label);
    var head = headOf(label);
    if (head && norm(head).length <= SHORT_LIMIT && norm(head) !== t) { var k = matchKey(head); if (k) return k; }
    return t.length <= LONG_LIMIT ? matchAmong(label, LONG_OK) : null;
  }

  // ── your words, in the form's language ─────────────────────────────────────
  // The profile is written in Arabic and its choices are Arabic words; the forms are in
  // English. "بكالوريوس" is not an option in a list that offers "Bachelor's Degree", and
  // typing "شهر" into "Notice period" tells a recruiter nothing. Each entry is the same
  // answer said in English: the first is what gets typed, all of them are accepted when
  // choosing from a list. Nothing here is a new fact — only a translation of one you gave.
  var SAYS = {
    'ثانوية': ['High school', 'High school diploma', 'Secondary', 'Secondary school'],
    'دبلوم': ['Diploma', 'Associate degree', 'Associate', "Associate's degree"],
    'بكالوريوس': ["Bachelor's degree", 'Bachelor', 'Bachelors', "Bachelor's", 'Bachelor degree', 'BSc', 'BA', 'Undergraduate'],
    'ماجستير': ["Master's degree", 'Master', 'Masters', "Master's", 'Master degree', 'MSc', 'MBA', 'Postgraduate'],
    'دكتوراه': ['Doctorate', 'PhD', 'Doctoral degree', 'Doctor of Philosophy'],
    'فوراً': ['Immediately', 'Immediate', 'No notice', 'None', 'Available now'],
    'أسبوعان': ['2 weeks', 'Two weeks', '14 days'],
    'شهر': ['1 month', 'One month', '30 days', '4 weeks'],
    'شهران': ['2 months', 'Two months', '60 days'],
    'ثلاثة أشهر': ['3 months', 'Three months', '90 days'],
    'ذكر': ['Male', 'Man'], 'أنثى': ['Female', 'Woman'],
    'أعزب': ['Single', 'Never married', 'Unmarried'], 'عزباء': ['Single', 'Never married', 'Unmarried'],
    'متزوج': ['Married'], 'متزوجة': ['Married'],
    'مطلّق': ['Divorced'], 'مطلّقة': ['Divorced'], 'أرمل': ['Widowed'], 'أرملة': ['Widowed'],
    'سعودي': ['Saudi', 'Saudi Arabian', 'Saudi Arabia', 'KSA'], 'سعودية': ['Saudi', 'Saudi Arabian', 'Saudi Arabia', 'KSA'],
    'إماراتي': ['Emirati', 'United Arab Emirates', 'UAE'], 'مصري': ['Egyptian', 'Egypt'],
    'أردني': ['Jordanian', 'Jordan'], 'كويتي': ['Kuwaiti', 'Kuwait'], 'بحريني': ['Bahraini', 'Bahrain'],
    'قطري': ['Qatari', 'Qatar'], 'عماني': ['Omani', 'Oman'], 'يمني': ['Yemeni', 'Yemen'],
    'سوري': ['Syrian', 'Syria'], 'لبناني': ['Lebanese', 'Lebanon'], 'سوداني': ['Sudanese', 'Sudan'],
    'فلسطيني': ['Palestinian', 'Palestine'], 'هندي': ['Indian', 'India'], 'باكستاني': ['Pakistani', 'Pakistan'],
    'Saudi Arabia': ['Saudi Arabia', 'Kingdom of Saudi Arabia', 'KSA', 'Saudi Arabia (KSA)'],
    'United Arab Emirates': ['United Arab Emirates', 'UAE', 'United Arab Emirates (UAE)'],
    'Egypt': ['Egypt'], 'Jordan': ['Jordan'], 'Kuwait': ['Kuwait'], 'Bahrain': ['Bahrain'],
    'Qatar': ['Qatar'], 'Oman': ['Oman']
  };
  var SAYS_N = {};
  Object.keys(SAYS).forEach(function (k) { SAYS_N[norm(k)] = SAYS[k]; });
  var ARABIC = /[\u0600-\u06FF]/;

  /** @returns {{typed:string, accept:string[]}} how this answer reads on this form. */
  function wording(value, label) {
    var said = SAYS_N[norm(value)];
    var accept = [norm(value)];
    if (said) said.forEach(function (x) { var n = norm(x); if (accept.indexOf(n) < 0) accept.push(n); });
    // An Arabic form gets the answer as it was written.
    return { typed: said && !ARABIC.test(label) ? said[0] : value, accept: accept };
  }

  /**
   * Sponsorship and the right to work depend on where the job is, and the profile records
   * one thing only: your standing in Saudi Arabia. For a job there, that is an answer. For a
   * job anywhere else it is not — and "no sponsorship needed" used to be sent regardless,
   * to Dubai and Cairo alike, on behalf of people who had never been asked.
   */
  function workFact(key, profile, ctx) {
    var status = String(profile.work_authorization || '').trim();
    if (!status) return { value: null, why: 'لم تكتب وضعك النظامي للعمل في ملفك' };
    if (!ctx || ctx.country !== 'sa') return { value: null, why: 'يعتمد على بلد الوظيفة، وملفك يصف وضعك في السعودية فقط' };
    var sponsor = key === 'requires_sponsorship';
    if (status === 'مواطن') return { value: sponsor ? 'no' : 'yes', text: 'Saudi citizen' };
    if (status === 'أحتاج تأشيرة عمل') return { value: sponsor ? 'yes' : 'no', text: 'Requires a work visa' };
    return { value: null, why: 'الإقامة يختلف جوابها من صاحب عمل لآخر — أجب بنفسك' };
  }

  /**
   * A date in the shape the form asks for. A form that does not say which shape gets no
   * answer: 03/04/1995 is two different birthdays, and guessing between them is inventing one.
   */
  function dateFor(iso, label, inputType) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    if (inputType === 'date') return m[0];
    var hint = /(dd|mm|yyyy)\s*([\/.\-])\s*(dd|mm|yyyy)\s*\2\s*(dd|mm|yyyy)/i.exec(label);
    if (!hint) return null;
    var part = { dd: m[3], mm: m[2], yyyy: m[1] };
    return [hint[1], hint[3], hint[4]].map(function (p) { return part[p.toLowerCase()]; }).join(hint[2]);
  }
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

  // ── questions about this employer ──────────────────────────────────────────
  // "Have you worked here before?" and "do you have relatives here?" were, measured across our
  // open jobs, the two questions that stopped the most forms — and no profile field can answer
  // them, because they are about the company, not about you. What a person *can* say once is
  // their usual answer: no. It is only ever used when they have said so, and only when the
  // question is plainly about the employer: "have you worked with Kubernetes before?" has the
  // same shape and a different subject, so the company's own name (or "us", "this company")
  // has to be in the question.
  var HERE = ['this company', 'our company', 'the company', 'with us', 'for us', 'our organization',
    'this organization', 'our group', 'our team'];
  function aboutEmployer(t, ctx) {
    var padded = ' ' + t + ' ';
    for (var i = 0; i < HERE.length; i++) if (padded.indexOf(' ' + HERE[i] + ' ') >= 0) return true;
    var name = norm(ctx && ctx.company);
    if (!name) return false;
    if (padded.indexOf(' ' + name) >= 0) return true;
    var first = name.split(' ')[0];
    return first.length >= 5 && padded.indexOf(' ' + first) >= 0;
  }
  var WORKED = /\b(previously|ever|before|formerly|in the past)\b.{0,60}\b(work|employ)|\b(work|employ)\w*\b.{0,80}\b(before|previously|in the past)\b|current or former .{0,40}employee|\bformer employee\b/;
  var RELATIVE = /\b(relatives?|family members?|related to)\b|أقارب|قريب/;
  function standingKey(t, ctx) {
    if (t.length > LONG_LIMIT) return null;
    if (RELATIVE.test(t) && (aboutEmployer(t, ctx) || /\bemployees?\b|\bworking\b/.test(t))) return 'relatives_here';
    if (WORKED.test(t) && aboutEmployer(t, ctx)) return 'worked_here_before';
    return null;
  }

  /**
   * @param ctx  what is known beyond the label: the job's `country` (ISO code) and `company`,
   *             and the control's input `type`.
   * @returns {{key,value,accept,source,why}|null} — value null means "cannot answer this honestly".
   */
  function answerFor(label, profile, ctx) {
    var t = norm(label);
    var extra = profile.answers || {};

    // What you wrote for this very question outranks everything else: it is the only answer
    // here that was given to these exact words. Without this, an answer picked in the draft
    // screen lost to the profile field that had failed to fit the form in the first place —
    // and a question shorter than ten characters could be answered for ever and never matched.
    for (var own in extra) {
      if (own.charAt(0) === '_' || norm(own) !== t) continue;
      var mine = String(extra[own] || '').trim();
      if (!mine) continue;
      if (UNFINISHED.test(mine)) return { key: 'answers', value: null, source: own, why: 'إجابتك فيها فراغ لم تملأه' };
      return { key: 'answers', value: mine, accept: wording(mine, label).accept, source: own };
    }

    var standing = standingKey(t, ctx);
    var key = standing || keyFor(label);
    var blocked = null;

    if (standing) {
      if (profile[standing] === 'no') return { key: standing, value: 'no', accept: ['no'], source: standing };
      blocked = { key: standing, value: null, source: standing, why: 'سؤال عن هذه الشركة — أجبه هنا، أو ضع جوابك المعتاد في ملفك' };
    } else if (key && LONG_OK[key]) {
      var fact = workFact(key, profile, ctx);
      if (fact.value) return { key: key, value: fact.value, text: fact.text, accept: [norm(fact.value)], source: 'work_authorization' };
      blocked = { key: key, value: null, source: 'work_authorization', why: fact.why };
    } else if (key && profile[key] != null && String(profile[key]).trim() !== '') {
      var value = String(profile[key]).trim();
      var asked = currencyOf(label), held = currencyOf(value);
      if ((key === 'salary_expectation' || key === 'current_salary') && asked && held && asked !== held) {
        blocked = { key: key, value: null, source: key, why: 'يسأل بـ' + asked.toUpperCase() + ' وإجابتك بـ' + held.toUpperCase() };
      } else if (UNFINISHED.test(value)) {
        blocked = { key: key, value: null, source: key, why: 'إجابتك فيها فراغ لم تملأه' };
      } else if (key === 'date_of_birth') {
        var shaped = dateFor(value, label, ctx && ctx.type);
        if (shaped) return { key: key, value: shaped, accept: [norm(shaped)], source: key };
        blocked = { key: key, value: null, source: key, why: 'الاستمارة لا تحدد صيغة التاريخ — اكتبه مرة كما تطلبه' };
      } else {
        var w = wording(value, label);
        return { key: key, value: w.typed, accept: w.accept, source: key };
      }
    }

    for (var q in extra) {
      if (q.charAt(0) === '_') continue;          // the profile's own facts, not a saved question
      var nq = norm(q), v = String(extra[q] || '').trim();
      if (!nq || !v) continue;
      var fwd = nq.length >= 10 && t.indexOf(nq) >= 0;
      var back = t.length >= 14 && nq.indexOf(t) >= 0;
      if (!fwd && !back) continue;
      if (UNFINISHED.test(v)) return { key: 'answers', value: null, source: q, why: 'إجابتك فيها فراغ لم تملأه' };
      return { key: 'answers', value: v, accept: wording(v, label).accept, source: q };
    }
    if (blocked) return blocked;
    return key ? { key: key, value: null, source: key, why: 'لم تكتب هذه البيانات في ملفك' } : null;
  }

  return { norm: norm, matchKey: matchKey, keyFor: keyFor, answerFor: answerFor, dateFor: dateFor, wording: wording };
})();
