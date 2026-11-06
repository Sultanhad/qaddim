const $ = (id) => document.getElementById(id);

async function render() {
  const s = await chrome.storage.local.get(['profile', 'session', 'log', 'settings', 'running']);
  const settings = { autoSubmit: false, ...(s.settings ?? {}) };
  $('who').textContent = s.profile
    ? `${s.profile.full_name || 'ملفك'} · ${Object.keys(s.profile.answers ?? {}).length} إجابة محفوظة`
    : 'افتح المنصة مرة لمزامنة حسابك';
  $('queue').textContent = s.running ? 'يعمل الآن…' : (s.session ? 'متصل بالمنصة' : 'غير متصل');
  $('auto').checked = !!settings.autoSubmit;
  $('autoNote').textContent = settings.autoSubmit
    ? 'يضغط الإرسال بنفسه. أي سؤال إلزامي بلا إجابة منك يوقفه عند تلك الوظيفة.'
    : 'يعبّي الاستمارة ويترك الإرسال لك — ابدأ بهذا حتى تطمئن.';
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

$('auto').addEventListener('change', async (e) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: { ...(settings ?? {}), autoSubmit: e.target.checked } });
  render();
});
$('run').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'fursa:run' }));
$('stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'fursa:stop' }));
chrome.storage.onChanged.addListener(render);
render();
