import React, { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { S, FAQS, CITIES, COUNTRY } from './landing-strings.js';
import './landing.css';

const ATS = ['Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters'];

const Pin = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" />
  </svg>
);
const Mark = ({ size = 64, radius = 18 }) => (
  <span className="mark" style={{ width: size, height: size, borderRadius: radius }} aria-hidden="true">
    <i style={{ width: size * .4, height: Math.max(3, size * .078) }} />
    <i style={{ width: size * .28, height: Math.max(3, size * .078) }} />
  </span>
);

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function useRotating(list, ms = 2200) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (reduced()) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), ms);
    return () => clearInterval(t);
  }, [list, ms]);
  return list[i % list.length];
}

const ago = (iso, lang) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (lang === 'en') {
    if (m < 1) return 'just now';
    if (m < 60) return `${m} minutes ago`;
    const h = Math.round(m / 60);
    return h < 24 ? `${h} hours ago` : `${Math.round(h / 24)} days ago`;
  }
  if (m < 1) return 'الآن';
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  return h < 24 ? `قبل ${h} ساعة` : `قبل ${Math.round(h / 24)} يوم`;
};

export default function Landing({ loading, authError }) {
  const [lang, setLang] = useState(() => localStorage.getItem('fursa:lang') || 'ar');
  const [theme, setTheme] = useState(() => localStorage.getItem('fursa:theme') || 'dark');
  const t = S[lang];
  const city = useRotating(CITIES[lang]);

  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('fursa:lang', lang);
    localStorage.setItem('fursa:theme', theme);
  }, [lang, theme, t.dir]);

  useEffect(() => {
    supabase.rpc('board_summary').then(({ data }) => setSummary(data?.[0] ?? null));
    supabase.from('jobs').select('title, company, country, first_seen')
      .eq('is_open', true).order('first_seen', { ascending: false }).limit(6)
      .then(({ data }) => setRecent(data ?? []));
    supabase.from('jobs').select('company').eq('is_open', true)
      .then(({ data }) => setCompanies([...new Set((data ?? []).map((j) => j.company))].filter(Boolean)));
  }, []);

  const marquee = companies.length ? [...companies, ...companies] : [];
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth' });

  return (
    <div className="lp">
      {/* ── navbar ─────────────────────────────────────────────── */}
      <nav className="lp-nav" aria-label={t.brand}>
        <div className="lp-nav-inner">
          <a className="brand" href="#top" onClick={(e) => { e.preventDefault(); go('top'); }}>
            <Mark size={30} radius={9} /><b>{t.brand}</b>
          </a>
          <div className="nav-mid">
            <button type="button" onClick={() => go('how')}>{t.howItWorks}</button>
            <button type="button" onClick={() => go('faq')}>{t.faq}</button>
          </div>
          <div className="nav-end">
            <button type="button" className="lang" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
            <button type="button" className="icon" aria-label="theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <button type="button" className="btn btn-white" style={{ margin: 0 }} onClick={() => go('start')}>{t.cta}</button>
          </div>
        </div>
      </nav>

      {/* ── hero ───────────────────────────────────────────────── */}
      <header className="lp-hero" id="top">
        <Mark />
        <h1 className="lp-h1">
          {t.heroA}{' '}
          <span className="city-chip"><Pin /><span className="name" key={city}>{city}</span></span>
          <br /><span className="soft">{t.heroB}</span>
        </h1>
        <p className="lp-sub">{t.sub}</p>
        <div className="lp-cta" id="start"><SignIn t={t} loading={loading} notice={authError} /></div>
        <p className="lp-meta">{t.meta.map((m) => <span key={m}>{m}</span>)}</p>
      </header>

      {/* ── live board ─────────────────────────────────────────── */}
      <section className="board">
        <div className="board-head">
          <span><span className="dot" /><b>{summary?.open_jobs ?? '—'}</b> {t.openJobs}</span>
          <span className="faint">{t.updated} {ago(summary?.last_seen, lang)}</span>
        </div>
        {recent.map((j, i) => (
          <div className="board-row" key={i}>
            <span className="t">{j.title}</span>
            <span className="c">{j.company} / {COUNTRY[lang][j.country] ?? '—'}</span>
            <span className="w">{ago(j.first_seen, lang)}</span>
          </div>
        ))}
        {!recent.length && <div className="board-row"><span className="faint">{t.loading}</span><span /><span /></div>}
      </section>

      {/* ── how it works ───────────────────────────────────────── */}
      <section className="lp-sec" id="how">
        <h2>{t.howItWorks}</h2>
        <div className="panel split">
          <div><h3>{t.sourceH}</h3><p>{t.sourceP}</p></div>
          <Radar />
        </div>

        <div className="two">
          <div className="panel">
            <h3>{t.scoreH}</h3><p>{t.scoreP}</p>
            {t.scoreRows.map(([label, n]) => (
              <div className="bar-row" key={label}>
                <div className="lbl"><span>{label}</span><b>{n}%</b></div>
                <div className="bar"><i style={{ '--w': n + '%' }} /></div>
              </div>
            ))}
            <p className="faint" style={{ marginTop: 14 }}>{t.sample}</p>
          </div>

          <div className="panel">
            <h3>{t.orderH}</h3><p>{t.orderP}</p>
            <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
              <p style={{ margin: 0, fontWeight: 800, color: 'var(--text)' }}>Sr. Product Manager</p>
              <p className="faint" style={{ margin: '4px 0 12px' }}>Foodics</p>
              <span className="status-pill st-saved">{t.statuses.saved}</span>{' '}
              <span className="status-pill st-applied">{t.statuses.applied}</span>{' '}
              <span className="status-pill st-interview">{t.statuses.interview}</span>
              <p style={{ color: 'var(--blue-soft)', fontWeight: 700, marginTop: 14 }}>{t.followBy}</p>
            </div>
            <p className="faint" style={{ marginTop: 14 }}>{t.sample}</p>
          </div>
        </div>
      </section>

      {/* ── the word ───────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="word">
          <p className="ar">فرصة</p>
          <p className="en">{t.wordEn}</p>
          <p className="cap">{t.amongCompanies}</p>
          <div className="marquee" dir="ltr">
            <div className="track">{marquee.map((c, i) => <span className="wordmark" key={i}>{c}</span>)}</div>
          </div>
        </div>
      </section>

      {/* ── where every application stands ─────────────────────── */}
      <section className="lp-sec">
        <h2 style={{ marginBottom: 16 }}>{t.standH}</h2>
        <p className="muted" style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto 36px' }}>{t.standP}</p>
        <AppMockup t={t} />
        <p className="faint" style={{ textAlign: 'center', marginTop: 14 }}>{t.sample}</p>
      </section>

      {/* ── autopilot ──────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="panel split">
          <div>
            <h3 style={{ fontSize: 'clamp(28px,5vw,46px)', lineHeight: 1.05 }}>{t.autoH1}<br />{t.autoH2}</h3>
            <p className="faint" style={{ marginTop: 14 }}>{t.autoP}</p>
          </div>
          <div>
            {t.autoPoints.map((p, i) => (
              <p key={i} style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: i ? 18 : 0 }}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* ── faq ────────────────────────────────────────────────── */}
      <section className="lp-sec faq" id="faq">
        <h2>{t.faq}</h2>
        {FAQS[lang].map(([q, a], i) => <details key={i}><summary>{q}</summary><p>{a}</p></details>)}
      </section>

      {/* ── closing ────────────────────────────────────────────── */}
      <section className="lp-sec">
        <div className="split" style={{ alignItems: 'center' }}>
          <h2 style={{ textAlign: 'start', margin: 0 }}>{t.closing}</h2>
          <div style={{ textAlign: 'end' }}>
            <SignIn t={t} loading={loading} compact />
            <p className="faint" style={{ marginTop: 10 }}>
              <span className="dot" />{summary?.open_jobs ?? '—'} {t.openJobs}
            </p>
          </div>
        </div>
      </section>

      <footer className="lp-sec" style={{ paddingTop: 34 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="faint">{t.free}</span>
          <span>
            <a href="#privacy">{t.privacy}</a>
            {' · '}<button type="button" className="linkish" onClick={() => go('how')}>{t.howItWorks}</button>
            {' · '}<button type="button" className="linkish" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
              {lang === 'ar' ? 'English' : 'العربية'}
            </button>
          </span>
        </div>
      </footer>
      <Skyline lang={lang} />
    </div>
  );
}

/** We are looking, continuously, at these five places. */
function Radar() {
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (reduced()) return;
    const t = setInterval(() => setLit((n) => (n + 1) % ATS.length), 1400);
    return () => clearInterval(t);
  }, []);
  const place = (i) => {
    const a = (i / ATS.length) * 2 * Math.PI - Math.PI / 2;
    return { left: `${50 + 46 * Math.cos(a)}%`, top: `${50 + 46 * Math.sin(a)}%` };
  };
  return (
    <div className="radar" aria-hidden="true">
      <div className="sweep" />
      <i className="r1" /><i className="r2" /><i className="r3" />
      <div className="core"><Mark size={56} radius={15} /></div>
      {ATS.map((n, i) => <span className={'ats' + (i === lit ? ' lit' : '')} style={place(i)} key={n}>{n}</span>)}
    </div>
  );
}

/** A still of the app itself, so the tracker is understood before signing up. */
function AppMockup({ t }) {
  const rows = [
    ['Sr. Product Manager', 'Foodics / Riyadh', 'interview', 'Applied 24 Oct', 'Interview on Tuesday at 10:00'],
    ['Product Manager, Storefront', 'Salla / Jeddah', 'applied', 'Applied 5 Nov', null],
    ['Cloud Platform Engineer', 'Mozn / Dubai', 'saved', 'Saved 2 Nov', null],
    ['Senior Software Engineer', 'Lean Technologies / Dubai', 'offer', 'Applied 6 Oct', null]
  ];
  return (
    <div className="mock">
      <span className="mock-float">{t.statuses.interview}</span>
      <aside className="mock-side">
        <div className="brand"><Mark size={26} radius={8} /><b>{t.brand}</b></div>
        {t.nav.map((n, i) => <span key={n} className={i === 2 ? 'on' : ''}>{n}</span>)}
      </aside>
      <div className="mock-main">
        <h3>{t.appsTitle}</h3>
        <div className="mock-tabs">
          <span className="on">{t.statuses.all} 4</span>
          <span>{t.statuses.saved} 1</span><span>{t.statuses.applied} 1</span>
          <span>{t.statuses.interview} 1</span><span>{t.statuses.offer} 1</span>
        </div>
        {rows.map(([title, where, st, when, note]) => (
          <div className="mock-row" key={title}>
            <div>
              <p className="tt">{title}</p>
              <p className="faint">{where}</p>
              <p className="faint">{when}</p>
              {st === 'applied' && <p style={{ color: 'var(--blue-soft)', fontWeight: 700, fontSize: 13, margin: '4px 0 0' }}>{t.followBy}</p>}
              <p className="faint" style={{ marginTop: 8 }}>{t.notes}</p>
              {note && <div className="mock-note">{note}</div>}
            </div>
            <span className={'status-pill st-' + st}>{t.statuses[st]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Skyline({ lang }) {
  const pins = CITIES[lang].map((name, i) => [name, [18, 33, 50, 70, 83, 94][i]]);
  return (
    <div className="sky">
      {pins.map(([name, x], i) => (
        <span className="pin" key={name} style={{ left: `${x}%`, top: `${34 + (i % 3) * 10}%`, animationDelay: `${i * .4}s` }}>
          <Pin />{name}
        </span>
      ))}
      <svg viewBox="0 0 1200 320" preserveAspectRatio="none" role="img" aria-hidden="true">
        <g className="sky-city">
          <path d="M0 320V214h58v106zM70 320V182h44v138zM126 320V236h70v84z" />
          <path d="M210 320V150c0-22 12-40 26-40s26 18 26 40v170z" />
          <path d="M276 320V198h52v122zM340 320V244h40v76z" />
          <path d="M392 320V120l26-54 26 54v200z" />
          <path d="M456 320V206h64v114zM532 320V176h38v144z" />
          <path d="M584 320V96c0-30 16-56 32-56s32 26 32 56v224z" />
          <path d="M660 320V188h54v132zM726 320V232h44v88z" />
          <path d="M782 320V140l30-46 30 46v180z" />
          <path d="M854 320V204h58v116zM924 320V168h40v152z" />
          <path d="M976 320V108c0-26 14-48 30-48s30 22 30 48v212z" />
          <path d="M1048 320V196h52v124zM1112 320V240h52v80zM1176 320V210h24v110z" />
        </g>
        <g className="sky-lights">
          {Array.from({ length: 64 }, (_, i) => (
            <rect key={i} x={40 + (i * 19) % 1130} y={172 + ((i * 37) % 118)} width="5" height="7" />
          ))}
        </g>
      </svg>
    </div>
  );
}

/** Supabase answers in English; these are the ones a person actually hits. */
function authErrorAr(message) {
  const m = String(message || '');
  if (/only request this after (\d+)/i.test(m)) {
    return `انتظر ${m.match(/after (\d+)/i)[1]} ثانية قبل إرسال رسالة أخرى.`;
  }
  if (/rate limit|too many|email rate/i.test(m)) return 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.';
  // Order matters: an expired link also says "invalid" and "email", and would otherwise be
  // reported as a bad address — sending the reader to fix something that is not wrong.
  if (/link is invalid or has expired|access_denied|otp_expired/i.test(m)) {
    return 'انتهت صلاحية الرابط أو استُخدم من قبل. اطلب رسالة جديدة.';
  }
  if (/expired|invalid token|invalid otp|token has expired/i.test(m)) return 'الرمز غير صحيح أو انتهت صلاحيته.';
  if (/signups not allowed|disabled/i.test(m)) return 'التسجيل مغلق حالياً.';
  if (/invalid|unable to validate/i.test(m) && /email/i.test(m)) return 'البريد غير صحيح.';
  if (/failed to fetch|network/i.test(m)) return 'تعذّر الاتصال. تأكّد من الشبكة.';
  return m;
}

const LAST_EMAIL = 'fursa:last-email';

/**
 * Signing in by email, without the trap that email sign-in usually sets.
 *
 * A link in an email opens in whatever browser the mail app owns — on a phone that is rarely
 * the one the person started in, so the session lands somewhere they are not looking. The
 * code they can type keeps them here. Both are offered; whichever they use, they end up
 * signed in on this screen.
 */
function SignIn({ t, loading, compact, notice }) {
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(LAST_EMAIL) || ''; } catch { return ''; }
  });
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  // `notice` arrives a render after this mounts (the session check has to finish first), so
  // it is read on every render rather than copied into state once and missed.
  const [dismissed, setDismissed] = useState(false);
  const shown = error || (!dismissed && notice ? authErrorAr(notice) : '');

  useEffect(() => {
    if (!cooldown) return;
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function send(e) {
    e?.preventDefault();
    setBusy(true); setError(''); setDismissed(true);
    const address = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithOtp({
      // Back to this page, not to the origin: the site may live under a sub-path,
      // and the hash is dropped so the link lands on the app rather than a stale route.
      email: address, options: { emailRedirectTo: location.href.split('#')[0] }
    });
    setBusy(false);
    if (error) { setError(authErrorAr(error.message)); return; }
    try { localStorage.setItem(LAST_EMAIL, address); } catch { /* private window */ }
    setSent(true); setCooldown(45);
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true); setError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(), token: code.trim(), type: 'email'
    });
    setBusy(false);
    if (error) setError(authErrorAr(error.message));
    // On success the session arrives through onAuthStateChange and the app swaps itself out.
  }

  if (sent) {
    return (
      <div className="sent">
        <p className="sent-h">{t.sentTo} <b dir="ltr">{email.trim()}</b></p>
        <p className="sent-p">{t.sentHint}</p>

        <form onSubmit={verify} className="code-row">
          <input inputMode="numeric" pattern="[0-9]*" maxLength={8} dir="ltr" value={code}
            placeholder={t.codePh} aria-label={t.codePh}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-white" disabled={busy || code.trim().length < 6}>{busy ? '…' : t.codeGo}</button>
        </form>

        {shown && <p className="err">{shown}</p>}
        <p className="sent-actions">
          <button type="button" className="linklike" disabled={!!cooldown || busy} onClick={send}>
            {cooldown ? `${t.resend} (${cooldown})` : t.resend}
          </button>
          <span className="faint"> · </span>
          <button type="button" className="linklike" onClick={() => { setSent(false); setCode(''); setError(''); }}>
            {t.changeEmail}
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="signin" data-compact={compact ? '' : undefined}>
      <input type="email" required dir="ltr" value={email} placeholder={t.emailPh} autoComplete="email"
        onChange={(e) => setEmail(e.target.value)} aria-label={t.emailPh} />
      <button className="btn btn-white btn-lg" disabled={busy || loading || !email.trim()}>{busy ? '…' : t.cta}</button>
      {shown && <p className="err">{shown}</p>}
    </form>
  );
}
