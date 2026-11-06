// Fills the employer's form from your profile, inside your own browser, and — if you turned that on
// and nothing was left unanswered — presses submit.
//
// Why this runs as an extension rather than an automated browser: a CAPTCHA does not check your
// click, it checks the browser. A driven browser fails that check even when a human clicks the box.
// Your own Chrome passes it the way it always does, because it *is* your own Chrome.
//
// It never invents an answer. An unanswered required question stops the submission and tells you which.

(function () {
  const F = FursaFields;
  const CAPTCHA_SEL = [
    'iframe[src*="challenges.cloudflare.com"]', '.cf-turnstile', '[class*="turnstile" i]',
    'input[name="cf-turnstile-response"]', 'iframe[src*="recaptcha"]', '.g-recaptcha',
    'iframe[src*="hcaptcha"]', 'iframe[title*="challenge" i]'
  ];
  const SUBMIT_RE = /^\s*(submit application|submit my application|send application|submit|apply|إرسال الطلب|إرسال)\s*$/i;
  const OPEN_RE = /^\s*(apply for this job|apply now|apply|i am interested|تقديم)\s*$/i;

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
    if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 2500)); }
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
          if (check(el)) report.agreed.push(q);
          else report.missing.push({ q, why: 'مربع إلزامي لم يستجب' });
        }
        continue;
      }
      if (type === 'file') {
        // A CV has to be attached by you: an extension cannot put a file into a file input.
        const wantsCv = /resume|cv|curriculum|السيرة/i.test(q);
        if (wantsCv && el.files.length === 0) report.missing.push({ q, why: 'أرفق سيرتك يدوياً — المتصفح لا يسمح بذلك آلياً' });
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
    return Array.from(document.querySelectorAll('button, input[type=submit]'))
      .find((b) => SUBMIT_RE.test(txt(b.textContent || b.value)) && visible(b));
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
