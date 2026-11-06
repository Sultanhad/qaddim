import React, { useEffect, useMemo, useState } from 'react';
import { supabase, cvPathFor } from './supabase.js';
import { Hero, Score, Live, RankedChips, Banner, Skeleton, L } from './ui.jsx';
import { ROLE_FAMILIES, SKILL_AREAS, CITY_ALIASES } from '@engine/taxonomy.js';
import ApplySheet from './ApplySheet.jsx';
import Privacy from './Privacy.jsx';
import Landing from './Landing.jsx';

const AR_CITY = {
  riyadh: 'الرياض', jeddah: 'جدة', dammam: 'الدمام', khobar: 'الخبر', dhahran: 'الظهران',
  mecca: 'مكة', medina: 'المدينة', neom: 'نيوم', tabuk: 'تبوك', abha: 'أبها', qassim: 'القصيم',
  dubai: 'دبي', 'abu dhabi': 'أبوظبي', sharjah: 'الشارقة', doha: 'الدوحة', manama: 'المنامة',
  kuwait: 'الكويت', muscat: 'مسقط', cairo: 'القاهرة', amman: 'عمّان'
};
const CITIES = Object.keys(CITY_ALIASES).map((id) => ({ id, label: id, label_ar: AR_CITY[id] || id }));

// ──────────────────────────────────────────────────────────────── shell ──
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [route, setRoute] = useState(() => location.hash.replace('#', '') || 'jobs');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const onHash = () => setRoute(location.hash.replace('#', '') || 'jobs');
    addEventListener('hashchange', onHash);
    return () => { sub.subscription.unsubscribe(); removeEventListener('hashchange', onHash); };
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data ?? null));
  }, [session?.user?.id]);

  if (route === 'privacy') return <Privacy />;
  if (route === 'help') return <Help />;
  if (session === undefined) return <Landing loading />;
  if (!session) return <Landing />;
  if (profile && !profile.onboarded) return <Onboarding user={session.user} profile={profile} onDone={setProfile} />;
  if (!profile) return <Landing loading />;

  return (
    <>
      <Hero title={route === 'applications' ? L.applications : route === 'settings' ? L.settings : L.today} />
      <div className="wrap">
        {route === 'applications' ? <Applications user={session.user} profile={profile} />
          : route === 'settings' ? <Onboarding user={session.user} profile={profile} onDone={setProfile} editing />
            : <Jobs user={session.user} profile={profile} />}
        <nav className="nav">
          <a href="#jobs" aria-current={route === 'jobs' ? 'page' : undefined}>{L.today}</a>
          <a href="#applications" aria-current={route === 'applications' ? 'page' : undefined}>{L.applications}</a>
          <a href="#settings" aria-current={route === 'settings' ? 'page' : undefined}>{L.settings}</a>
          <a href="#privacy">الخصوصية</a>
          <a href="#out" onClick={(e) => { e.preventDefault(); supabase.auth.signOut(); }}>{L.signOut}</a>
        </nav>
      </div>
    </>
  );
}

function Help() {
  return (
    <>
      <Hero title="التقديم التلقائي" eyebrow="فرصة" />
      <div className="wrap">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>لماذا يحتاج إضافة؟</h2>
          <p className="muted">
            كل نظام توظيف نقرأ منه — Greenhouse وLever وAshby وWorkable — يضع «تحقّق أنك لست روبوتاً» قبل الإرسال.
            هذا الفحص لا يقيس ضغطتك، بل يقيس <b>المتصفح نفسه</b>: حركته، توقيته، تاريخه. أي متصفح يعمل على خادم يسقط فيه،
            حتى لو ضغط إنسان المربع بيده — جرّبناه وفشل.
          </p>
          <p className="muted">
            متصفحك أنت يمرّ، لأنه متصفح حقيقي. فالإضافة ليست حيلة للتحايل على الفحص — هي السبب في أننا لا نحتاج للتحايل عليه.
          </p>

          <h2>التثبيت — مرة واحدة</h2>
          <ol style={{ paddingInlineStart: 20, color: 'var(--dim)', lineHeight: 2 }}>
            <li>افتح <span dir="ltr">chrome://extensions</span></li>
            <li>فعّل <b>Developer mode</b> أعلى اليمين</li>
            <li>اضغط <b>Load unpacked</b> واختر مجلد <span dir="ltr">extension</span></li>
            <li>ارجع لهذه الصفحة — ستظهر «الإضافة متصلة»</li>
          </ol>

          <h2>كيف تشتغل</h2>
          <p className="muted">
            تضغط «يهمني» على وظيفة ← تدخل الطابور ← متصفحك يفتحها في تبويب خلفي، يعبّيها من ملفك، ويرسلها ← يقفل التبويب وينتقل للتالية.
            بين كل وظيفة والتي تليها تسع ثوانٍ، وواحدة في كل مرة — لا دفعات.
          </p>
          <p className="muted">
            <b style={{ color: 'var(--text)' }}>تتوقف عندك</b> إذا: ظهر سؤال إلزامي لم تجب عنه، أو تحدّتك الكابتشا فعلاً، أو طُلب ملف لا يمكن لأي إضافة رفعه.
            عندها يفتح التبويب أمامك ويصلك إشعار بالسبب.
          </p>
          <p className="muted">
            <b style={{ color: 'var(--text)' }}>لا تخترع شيئاً أبداً.</b> كل حرف تكتبه مصدره ملفك الذي كتبته بنفسك.
          </p>

          <h2>قبل أن تطلقها</h2>
          <p className="muted">
            ابدأ والإرسال التلقائي <b>مطفأ</b> من أيقونة الإضافة: ستعبّي وتترك الزر لك، فترى بعينك ما سيُرسل باسمك.
            وحين تطمئن، فعّله.
          </p>
          <p className="faint">
            تنبيه: شروط استخدام معظم أنظمة التوظيف تمنع الإرسال الآلي. القرار قرارك، والحساب حسابك.
          </p>
        </div>
        <nav className="nav"><a href="#jobs">عودة</a><a href="#settings">ملفي</a></nav>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── landing ──
// ───────────────────────────────────────────────────────────── onboarding ──
function Onboarding({ user, profile, onDone, editing }) {
  const [form, setForm] = useState(() => ({
    full_name: profile?.full_name ?? '',
    roles: profile?.roles ?? [],
    skill_areas: profile?.skill_areas ?? [],
    extra_skills: (profile?.extra_skills ?? []).join('، '),
    years_experience: profile?.years_experience ?? 0,
    cities: profile?.cities ?? ['riyadh'],
    accept_remote: profile?.accept_remote ?? true,
    avoid_software_roles: profile?.avoid_software_roles ?? false,
    auto_apply: profile?.auto_apply ?? false,
    exclude_title_words: (profile?.exclude_title_words ?? []).join('، '),
    exclude_companies: (profile?.exclude_companies ?? []).join('، '),
    min_score: profile?.min_score ?? 70
  }));
  const [cv, setCv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const listOf = (s) => String(s).split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);

  async function save(e) {
    e.preventDefault();
    if (!form.roles.length) { setError('اختر مجالاً واحداً على الأقل.'); return; }
    if (!form.cities.length) { setError('اختر مدينة واحدة على الأقل.'); return; }
    setBusy(true); setError('');
    let cv_path = profile?.cv_path ?? null, cv_uploaded_at = profile?.cv_uploaded_at ?? null;
    try {
      if (cv) {
        const path = cvPathFor(user.id, cv.name);
        const { error: upErr } = await supabase.storage.from('cvs').upload(path, cv, { upsert: false });
        if (upErr) throw upErr;
        if (profile?.cv_path) await supabase.storage.from('cvs').remove([profile.cv_path]);
        cv_path = path; cv_uploaded_at = new Date().toISOString();
      }
      const patch = {
        ...form,
        extra_skills: listOf(form.extra_skills),
        exclude_title_words: listOf(form.exclude_title_words),
        exclude_companies: listOf(form.exclude_companies),
        years_experience: Number(form.years_experience) || 0,
        min_score: Number(form.min_score) || 70,
        cv_path, cv_uploaded_at, onboarded: true, updated_at: new Date().toISOString()
      };
      const { data, error: dbErr } = await supabase.from('profiles').update(patch).eq('id', user.id).select().single();
      if (dbErr) throw dbErr;
      onDone(data);
      if (editing) location.hash = 'jobs';
    } catch (err) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <>
      {!editing && <Hero title="عرّفنا بنفسك" eyebrow={L.brand} />}
      <div className="wrap">
        <form className="card" onSubmit={save}>
          <div className="field">
            <label htmlFor="name">الاسم</label>
            <input id="name" type="text" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
          </div>

          <div className="field">
            <label>مجالاتك — بالترتيب</label>
            <p className="hint">اضغط عليها بالترتيب الذي تريده. الأول هو الأهم.</p>
            <RankedChips options={ROLE_FAMILIES} value={form.roles} onChange={(v) => set('roles', v)} />
          </div>

          <div className="field">
            <label>مهارات تملكها فعلاً</label>
            <p className="hint">لا نحتسب إلا ما تؤكده أنت. وما لا تؤكده يظهر كفجوة، لا كرصيد.</p>
            <RankedChips options={SKILL_AREAS} value={form.skill_areas} onChange={(v) => set('skill_areas', v)} />
          </div>

          <div className="field">
            <label htmlFor="extra">أدوات وشهادات تتقنها</label>
            <p className="hint">مثل: SQL، Power BI، PMP. افصل بفاصلة.</p>
            <input id="extra" type="text" value={form.extra_skills} onChange={(e) => set('extra_skills', e.target.value)} />
          </div>

          <div className="field">
            <label>مدنك</label>
            <p className="hint">الوظائف خارجها تُستبعد تماماً.</p>
            <RankedChips options={CITIES} value={form.cities} onChange={(v) => set('cities', v)} />
          </div>

          <div className="row">
            <div className="field grow">
              <label htmlFor="yrs">سنوات خبرتك</label>
              <input id="yrs" type="number" min="0" max="50" value={form.years_experience}
                onChange={(e) => set('years_experience', e.target.value)} />
            </div>
            <div className="field grow">
              <label htmlFor="min">أقل درجة تستحق الإظهار</label>
              <input id="min" type="number" min="0" max="100" value={form.min_score}
                onChange={(e) => set('min_score', e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>
              <input type="checkbox" checked={form.accept_remote}
                onChange={(e) => set('accept_remote', e.target.checked)} /> أقبل العمل عن بُعد
            </label>
            <label>
              <input type="checkbox" checked={form.avoid_software_roles}
                onChange={(e) => set('avoid_software_roles', e.target.checked)} /> لا تعرض عليّ وظائف برمجة
            </label>
          </div>

          <div className="field">
            <label>
              <input type="checkbox" checked={form.auto_apply}
                onChange={(e) => set('auto_apply', e.target.checked)} /> <b>قدّم لي تلقائياً</b>
            </label>
            <p className="hint">
              كل وظيفة تضغط عليها «يهمني» تُعبّأ وتُرسل عنك. يحتاج إضافة المتصفح — <a href="#help">خطوة واحدة</a>.
              الاستمارة التي فيها سؤال لم تجب عنه تتوقف وتنبّهك بدل أن يُخترع لك جواب.
            </p>
          </div>

          <div className="field">
            <label htmlFor="exw">كلمات تُخفي الوظيفة</label>
            <p className="hint">مثل: sales، teacher. افصل بفاصلة.</p>
            <input id="exw" type="text" value={form.exclude_title_words} onChange={(e) => set('exclude_title_words', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="exc">شركات لا تريد رؤيتها</label>
            <input id="exc" type="text" value={form.exclude_companies} onChange={(e) => set('exclude_companies', e.target.value)} />
          </div>

          <div className="field">
            <label htmlFor="cv">سيرتك الذاتية (PDF)</label>
            <p className="hint">
              تُحفظ في مجلد خاص بك لا يقرؤه أحد غيرك. تُستخدم لتعبئة الطلبات، ويمكنك حذفها في أي وقت.
              {profile?.cv_path && <> الحالية محفوظة ✓</>}
            </p>
            <input id="cv" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
          </div>

          {error && <Banner kind="bad">{error}</Banner>}
          <button className="btn btn-go btn-lg" disabled={busy}>{busy ? '…' : editing ? 'احفظ' : 'ابدأ'}</button>
        </form>

        {editing && <DangerZone user={user} profile={profile} />}
      </div>
    </>
  );
}

function DangerZone({ user, profile }) {
  const [confirming, setConfirming] = useState(false);
  async function wipe() {
    if (profile?.cv_path) await supabase.storage.from('cvs').remove([profile.cv_path]);
    await supabase.rpc('delete_my_account');
    await supabase.auth.signOut();
  }
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>بياناتك</h2>
      <p className="muted">كل ما نحتفظ به: ملفك، سيرتك، وطلباتك. الحذف فوري ونهائي.</p>
      {confirming
        ? <><Banner kind="bad">سيُحذف حسابك وسيرتك وكل طلباتك. لا يمكن التراجع.</Banner>
          <button className="btn btn-no" onClick={wipe}>نعم، احذف كل شيء</button>
          <button className="btn" onClick={() => setConfirming(false)}>تراجع</button></>
        : <button className="btn btn-no" onClick={() => setConfirming(true)}>احذف حسابي وبياناتي</button>}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── jobs ──
/** The extension announces itself on load; without it we simply never show its button. */
function useExtension() {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    const on = (e) => { if (e.source === window && e.data?.type === 'fursa:extension-ready') setVersion(e.data.version); };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  return version;
}

/** Hands the extension this user's session and profile. Nothing else leaves this page. */
async function sendToExtension(profile) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  postMessage({
    type: 'fursa:sync',
    session: {
      url: import.meta.env.VITE_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      token: data.session.access_token
    },
    profile: {
      full_name: profile.full_name, first_name: (profile.full_name || '').split(' ')[0],
      last_name: (profile.full_name || '').split(' ').slice(1).join(' '),
      email_for_applications: profile.email_for_applications, phone: profile.phone,
      city: (profile.cities || [])[0], location: (profile.cities || [])[0],
      nationality: profile.nationality, work_authorization: profile.work_authorization,
      requires_sponsorship: profile.requires_sponsorship ? 'yes' : 'no',
      salary_expectation: profile.salary_expectation, current_salary: profile.current_salary,
      notice_period: profile.notice_period, current_company: profile.current_company,
      current_title: profile.current_title, years_experience: String(profile.years_experience ?? ''),
      linkedin_url: profile.linkedin_url, education_degree: profile.education_degree,
      university: profile.university, graduation_year: String(profile.graduation_year ?? ''),
      answers: profile.answers ?? {}
    }
  }, '*');
}

function Jobs({ user, profile }) {
  const [rows, setRows] = useState(null);
  const [meta, setMeta] = useState({ open: null, updated: null });
  const [busyId, setBusyId] = useState(null);
  const [sheetFor, setSheetFor] = useState(null);
  const [queued, setQueued] = useState(0);
  const ext = useExtension();

  useEffect(() => { load(); }, [user.id]);
  useEffect(() => { if (ext && profile.auto_apply) sendToExtension(profile); }, [ext, profile.auto_apply]);

  async function load() {
    const { data } = await supabase
      .from('matches')
      .select('score, reasons, gaps, flags, job:jobs(*)')
      .eq('user_id', user.id)
      .gte('score', profile.min_score ?? 70)
      .order('score', { ascending: false })
      .limit(40);
    setRows(data ?? []);
    const { count } = await supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('is_open', true);
    const { data: last } = await supabase.from('jobs').select('last_seen').order('last_seen', { ascending: false }).limit(1).maybeSingle();
    setMeta({ open: count ?? null, updated: last?.last_seen ?? null });
  }

  async function act(job, status) {
    setBusyId(job.id);
    const row = { user_id: user.id, job_id: job.id, status };
    // "Interested" means: apply for me. The queue is drained by your own browser.
    if (status === 'saved' && profile.auto_apply) row.auto_status = 'queued';
    await supabase.from('applications').upsert(row, { onConflict: 'user_id,job_id' });
    setBusyId(null);
    setRows((r) => r.filter((x) => x.job.id !== job.id));
    if (status === 'saved') {
      if (profile.auto_apply && ext) { sendToExtension(profile); setQueued((n) => n + 1); }
      else setSheetFor(job);                           // no extension: hand them the fill sheet
    }
  }

  if (rows === null) return <><Skeleton /><Skeleton /></>;
  return (
    <>
      <Live open={meta.open} updatedAt={meta.updated} />
      {profile.auto_apply && !ext && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>التقديم التلقائي مفعّل — تنقصه خطوة واحدة</p>
          <p className="faint" style={{ margin: '6px 0 0' }}>
            ثبّت إضافة المتصفح مرة واحدة، وبعدها كل «يهمني» يُقدَّم عنك تلقائياً.
            سبب وجودها: مواقع التوظيف ترفض أي متصفح آلي، وتقبل متصفحك أنت.
            {' '}<a href="#help">كيف أثبّتها</a>
          </p>
        </div>
      )}
      {profile.auto_apply && ext && (
        <p className="faint" style={{ margin: '0 0 14px' }}>
          <span className="dot" /> التقديم التلقائي يعمل · الإضافة {ext}
          {queued > 0 && <> · {queued} في الطابور</>}
        </p>
      )}
      {!rows.length && (
        <div className="card">
          <p style={{ margin: 0 }}>لا جديد فوق درجتك الآن.</p>
          <p className="faint">نقرأ اللوحات كل ١٥ دقيقة. حين تظهر وظيفة تناسبك ستجدها هنا.</p>
        </div>
      )}
      {sheetFor && <ApplySheet profile={profile} job={sheetFor} onClose={() => {
        setRows((r) => r.filter((x) => x.job.id !== sheetFor.id));
        setSheetFor(null);
      }} />}
      {rows.map(({ job, score, reasons, gaps, flags }) => (
        <article className="card" key={job.id}>
          <div style={{ marginBottom: 10 }}>
            <Score value={score} />
            <span className="faint" style={{ marginInlineStart: 10 }}>{job.arrangement || ''}</span>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>{job.title}</p>
          <p className="muted" style={{ margin: '6px 0 0' }}>{job.company} · {job.location}</p>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {job.salary_published ? `الراتب ${job.salary_published}` : L.noSalary}
          </p>
          {!!reasons?.length && <ul className="reasons">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
          {!!gaps?.length && <p className="faint" style={{ marginTop: 8 }}>فجوات: {gaps.join(' · ')}</p>}
          {!!flags?.length && <Banner kind="warn">{flags.join(' · ')}</Banner>}
          <p style={{ margin: '12px 0 0', fontSize: 14 }}>
            <a href={job.url} target="_blank" rel="noopener noreferrer">{L.openListing} ↗</a>
          </p>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-go" disabled={busyId === job.id} onClick={() => act(job, 'saved')}>
              {profile.auto_apply ? 'يهمني — قدّم لي' : L.approve}
            </button>
            <button className="btn btn-no" disabled={busyId === job.id} onClick={() => act(job, 'closed')}>{L.reject}</button>
          </div>
        </article>
      ))}
    </>
  );
}

// ───────────────────────────────────────────────────────── applications ──
const STATUSES = ['saved', 'applied', 'interview', 'offer', 'closed'];

function Applications({ user, profile }) {
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sheetFor, setSheetFor] = useState(null);

  useEffect(() => { load(); }, [user.id]);
  async function load() {
    const { data } = await supabase
      .from('applications')
      .select('id, status, notes, applied_on, follow_up_on, auto_status, auto_reason, job:jobs(*)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setRows(data ?? []);
  }
  async function setStatus(row, status) {
    await supabase.from('applications').update({ status }).eq('id', row.id);
    load();
  }
  async function setNotes(row, notes) {
    await supabase.from('applications').update({ notes }).eq('id', row.id);
  }

  if (rows === null) return <Skeleton />;
  const shown = filter === 'all' ? rows : rows.filter((r) => r.status === filter);
  const count = (s) => rows.filter((r) => r.status === s).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل {rows.length}</button>
        {STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{L[s]} {count(s)}</button>
        ))}
      </div>
      {sheetFor && <ApplySheet profile={profile} job={sheetFor} onClose={() => setSheetFor(null)} />}
      {!shown.length && <div className="card"><p style={{ margin: 0 }}>لا شيء هنا بعد.</p></div>}
      {shown.map((row) => (
        <article className="card" key={row.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>{row.job?.title}</p>
              <p className="muted" style={{ margin: '4px 0 0' }}>{row.job?.company} · {row.job?.location}</p>
            </div>
            <select className="status-pill" value={row.status} onChange={(e) => setStatus(row, e.target.value)}
              style={{ width: 'auto' }}>
              {STATUSES.map((s) => <option key={s} value={s}>{L[s]}</option>)}
            </select>
          </div>
          {row.auto_status && (
            <p style={{ marginTop: 8, fontSize: 14, color: row.auto_status === 'submitted' ? 'var(--good)' : row.auto_status === 'queued' ? 'var(--blue-soft)' : 'var(--warn)' }}>
              {{ queued: 'في الطابور', filling: 'يُعبّأ الآن…', submitted: 'أُرسل تلقائياً ✓', needs_you: 'يحتاجك', failed: 'تعذّر' }[row.auto_status]}
              {row.auto_reason ? <span className="faint"> — {row.auto_reason}</span> : null}
            </p>
          )}
          {row.applied_on && <p className="faint" style={{ marginTop: 8 }}>قدّمت في {row.applied_on}</p>}
          {row.follow_up_on && row.status === 'applied' && (
            <p style={{ color: row.follow_up_on <= today ? 'var(--warn)' : 'var(--blue-soft)', fontSize: 14, margin: '6px 0 0' }}>
              {row.follow_up_on <= today ? 'حان وقت المتابعة' : `تابع في ${row.follow_up_on}`}
            </p>
          )}
          <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label htmlFor={`n${row.id}`}>ملاحظات</label>
            <textarea id={`n${row.id}`} rows={2} defaultValue={row.notes ?? ''}
              onBlur={(e) => setNotes(row, e.target.value)} />
          </div>
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-go" onClick={() => setSheetFor(row.job)}>ورقة التعبئة</button>
            {row.job?.url && <a className="btn" href={row.job.url} target="_blank" rel="noopener noreferrer">{L.openListing} ↗</a>}
          </div>
        </article>
      ))}
    </>
  );
}
