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

  const visible = (el) => !!(el.offsetParent || el.getClientRects().length) && !el.disabled;
  const txt = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function labelOf(node) {
    const aria = node.getAttribute('aria-label');
    if (txt(aria)) return txt(aria);
    const by = node.getAttribute('aria-labelledby');
    if (by) {
      const parts = by.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => txt(e.textContent));
      if (parts.join(' ').trim()) return txt(parts.join(' '));
    }
    if (node.id) {
      const l = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
      if (l && txt(l.textContent)) return txt(l.textContent);
    }
    const own = node.closest('label');
    if (own && txt(own.textContent)) return txt(own.textContent);
    let cur = node;
    for (let i = 0; i < 4 && cur.parentElement; i++) {
      cur = cur.parentElement;
      const lbl = cur.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (lbl && txt(lbl.textContent)) return txt(lbl.textContent);
    }
    return txt(node.getAttribute('placeholder')) || txt(node.getAttribute('name'));
  }

  function groupQuestion(node) {
    const name = node.getAttribute('name') || '';
    const opts = name
      ? Array.from(document.querySelectorAll('input[type=radio][name="' + CSS.escape(name) + '"]'))
        .map((r) => txt((r.closest('label') || {}).textContent || r.value)).filter(Boolean)
      : [];
    const clean = (s) => {
      let t = txt(s);
      opts.forEach((o) => { if (o) t = t.split(o).join(' '); });
      return txt(t).replace(/^[*\s:]+/, '');
    };
    const fs = node.closest('fieldset');
    if (fs) { const lg = fs.querySelector('legend'); if (lg && txt(lg.textContent)) return clean(lg.textContent); }
    let cur = node;
    for (let i = 0; i < 7 && cur.parentElement; i++) {
      cur = cur.parentElement;
      const t = clean(cur.textContent);
      if (t.length > 8) return t;
    }
    return txt(name);
  }

  function isRequired(node) {
    if (node.required || node.getAttribute('aria-required') === 'true') return true;
    const wrap = node.closest('label, fieldset, [class*="field" i], [class*="question" i], div');
    const t = wrap ? String(wrap.textContent || '') : '';
    return /\*/.test(t) || /\brequired\b/i.test(t) || /مطلوب/.test(t);
  }

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

  async function fill(profile) {
    const report = { filled: [], agreed: [], missing: [], skipped: [], captcha: false };
    await openFormIfNeeded();

    // radio groups: one question, several controls
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (!visible(r)) continue;
      const n = r.getAttribute('name') || labelOf(r);
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(r);
    }
    for (const els of groups.values()) {
      const q = groupQuestion(els[0]);
      const req = isRequired(els[0]);
      const ans = F.answerFor(q, profile);
      if (!ans || !ans.value) { (req ? report.missing : report.skipped).push({ q, why: ans?.why || 'لا إجابة عندك لهذا السؤال' }); continue; }
      const yn = yesNo(ans.value);
      const pick = els.find((e) => {
        const t = F.norm(labelOf(e));
        return t === F.norm(ans.value) || (yn !== null && t === (yn ? 'yes' : 'no'));
      });
      if (!pick) { (req ? report.missing : report.skipped).push({ q, why: 'إجابتك ليست من الخيارات المعروضة' }); continue; }
      if (check(pick)) report.filled.push({ q, v: ans.value });
      else (req ? report.missing : report.skipped).push({ q, why: 'الخيار لم يستجب للضغط' });
    }

    for (const el of document.querySelectorAll('input:not([type=hidden]):not([type=radio]), textarea, select')) {
      if (!visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
      const q = labelOf(el);
      const req = isRequired(el);

      if (type === 'checkbox') {
        if (req && !el.checked) {
          // A required checkbox is usually "I agree to the privacy policy". But a required
          // *group* of checkboxes is a question — "which of these apply to you?" — and ticking
          // one of those is claiming something about yourself that you never said. Only a lone
          // box whose own words are a consent sentence gets ticked.
          const group = el.name
            ? document.querySelectorAll(`input[type=checkbox][name="${CSS.escape(el.name)}"]`).length
            : 1;
          const consent = /agree|consent|accept|acknowledge|confirm|privacy|terms|policy|gdpr|أوافق|أقر|الموافقة|الخصوصية|الشروط/i.test(q);
          if (group > 1 || !consent) {
            report.missing.push({ q, why: group > 1 ? 'سؤال خيارات إلزامي — اختر بنفسك' : 'مربع إلزامي ليس إقراراً — راجعه بنفسك' });
          } else if (check(el)) report.agreed.push(q);
          else report.missing.push({ q, why: 'مربع إلزامي لم يستجب' });
        }
        continue;
      }
      if (type === 'file') {
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
      if (el.value && String(el.value).trim() !== '') continue;  // the site already filled it

      const ans = F.answerFor(q, profile);
      if (!ans || !ans.value) { (req ? report.missing : report.skipped).push({ q, why: ans?.why || 'لا إجابة عندك لهذا السؤال' }); continue; }

      if (type === 'select' || type === 'select-one') {
        const want = F.norm(ans.value), yn = yesNo(ans.value);
        const opt = Array.from(el.options).find((o) => F.norm(o.textContent) === want)
          || (want.length > 1 ? Array.from(el.options).find((o) => F.norm(o.textContent).indexOf(want) >= 0) : null)
          || (yn !== null ? Array.from(el.options).find((o) => F.norm(o.textContent) === (yn ? 'yes' : 'no')) : null);
        if (!opt) { (req ? report.missing : report.skipped).push({ q, why: 'إجابتك ليست في القائمة' }); continue; }
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        report.filled.push({ q, v: ans.value });
        continue;
      }
      setValue(el, ans.value);
      report.filled.push({ q, v: ans.value });
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
      const report = await fill(msg.profile);
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
