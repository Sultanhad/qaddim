const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.local.get(['profile', 'session', 'log', 'settings', 'running']);
  // Sending is decided on the site and nowhere else. This used to hold a switch of its own,
  // off by default, that quietly overruled the site's — so it only reports now.
  const sends = !!s.profile?.auto_submit && s.settings?.neverSubmit !== true;
  $('who').textContent = s.profile
    ? `${s.profile.full_name || 'ملفك'} · ${Object.keys(s.profile.answers ?? {}).length} إجابة محفوظة`
    : 'افتح المنصة مرة لمزامنة حسابك';
  $('queue').textContent = s.running ? 'يعمل الآن…' : (s.session ? 'متصل بالمنصة' : 'غير متصل');
  $('sends').textContent = sends ? 'يرسل بنفسه' : 'يعبّي ويترك الإرسال لك';
  $('autoNote').textContent = sends
    ? 'كما اخترت في ضبط قدّم. أي سؤال إلزامي بلا جواب يوقفه عند تلك الوظيفة.'
    : 'لتغييره: الضبط في قدّم ← «وأرسل بنفسك». الإرسال يُقرَّر هناك لا هنا.';
  $('run').disabled = !s.session || !!s.running;
  $('stop').disabled = !s.running;

  const log = s.log ?? [];
  $('log').innerHTML = log.length ? '' : '<p class="faint" style="margin:0">لا سجل بعد.</p>';
  for (const e of log.slice(0, 12)) {
    const cls = e.status === 'submitted' ? 'ok' : e.status === 'error' ? 'err' : 'need';
    const label = { submitted: 'أُرسل', needs_you: 'يحتاجك', error: 'خطأ' }[e.status] ?? e.status;
    const title = e.job ? `${e.job.company} — ${e.job.title}` : '';
    const miss = e.report?.missing?.length ? ' · ناقص: ' + e.report.missing.map((m) => m.q).slice(0, 2).join('، ') : '';
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<span class="${cls}">${label}</span> ${title}<br><span class="faint">${(e.reason ?? '') + miss}</span>`;
    $('log').appendChild(div);
  }
}

$('run').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'qaddim:run' }));
$('stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'qaddim:stop' }));
chrome.storage.onChanged.addListener(render);
render();
