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

  async function openList(el) {
    const control = el.closest('.select__control') || el;
    mouse(control, 'mousedown'); el.focus(); mouse(control, 'mouseup'); mouse(control, 'click');
    let options = [];
    for (let i = 0; i < 20 && !options.length; i++) { await sleep(100); options = listOf(el); }
    return options;
  }
  const shutList = (el) => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); el.blur(); };

  /** Typing into a search box: the value and one input event, nothing that reads as leaving the field. */
  function typeInto(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /**
   * Which of a location search's results is where you live: your city as the place itself —
   * "Riyadh, …", not "Riyadh Al Khabra, …" — and in your country. Search results come best
   * match first, so among several that fit, the first is taken; with none that fit, nothing is.
   */
  const PLACE = { city: 1, location: 1 };
  function choosePlace(options, profile) {
    const city = F.norm(profile.city), country = F.norm(profile.country);
    if (!city) return null;
    const named = options.map((o) => ({ node: o.node, head: F.norm(String(o.text).split(',')[0]), all: ' ' + F.norm(o.text) + ' ' }));
    const here = (o) => !country || o.all.indexOf(' ' + country + ' ') >= 0;
    const exact = named.filter((o) => o.head === city && here(o));
    if (exact.length) return exact[0].node;
    const loose = named.filter((o) => o.all.indexOf(' ' + city + ' ') === 0 && country && here(o));
    return loose.length === 1 ? loose[0].node : null;
  }

  /** @returns {{why?:string, manual?:boolean, options?:string[]}} — empty when the option was chosen. */
  async function pickFrom(el, ans, profile) {
    let options = await openList(el);
    let searched = '';
    if (!options.length && !el.readOnly && el.getAttribute('aria-autocomplete') === 'list') {
      // A search box rather than a list: it has nothing to show until it is given something
      // to look for. Greenhouse's "Location (City)" is one, and it stopped every form it was
      // on — including one where it was the only thing left unanswered.
      searched = String(PLACE[ans.key] ? profile.city || ans.value : ans.text || ans.value).split(',')[0].trim();
      typeInto(el, searched);
      for (let i = 0; i < 40 && !options.length; i++) { await sleep(150); options = listOf(el); }
    }
    const giveUp = () => { if (searched) typeInto(el, ''); shutList(el); };
    if (!options.length) {
      giveUp();
      return { why: searched ? `البحث عن «${searched}» لم يعرض شيئاً — اختر بنفسك` : 'القائمة لم تفتح — اختر بنفسك', manual: true };
    }
    const listed = options.map((o) => ({ node: o, text: o.textContent }));
    const opt = (searched && PLACE[ans.key] && choosePlace(listed, profile)) || choose(listed, ans);
    if (!opt) { giveUp(); return { why: 'إجابتك ليست من الخيارات المعروضة', options: offer(listed.map((o) => o.text)) }; }
    mouse(opt, 'mousedown'); mouse(opt, 'mouseup'); opt.click();
    await sleep(250);
    return chosenIn(el) ? {} : { why: 'الخيار لم يستجب للضغط', manual: true };
  }

  // What a question offers, for the draft screen: answering with the form's own words is the
  // one way to be sure the answer fits next time. A list too long to show (every country on
  // earth) is left out, and the person types instead.
  const offer = (texts) => {
    const list = texts.map(txt).filter(Boolean);
    return list.length && list.length <= 40 ? list.map((t) => t.slice(0, 120)) : undefined;
  };
  async function optionsOf(item) {
    if (item.kind === 'radio') return offer(item.els.map((r) => labelOf(r)));
    if (item.kind === 'select') return offer(Array.from(item.el.options).filter((o) => o.value !== '').map((o) => o.textContent));
    if (item.kind === 'combo') {
      const options = await openList(item.el);
      shutList(item.el);
      return offer(options.map((o) => o.textContent));
    }
    return undefined;
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
      // `manual` marks what no answer typed into قدّم can settle — it has to be done on the page.
      const leave = (why, more) => (req ? report.missing : report.skipped).push({ q, why, kind, ...more });

      if (kind === 'checks') {
        if (!req || item.els.some((c) => c.checked)) continue;
        // A required checkbox is usually "I agree to the privacy policy". But a required
        // *group* of checkboxes is a question — "which of these apply to you?" — and ticking
        // one of those is claiming something about yourself that you never said. Only a lone
        // box whose own words are a consent sentence gets ticked.
        const consent = /agree|consent|accept|acknowledge|confirm|privacy|terms|policy|gdpr|أوافق|أقر|الموافقة|الخصوصية|الشروط/i.test(q);
        if (item.els.length > 1 || !consent) {
          leave(item.els.length > 1 ? 'سؤال خيارات إلزامي — اختر بنفسك' : 'مربع إلزامي ليس إقراراً — راجعه بنفسك', { manual: true });
        } else if (check(el)) report.agreed.push(q);
        else leave('مربع إلزامي لم يستجب', { manual: true });
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
          report.missing.push({ q, kind, manual: true, why: wantsCv ? 'سيرتك غير محمّلة — افتح المنصة مرة لمزامنتها' : 'لا خطاب تقديم في ملفك' });
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
          else report.missing.push({ q, kind, manual: true, why: 'الصفحة رفضت المرفق — أرفق سيرتك بنفسك' });
        } catch (e) {
          report.missing.push({ q, kind, manual: true, why: 'تعذّر إرفاق سيرتك — أرفقها بنفسك' });
        }
        continue;
      }

      // the site, or an earlier pass, already answered it
      if (kind === 'radio' ? item.els.some((r) => r.checked)
        : kind === 'combo' ? chosenIn(el)
          : el.value && String(el.value).trim() !== '') continue;

      const ans = F.answerFor(q, profile, { ...ctx, type: item.type });
      if (!ans || !ans.value) {
        // Opening a list just to read it is only worth doing for a question that stops the
        // form. `key` tells the draft screen what kind of question this was, where known.
        leave(ans?.why || 'لا إجابة عندك لهذا السؤال',
          // `scope: 'job'` — an answer here holds for this job only (it depends on the country).
          !req ? null : { key: ans?.key, ...(ans?.scope ? { scope: ans.scope } : {}), options: await optionsOf(item) });
        continue;
      }

      // What went into the form, and whether it was an estimate rather than the person's own
      // answer — the record of what was said in their name has to be able to tell the two apart.
      const done = (v) => report.filled.push(ans.source === 'estimate' ? { q, v, by: 'estimate' } : { q, v });

      if (kind === 'radio') {
        const pick = choose(item.els.map((r) => ({ node: r, text: labelOf(r) })), ans);
        if (!pick) leave('إجابتك ليست من الخيارات المعروضة', { options: await optionsOf(item) });
        else if (check(pick)) done(ans.value);
        else leave('الخيار لم يستجب للضغط', { manual: true });
        continue;
      }
      if (kind === 'select') {
        const opt = choose(Array.from(el.options).map((o) => ({ node: o, text: o.textContent })), ans);
        if (!opt) { leave('إجابتك ليست في القائمة', { options: await optionsOf(item) }); continue; }
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        done(ans.value);
        continue;
      }
      if (kind === 'combo') {
        const failed = await pickFrom(el, ans, profile);
        if (failed.why) leave(failed.why, failed); else done(ans.value);
        continue;
      }

      const value = ans.text || ans.value;
      setValue(el, value);
      done(value);
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
