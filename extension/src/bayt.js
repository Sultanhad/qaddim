// «أضف لقدّم» on a Bayt job page.
//
// Bayt is never read automatically: it shuts its job search to crawlers. This runs only in the
// person's own browser, on a job page they opened, and does nothing until they press the
// button. It reads that one page — the structured description most job pages carry for search
// engines (schema.org JobPosting), else what the page shows — and hands it to the extension,
// which adds it to their qaddim account.
//
// It never presses anything on Bayt. Applying on Bayt is the person's own click.
//
// Plain script (no modules): content scripts share one global scope.

(function () {
  // /en/saudi-arabia/jobs/product-manager-5123456/
  if (!/^\/(en|ar)\/[a-z-]+\/jobs\/[^/]*-\d{5,}\/?$/.test(location.pathname)) return;

  var txt = function (s) { return String(s || '').replace(/\s+/g, ' ').trim(); };
  var strip = function (h) {
    var d = document.createElement('div');
    d.innerHTML = String(h || '').replace(/<(br|\/p|\/li|\/h\d)>/gi, '\n');
    return (d.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  };
  var meta = function (name) {
    var el = document.querySelector('meta[property="' + name + '"], meta[name="' + name + '"]');
    return el ? txt(el.getAttribute('content')) : '';
  };

  /** The job this page describes, or null if it cannot be read. */
  function readJob() {
    var posting = null;
    document.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
      if (posting) return;
      try {
        var data = JSON.parse(s.textContent);
        var list = Array.isArray(data) ? data : (data['@graph'] || [data]);
        list.forEach(function (d) { if (!posting && d && d['@type'] === 'JobPosting') posting = d; });
      } catch (e) { /* not ours to read */ }
    });
    var place = function (p) {
      var a = (p && (p.address || p)) || {};
      return [a.addressLocality, a.addressRegion, a.addressCountry && (a.addressCountry.name || a.addressCountry)].filter(Boolean).join(', ');
    };
    var job = posting ? {
      title: txt(posting.title),
      company: txt(posting.hiringOrganization && (posting.hiringOrganization.name || posting.hiringOrganization)),
      location: [].concat(posting.jobLocation || []).map(place).filter(Boolean).join('; '),
      description: strip(posting.description),
      posted: txt(posting.datePosted)
    } : {
      title: txt((document.querySelector('h1') || {}).textContent) || meta('og:title'),
      company: txt((document.querySelector('[data-automation-id="company-name"], .t-default a[href*="/company/"]') || {}).textContent),
      location: txt((document.querySelector('[data-automation-id="job-location"]') || {}).textContent),
      description: strip((document.querySelector('[data-automation-id="job-description"], .card-content') || {}).innerHTML) || meta('og:description'),
      posted: ''
    };
    if (!job.title) return null;
    // Where applying happens: a link out of Bayt to the employer's own hiring system, if any.
    var out = Array.from(document.querySelectorAll('a[href^="https://"]')).map(function (a) { return a.href; })
      .find(function (h) { return /^https:\/\/(apply\.workable\.com|jobs\.lever\.co|jobs\.ashbyhq\.com|([a-z0-9-]+\.)?greenhouse\.io|(jobs|careers)\.smartrecruiters\.com|[a-z0-9-]+\.recruitee\.com)\//.test(h); });
    job.applyUrl = out || null;
    job.url = location.origin + location.pathname;
    return job;
  }

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'أضف لقدّم';
  btn.setAttribute('data-qaddim', 'add');
  btn.style.cssText = 'position:fixed;inset-inline-start:16px;bottom:16px;z-index:2147483647;padding:12px 20px;border:0;border-radius:999px;' +
    'background:#2f6bff;color:#fff;font:700 15px system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(47,107,255,.45);cursor:pointer;direction:rtl';
  btn.addEventListener('click', function () {
    var job = readJob();
    if (!job) { btn.textContent = 'لم أقرأ الوظيفة من هذه الصفحة'; return; }
    btn.disabled = true; btn.textContent = '…';
    chrome.runtime.sendMessage({ type: 'qaddim:add-job', job: job }, function (res) {
      btn.disabled = false;
      btn.textContent = res && res.ok
        ? (res.queued ? 'أُضيفت ✓ — يقدّم عليها قدّم' : 'أُضيفت ✓ — قدّم عليها هنا في بيت')
        : (res && res.why) || 'تعذّرت الإضافة';
    });
  });
  (document.body || document.documentElement).appendChild(btn);
  window.__qaddimBayt = readJob;     // for the tests
})();
