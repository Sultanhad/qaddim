// Reads an employer's form into a list of questions — and changes nothing on the page.
//
// This used to live inside fill.js, woven through the code that types. It is its own file
// because two other things need to read a form without touching it: the measurement in
// scripts/measure-forms.mjs, and the draft screen that will show these questions before
// anything is sent. One reader, so what is measured is what gets filled.
//
// Plain script (no modules) because content scripts share one global scope.

var QaddimRead = (function () {
  function txt(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function visible(el) { return !!(el.offsetParent || el.getClientRects().length) && !el.disabled; }

  /**
   * An element's words, without its icons'. Workable puts "SVGs not supported by this
   * browser." inside every chevron, and that sentence was being read as the question.
   */
  function textOf(el) {
    if (!el) return '';
    if (!el.querySelector || !el.querySelector('svg')) return txt(el.textContent);
    var copy = el.cloneNode(true);
    copy.querySelectorAll('svg').forEach(function (s) { s.remove(); });
    return txt(copy.textContent);
  }

  function labelOf(node) {
    var aria = node.getAttribute('aria-label');
    if (txt(aria)) return txt(aria);
    var by = node.getAttribute('aria-labelledby');
    if (by) {
      var parts = by.split(/\s+/).map(function (id) { return document.getElementById(id); })
        .filter(Boolean).map(textOf);
      if (parts.join(' ').trim()) return txt(parts.join(' '));
    }
    if (node.id) {
      var l = document.querySelector('label[for="' + CSS.escape(node.id) + '"]');
      if (l && textOf(l)) return textOf(l);
    }
    var own = node.closest('label');
    if (own && textOf(own)) return textOf(own);
    var cur = node;
    for (var i = 0; i < 4 && cur.parentElement; i++) {
      cur = cur.parentElement;
      var lbl = cur.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (lbl && textOf(lbl)) return textOf(lbl);
    }
    return txt(node.getAttribute('placeholder')) || txt(node.getAttribute('name'));
  }

  /** The question a group of radios or checkboxes is asking, with the options taken out. */
  function groupQuestion(node, type) {
    var name = node.getAttribute('name') || '';
    var opts = name
      ? Array.from(document.querySelectorAll('input[type=' + type + '][name="' + CSS.escape(name) + '"]'))
        .map(function (r) { return txt((r.closest('label') || {}).textContent || r.value); }).filter(Boolean)
      : [];
    var clean = function (s) {
      var t = txt(s);
      opts.forEach(function (o) { if (o) t = t.split(o).join(' '); });
      return txt(t).replace(/^[*\s:]+/, '');
    };
    var fs = node.closest('fieldset');
    if (fs) { var lg = fs.querySelector('legend'); if (lg && textOf(lg)) return clean(textOf(lg)); }
    var cur = node;
    for (var i = 0; i < 7 && cur.parentElement; i++) {
      cur = cur.parentElement;
      var t = clean(textOf(cur));
      if (t.length > 8) return t;
    }
    return txt(name);
  }

  function isRequired(node) {
    if (node.required || node.getAttribute('aria-required') === 'true') return true;
    // A styled dropdown keeps its `required` on a stand-in input beside the one you see.
    if (node.getAttribute('role') === 'combobox') {
      var up = node;
      for (var i = 0; i < 5 && up.parentElement; i++) {
        up = up.parentElement;
        if (up.querySelector('input[aria-hidden="true"][required]')) return true;
        if (up.querySelectorAll('input:not([type=hidden])').length > 2) break;   // past this one widget
      }
    }
    var wrap = node.closest('label, fieldset, [class*="field" i], [class*="question" i], div');
    var t = wrap ? String(wrap.textContent || '') : '';
    return /\*/.test(t) || /\brequired\b/i.test(t) || /مطلوب/.test(t);
  }

  /**
   * Every question on the page, once each, in the order a person meets them.
   *
   *   kind     'radio' | 'checks' | 'file' | 'select' | 'combo' | 'text'
   *   el       the control (the first one, for a group)      els   all of them, for a group
   *   q        the question in the employer's words          required
   */
  function questions() {
    var out = [];

    var radios = new Map();
    document.querySelectorAll('input[type=radio]').forEach(function (r) {
      if (!visible(r)) return;
      var n = r.getAttribute('name') || labelOf(r);
      if (!radios.has(n)) radios.set(n, []);
      radios.get(n).push(r);
    });
    radios.forEach(function (els) {
      out.push({ kind: 'radio', el: els[0], els: els, q: groupQuestion(els[0], 'radio'), required: isRequired(els[0]) });
    });

    // Checkboxes that share a name — or, unnamed, a fieldset — are one question with several
    // answers. Read one box at a time, "which of these apply?" became seven separate
    // questions, each reported as unanswered.
    var boxes = new Map();
    document.querySelectorAll('input[type=checkbox]').forEach(function (c) {
      if (!visible(c)) return;
      var fs = c.closest('fieldset');
      var key = c.getAttribute('name') ? 'name:' + c.getAttribute('name')
        : (fs && fs.querySelectorAll('input[type=checkbox]').length > 1) ? fs : c;
      if (!boxes.has(key)) boxes.set(key, []);
      boxes.get(key).push(c);
    });
    boxes.forEach(function (els) {
      out.push({
        kind: 'checks', el: els[0], els: els,
        q: els.length > 1 ? groupQuestion(els[0], 'checkbox') : labelOf(els[0]),
        required: isRequired(els[0])
      });
    });

    document.querySelectorAll('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea, select')
      .forEach(function (el) {
        if (!visible(el)) return;
        var tag = el.tagName.toLowerCase();
        var type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
        // The stand-in behind a styled dropdown: it carries `required` for the browser's sake
        // and is not a second question. Greenhouse and Workable both build dropdowns this way.
        if (type !== 'file' && el.getAttribute('aria-hidden') === 'true') return;
        var kind = type === 'file' ? 'file'
          : type === 'select' ? 'select'
            : el.getAttribute('role') === 'combobox' ? 'combo'
              : 'text';
        out.push({ kind: kind, type: type, el: el, q: labelOf(el), required: isRequired(el) });
      });

    return out;
  }

  // "Is there a check on this page" has two different answers that used to be one: a box
  // someone must tick before sending, and a score worked out silently that only objects —
  // if it objects — at the moment of sending.
  var CHECK_PARTS = 'iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], ' +
    '.cf-turnstile, .g-recaptcha, .h-captcha';
  function checks() {
    var parts = Array.from(document.querySelectorAll(CHECK_PARTS));
    var shown = parts.some(function (el) {
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      return r.width >= 200 && r.height >= 50 && cs.visibility !== 'hidden' && cs.display !== 'none'
        && !el.closest('.grecaptcha-badge');
    });
    return {
      widget: shown,
      silent: !shown && (parts.length > 0 || !!document.querySelector('.grecaptcha-badge, [data-size="invisible"], input[name="cf-turnstile-response"]'))
    };
  }

  return { txt: txt, visible: visible, textOf: textOf, labelOf: labelOf, isRequired: isRequired, questions: questions, checks: checks };
})();
