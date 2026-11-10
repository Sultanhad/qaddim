// Fills the employer's form from your profile, inside your own browser, and — if you turned that on
// and nothing was left unanswered — presses submit.
//
// Why this runs as an extension rather than an automated browser: a CAPTCHA does not check your
// click, it checks the browser. A driven browser fails that check even when a human clicks the box.
// Your own Chrome passes it the way it always does, because it *is* your own Chrome.
//
// It never invents an answer. An unanswered required question stops the submission and tells you which.

(function () {
  const F = QaddimFields;
  const CAPTCHA_SEL = [
    'iframe[src*="challenges.cloudflare.com"]', '.cf-turnstile', '[class*="turnstile" i]',
    'input[name="cf-turnstile-response"]', 'iframe[src*="recaptcha"]', '.g-recaptcha',
    'iframe[src*="hcaptcha"]', 'iframe[title*="challenge" i]'
  ];
  // Ordered from most specific to least. Greenhouse puts an "Apply" button at the top of the
  // page that scrolls to the form, and a "Submit application" at the bottom that sends it —
  // matching "apply" first meant the robot clicked the scroll button for ever and reported
  // the form as unsent.
  const SUBMIT_PATTERNS = [
    /^\s*(submit application|submit my application|send application|إرسال الطلب)\s*$/i,
    /^\s*(submit|send|إرسال)\s*$/i,
    /^\s*(apply|تقديم)\s*$/i
  ];
  const OPEN_RE = /^\s*(apply for this job|apply now|apply|i am interested|i'?m interested|تقديم|قدّم الآن)\s*$/i;

  const { visible, txt, labelOf } = QaddimRead;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** React and friends ignore a plain value assignment; this makes the framework notice. */
  function setValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /** Hidden inputs behind styled controls only respond to their label. */
  function check(el) {
    if (el.checked) return true;
    el.click();
    if (el.checked) return true;
    const lab = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label');
    if (lab) { lab.click(); if (el.checked) return true; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!el.checked;
  }

  const yesNo = (v) => {
    const s = F.norm(v);
    if (['yes', 'y', 'true', 'نعم'].indexOf(s) >= 0) return true;
    if (['no', 'n', 'false', 'لا'].indexOf(s) >= 0) return false;
    return null;
  };

  /**
   * Which of the offered options is your answer — or none of them.
   *
   * It used to take the first option that *contained* the answer, and "Female" contains
   * "Male". An option now has to be the answer, word for word, in one of the ways the answer
   * can be said; failing that, exactly one option may contain it as whole words. Two
   * candidates is not a match, it is a question for the person.
   */
  function choose(options, ans) {
    const accept = ans.accept && ans.accept.length ? ans.accept : [F.norm(ans.value)];
    const named = options.map((o) => ({ node: o.node, t: F.norm(o.text) })).filter((o) => o.t);
    const exact = named.find((o) => accept.indexOf(o.t) >= 0);
    if (exact) return exact.node;
    const yn = yesNo(ans.value);
    if (yn !== null) {
      const word = named.find((o) => o.t === (yn ? 'yes' : 'no'));
      if (word) return word.node;
    }
    const within = named.filter((o) => accept.some((a) => a.length >= 4 && (' ' + o.t + ' ').indexOf(' ' + a + ' ') >= 0));
    return within.length === 1 ? within[0].node : null;
  }

  // ── styled dropdowns ───────────────────────────────────────────────────────
  // Greenhouse's newer boards and Workable do not use <select>. Each builds a text box that
  // opens a list when pressed, and typing an answer into that box only filters the list — it
  // chooses nothing, so the form's own validation refused every one of them.
  const mouse = (node, type) =>
    node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0 }));

  function listOf(el) {
    const LIST = '[role=listbox], [class*="select__menu"]';
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    let box = id && document.getElementById(id);
    // No id to follow: the list is rendered beside the box, a few wrappers up — or, when the
    // page hangs its menus off <body>, nowhere near it, and it is simply the one that is open.
    for (let up = el, i = 0; !box && i < 7 && up.parentElement; i++) {
      up = up.parentElement;
      box = up.querySelector(LIST);
    }
    box = box || Array.from(document.querySelectorAll(LIST)).find(visible);
    return box ? Array.from(box.querySelectorAll('[role=option], [class*="select__option"]')) : [];
  }

  /** What the dropdown currently shows as chosen, if anything. */
  function chosenIn(el) {
    const shell = el.closest('.select__control') || el.closest('[data-ui]') || el.parentElement;
    const single = shell && shell.querySelector('[class*="single-value" i]');
    if (single && txt(single.textContent)) return txt(single.textContent);
    return el.readOnly ? txt(el.value) : '';
  }

  /** @returns null when the option was chosen and the dropdown shows it, else why not. */
  async function pickFrom(el, ans) {
    const control = el.closest('.select__control') || el;
    mouse(control, 'mousedown'); el.focus(); mouse(control, 'mouseup'); mouse(control, 'click');
    let options = [];
    for (let i = 0; i < 20 && !options.length; i++) { await sleep(100); options = listOf(el); }
    const shut = () => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); el.blur(); };
    if (!options.length) { shut(); return 'القائمة لم تفتح — اختر بنفسك'; }
    const opt = choose(options.map((o) => ({ node: o, text: o.textContent })), ans);
    if (!opt) { shut(); return 'إجابتك ليست من الخيارات المعروضة'; }
    mouse(opt, 'mousedown'); mouse(opt, 'mouseup'); opt.click();
    await sleep(250);
    return chosenIn(el) ? null : 'الخيار لم يستجب للضغط';
  }

  function captchaPresent() {
    return CAPTCHA_SEL.some((s) => document.querySelector(s));
  }

  async function openFormIfNeeded() {
    if (document.querySelectorAll('input:not([type=hidden]), textarea').length >= 3) return;
    const btn = Array.from(document.querySelectorAll('button, a[role=button]'))
      .find((b) => OPEN_RE.test(txt(b.textContent)) && visible(b));
    if (!btn) return;
    btn.click();
    // SmartRecruiters' "I'm interested" navigates to a separate application page rather than
    // revealing a form in place; waiting a fixed moment lands on a half-loaded document.
    const before = location.href;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fields = document.querySelectorAll('input:not([type=hidden]), textarea').length;
      if (fields >= 3 && document.readyState === 'complete') break;
      if (location.href !== before && document.readyState === 'complete') break;
    }
  }

  /** @param ctx what is known about the job itself — see QaddimFields.answerFor. */
  async function fill(profile, ctx) {
    const report = { filled: [], agreed: [], missing: [], skipped: [], captcha: false };
    await openFormIfNeeded();

    for (const item of QaddimRead.questions()) {
      const { kind, el, q, required: req } = item;
      const leave = (why) => (req ? report.missing : report.skipped).push({ q, why });

      if (kind === 'checks') {
        if (!req || item.els.some((c) => c.checked)) continue;
        // A required checkbox is usually "I agree to the privacy policy". But a required
        // *group* of checkboxes is a question — "which of these apply to you?" — and ticking
        // one of those is claiming something about yourself that you never said. Only a lone
        // box whose own words are a consent sentence gets ticked.
        const consent = /agree|consent|accept|acknowledge|confirm|privacy|terms|policy|gdpr|أوافق|أقر|الموافقة|الخصوصية|الشروط/i.test(q);
        if (item.els.length > 1 || !consent) {
          report.missing.push({ q, why: item.els.length > 1 ? 'سؤال خيارات إلزامي — اختر بنفسك' : 'مربع إلزامي ليس إقراراً — راجعه بنفسك' });
        } else if (check(el)) report.agreed.push(q);
        else report.missing.push({ q, why: 'مربع إلزامي لم يستجب' });
        continue;
      }

      if (kind === 'file') {
        // A file input cannot be *typed* into, but it can be given a real File through
        // DataTransfer — the same object a drag-and-drop produces. The page cannot tell the
        // difference, and nothing is fabricated: these are the bytes the user uploaded.
        const wantsCv = /resume|cv|curriculum|السيرة|سيرة/i.test(q);
        const wantsCover = /cover letter|motivation/i.test(q);
        if (!(wantsCv || wantsCover) || el.files.length) continue;
        if (!profile.cv_file) {
          report.missing.push({ q, why: wantsCv ? 'سيرتك غير محمّلة — افتح المنصة مرة لمزامنتها' : 'لا خطاب تقديم في ملفك' });
          continue;
        }
        if (!wantsCv) continue;
        try {
          const bin = atob(profile.cv_file.b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const file = new File([bytes], profile.cv_file.name, { type: profile.cv_file.type || 'application/pdf' });
          const dt = new DataTransfer();
          dt.items.add(file);
          el.files = dt.files;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (el.files.length === 1) report.filled.push({ q, v: profile.cv_file.name });
          else report.missing.push({ q, why: 'الصفحة رفضت المرفق — أرفق سيرتك بنفسك' });
        } catch (e) {
          report.missing.push({ q, why: 'تعذّر إرفاق سيرتك — أرفقها بنفسك' });
        }
        continue;
      }

      // the site, or an earlier pass, already answered it
      if (kind === 'radio' ? item.els.some((r) => r.checked)
        : kind === 'combo' ? chosenIn(el)
          : el.value && String(el.value).trim() !== '') continue;

      const ans = F.answerFor(q, profile, ctx);
      if (!ans || !ans.value) { leave(ans?.why || 'لا إجابة عندك لهذا السؤال'); continue; }

      if (kind === 'radio') {
        const pick = choose(item.els.map((r) => ({ node: r, text: labelOf(r) })), ans);
        if (!pick) leave('إجابتك ليست من الخيارات المعروضة');
        else if (check(pick)) report.filled.push({ q, v: ans.value });
        else leave('الخيار لم يستجب للضغط');
        continue;
      }
      if (kind === 'select') {
        const opt = choose(Array.from(el.options).map((o) => ({ node: o, text: o.textContent })), ans);
        if (!opt) { leave('إجابتك ليست في القائمة'); continue; }
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        report.filled.push({ q, v: ans.value });
        continue;
      }
      if (kind === 'combo') {
        const failed = await pickFrom(el, ans);
        if (failed) leave(failed); else report.filled.push({ q, v: ans.value });
        continue;
      }

      let value = ans.text || ans.value;
      if (ans.key === 'date_of_birth') {
        value = F.dateFor(ans.value, q, item.type);
        if (!value) { leave('الاستمارة لا تحدد صيغة التاريخ — اكتبه بنفسك'); continue; }
      }
      setValue(el, value);
      report.filled.push({ q, v: value });
    }

    await new Promise((r) => setTimeout(r, 800));
    report.captcha = captchaPresent();
    return report;
  }

  function submitButton() {
    const buttons = Array.from(document.querySelectorAll('button, input[type=submit]')).filter(visible);
    // Prefer a real submit control inside the form that holds the fields, then fall back to
    // any button whose words match — most specific wording first.
    const form = document.querySelector('form input:not([type=hidden])')?.closest('form');
    for (const re of SUBMIT_PATTERNS) {
      const inForm = form && buttons.find((b) => form.contains(b) && re.test(txt(b.textContent || b.value)));
      if (inForm) return inForm;
    }
    for (const re of SUBMIT_PATTERNS) {
      const any = buttons.find((b) => re.test(txt(b.textContent || b.value)));
      if (any) return any;
    }
    return null;
  }

  async function waitForOutcome(timeoutMs = 60000) {
    const DONE = /thank you|thanks for applying|application (was )?(received|submitted|sent)|we (have )?received|successfully (applied|submitted)|تم (استلام|إرسال|التقديم)/i;
    const BUSY = /submitting|sending|please wait|uploading|جار/i;
    const FAIL = /is required|please (fix|correct|complete)|something went wrong/i;
    const start = location.href;
    const until = Date.now() + timeoutMs;
    let wasBusy = false;
    while (Date.now() < until) {
      const t = document.body ? document.body.innerText : '';
      if (DONE.test(t)) return { ok: true, why: 'الموقع أكّد الاستلام' };
      if (location.href !== start && !BUSY.test(t)) return { ok: true, why: 'الصفحة انتقلت بعد الإرسال' };
      const busy = BUSY.test(t);
      if (wasBusy && !busy) {
        if (FAIL.test(t)) return { ok: false, why: 'الاستمارة رجعت بخطأ' };
        return { ok: true, why: 'انتهى الإرسال' };
      }
      wasBusy = busy;
      await new Promise((r) => setTimeout(r, 1200));
    }
    return { ok: false, why: 'ما زال يعالج بعد ٦٠ ثانية' };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'qaddim:apply') return;
    (async () => {
      const report = await fill(msg.profile, msg.job || null);
      if (report.missing.length) {
        reply({ status: 'needs_you', report, reason: 'أسئلة إلزامية بلا إجابة منك' });
        return;
      }
      if (!msg.autoSubmit) { reply({ status: 'filled', report }); return; }
      const btn = submitButton();
      if (!btn) { reply({ status: 'needs_you', report, reason: 'لم أجد زر الإرسال' }); return; }
      btn.click();
      const outcome = await waitForOutcome();
      reply({ status: outcome.ok ? 'submitted' : 'needs_you', report, reason: outcome.why });
    })();
    return true;   // keep the channel open for the async reply
  });
})();
