import React, { useEffect, useMemo, useState } from 'react';
import { supabase, cvPathFor, authReturn } from './supabase.js';
import { Hero, Score, Live, RankedChips, Banner, Skeleton, Field, Ladder, Icon, Mark, L, browserKind, BROWSER_AR } from './ui.jsx';
import { ROLE_FAMILIES, SKILL_AREAS, CITY_ALIASES, CITY_COUNTRY } from '@engine/taxonomy.js';
import { normaliseProfile, scoreJob, filterReason } from '@engine/score.js';
import { autoApplyable } from '@engine/sources.js';
import { mayGuess, sameWords } from '@engine/answering.js';
import { stateOf, awaitingProof, sentOf, isPaused, STATE_AR } from '@engine/applications.js';
import { APPLY_FIELDS, readiness, RUNGS } from './profile-fields.js';
import { forExtension } from './extension-profile.js';
import { reasonAr, flagAr, gapAr } from './explain.js';
import { useToast, errorAr, useOnline } from './toast.jsx';
import ApplySheet from './ApplySheet.jsx';
import Privacy from './Privacy.jsx';
import Landing from './Landing.jsx';

const AR_CITY = {
  riyadh: 'الرياض', jeddah: 'جدة', dammam: 'الدمام', khobar: 'الخبر', dhahran: 'الظهران',
  mecca: 'مكة', medina: 'المدينة', neom: 'نيوم', tabuk: 'تبوك', abha: 'أبها', qassim: 'القصيم',
  dubai: 'دبي', 'abu dhabi': 'أبوظبي', sharjah: 'الشارقة', doha: 'الدوحة', manama: 'المنامة',
  kuwait: 'الكويت', muscat: 'مسقط', cairo: 'القاهرة', amman: 'عمّان'
};
// Role families whose jobs are expected to involve writing code.
const CODE_ROLES = new Set(['software', 'data_science', 'ai_solutions', 'tech_ops']);

const CITIES = Object.keys(CITY_ALIASES).map((id) => ({ id, label: id, label_ar: AR_CITY[id] || id }));

// The bar a match must clear to be worth showing. New accounts start here; الضبط moves it.
export const START_SCORE = 45;

/** How long a posting has been up, in the words a reader uses. */
function ageOf(published) {
  if (!published) return null;
  const days = Math.floor((Date.now() - new Date(published).getTime()) / 864e5);
  if (!Number.isFinite(days) || days < 0) return null;
  if (days <= 1) return 'نُشرت اليوم';
  if (days < 7) return `قبل ${days} أيام`;
  if (days < 30) return `قبل ${Math.floor(days / 7)} أسابيع`;
  if (days < 60) return 'قبل شهر';
  if (days < 365) return `قبل ${Math.floor(days / 30)} أشهر`;
  return 'قبل أكثر من سنة';
}

// ───────────────────────────────────────────────────────── the job pool ──
// Scoring happens here, in the browser, against the open jobs. The nightly worker writes the
// same scores to `matches`, but waiting for it would mean a new account sees an empty screen
// for fifteen minutes — and changing a city would do nothing until the next sweep. Scoring
// locally makes every choice answer back immediately, which is the whole feel of the product.
const POOL_TTL = 300000;                 // the worker sweeps every fifteen minutes; five is well inside that
const COLUMNS = 'id,title,company,location,city,country,arrangement,salary_published,description,url,published_at,last_seen';
let POOL = null, POOL_AT = 0, POOL_FOR = '';

/** The countries a profile can actually take a job in. */
function countriesFor(profile) {
  const set = new Set(profile?.countries ?? []);
  for (const c of profile?.cities ?? []) if (CITY_COUNTRY[c]) set.add(CITY_COUNTRY[c]);
  return [...set].sort();
}

async function loadPool(countries) {
  const key = countries.join(',');
  if (POOL && POOL_FOR === key && Date.now() - POOL_AT < POOL_TTL) return POOL;

  // Descriptions are most of the weight, and the scorer needs them — so the question is how
  // many rows carry them. Someone looking for work in Riyadh has no use for two hundred jobs
  // in Dubai, and downloading them on a phone is the difference between a second and five.
  // A job with no country is remote and open from anywhere, so it stays.
  const cacheKey = 'qaddim:pool:' + key;
  if (POOL_FOR !== key || !POOL) {
    try {
      const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
      if (c && Date.now() - c.at < POOL_TTL) { POOL = c.rows; POOL_AT = c.at; POOL_FOR = key; return POOL; }
    } catch { /* private window, or a quota that filled */ }
  }

  let q = supabase.from('jobs').select(COLUMNS).eq('is_open', true);
  if (countries.length) q = q.or(`country.in.(${countries.join(',')}),country.is.null`);
  const { data } = await q.order('published_at', { ascending: false, nullsFirst: false }).limit(600);

  POOL = data ?? []; POOL_AT = Date.now(); POOL_FOR = key;
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: POOL_AT, rows: POOL })); } catch { /* over quota */ }
  return POOL;
}

function useJobPool(profile) {
  const countries = useMemo(() => countriesFor(profile), [profile?.cities, profile?.countries]);
  const [pool, setPool] = useState(() => (POOL_FOR === countries.join(',') ? POOL : null));
  useEffect(() => {
    let live = true;
    setPool((p) => (POOL_FOR === countries.join(',') ? p : null));
    loadPool(countries).then((p) => live && setPool(p));
    return () => { live = false; };
  }, [countries.join(',')]);
  return pool;
}

function scoreAll(pool, profile) {
  if (!pool) return null;
  const p = normaliseProfile(profile);
  const out = [];
  for (const job of pool) {
    if (filterReason(job, p)) continue;
    const s = scoreJob(job, p);
    out.push({ job, score: s.total, reasons: s.reasons, gaps: s.gaps, flags: s.flags });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ──────────────────────────────────────────────────────────────── shell ──
export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const [profile, setProfile] = useState(null);
  const [route, setRoute] = useState(() => {
    const h = location.hash.replace('#', '');
    // A sign-in redirect can leave its tokens in the hash; that is not a route.
    return !h || h.includes('=') ? 'jobs' : h;
  });
  const back = authReturn;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    const onHash = () => {
      const h = location.hash.replace('#', '');
      setRoute(!h || h.includes('=') ? 'jobs' : h);
    };
    addEventListener('hashchange', onHash);
    return () => { sub.subscription.unsubscribe(); removeEventListener('hashchange', onHash); };
  }, []);

  const [profileError, setProfileError] = useState('');
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const shut = () => setMenu(false);
    addEventListener('hashchange', shut);
    return () => removeEventListener('hashchange', shut);
  }, []);

  function loadProfile() {
    if (!session?.user) { setProfile(null); return; }
    setProfileError('');
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
      .then(({ data, error }) => {
        // A failed read is not an empty profile. Treating it as one showed a returning user
        // the first-run questions, and answering them again overwrote their settings.
        if (error) { setProfileError(error.message); return; }
        setProfile(data ?? { id: session.user.id });
      });
  }
  useEffect(loadProfile, [session?.user?.id]);

  // The landing page writes lang/dir/theme onto <html> and they outlive it. The signed-in app
  // has only a dark Arabic palette — under the landing's light theme its job titles are white
  // on white, and under English it lays out left-to-right. Claim the document back.
  useEffect(() => {
    if (!session?.user) return;
    const el = document.documentElement;
    const before = { lang: el.lang, dir: el.dir, theme: el.dataset.theme };
    el.lang = 'ar'; el.dir = 'rtl'; el.dataset.theme = 'dark';
    return () => { el.lang = before.lang; el.dir = before.dir; if (before.theme) el.dataset.theme = before.theme; };
  }, [session?.user?.id]);

  // Between the click in the email and the session arriving, say so. Showing the sign-in
  // form in that gap reads as "your link did not work".
  const linkError = back.state === 'error' ? back.message : undefined;

  // The privacy notice and the extension guide are readable signed in or out — but signed in
  // they used to drop you onto a bare page with no bar and no tabs, which reads as having
  // left the product. They now sit inside the same shell as everything else.
  if (route === 'privacy' || route === 'help') {
    const docTitle = route === 'privacy' ? 'الخصوصية' : 'التقديم التلقائي';
    if (!session?.user) {
      return (
        <>
          <DocBar title={docTitle} />
          <div className="wrap">{route === 'privacy' ? <Privacy /> : <Help />}</div>
        </>
      );
    }
    return (
      <>
        <AppBar title={docTitle} route={route} doc onMenu={() => setMenu(true)} />
        <div className="wrap app-wrap">{route === 'privacy' ? <Privacy /> : <Help />}</div>
        <TabBar route={route} />
        <Drawer open={menu} onClose={() => setMenu(false)} route={route}
          user={session.user} profile={profile} />
      </>
    );
  }

  if (session === undefined) return back.state === 'signing' ? <SigningIn /> : <Landing loading authError={linkError} />;
  if (!session) return <Landing authError={linkError} />;
  if (profileError) {
    return (
      <>
        <Hero title="تعذّر تحميل ملفك" />
        <div className="wrap">
          <div className="card">
            <p style={{ margin: 0 }}>حسابك وبياناتك سليمة — تعذّر الوصول إليها الآن فقط.</p>
            <p className="faint" dir="ltr" style={{ fontSize: 12 }}>{profileError}</p>
            <button className="btn btn-go" onClick={loadProfile}>أعد المحاولة</button>
            <button className="btn" onClick={() => supabase.auth.signOut()}>{L.signOut}</button>
          </div>
        </div>
      </>
    );
  }
  if (!profile) return <Landing loading />;
  if (!profile.onboarded) return <FirstRun user={session.user} profile={profile} onDone={setProfile} />;

  const tab = TABS.find((x) => x.id === route);
  const title = tab ? tab.title : L.today;
  return (
    <>
      <AppBar title={title} route={route} onMenu={() => setMenu(true)} />
      <div className="wrap app-wrap">
        {route === 'applications' ? <Applications user={session.user} profile={profile} onProfile={setProfile} />
          : route === 'profile' ? <ApplyProfile user={session.user} profile={profile} onDone={setProfile} />
            : route === 'settings' ? <Settings user={session.user} profile={profile} onDone={setProfile} />
              : <Jobs user={session.user} profile={profile} onProfile={setProfile} />}
      </div>
      <TabBar route={route} />
      <Drawer open={menu} onClose={() => setMenu(false)} route={route}
        user={session.user} profile={profile} />
    </>
  );
}

// ───────────────────────────────────────────────────────────── the shell ──
/**
 * Four places, reachable from anywhere.
 *
 * They used to be a row of links printed *after* the content, so on a phone the way to your
 * own profile — or out of the account — sat four thousand pixels below the fold, under forty
 * job cards. Nothing you need at any moment should be something you have to scroll to find:
 * the bar at the bottom holds the four screens, and the button at the top holds everything
 * about the account, including the way out.
 */
const TABS = [
  { id: 'jobs', label: 'وظائف', title: L.today, icon: 'jobs' },
  { id: 'applications', label: 'طلباتي', title: L.applications, icon: 'apps' },
  { id: 'profile', label: 'ملفي', title: 'ملف التقديم', icon: 'profile' },
  { id: 'settings', label: 'الضبط', title: 'الضبط', icon: 'settings' }
];

function AppBar({ title, route, doc, onMenu }) {
  return (
    <header className={'appbar' + (doc ? ' appbar-doc' : '')}>
      <div className="appbar-inner">
        <a className="appbar-brand" href="#jobs" aria-label={L.brand}><Mark size={28} radius={9} /></a>
        {/* On a phone the bar says which screen you are on; on a wide one the highlighted
            tab says it already, so the same space carries the name instead. A page that is
            not one of the tabs keeps its title at every width — nothing else would name it. */}
        <h1 className="appbar-title">{title}</h1>
        <b className="appbar-word">{L.brand}</b>
        <nav className="appbar-tabs" aria-label="الأقسام">
          {TABS.map((t) => (
            <a key={t.id} href={'#' + t.id} aria-current={route === t.id ? 'page' : undefined}>
              <Icon name={t.icon} size={18} />{t.label}
            </a>
          ))}
        </nav>
        {/* At the end of the bar, which in Arabic is the left — where the account control
            was, and where a thumb on a phone already expects to find it. */}
        <button type="button" className="burger" aria-label="القائمة" onClick={onMenu}>
          <span /><span /><span />
        </button>
      </div>
    </header>
  );
}

/** The privacy notice read by someone with no account still needs a way back. */
function DocBar({ title }) {
  return (
    <header className="appbar appbar-doc">
      <div className="appbar-inner">
        <a className="appbar-brand" href="#" aria-label={L.brand}><Mark size={28} radius={9} /></a>
        <h1 className="appbar-title">{title}</h1>
        <a className="btn" href="#" style={{ margin: 0, marginInlineStart: 'auto' }}>رجوع</a>
      </div>
    </header>
  );
}

/**
 * Everything the four tabs do not hold: who you are signed in as, the two reference pages,
 * and the way out. One panel, opened by one button, reachable from every screen — including
 * the wide one, where the tabs along the top cover only the four.
 */
function Drawer({ open, onClose, route, user, profile }) {
  useEffect(() => {
    if (!open) return;
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    // Scrolling the page behind an open panel is how a drawer feels broken.
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', key); document.body.style.overflow = before; };
  }, [open, onClose]);

  if (!open) return null;
  const name = profile?.full_name?.trim() || '';
  const letter = (name || user.email || '؟').trim()[0];
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="القائمة">
        <div className="drawer-head">
          <span className="avatar" aria-hidden="true">{letter}</span>
          <span className="drawer-who">
            {name && <b>{name}</b>}
            <span dir="ltr">{user.email}</span>
          </span>
          <button type="button" className="drawer-x" aria-label="إغلاق" onClick={onClose}>✕</button>
        </div>
        <nav className="drawer-nav">
          {TABS.map((t) => (
            <a key={t.id} href={'#' + t.id} aria-current={route === t.id ? 'page' : undefined} onClick={onClose}>
              <Icon name={t.icon} size={19} />{t.title}
            </a>
          ))}
          <hr />
          <a href="#help" aria-current={route === 'help' ? 'page' : undefined} onClick={onClose}>
            <Icon name="help" size={19} />كيف يشتغل
          </a>
          <a href="#privacy" aria-current={route === 'privacy' ? 'page' : undefined} onClick={onClose}>
            <Icon name="shield" size={19} />الخصوصية
          </a>
          <hr />
          <button type="button" className="danger"
            onClick={() => { onClose(); supabase.auth.signOut(); }}>
            <Icon name="out" size={19} />{L.signOut}
          </button>
        </nav>
      </aside>
    </>
  );
}

function TabBar({ route }) {
  return (
    <nav className="tabbar" aria-label="التنقل">
      {TABS.map((t) => (
        <a key={t.id} href={'#' + t.id} aria-current={route === t.id ? 'page' : undefined}>
          <Icon name={t.icon} /><span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

function SigningIn() {
  return (
    <div className="signing">
      <div className="spinner" />
      <p className="muted" style={{ margin: 0 }}>جارٍ الدخول…</p>
    </div>
  );
}

function Help() {
  const kind = browserKind();
  return (
    <>
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
        {kind !== 'chrome' && (
          <Banner kind="warn">
            أنت الآن في {BROWSER_AR[kind]}، والإضافة لا تعمل إلا في <b>Google Chrome على حاسب</b>.
            افتح قدّم في Chrome وأكمل التثبيت من هناك. كل ما عدا الإرسال — الوظائف، أسئلتك، ملفك — يعمل هنا كما هو.
          </Banner>
        )}
        <p className="muted">
          تحتاج <b>Google Chrome</b> على حاسب. سفاري وفايرفوكس والجوال لا تشغّل هذه الإضافة — تختار وتجيب منها،
          و Chrome هو الذي يرسل.
        </p>
        <p><a className="btn btn-go" style={{ margin: 0 }} href={import.meta.env.BASE_URL + 'qaddim-extension.zip'} download>نزّل الإضافة</a></p>
        <ol style={{ paddingInlineStart: 20, color: 'var(--dim)', lineHeight: 2 }}>
          <li>فكّ الملف المضغوط — يظهر مجلد <span dir="ltr">qaddim-extension</span></li>
          <li>في Chrome، افتح <span dir="ltr">chrome://extensions</span></li>
          <li>فعّل <b>Developer mode</b> أعلى اليمين</li>
          <li>اضغط <b>Load unpacked</b> واختر ذلك المجلد</li>
          <li>افتح قدّم في Chrome نفسه وسجّل دخولك — تظهر «الإضافة متصلة» في صفحة الوظائف</li>
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
          الإرسال يُقرَّر من مكان واحد: <a href="#settings">الضبط</a> ← «وأرسل بنفسك». ما دام مطفأً تعبّي الإضافة
          الاستمارة وتتركها مفتوحة لك، فترى بعينك ما سيُرسل باسمك. وحين تشغّله، أول ثلاثة طلبات تبقى لك لتراها —
          إلا إن اخترت «أرسل من أول طلب».
        </p>
        <p className="muted">
          وما كان معبّأً وينتظرك حين شغّلته يخرج وحده في الدورة التالية؛ لا تحتاج أن ترجع لكل طلب.
        </p>
        <p className="faint">
          تنبيه: شروط استخدام معظم أنظمة التوظيف تمنع الإرسال الآلي. القرار قرارك، والحساب حسابك.
        </p>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────── first run ──
/**
 * Three questions, then jobs.
 *
 * Everything else a hiring form will ask is asked later, by the screen that needs it. Someone
 * who just arrived has not yet seen a single job; making them fill in their notice period and
 * graduation year first is how a product loses the people it was built for. The counter under
 * the chips answers back as they choose, so the form proves itself before it asks for trust.
 */
function FirstRun({ user, profile, onDone }) {
  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    roles: profile?.roles ?? [],
    skill_areas: profile?.skill_areas ?? [],
    cities: profile?.cities?.length ? profile.cities : ['riyadh'],
    years_experience: profile?.years_experience ?? 0
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pool = useJobPool(form);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const ready = form.roles.length > 0 && form.cities.length > 0;
  const softwareOff = !form.roles.some((r) => CODE_ROLES.has(r));

  const hits = useMemo(() => {
    if (!pool || !form.roles.length || !form.cities.length) return null;
    // Preview exactly what will be saved, including the software-roles default, or the
    // number promised here is not the number they land on.
    return scoreAll(pool, { ...form, accept_remote: true, avoid_software_roles: softwareOff })
      .filter((r) => r.score >= START_SCORE).length;
  }, [pool, form.roles, form.skill_areas, form.cities, form.years_experience, softwareOff]);

  async function save(e) {
    e.preventDefault();
    if (!form.roles.length) { setError('اختر مجالاً واحداً على الأقل.'); return; }
    if (!form.cities.length) { setError('اختر مدينة واحدة على الأقل.'); return; }
    setBusy(true); setError('');
    const patch = {
      ...form, years_experience: Number(form.years_experience) || 0,
      // Someone who chose product and analysis did not ask to be shown engineering roles.
      // It is a default, not a decision: الضبط turns it off in one tap.
      avoid_software_roles: softwareOff,
      // A threshold is something you raise once you have seen the list, not a gate you are
      // born behind. 45 keeps out the genuinely unrelated; the slider in الضبط does the rest.
      min_score: START_SCORE, onboarded: true, updated_at: new Date().toISOString()
    };
    const { data, error: dbErr } = await supabase.from('profiles')
      .update(patch).eq('id', user.id).select().single();
    setBusy(false);
    if (dbErr) setError(errorAr(dbErr)); else onDone(data);
  }

  return (
    <>
      <Hero title="نبدأ من مجالك" eyebrow={L.brand} />
      <div className="wrap">
        <form className="card" onSubmit={save}>
          <div className="field">
            <label htmlFor="name">اسمك</label>
            <input id="name" type="text" autoFocus value={form.full_name}
              onChange={(e) => set('full_name', e.target.value)} />
          </div>

          <div className="field">
            <label>وش مجالك؟</label>
            <p className="hint">اضغط عليها بالترتيب الذي يهمّك. الأول هو الأهم.</p>
            <RankedChips options={ROLE_FAMILIES} value={form.roles} onChange={(v) => set('roles', v)} limit={10} />
          </div>

          <div className="field">
            <label>وش تتقن فعلاً؟</label>
            <p className="hint">لا نحتسب إلا ما تؤكده أنت. وما لا تؤكده يظهر كفجوة، لا كرصيد.</p>
            <RankedChips options={SKILL_AREAS} value={form.skill_areas} onChange={(v) => set('skill_areas', v)} limit={8} />
          </div>

          <div className="field">
            <label>وين تبي تشتغل؟</label>
            <p className="hint">ما خارجها لا يظهر لك.</p>
            <RankedChips options={CITIES} value={form.cities} onChange={(v) => set('cities', v)} limit={8} />
          </div>

          <div className="field">
            <label htmlFor="yrs">كم سنة خبرة؟</label>
            <input id="yrs" type="number" min="0" max="50" value={form.years_experience}
              onChange={(e) => set('years_experience', e.target.value)} style={{ maxWidth: 120 }} />
          </div>

          {hits !== null && (
            <p className="tally"><b>{hits}</b> وظيفة مفتوحة تناسبك الآن</p>
          )}

          {error && <Banner kind="bad">{error}</Banner>}
          <button className="btn btn-go btn-lg" disabled={busy || !ready}>
            {busy ? '…' : ready ? 'أرني الوظائف' : !form.roles.length ? 'اختر مجالك أولاً' : 'اختر مدينة'}
          </button>
          <p className="faint" style={{ marginBottom: 0 }}>
            سيرتك وبقية بياناتك تُطلب لاحقاً — عند أول وظيفة تقول عنها «يهمني».
          </p>
        </form>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────── apply profile ──
/** The answers a hiring form asks for. Collected once, reused on every application. */
function ApplyProfile({ user, profile, onDone, onSaved, compact }) {
  // Most answers are columns. The few marked `store: 'facts'` are kept with the saved
  // questions instead, under one reserved key: they are exactly that — answers to questions
  // forms keep asking — and keeping them there means a new one never needs a migration.
  const [form, setForm] = useState(() => Object.fromEntries(APPLY_FIELDS.map((f) =>
    [f.key, (f.store === 'facts' ? profile?.answers?._facts?.[f.key] : profile?.[f.key]) ?? ''])));
  const [cv, setCv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const ext = useExtension();
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const live = { ...profile, ...form, cv_path: cv ? 'pending' : profile?.cv_path };
  const r = readiness(live, { extension: !!ext || live.answers?._settings?.server === true });
  // When opened because an application needed something, lead with what is missing.
  // Asked in the middle of applying, the list is only what a form will actually reject you
  // for. The rest is worth having, but not worth standing between someone and the job.
  const order = compact ? r.missingApply.filter((f) => f.key !== 'cv_path') : APPLY_FIELDS;

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setSaved(false);
    try {
      let cv_path = profile?.cv_path ?? null, cv_uploaded_at = profile?.cv_uploaded_at ?? null;
      if (cv) {
        const path = cvPathFor(user.id, cv.name);
        const { error: upErr } = await supabase.storage.from('cvs').upload(path, cv, { upsert: false });
        if (upErr) throw upErr;
        if (profile?.cv_path) await supabase.storage.from('cvs').remove([profile.cv_path]);
        cv_path = path; cv_uploaded_at = new Date().toISOString();
      }
      // An untouched field is empty text in the form and must reach Postgres as null:
      // `graduation_year = ''` is not an integer, and the whole save fails with a 400.
      const blank = (v) => typeof v === 'string' && v.trim() === '';
      const stored = (key) => APPLY_FIELDS.find((f) => f.key === key)?.store;
      const clean = Object.fromEntries(Object.entries(form)
        .filter(([k]) => stored(k) !== 'facts').map(([k, v]) => [k, blank(v) ? null : v]));
      const facts = Object.fromEntries(Object.entries(form)
        .filter(([k, v]) => stored(k) === 'facts' && !blank(v)));
      const answers = { ...(profile?.answers ?? {}), _facts: facts };
      const { data, error: dbErr } = await supabase.from('profiles')
        .update({ ...clean, answers, cv_path, cv_uploaded_at, updated_at: new Date().toISOString() })
        .eq('id', user.id).select().single();
      if (dbErr) throw dbErr;
      onDone(data); setCv(null); setSaved(true);
      onSaved?.(data);
    } catch (err) { setError(errorAr(err)); }
    finally { setBusy(false); }
  }

  return (
    <form className="card" onSubmit={save}>
      {!compact && (
        <p className="muted" style={{ marginTop: 0 }}>
          هذه إجابات تُكتب مرة واحدة، ثم تُستخدم في كل طلب. المعلّم بنقطة لا يمكن إرسال أي طلب بدونه.
        </p>
      )}

      <div className="field">
        <label htmlFor="cv">سيرتك الذاتية</label>
        <p className="hint">تُحفظ في مجلد خاص بك لا يقرؤه أحد غيرك، وتُرسل كما هي.</p>
        {/* The browser's own file button is a grey English box laid out left-to-right: the
            one control on the page that belonged to no design at all. The input is still
            the input — it is simply wearing the label. */}
        <label className="filepick" htmlFor="cv">
          <span className="filepick-btn">{cv || profile?.cv_path ? 'استبدلها' : 'اختر ملفاً'}</span>
          <span className="filepick-name">
            {cv ? cv.name
              : profile?.cv_path ? <>محفوظة ✓ <span dir="ltr">{cvName(profile.cv_path)}</span></>
                : 'ملف PDF أو Word، حتى ٥ ميغابايت'}
          </span>
          <input id="cv" type="file" accept=".pdf,.doc,.docx"
            onChange={(e) => setCv(e.target.files?.[0] ?? null)} />
        </label>
      </div>

      {compact
        ? order.map((f, i) => {
          const field = APPLY_FIELDS.find((x) => x.key === f.key) ?? f;
          return <Field key={field.key} field={field} value={form[field.key]}
            onChange={(v) => set(field.key, v)} autoFocus={i === 0} />;
        })
        : GROUPS.map(([heading, fields]) => (
          <section key={heading}>
            <p className="group-h">{heading}</p>
            {fields.map((field) => (
              <Field key={field.key} field={field} value={form[field.key]}
                onChange={(v) => set(field.key, v)} />
            ))}
          </section>
        ))}

      {error && <Banner kind="bad">{error}</Banner>}
      {saved && <Banner kind="good">حُفظ ✓</Banner>}
      <div className="formbar">
        <button className="btn btn-go btn-lg" disabled={busy}>{busy ? '…' : 'احفظ'}</button>
        {!compact && <span className="faint">{r.canApply
          ? 'ملفك يكفي للتقديم ✓'
          : `ينقص: ${r.missingApply.slice(0, 2).map((f) => f.label).join('، ')}${r.missingApply.length > 2 ? ` +${r.missingApply.length - 2}` : ''}`}</span>}
      </div>
    </form>
  );
}

/** The stored path is `<user>/<stamp>-<name>`; only the last part was ever the file. */
function cvName(path) {
  const base = String(path).split('/').pop() ?? '';
  return base.replace(/^\d+-/, '');
}

// The editor's three blocks, in the order APPLY_FIELDS declares them.
const GROUPS = APPLY_FIELDS.reduce((acc, f) => {
  const g = f.group ?? 'غير ذلك';
  const row = acc.find(([name]) => name === g);
  if (row) row[1].push(f); else acc.push([g, [f]]);
  return acc;
}, []);

// ───────────────────────────────────────────────────────────────── settings ──
/** What you want to see, and how far the robot may go. Separate from who you are. */
function Settings({ user, profile, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({
    roles: profile.roles ?? [], skill_areas: profile.skill_areas ?? [],
    extra_skills: (profile.extra_skills ?? []).join('، '),
    cities: profile.cities ?? [], accept_remote: profile.accept_remote ?? true,
    avoid_software_roles: profile.avoid_software_roles ?? false,
    auto_apply: profile.auto_apply ?? false,
    auto_submit: profile.auto_submit ?? false,
    auto_queue: profile.auto_queue ?? false,
    skip_first_three: profile.skip_first_three ?? false,
    auto_queue_above: profile.auto_queue_above ?? 75,
    daily_cap: profile.daily_cap ?? 20,
    exclude_title_words: (profile.exclude_title_words ?? []).join('، '),
    exclude_companies: (profile.exclude_companies ?? []).join('، '),
    min_score: profile.min_score ?? 70,
    // Not a column: kept with the answers it governs (profiles.answers._settings).
    guess: profile.answers?._settings?.guess === true,
    server: profile.answers?._settings?.server === true
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const pool = useJobPool({ ...profile, ...form });
  const ext = useExtension();
  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setSaved(false); };
  const listOf = (s) => String(s).split(/[,،\n]/).map((x) => x.trim()).filter(Boolean);

  const patch = useMemo(() => {
    const { guess, server, ...columns } = form;
    const was = profile.answers?._settings ?? {};
    return {
      ...columns,
      extra_skills: listOf(form.extra_skills),
      exclude_title_words: listOf(form.exclude_title_words),
      exclude_companies: listOf(form.exclude_companies),
      min_score: Number(form.min_score) || 0,
      // The answers column is only written when this switch moved: the worker writes its
      // estimates there too, and a save that changed nothing must not write over them.
      ...(guess !== (was.guess === true) || server !== (was.server === true)
        ? { answers: { ...(profile.answers ?? {}), _settings: { ...was, guess, server } } }
        : {})
    };
  }, [form, profile.answers]);

  // Every control shows what it costs: how many jobs survive it, recomputed as you touch it.
  const scored = useMemo(() => scoreAll(pool, { ...profile, ...patch }), [pool, patch]);
  const shown = scored?.filter((r) => r.score >= patch.min_score).length;
  const r = readiness(profile, { extension: !!ext || form.server });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from('profiles')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', user.id).select().single();
    setBusy(false);
    if (error) { toast.fail(errorAr(error), () => save(e)); return; }
    onDone(data); setSaved(true);
  }

  return (
    <>
      <form className="card" onSubmit={save}>
        {scored && (
          <p className="tally"><b>{shown}</b> وظيفة ستظهر لك بهذا الضبط
            {shown === 0 && scored.length > 0 && <> · أقرب درجة {scored[0].score}</>}
          </p>
        )}

        <div className="field">
          <label>مجالاتك — بالترتيب</label>
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
          <RankedChips options={CITIES} value={form.cities} onChange={(v) => set('cities', v)} />
        </div>

        <div className="field">
          <label htmlFor="min">أقل درجة تستحق الإظهار — {form.min_score}</label>
          <p className="hint">انزل بها لترى أكثر، وارفعها لترى الأقرب فقط.</p>
          <input id="min" type="range" min="40" max="95" step="5" value={form.min_score}
            onChange={(e) => set('min_score', e.target.value)} />
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
          <label htmlFor="exw">كلمات تُخفي الوظيفة</label>
          <p className="hint">مثل: sales، teacher. افصل بفاصلة.</p>
          <input id="exw" type="text" value={form.exclude_title_words} onChange={(e) => set('exclude_title_words', e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="exc">شركات لا تريد رؤيتها</label>
          <input id="exc" type="text" value={form.exclude_companies} onChange={(e) => set('exclude_companies', e.target.value)} />
        </div>

        <hr className="rule" />

        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            <input type="checkbox" checked={form.auto_apply} disabled={!r.canApply}
              onChange={(e) => set('auto_apply', e.target.checked)} /> <b>قدّم عني تلقائياً</b>
          </label>
          {r.canApply
            ? <p className="hint">
                كل وظيفة تضغط عليها «يهمني» تُعبّأ وتُرسل عنك.
                {ext ? <> الإضافة متصلة ✓</>
                  : form.server ? <> من الخادم — لا إضافة في هذا المتصفح.</>
                    : <> تحتاج إضافة المتصفح — <a href="#help">خطوة واحدة</a>، أو فعّل «من الخادم» أدناه.</>}
              </p>
            : <p className="hint">
                يحتاج أولاً: {r.missingApply.map((f) => f.label).join('، ')}.
                {' '}<a href="#profile">أكمل ملفك</a>
              </p>}
        </div>

        {form.auto_apply && r.canApply && (
          <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
            <label>
              <input type="checkbox" checked={form.auto_submit}
                onChange={(e) => set('auto_submit', e.target.checked)} /> <b>وأرسل بنفسك — لا تنتظر ضغطتي</b>
            </label>
            <p className="hint">
              أول ثلاثة طلبات تُعبَّأ وتُترك لك مهما كان هذا المفتاح: ترى بعينك ما يخرج باسمك،
              ثم يمشي وحده. وفي كل الأحوال لا يتجاوز {form.daily_cap} طلباً في اليوم،
              وواحداً لكل شركة في الأسبوع.
            </p>
            <label htmlFor="cap" style={{ marginTop: 10 }}>أكثر عدد في اليوم — {form.daily_cap}</label>
            <input id="cap" type="range" min="1" max="40" step="1" value={form.daily_cap}
              onChange={(e) => set('daily_cap', Number(e.target.value))} />

            <label style={{ marginTop: 12 }}>
              <input type="checkbox" checked={form.skip_first_three}
                onChange={(e) => set('skip_first_three', e.target.checked)} /> أرسل من أول طلب
            </label>
            <p className="hint">
              افتراضاً تُعبَّأ أول ثلاثة وتُترك لك لتراها بعينك قبل أن تخرج باسمك. فعّل هذا
              وتُرسل من الأول — ويبقى السقف اليومي وواحد لكل شركة أسبوعياً كما هما.
            </p>

            <hr className="rule" />

            <label>
              <input type="checkbox" checked={form.auto_queue}
                onChange={(e) => set('auto_queue', e.target.checked)} /> <b>ولا تنتظر ضغطة «يهمني»</b>
            </label>
            <p className="hint">
              كل ١٥ دقيقة نقرأ اللوحات. ما تجاوز درجتك أدناه يدخل الطابور وحده، ومتصفّحك يقدّم
              عليه. لا تفتح الموقع ولا تضغط شيئاً — يكفي أن يبقى Chrome مفتوحاً والإضافة فيه.
            </p>
            {form.auto_queue && (
              <>
                <label htmlFor="aq" style={{ marginTop: 10 }}>لا تقدّم عنّي إلا فوق — {form.auto_queue_above}</label>
                <p className="hint">
                  {scored
                    ? <>بهذا الحدّ، <b>{scored.filter((r) => r.score >= form.auto_queue_above).length}</b> من
                      وظائف اليوم كانت ستدخل الطابور وحدها.</>
                    : 'يُحسب…'}
                </p>
                <input id="aq" type="range" min="50" max="100" step="5" value={form.auto_queue_above}
                  onChange={(e) => set('auto_queue_above', Number(e.target.value))} />
              </>
            )}

            <hr className="rule" />

            <label>
              <input type="checkbox" checked={form.guess}
                onChange={(e) => set('guess', e.target.checked)} /> <b>وأجب عني ما لا جواب له</b>
            </label>
            <p className="hint">
              أسئلة الاستمارة التي لا يجيبها ملفك — «كم سنة خبرتك في كذا؟»، «لماذا نحن؟» — يجيبها قدّم
              من سيرتك بتقديره، ومع «أرسل بنفسك» تخرج <b>بلا أن تقرأها</b>. لا يذكر جهة عمل ولا شهادة
              ولا راتباً ليست في سيرتك، وما لا يُجاب إلا باختراع يتركه لك.
            </p>
            <p className="hint">
              ولا يجيب الإقرارات مهما كان: حقّك في العمل والكفالة، السجل، الأقارب في الشركة،
              «أقرّ أن ما سبق صحيح». هذه تبقى لك.
            </p>
            <p className="hint">
              لصياغة الجواب تُرسل سيرتك وملفك وأسئلة الاستمارة إلى Google (Gemini، الطبقة المجانية)،
              وGoogle قد تستعمل ما يُرسل إليها في هذه الطبقة لتحسين خدماتها.
              وكل ما أُجيب به عنك يبقى مكتوباً على طلبه في «طلباتي».
            </p>

            <hr className="rule" />

            <label>
              <input type="checkbox" checked={form.server}
                onChange={(e) => set('server', e.target.checked)} /> <b>وقدّم من الخادم — بلا حاسب</b>
            </label>
            <p className="hint">
              متصفح على خادم يفتح الاستمارة ويعبّيها ويرسلها كما تفعل الإضافة، فتضغط «يهمني» من جوالك
              وحاسبك مغلق. لهذا يدخل الخادم بحسابك لحظة التقديم، وتمرّ به سيرتك وإجاباتك، ثم يخرج.
            </p>
            <p className="hint">
              <b>تجريبي.</b> الشركات تفحص من يرسل، وقد ترفض متصفحاً على خادم — وقدّم لا يتحايل على
              الفحص. ما أُرسل ولم يتأكد وصوله يظهر في «طلباتي» كما هو، ولا يُعاد وحده. ويبدأ
              التقديم خلال دقيقة أو دقيقتين من ضغطتك.
            </p>
          </div>
        )}

        {saved && <Banner kind="good">حُفظ ✓</Banner>}
        <div className="formbar">
          <button className="btn btn-go btn-lg" disabled={busy}>{busy ? '…' : 'احفظ'}</button>
          {scored && <span className="faint">{shown} وظيفة بهذا الضبط</span>}
        </div>
      </form>

      <DangerZone user={user} profile={profile} />
    </>
  );
}

/**
 * Deleting the account, and actually checking that it happened.
 *
 * This used to fire three calls and ignore all three answers, then sign the user out — so a
 * failure looked exactly like a success: the page said the data was gone while every row and
 * every file was still there. Postgres cannot delete storage objects at all (Supabase refuses
 * it), so the files have to go through the Storage API from here, before the account itself.
 */
function DangerZone({ user, profile }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function wipe() {
    setBusy(true); setError('');
    try {
      // Everything under this user's folder, not only the CV the profile happens to point at —
      // an earlier upload that was replaced would otherwise outlive the account.
      const { data: files, error: listErr } = await supabase.storage.from('cvs').list(user.id, { limit: 1000 });
      if (listErr) throw listErr;
      const paths = (files ?? []).map((f) => `${user.id}/${f.name}`);
      if (paths.length) {
        const { error: rmErr } = await supabase.storage.from('cvs').remove(paths);
        if (rmErr) throw rmErr;
      }
      const { error: rpcErr } = await supabase.rpc('delete_my_account');
      if (rpcErr) throw rpcErr;
      await supabase.auth.signOut();
    } catch (e) {
      // Still signed in, data still there, and now they know.
      setError(e?.message ? `تعذّر الحذف: ${e.message}` : 'تعذّر الحذف. حاول مرة أخرى.');
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>بياناتك</h2>
      <p className="muted">كل ما نحتفظ به: ملفك، سيرتك، وطلباتك. الحذف فوري ونهائي.</p>
      {error && <Banner kind="bad">{error}</Banner>}
      {confirming
        ? <><Banner kind="bad">سيُحذف حسابك وسيرتك وكل طلباتك. لا يمكن التراجع.</Banner>
          <button className="btn btn-no" disabled={busy} onClick={wipe}>{busy ? 'يُحذف…' : 'نعم، احذف كل شيء'}</button>
          <button className="btn" disabled={busy} onClick={() => { setConfirming(false); setError(''); }}>تراجع</button></>
        : <button className="btn btn-no" onClick={() => setConfirming(true)}>احذف حسابي وبياناتي</button>}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────── jobs ──
/** The extension announces itself on load; without it we simply never show its button. */
function useExtension() {
  const [version, setVersion] = useState(null);
  useEffect(() => {
    const on = (e) => { if (e.source === window && e.data?.type === 'qaddim:extension-ready') setVersion(e.data.version); };
    addEventListener('message', on);
    // The extension announces itself at document_idle, which is usually before this effect
    // runs — so asking is what actually finds it. A couple of retries cover a slow start.
    const ask = () => postMessage({ type: 'qaddim:extension-hello' }, location.origin);
    ask();
    const t1 = setTimeout(ask, 400), t2 = setTimeout(ask, 1500);
    return () => { removeEventListener('message', on); clearTimeout(t1); clearTimeout(t2); };
  }, []);
  return version;
}

/**
 * Hands the extension this user's session and profile. Nothing else leaves this page.
 *
 * Supabase rotates refresh tokens, so a copy handed over once goes stale the first time this
 * tab refreshes — and a stale refresh token is worse than none, because presenting it can end
 * the whole session. The page therefore re-sends on every token refresh (see the effect in
 * Jobs), which keeps the extension on a live access token and makes its own refresh a fallback
 * rather than the normal path.
 */
async function sendToExtension(profile) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  // Same document only; a page on another origin was never a listener here.
  postMessage({
    type: 'qaddim:sync',
    session: {
      url: import.meta.env.VITE_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      token: data.session.access_token,
      // Without this the extension stops working an hour after this page was last open.
      refresh_token: data.session.refresh_token
    },
    profile: forExtension(profile)
  }, location.origin);
}

function Jobs({ user, profile, onProfile }) {
  const toast = useToast();
  const online = useOnline();
  const pool = useJobPool(profile);
  const [actedOn, setActedOn] = useState(null);   // job ids already saved or dismissed
  const [busyId, setBusyId] = useState(null);
  const [sheetFor, setSheetFor] = useState(null);
  const [needFor, setNeedFor] = useState(null);   // job that is waiting on a missing answer
  const [undo, setUndo] = useState(null);
  // One job at a time, two buttons — or the full list. The person's choice, remembered here.
  const [view, setView] = useState(() => { try { return localStorage.getItem('qaddim:view') || 'deck'; } catch { return 'deck'; } });
  const showAs = (v) => { setView(v); try { localStorage.setItem('qaddim:view', v); } catch { /* private window */ } };
  const [more, setMore] = useState(false);
  const [queued, setQueued] = useState(0);
  const ext = useExtension();
  // Something applies for this person when either their own browser has the extension or they
  // chose the server. The page used to ask only about the extension, so on a phone — where no
  // extension can ever be — it went on saying "install the extension" after the server was on.
  const server = profile.answers?._settings?.server === true;
  const r = readiness(profile, { extension: !!ext || server });

  useEffect(() => {
    supabase.from('applications').select('job_id').eq('user_id', user.id)
      .then(({ data }) => setActedOn(new Set((data ?? []).map((a) => a.job_id))));
  }, [user.id]);

  useEffect(() => { if (ext && profile.auto_apply) sendToExtension(profile); }, [ext, profile.auto_apply]);

  // Every time this tab gets a new access token, hand it over. Without this the extension
  // works from a copy that ages out in an hour and then has to spend its refresh token.
  useEffect(() => {
    if (!ext || !profile.auto_apply) return;
    const { data } = supabase.auth.onAuthStateChange((e) => {
      if (e === 'TOKEN_REFRESHED' || e === 'SIGNED_IN') sendToExtension(profile);
    });
    return () => data.subscription.unsubscribe();
  }, [ext, profile.auto_apply, profile.id]);

  const scored = useMemo(() => scoreAll(pool, profile), [pool, profile]);
  // An empty screen is never the right answer to "show me jobs". If the threshold clears the
  // page, we show the closest we have and say so, rather than implying nothing exists.
  const { rows, fallback } = useMemo(() => {
    if (!scored || !actedOn) return { rows: null, fallback: false };
    const live = scored.filter((x) => !actedOn.has(x.job.id));
    const above = live.filter((x) => x.score >= (profile.min_score ?? START_SCORE));
    return above.length
      ? { rows: above.slice(0, 40), fallback: false }
      : { rows: live.slice(0, 10), fallback: true };
  }, [scored, actedOn, profile.min_score]);

  async function act(job, status, fresh) {
    const me = fresh ?? profile;
    // "Interested" means apply. If we cannot apply yet, ask for the missing answers first —
    // at the moment they matter, not in a form before any job was ever seen.
    if (status === 'saved' && !readiness(me, { extension: !!ext || me.answers?._settings?.server === true }).canApply) { setNeedFor(job); return; }
    setBusyId(job.id);
    const row = { user_id: user.id, job_id: job.id, status };
    // Only queue when something will actually drain the queue. Without the extension these
    // rows sit at "في الطابور" for ever while the bar counts them as pending work — and the
    // same is true of a job on a system the extension has no script for.
    // (The server counts as "something": with it switched on, a phone with no extension can
    // queue an application and a browser elsewhere sends it.)
    const sendable = me.auto_apply && (ext || me.answers?._settings?.server === true) && autoApplyable(job.url);
    if (status === 'saved' && sendable) row.auto_status = 'queued';
    const { error } = await supabase.from('applications').upsert(row, { onConflict: 'user_id,job_id' });
    setBusyId(null);
    if (error) { toast.fail(errorAr(error), () => act(job, status, fresh)); return; }
    setActedOn((s) => new Set(s).add(job.id));
    if (status === 'closed') {
      setUndo(job);
      setTimeout(() => setUndo((u) => (u?.id === job.id ? null : u)), 7000);
    } else if (sendable) {
      if (ext) sendToExtension(me);
      setQueued((n) => n + 1);
      toast.ok(ext ? 'في الطابور — متصفحك يقدّم عليها الآن' : 'في الطابور — يبدأ التقديم من الخادم خلال دقيقة أو دقيقتين');
    } else {
      // Not one that can be sent for them: say why, and bring the fill sheet into view. On a
      // phone it opened at the top of a page scrolled half-way down, and the press looked like
      // it had done nothing at all.
      setSheetFor(job);
      toast.ok(me.auto_apply && !autoApplyable(job.url)
        ? 'حُفظت في «طلباتي» · هذه يُقدَّم عليها من صفحة الشركة — ورقة التعبئة فوق'
        : 'حُفظت في «طلباتي» · ورقة التعبئة فوق');
      setTimeout(() => document.getElementById('apply-sheet')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    }
  }

  async function undoReject(job) {
    const { error } = await supabase.from('applications').delete().eq('user_id', user.id).eq('job_id', job.id);
    if (error) { toast.fail(errorAr(error), () => undoReject(job)); return; }
    setActedOn((s) => { const n = new Set(s); n.delete(job.id); return n; });
    setUndo(null);
  }

  if (rows === null) return <><Skeleton /><Skeleton /></>;

  const nextStep = !r.done[1] ? 'أكمل ملفك لتقدّم'
    : !r.done[2] ? 'أجب ما يسأله أصحاب العمل'
      : 'فعّل «من الخادم» أو ثبّت الإضافة';

  // When something applies for them, the deck holds only jobs it can apply to: a job that
  // must be done by hand on the employer's site does not belong behind a one-tap «يهمني».
  const sends = profile.auto_apply && (ext || server);
  const deck = sends ? rows.filter((x) => autoApplyable(x.job.url)) : rows;
  const byHand = rows.length - deck.length;
  const top = deck[0];
  const ready = r.done.every(Boolean);

  if (view === 'deck') {
    return (
      <div className="deck">
        {!online && <Banner kind="bad">لا اتصال بالشبكة — ما تضغطه الآن لن يُحفظ.</Banner>}
        {/* Only what stands in the way is said here; everything else lives in the list view. */}
        {!ready && <a className="deck-need" href={r.done[1] && r.done[2] ? '#settings' : '#profile'}>{nextStep} ←</a>}
        {needFor && (
          <div className="card" style={{ borderColor: 'var(--blue-soft)' }}>
            <p style={{ margin: 0, fontWeight: 800, color: '#fff' }}>قبل أن نقدّم على «{needFor.title}»</p>
            <p className="faint" style={{ margin: '6px 0 14px' }}>
              ينقص: {r.missingApply.map((f) => f.label).join('، ')}. اكتبها مرة واحدة وتُستخدم في كل طلب بعدها.
            </p>
            <ApplyProfile user={user} profile={profile} compact onDone={onProfile}
              onSaved={(saved) => { const j = needFor; setNeedFor(null); act(j, 'saved', saved); }} />
            <button className="btn" onClick={() => setNeedFor(null)}>ليس الآن</button>
          </div>
        )}
        {sheetFor && <div id="apply-sheet" style={{ scrollMarginTop: 72 }}><ApplySheet profile={profile} job={sheetFor} onClose={() => setSheetFor(null)} /></div>}

        {!top ? (
          <div className="card deck-card deck-empty">
            <p className="deck-title">خلصت الوظائف لليوم</p>
            <p className="faint" style={{ margin: '8px 0 0' }}>نقرأ اللوحات كل ١٥ دقيقة، وما يطابقك يظهر هنا.</p>
            <a className="btn" href="#settings" style={{ marginTop: 16 }}>وسّع بحثك</a>
          </div>
        ) : (
          <article className="card deck-card" key={top.job.id}>
            <div className="deck-meta">
              <Score value={top.score} />
              <span className="faint">{deck.length > 1 ? `باقي ${deck.length - 1}` : 'الأخيرة'}</span>
            </div>
            <p className="deck-title">{top.job.title}</p>
            <p className="deck-where">{top.job.company} · {AR_CITY[top.job.city] || top.job.location}</p>
            <p className="faint" style={{ margin: '6px 0 0' }}>
              {top.job.salary_published ? `الراتب ${top.job.salary_published}` : L.noSalary}
              {ageOf(top.job.published_at) && <> · {ageOf(top.job.published_at)}</>}
            </p>
            {!!top.reasons?.length && <ul className="reasons">{top.reasons.slice(0, 3).map((x, i) => <li key={i}>{reasonAr(x)}</li>)}</ul>}
            {more ? (
              <>
                {!!top.gaps?.length && <p className="faint" style={{ marginTop: 8 }}>فجوات: {top.gaps.slice(0, 3).map(gapAr).join(' · ')}</p>}
                <p style={{ margin: '10px 0 0', fontSize: 14 }}><a href={top.job.url} target="_blank" rel="noopener noreferrer">{L.openListing} ↗</a></p>
              </>
            ) : (
              <button type="button" className="notes-add" onClick={() => setMore(true)}>تفاصيل</button>
            )}
          </article>
        )}

        {top && (
          <div className="deck-actions">
            <button className="btn deck-no" disabled={busyId === top.job.id} onClick={() => { setMore(false); act(top.job, 'closed'); }}>لا يهمني</button>
            <button className="btn btn-go deck-yes" disabled={busyId === top.job.id} onClick={() => { setMore(false); act(top.job, 'saved'); }}>يهمني</button>
          </div>
        )}

        {undo && (
          <div className="snack">
            أُخفيت «{undo.title}»
            <button className="btn" onClick={() => undoReject(undo)}>تراجع</button>
          </div>
        )}

        <p className="deck-foot">
          {sends && <><span className="dot" /> يقدّم عنك {ext ? 'من متصفحك' : 'من الخادم'}{queued > 0 && <> · {queued} في الطابور</>} · </>}
          <button type="button" className="linkish" onClick={() => showAs('list')}>
            {byHand > 0 ? `القائمة كاملة (+${byHand} تقدّم عليها بنفسك)` : 'القائمة كاملة'}
          </button>
        </p>
      </div>
    );
  }

  return (
    <>
      {!online && <Banner kind="bad">لا اتصال بالشبكة — ما تضغطه الآن لن يُحفظ.</Banner>}
      <p className="deck-foot" style={{ marginTop: 0 }}>
        <button type="button" className="linkish" onClick={() => showAs('deck')}>وظيفة وحدة بزرّين ←</button>
      </p>
      <Live open={pool?.length ?? null} updatedAt={pool?.[0]?.last_seen} />

      <Ladder rungs={RUNGS} done={r.done} nextLabel={nextStep}
        onNext={() => { location.hash = r.done[1] && r.done[2] ? 'settings' : 'profile'; }} />

      {profile.auto_apply && (ext || server) && (
        <p className="faint" style={{ margin: '0 0 14px' }}>
          <span className="dot" /> التقديم التلقائي يعمل · {ext ? `الإضافة ${ext}` : 'من الخادم، بلا حاسب'}
          {queued > 0 && <> · {queued} في الطابور</>}
        </p>
      )}

      {profile.auto_apply && !ext && !server && (
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>التقديم التلقائي مفعّل — والإضافة غير متصلة</p>
          <p className="faint" style={{ margin: '6px 0 0' }}>
            «يهمني» الآن يحفظ الوظيفة ويفتح لك ورقة التعبئة، ولا يدخل الطابور — لأن لا شيء
            سيُفرغه. {browserKind() === 'chrome'
              ? 'ثبّت الإضافة ثم ارجع لهذه الصفحة.'
              : `الإضافة تعمل في Chrome على حاسب، وأنت الآن في ${BROWSER_AR[browserKind()]}.`}
            {' '}<a href="#settings">أو فعّل «وقدّم من الخادم» في الضبط</a> — فيقدّم عنك بلا حاسب.
          </p>
        </div>
      )}

      {undo && (
        <div className="snack">
          أُخفيت «{undo.title}»
          <button className="btn" onClick={() => undoReject(undo)}>تراجع</button>
        </div>
      )}

      {needFor && (
        <div className="card" style={{ borderColor: 'var(--blue-soft)' }}>
          <p style={{ margin: 0, fontWeight: 800, color: '#fff' }}>قبل أن نقدّم على «{needFor.title}»</p>
          <p className="faint" style={{ margin: '6px 0 14px' }}>
            ينقص: {r.missingApply.map((f) => f.label).join('، ')}. اكتبها مرة واحدة وتُستخدم في كل طلب بعدها.
          </p>
          <ApplyProfile user={user} profile={profile} compact
            onDone={onProfile}
            onSaved={(saved) => { const j = needFor; setNeedFor(null); act(j, 'saved', saved); }} />
          <button className="btn" onClick={() => setNeedFor(null)}>ليس الآن</button>
        </div>
      )}

      {fallback && !!rows.length && (
        <div className="card" style={{ borderColor: 'var(--line)' }}>
          <p style={{ margin: 0, fontWeight: 700 }}>لا شيء فوق {profile.min_score ?? START_SCORE} اليوم</p>
          <p className="faint" style={{ margin: '6px 0 0' }}>
            هذه أقرب ما وجدنا، بدرجاتها كما هي. نقرأ اللوحات كل ١٥ دقيقة.
          </p>
        </div>
      )}

      {!rows.length && scored && (
        <div className="card">
          <p style={{ margin: 0 }}>لم تطابق أي وظيفة مجالاتك ومدنك.</p>
          <p className="faint">جرّب مدينة أخرى، أو أضف مجالاً قريباً من مجالك.</p>
          <a className="btn btn-go" href="#settings">وسّع بحثك</a>
        </div>
      )}

      {sheetFor && <div id="apply-sheet" style={{ scrollMarginTop: 72 }}><ApplySheet profile={profile} job={sheetFor} onClose={() => setSheetFor(null)} /></div>}

      {rows.map(({ job, score, reasons, gaps, flags }) => (
        <article className="card" key={job.id}>
          <div style={{ marginBottom: 10 }}>
            <Score value={score} />
            <span className="faint" style={{ marginInlineStart: 10 }}>{job.arrangement || ''}</span>
          </div>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#fff', lineHeight: 1.25 }}>{job.title}</p>
          {/* The raw location is whatever the board typed — "Riyadh Saudi Arabia, Dubai United
              Arab Emirates". The normalised city is the one the reader asked for. */}
          <p className="muted" style={{ margin: '6px 0 0' }}>
            {job.company} · {AR_CITY[job.city] || job.location}
          </p>
          <p className="faint" style={{ margin: '8px 0 0' }}>
            {job.salary_published ? `الراتب ${job.salary_published}` : L.noSalary}
            {/* A board rarely deletes anything, so an advert can sit there for months. How
                old it is changes whether it is worth an application. */}
            {ageOf(job.published_at) && <> · {ageOf(job.published_at)}</>}
          </p>
          {!!reasons?.length && <ul className="reasons">{reasons.map((r, i) => <li key={i}>{reasonAr(r)}</li>)}</ul>}
          {!!gaps?.length && (
            // Three is a nudge; seven reads as a verdict on the reader.
            <p className="faint" style={{ marginTop: 8 }}>
              فجوات: {gaps.slice(0, 3).map(gapAr).join(' · ')}
              {gaps.length > 3 && ` +${gaps.length - 3}`}
            </p>
          )}
          {/* The salary line above already says it; a warning band repeating it is noise. */}
          {(() => {
            const real = (flags || []).filter((f) => (f.code ?? f) !== 'no_salary');
            return real.length ? <Banner kind="warn">{real.map(flagAr).join(' · ')}</Banner> : null;
          })()}
          <p style={{ margin: '12px 0 0', fontSize: 14 }}>
            <a href={job.url} target="_blank" rel="noopener noreferrer">{L.openListing} ↗</a>
            {profile.auto_apply && !autoApplyable(job.url) && (
              <span className="faint"> · التقديم عليها يدوي: نظامها يطلب حساباً عند الشركة</span>
            )}
          </p>
          {/* Passing on a job is not deleting anything — it used to be painted in the same red
              as "delete my account", which made the quieter of the two choices the louder one. */}
          <div className="card-actions">
            <button className="btn btn-go" disabled={busyId === job.id} onClick={() => act(job, 'saved')}>
              {profile.auto_apply && (ext || server) && autoApplyable(job.url) ? 'يهمني — قدّم لي' : L.approve}
            </button>
            <button className="btn" disabled={busyId === job.id} onClick={() => act(job, 'closed')}>{L.reject}</button>
          </div>
        </article>
      ))}
    </>
  );
}

const stoppedOn = (row) => (row.auto_report?.missing ?? []).filter((m) => m.q);

/**
 * Whose each question on a stopped application is.
 *
 *   mine    only the person can answer it — it is shown to them
 *   soon    they asked for estimates, and the worker has not reached this one yet
 *   byHand  can only be done on the employer's page
 *
 * A question the worker already answered for this application is nobody's any more — unless
 * the form was tried again afterwards and still stopped on it, which means the estimate did
 * not fit and it is the person's after all.
 */
function whose(row, profile) {
  const answers = profile.answers ?? {};
  const own = new Set(Object.keys(answers).filter((k) => !k.startsWith('_')).map(sameWords));
  const forJob = answers._for?.[row.job?.id];
  const drafted = new Map(Object.entries(forJob?.answers ?? {}).map(([q, v]) => [sameWords(q), v]));
  const stale = forJob?.at && row.auto_at && row.auto_at > forJob.at;
  const guessing = answers._settings?.guess === true;
  const out = { mine: [], soon: 0, byHand: [] };
  for (const m of stoppedOn(row)) {
    if (m.manual) { out.byHand.push(m); continue; }
    const k = sameWords(m.q);
    // Sponsorship and the right to work depend on the country: an answer saved for the
    // words alone does not answer them, only one given for this job does.
    if (m.scope !== 'job' && own.has(k)) continue;
    const draft = drafted.get(k);
    if (draft?.a && !stale) continue;
    if (!drafted.has(k) && guessing && mayGuess(m.q, m.options).ok) { out.soon++; continue; }
    out.mine.push(m);
  }
  return out;
}
// The extension's reason when there is simply nothing in the profile — true of most questions
// here, so repeating it under each one says nothing. Any other reason is worth showing.
const NO_ANSWER = 'لا إجابة عندك لهذا السؤال';
// Questions about the employer whose usual answer can be kept in the profile.
const STANDING = {
  worked_here_before: 'واجعلها جوابي لكل شركة تسأل إن كنت عملت فيها',
  relatives_here: 'واجعلها جوابي لكل شركة تسأل إن كان لي قريب فيها'
};

/**
 * The draft screen: every question that stopped an application, asked once.
 *
 * Measured across our open jobs, nine forms in ten ask something no profile can answer — "have
 * you worked here before?", "why us?" — so this screen is not an error path, it is where most
 * applications pass through. It gathers the questions from every waiting application, shows
 * each one once however many forms asked it, and offers the form's own options when it has
 * them, because an answer in the form's words is the one that is certain to fit next time.
 *
 * It also had never been seen. The list of applications did not ask the database for the
 * report that carries these questions, so the only thing a stopped application ever showed was
 * "try again" — which sent it back to fail on the same question, three times, and then stop.
 */
function Questions({ rows, profile, onProfile, onDone }) {
  const toast = useToast();
  const [draft, setDraft] = useState({});
  const [always, setAlways] = useState({});
  const [busy, setBusy] = useState(false);

  const { list, waiting, soon } = useMemo(() => {
    const byWords = new Map(), waiting = [];
    let soon = 0;
    for (const row of rows) {
      const split = whose(row, profile);
      soon += split.soon;
      const open = split.mine;
      if (!open.length) continue;
      waiting.push(row);
      for (const m of open) {
        // The same words from two employers are one question — unless the answer depends on
        // the job, in which case each job asks its own.
        const k = m.scope === 'job' ? `${sameWords(m.q)}@${row.job?.id}` : sameWords(m.q);
        if (!byWords.has(k)) byWords.set(k, { k, q: m.q.replace(/\s+/g, ' ').trim(), why: m.why, options: m.options, key: m.key, from: [], jobId: m.scope === 'job' ? row.job?.id : null });
        const entry = byWords.get(k);
        if (!entry.options && m.options) entry.options = m.options;
        if (row.job?.company && !entry.from.includes(row.job.company)) entry.from.push(row.job.company);
      }
    }
    return { list: [...byWords.values()], waiting, soon };
  }, [rows, profile.answers]);

  // Nothing for the person, but something on its way: say so, or the applications below
  // look stuck for the quarter of an hour it takes the worker to come round.
  if (!list.length) {
    return soon ? (
      <div className="card questions">
        <p className="questions-h">{soon} سؤالاً يجيب عنها قدّم بالتقدير</p>
        <p className="faint" style={{ margin: '4px 0 0' }}>خلال ربع ساعة تقريباً، ثم تعود طلباتها للطابور وحدها.</p>
      </div>
    ) : null;
  }
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const written = list.filter((x) => String(draft[x.k] ?? '').trim());
  // "Have you worked here before?" will be asked again by the next company in other words.
  // Answering no once can stand for all of them — but only because the person said so.
  const isNo = (v) => /^(no|لا)$/i.test(String(v ?? '').trim());
  const usual = (x) => STANDING[x.key] && isNo(draft[x.k]) && always[x.key] !== false;

  async function save() {
    setBusy(true);
    const answers = { ...(profile.answers ?? {}) };
    for (const x of written.filter((w) => !w.jobId)) answers[x.q] = String(draft[x.k]).trim();
    // An answer that holds for one job is kept with that job, marked as the person's own.
    const perJob = { ...(answers._for ?? {}) };
    for (const x of written.filter((w) => w.jobId)) {
      const was = perJob[x.jobId] ?? {};
      perJob[x.jobId] = { ...was, at: new Date().toISOString(), answers: { ...(was.answers ?? {}), [x.q]: { a: String(draft[x.k]).trim(), basis: 'own' } } };
    }
    if (Object.keys(perJob).length) answers._for = perJob;
    const facts = { ...(answers._facts ?? {}) };
    for (const x of written) if (usual(x)) facts[x.key] = 'لا';
    answers._facts = facts;
    const { data, error } = await supabase.from('profiles').update({ answers }).eq('id', profile.id).select().single();
    if (error) { setBusy(false); toast.fail(errorAr(error), save); return; }
    // Back to the queue goes every application that now has nothing left to ask. One still
    // short an answer would only open the form again to stop at the same place. What can only
    // be done on the employer's page does not hold it back: half of those are things the
    // extension could not do that time — a list that would not open, a CV not yet loaded —
    // and the next attempt is how anyone finds out which half.
    const now = new Set(written.map((x) => x.k));
    const ready = waiting.filter((row) => {
      if (awaitingProof(row)) return false;
      const split = whose(row, profile);
      return !split.soon && split.mine.every((m) => now.has(m.scope === 'job' ? `${sameWords(m.q)}@${row.job?.id}` : sameWords(m.q)));
    });
    const failed = (await Promise.all(ready.map((row) => supabase.rpc('retry_application', { app_id: row.id }))))
      .filter((r) => r.error);
    setBusy(false);
    if (data) onProfile(data);
    setDraft({});
    if (failed.length) toast.fail(errorAr(failed[0].error));
    else toast.ok(ready.length
      ? `حُفظت ${written.length} · عاد ${ready.length} للطابور`
      : `حُفظت ${written.length} · الطلبات تنتظر بقية أسئلتها`);
    onDone();
  }

  return (
    <div className="card questions">
      <p className="questions-h">أسئلة تنتظرك · {list.length}</p>
      <p className="faint" style={{ margin: '4px 0 16px' }}>
        أجب مرة واحدة: الجواب يُحفظ ويُستعمل في كل استمارة تسأل السؤال نفسه. اكتب بلغة السؤال.
        {soon > 0 && <> و{soon} غيرها يجيب عنها قدّم بالتقدير خلال ربع ساعة تقريباً.</>}
      </p>
      {list.map((x, i) => (
        // An English question lays out left to right, controls included: "Yes / No" sitting
        // at the far right of a question that starts at the left reads as belonging elsewhere.
        <div className="field" key={x.k} dir={/[\u0600-\u06FF]/.test(x.q) ? 'rtl' : 'ltr'}>
          <label htmlFor={`q${i}`}>{x.q}</label>
          <p className="hint" dir="auto">
            {x.from.join('، ')}
            {x.jobId ? ' · لهذه الوظيفة وحدها: جوابه يختلف من بلد لآخر' : x.why && x.why !== NO_ANSWER ? ` · ${x.why}` : ''}
          </p>
          {x.options && x.options.length <= 5
            ? <div className="pick">
                {x.options.map((o) => (
                  <button key={o} type="button" className="chip" aria-pressed={draft[x.k] === o}
                    onClick={() => set(x.k, draft[x.k] === o ? '' : o)}>{o}</button>
                ))}
              </div>
            : x.options
              ? <select id={`q${i}`} value={draft[x.k] ?? ''} onChange={(e) => set(x.k, e.target.value)}>
                  <option value="">—</option>
                  {x.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              : <input id={`q${i}`} type="text" value={draft[x.k] ?? ''} onChange={(e) => set(x.k, e.target.value)} />}
          {STANDING[x.key] && isNo(draft[x.k]) && (
            <label className="usual" dir="rtl">
              <input type="checkbox" checked={always[x.key] !== false}
                onChange={(e) => setAlways((a) => ({ ...a, [x.key]: e.target.checked }))} /> {STANDING[x.key]}
            </label>
          )}
        </div>
      ))}
      <div className="formbar">
        <button className="btn btn-go btn-lg" disabled={busy || !written.length} onClick={save}>
          {busy ? '…' : 'احفظ'}
        </button>
        <span className="faint">{written.length} من {list.length}</span>
      </div>
    </div>
  );
}

/**
 * What قدّم answered for this application by estimate. Nobody read these before they went —
 * that was the point of asking for them — so the least the page owes is to keep them where
 * they can be read afterwards, on the application they were written for.
 */
function Estimated({ row, profile }) {
  const said = Object.entries(profile.answers?._for?.[row.job?.id]?.answers ?? {}).filter(([, v]) => v?.a && v.basis !== 'own');
  if (!said.length) return null;
  return (
    <details className="estimated">
      <summary>أجاب قدّم عنك بالتقدير · {said.length}</summary>
      {said.map(([q, v]) => (
        <div key={q} dir={/[\u0600-\u06FF]/.test(q) ? 'rtl' : 'ltr'}>
          <p className="q">{q}</p>
          <p className="a">{v.a}</p>
        </div>
      ))}
    </details>
  );
}

/** What is left on one stopped application once its questions have a screen of their own. */
function Stopped({ row, profile, onDone }) {
  const toast = useToast();
  const { mine: open, soon, byHand } = whose(row, profile);
  return (
    <div className="blocked">
      {open.length > 0 && <p className="blocked-h">ينتظر جوابك عن {open.length} — في أعلى الصفحة</p>}
      {soon > 0 && <p className="blocked-h" style={{ color: 'var(--blue-soft)' }}>{soon} يجيب عنها قدّم بالتقدير قريباً</p>}
      {byHand.length > 0 && (
        <>
          <p className="blocked-h">يُكمَل في صفحة الشركة</p>
          <ul className="reasons" style={{ marginTop: 0 }}>
            {byHand.map((m, i) => (
              <li key={i}><span dir="auto" style={{ display: 'block' }}>{m.q}</span>
                {m.why && <span className="faint">{m.why}</span>}</li>
            ))}
          </ul>
        </>
      )}
      {open.length === 0 && soon === 0 && (
        <button className="btn btn-go" onClick={async () => {
          const { error } = await supabase.rpc('retry_application', { app_id: row.id });
          if (error) toast.fail(errorAr(error)); else { toast.ok('عاد للطابور'); onDone(); }
        }}>أعد المحاولة</button>
      )}
    </div>
  );
}

/**
 * Send was pressed, and the employer's page never said it arrived.
 *
 * This is the one place an application can be sent twice, so it is the one card with no
 * "try again". It has two answers and both are the person's: it arrived (they found the
 * confirmation), or it did not — and that one takes a second, differently worded press,
 * because the cost of being wrong is a duplicate under their name.
 */
function Unverified({ row, profile, onArrived, onDone }) {
  const toast = useToast();
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const sent = sentOf(row);
  const at = new Date(sent.pressed_at);
  const when = Number.isNaN(at.getTime()) ? '' : at.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
  const company = row.job?.company || 'الشركة';

  async function again() {
    setBusy(true);
    // Its owner's word is what re-arms it; the record of the first press stays on the report.
    const back = profile.auto_apply && autoApplyable(row.job?.url);
    const { error } = await supabase.from('applications').update({
      auto_report: { ...(row.auto_report ?? {}), sent: { ...sent, rearmed: new Date().toISOString() } },
      auto_status: back ? 'queued' : null, auto_reason: null, auto_attempts: 0
    }).eq('id', row.id);
    if (!error) {
      await supabase.from('application_events').insert({
        application_id: row.id, user_id: profile.id, kind: 'note', detail: 'قلتَ إنه لم يصل — يُعاد الإرسال'
      });
    }
    setBusy(false);
    if (error) toast.fail(errorAr(error)); else { toast.ok(back ? 'عاد للطابور' : 'صار لك أن تقدّم عليه من صفحته'); onDone(); }
  }

  return (
    <div className="blocked unverified">
      <p className="blocked-h">ضُغط زر الإرسال{when ? ` ${when}` : ''} — ولم تؤكّد صفحة {company} الاستلام</p>
      <p className="faint" style={{ margin: '0 0 12px' }}>
        {sent.outcome === 'code'
          ? <>الشركة أرسلت رمز تحقق إلى بريدك. أدخله في تبويبها المفتوح، ثم علّمه «قدّمت».</>
          : <>قد يكون وصل. ابحث في بريدك عن رسالة تأكيد من {company} قبل أي شيء: إعادة الإرسال وهو واصل تجعله طلبين باسمك.</>}
        {sent.inferred && <> (سُجّل قبل أن يحفظ قدّم لحظة الضغط، فالضغطة نفسها مرجَّحة لا مؤكَّدة.)</>}
      </p>
      <div className="card-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-go" onClick={onArrived}>وصل — قدّمت</button>
        {!sure
          ? <button className="btn" onClick={() => setSure(true)}>لم يصل</button>
          : <button className="btn btn-no" disabled={busy} onClick={again}>{busy ? '…' : 'تأكدتُ من بريدي — أعد الإرسال'}</button>}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── applications ──
const STATUSES = ['saved', 'applied', 'interview', 'offer', 'closed'];

/**
 * What the robot is doing right now, in the user's own words — and the one control that
 * stops all of it. Stopping holds the queue where it is: nothing is opened, nothing is sent,
 * nothing is answered by estimate, nothing is queued on its own, until it is resumed.
 */
function RunBar({ stats, paused, onPause }) {
  const [busy, setBusy] = useState(false);
  const flip = async () => { setBusy(true); await onPause(!paused); setBusy(false); };
  // Stopped is said even when the numbers could not be read: it is the one line here that
  // must never be missing.
  if (!stats && !paused) return null;
  const { queued = 0, sent_today, cap, approved, auto_submit, submitting, auto_today } = stats ?? {};
  if (paused) {
    return (
      <div className="runbar runbar-stopped" role="status">
        <span><b>الأتمتة موقوفة</b> — لا شيء يُفتح ولا يُرسل{queued > 0 && <> · {queued} في الطابور تنتظر</>}</span>
        <button className="btn btn-go" disabled={busy} onClick={flip}>{busy ? '…' : 'استأنف'}</button>
      </div>
    );
  }
  return (
    <div className="runbar">
      <span><b>{sent_today}</b> من {cap} أُرسلت اليوم</span>
      {queued > 0 && <span><b>{queued}</b> في الطابور</span>}
      {auto_today > 0 && <span><b>{auto_today}</b> دخلت وحدها اليوم</span>}
      {!auto_submit
        ? <span className="off">الإرسال التلقائي مطفأ — <a href="#settings">شغّله</a></span>
        : submitting
          ? <span className="on"><span className="dot" /> يرسل وحده</span>
          : <span className="off">يعبّي ويتركها لك · {3 - approved} باقية قبل أن يرسل وحده</span>}
      <button className="runbar-stop" disabled={busy} onClick={flip}>{busy ? '…' : 'أوقف كل شيء'}</button>
    </div>
  );
}

/**
 * A note, when there is one to write.
 *
 * Every card used to carry an open, empty text box: on a phone that is 140px of furniture
 * per application for something most applications never get. It opens on a tap, and stays
 * open for ever after on the ones that have a note.
 */
function Notes({ row, onSave }) {
  const [open, setOpen] = useState(!!row.notes);
  if (!open) return <button type="button" className="notes-add" onClick={() => setOpen(true)}>+ أضف ملاحظة</button>;
  return (
    <div className="field" style={{ marginTop: 12, marginBottom: 0 }}>
      <label htmlFor={`n${row.id}`}>ملاحظات</label>
      <textarea id={`n${row.id}`} rows={2} autoFocus={!row.notes} defaultValue={row.notes ?? ''}
        onBlur={(e) => onSave(e.target.value)} />
    </div>
  );
}

function Applications({ user, profile, onProfile }) {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sheetFor, setSheetFor] = useState(null);
  // Sent, or not — that is all this page has to say by default. The full view (statuses to
  // move, notes, fill sheet) is one tap away, and the choice is remembered in this browser.
  const [view, setView] = useState(() => { try { return localStorage.getItem('qaddim:apps-view') || 'simple'; } catch { return 'simple'; } });
  const showAs = (v) => { setView(v); try { localStorage.setItem('qaddim:apps-view', v); } catch { /* private window */ } };

  useEffect(() => { load(); }, [user.id]);
  async function load() {
    supabase.rpc('my_apply_stats').then(({ data }) => setStats(data?.[0] ?? null));
    const { data } = await supabase
      .from('applications')
      .select('id, status, notes, applied_on, follow_up_on, auto_status, auto_reason, auto_report, auto_at, job:jobs(*)')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    setRows(data ?? []);
  }
  async function setStatus(row, status) {
    const prev = row.status;
    // Move the list now so the screen answers the tap, but put it back if the write failed.
    setRows((xs) => xs.map((x) => (x.id === row.id ? { ...x, status } : x)));
    // Saying "I applied" (or closing it) takes the application out of the robot's hands: it
    // must not still be sitting in a queue, or waiting to be sent, after its owner has said
    // it is done. Otherwise the form goes out twice.
    const patch = status === 'saved' ? { status } : { status, auto_status: null };
    const { error } = await supabase.from('applications').update(patch).eq('id', row.id);
    if (error) {
      setRows((xs) => xs.map((x) => (x.id === row.id ? { ...x, status: prev } : x)));
      toast.fail(errorAr(error), () => setStatus(row, status));
    } else load();
  }
  /** The kill switch. Kept with the person's other settings, where every part of قدّم reads it. */
  async function setPaused(paused) {
    // Read just before writing: the worker saves its estimates in the same column.
    const { data: fresh } = await supabase.from('profiles').select('answers').eq('id', profile.id).single();
    const answers = { ...(fresh?.answers ?? profile.answers ?? {}) };
    answers._settings = { ...(answers._settings ?? {}), paused };
    const { data, error } = await supabase.from('profiles').update({ answers }).eq('id', profile.id).select().single();
    if (error) { toast.fail(errorAr(error), () => setPaused(paused)); return; }
    onProfile(data);
    toast.ok(paused ? 'أُوقف كل شيء — الطابور يحتفظ بمكانه' : 'استؤنف');
    load();
  }
  /** One application out of the robot's hands: it stays saved, and is theirs to send or not. */
  async function unqueue(row) {
    const { error } = await supabase.from('applications')
      .update({ auto_status: null, auto_reason: 'أخرجتَه من الطابور' }).eq('id', row.id);
    if (error) toast.fail(errorAr(error), () => unqueue(row)); else { toast.ok('خرج من الطابور'); load(); }
  }
  async function requeue(row) {
    const { error } = await supabase.rpc('retry_application', { app_id: row.id });
    if (error) toast.fail(errorAr(error), () => requeue(row)); else { toast.ok('دخل الطابور'); load(); }
  }
  async function setNotes(row, notes) {
    if ((row.notes ?? '') === notes) return;
    const { error } = await supabase.from('applications').update({ notes }).eq('id', row.id);
    if (error) toast.fail(errorAr(error), () => setNotes(row, notes));
    else toast.ok('حُفظت الملاحظة');
  }

  if (rows === null) return <Skeleton />;
  const today = new Date().toISOString().slice(0, 10);

  // Two things interrupt a day: an application the robot stopped on, and one due for a nudge.
  // They lead, whatever filter is on, because a list sorted only by date buries both.
  // (Where an application stands is asked of one place — the same one the worker asks — so
  // that "send was pressed and never confirmed" is urgent whatever the two status fields say.)
  const state = new Map(rows.map((r) => [r.id, stateOf(r)]));
  const urgent = rows.filter((r) => state.get(r.id) === 'ACTION_REQUIRED' || state.get(r.id) === 'FAILED'
    || (r.status === 'applied' && r.follow_up_on && r.follow_up_on <= today));
  const paused = isPaused(profile);
  const TONE = { SUBMITTED: 'var(--good)', READY: 'var(--blue-soft)', PREPARING: 'var(--blue-soft)', SUBMITTING: 'var(--blue-soft)' };
  const rest = rows.filter((r) => !urgent.includes(r));
  const shown = filter === 'all' ? rest : rest.filter((r) => r.status === filter);
  const count = (s) => rows.filter((r) => r.status === s).length;

  if (view === 'simple') {
    /** One line about one application: was it sent, and if not, the one thing that moves it. */
    const verdict = (row) => {
      const st = state.get(row.id);
      const when = (iso) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long' }) : ''; };
      if (st === 'SUBMITTED') return { tone: 'sent', text: `أُرسل ✓ ${when(row.applied_on || row.auto_at)}`, rank: 3 };
      if (st === 'READY' || st === 'PREPARING' || st === 'SUBMITTING') {
        return { tone: 'going', text: paused ? 'لم يُرسل — موقوف (أوقفتَ الإرسال)' : st === 'READY' ? 'لم يُرسل بعد — في الطريق' : 'يُرسل الآن…', rank: 2 };
      }
      if (awaitingProof(row)) return { tone: 'ask', text: 'أُرسل؟ لم تؤكّد الشركة', rank: 0, proof: true };
      if (st === 'ACTION_REQUIRED' || st === 'FAILED') {
        const split = whose(row, profile);
        if (split.mine.length) return { tone: 'ask', text: `لم يُرسل — ينتظر جوابك عن ${split.mine.length} سؤال فوق`, rank: 0 };
        if (split.soon) return { tone: 'going', text: 'لم يُرسل — قدّم يجيب أسئلته الآن، ثم يُرسل', rank: 1 };
        return { tone: 'ask', text: 'لم يُرسل — تعذّر آلياً', rank: 1, retry: true, page: true };
      }
      if (st === 'CANCELLED' || st === 'DUPLICATE') return null;
      return autoApplyable(row.job?.url)
        ? { tone: 'idle', text: 'لم يُرسل', rank: 4, send: true }
        : { tone: 'idle', text: 'لم يُرسل — يُقدَّم عليها من صفحة الشركة', rank: 4, page: true };
    };
    const list = rows.map((row) => ({ row, v: verdict(row) })).filter((x) => x.v).sort((a, b) => a.v.rank - b.v.rank);
    const sent = list.filter((x) => x.v.tone === 'sent').length;
    const going = list.filter((x) => x.v.tone === 'going').length;
    const waiting = list.filter((x) => x.v.tone === 'ask').length;
    return (
      <>
        <p className="apps-sum"><b>{sent}</b> أُرسل · <b>{going}</b> في الطريق · <b>{waiting}</b> ينتظرك</p>
        {paused && (
          <div className="deck-need" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span>الإرسال موقوف</span>
            <button className="btn btn-go" style={{ margin: 0 }} onClick={() => setPaused(false)}>شغّله</button>
          </div>
        )}
        <Questions rows={urgent} profile={profile} onProfile={onProfile} onDone={load} />
        {!list.length && (
          <div className="card">
            <p style={{ margin: 0 }}>لا طلبات بعد.</p>
            <a className="btn btn-go" href="#jobs" style={{ marginTop: 12 }}>شوف الوظائف</a>
          </div>
        )}
        {list.map(({ row, v }) => (
          <article className={`card app-line app-${v.tone}`} key={row.id}>
            <p className="app-title">{row.job?.title}</p>
            <p className="app-where">{row.job?.company}{AR_CITY[row.job?.city] ? ` · ${AR_CITY[row.job.city]}` : ''}</p>
            <p className="app-verdict">{v.text}</p>
            {v.proof && <Unverified row={row} profile={profile} onArrived={() => setStatus(row, 'applied')} onDone={load} />}
            {(v.send || v.retry || v.page) && (
              <div className="app-acts">
                {v.send && profile.auto_apply && <button className="btn btn-go" onClick={() => requeue(row)}>أرسله</button>}
                {v.retry && <button className="btn btn-go" onClick={() => requeue(row)}>جرّب مرة ثانية</button>}
                {v.page && row.job?.url && <a className="btn" href={row.job.url} target="_blank" rel="noopener noreferrer">صفحة الشركة ↗</a>}
              </div>
            )}
          </article>
        ))}
        <p className="deck-foot">
          {!paused && <><button type="button" className="linkish" onClick={() => setPaused(true)}>أوقف الإرسال</button> · </>}
          <button type="button" className="linkish" onClick={() => showAs('full')}>العرض المفصّل</button>
        </p>
      </>
    );
  }

  const card = (row, lead) => {
    const st = state.get(row.id), unproven = awaitingProof(row);
    // Saved, not in the robot's hands, and on a system it can send on: it can be handed over.
    const idle = st === 'MATCHED' && profile.auto_apply && row.job?.is_open !== false && autoApplyable(row.job?.url);
    // "Sent ✓" is said for one thing only: the employer's own page confirmed it.
    const line = unproven && st === 'ACTION_REQUIRED' ? 'ضُغط الإرسال ولم يتأكد'
      : st === 'SUBMITTED' ? (row.auto_status === 'submitted' ? 'أُرسل تلقائياً ✓' : null)
        : st === 'MATCHED' || st === 'CANCELLED' ? null
          : st === 'READY' && paused ? 'في الطابور — موقوف'
            : STATE_AR[st];
    const said = st === 'SUBMITTED' && row.auto_status === 'submitted' ? sentOf(row)?.evidence?.said : null;
    return (
    <article className="card" key={row.id} style={lead ? { borderColor: 'var(--warn)' } : undefined}>
      <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{row.job?.title}</p>
      <p className="muted" style={{ margin: '4px 0 0' }}>
        {row.job?.company} · {AR_CITY[row.job?.city] || row.job?.location}
      </p>
      {line && (
        <p style={{ marginTop: 8, fontSize: 14, color: TONE[st] ?? 'var(--warn)' }}>
          {line}
          {row.auto_reason && !unproven && st !== 'SUBMITTED' ? <span className="faint"> — {row.auto_reason}</span> : null}
          {said ? <span className="faint" dir="auto"> — «{said.slice(0, 70)}»</span> : null}
        </p>
      )}
      {st === 'MATCHED' && row.auto_reason && <p className="faint" style={{ marginTop: 8 }}>{row.auto_reason}</p>}
      {row.applied_on && <p className="faint" style={{ marginTop: 8 }}>قدّمت في {row.applied_on}</p>}
      {row.follow_up_on && row.status === 'applied' && (
        <p style={{ color: row.follow_up_on <= today ? 'var(--warn)' : 'var(--blue-soft)', fontSize: 14, margin: '6px 0 0' }}>
          {row.follow_up_on <= today ? 'حان وقت المتابعة' : `تابع في ${row.follow_up_on}`}
        </p>
      )}
      <div className="card-meta">
        <select className="status-pill" value={row.status} onChange={(e) => setStatus(row, e.target.value)}
          style={{ width: 'auto' }}>
          {STATUSES.map((s) => <option key={s} value={s}>{L[s]}</option>)}
        </select>
        <Notes row={row} onSave={(v) => setNotes(row, v)} />
      </div>
      <Estimated row={row} profile={profile} />
      {unproven && st === 'ACTION_REQUIRED'
        ? <Unverified row={row} profile={profile} onArrived={() => setStatus(row, 'applied')} onDone={load} />
        : (st === 'ACTION_REQUIRED' || st === 'FAILED') && <Stopped row={row} profile={profile} onDone={load} />}
      <div className="card-actions">
        <button className="btn btn-go" onClick={() => setSheetFor(row.job)}>ورقة التعبئة</button>
        {row.job?.url && <a className="btn" href={row.job.url} target="_blank" rel="noopener noreferrer">{L.openListing} ↗</a>}
      </div>
      {/* Out of the queue is possible until send is pressed; after that there is nothing to take back. */}
      {(st === 'READY' || st === 'PREPARING') && (
        <button type="button" className="notes-add" onClick={() => unqueue(row)}>أخرجه من الطابور</button>
      )}
      {idle && <button type="button" className="notes-add" onClick={() => requeue(row)}>قدّم عليه تلقائياً</button>}
    </article>
    );
  };

  return (
    <>
      <p className="deck-foot" style={{ marginTop: 0 }}>
        <button type="button" className="linkish" onClick={() => showAs('simple')}>أُرسل أو لا فقط ←</button>
      </p>
      <RunBar stats={stats} paused={paused} onPause={setPaused} />
      {!!urgent.length && (
        <>
          <p className="section">يحتاج منك شيئاً · {urgent.length}</p>
          <Questions rows={urgent} profile={profile} onProfile={onProfile} onDone={load} />
          {urgent.map((row) => card(row, true))}
          <hr className="rule" />
        </>
      )}
      <div className="chipbar">
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>الكل {rows.length}</button>
        {STATUSES.map((s) => (
          <button key={s} className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>{L[s]} {count(s)}</button>
        ))}
      </div>
      {sheetFor && <div id="apply-sheet" style={{ scrollMarginTop: 72 }}><ApplySheet profile={profile} job={sheetFor} onClose={() => setSheetFor(null)} /></div>}
      {!shown.length && !urgent.length && (
        <div className="card">
          <p style={{ margin: 0 }}>لا شيء هنا بعد.</p>
          <p className="faint">كل وظيفة تقول عنها «يهمني» تظهر هنا، ومعها حالتها.</p>
          <a className="btn btn-go" href="#jobs">شوف الوظائف</a>
        </div>
      )}
      {shown.map((row) => card(row, false))}
    </>
  );
}
