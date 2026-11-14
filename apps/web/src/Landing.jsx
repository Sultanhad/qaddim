import React, { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { S, FAQS, CITIES, COUNTRY } from './landing-strings.js';
import { Mark } from './ui.jsx';
import './landing.css';

const ATS = ['Greenhouse', 'Lever', 'Ashby', 'Workable', 'SmartRecruiters'];

const Pin = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" />
  </svg>
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
  const [lang, setLang] = useState(() => localStorage.getItem('qaddim:lang') || 'ar');
  const [theme, setTheme] = useState(() => localStorage.getItem('qaddim:theme') || 'dark');
  // Everything the bar no longer shows lives behind the burger beside «الدخول».
  const [menu, setMenu] = useState(false);
  // «الدخول» opens the sign-in box over the page; it no longer sits in the middle of it.
  const [signing, setSigning] = useState(false);
  // A sign-in link that failed comes back here with a reason; the box opens to say it.
  useEffect(() => { if (authError) setSigning(true); }, [authError]);
  useEffect(() => {
    if (!menu && !signing) return;
    const key = (e) => { if (e.key === 'Escape') { setMenu(false); setSigning(false); } };
    addEventListener('keydown', key);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', key); document.body.style.overflow = before; };
  }, [menu, signing]);
  const t = S[lang];
  const city = useRotating(CITIES[lang]);

  const [summary, setSummary] = useState(null);
  const [recent, setRecent] = useState([]);
  const [companies, setCompanies] = useState([]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = t.dir;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('qaddim:lang', lang);
    localStorage.setItem('qaddim:theme', theme);
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
          {/* The bar holds the name and one way in — nothing else. */}
          <div className="nav-end">
            <button type="button" className="btn btn-white" style={{ margin: 0 }} onClick={() => setSigning(true)}>{t.signIn}</button>
            <button type="button" className="burger" aria-label={t.menu} aria-expanded={menu} onClick={() => setMenu(true)}>
              <span /><span /><span />
            </button>
          </div>
        </div>
      </nav>

      {menu && (
        <>
          <div className="scrim" onClick={() => setMenu(false)} />
          <aside className="drawer from-end" role="dialog" aria-modal="true" aria-label={t.menu}>
            <div className="drawer-head">
              <Mark size={30} radius={9} />
              <span className="drawer-who"><b>{t.brand}</b></span>
              <button type="button" className="drawer-x" aria-label="✕" onClick={() => setMenu(false)}>✕</button>
            </div>
            <nav className="drawer-nav">
              <button type="button" onClick={() => { setMenu(false); setSigning(true); }}>{t.signIn}</button>
              <hr />
              <button type="button" onClick={() => { setMenu(false); go('how'); }}>{t.howItWorks}</button>
              <button type="button" onClick={() => { setMenu(false); go('faq'); }}>{t.faq}</button>
              <a href="#privacy" onClick={() => setMenu(false)}>{t.privacy}</a>
              <hr />
              <button type="button" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>{lang === 'ar' ? 'English' : 'العربية'}</button>
              <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                {theme === 'dark' ? `☀ ${t.light}` : `☾ ${t.dark}`}
              </button>
            </nav>
          </aside>
        </>
      )}

      {signing && !loading && (
        <>
          <div className="scrim" onClick={() => setSigning(false)} />
          <div className="lp-signin" role="dialog" aria-modal="true" aria-label={t.signIn}>
            <button type="button" className="drawer-x" aria-label="✕" onClick={() => setSigning(false)}>✕</button>
            <SignIn t={t} loading={loading} notice={authError} boxed />
          </div>
        </>
      )}

      {/* ── hero ───────────────────────────────────────────────── */}
      <header className="lp-hero" id="top">
        <Mark className="lp-mark" />
        <h1 className="lp-h1">
          {t.heroA}{' '}
          <span className="city-chip"><Pin /><span className="name" key={city}>{city}</span></span>
          <br /><span className="soft">{t.heroB}</span>
        </h1>
        <p className="lp-sub">{t.sub}</p>
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
          <p className="ar">قدّم</p>
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

/**
 * The radar: the boards we read, arranged around the thing that reads them.
 *
 * Names sit on the dish because that is what says "these five are being swept", which a row
 * of pills underneath does not. The reason they were moved off once is real though — a pill
 * is as wide as its word, and "SmartRecruiters" ran past the panel's edge while the one
 * opposite hugged the other side.
 *
 * A name is centred on its own blip, not pinned to a wall — pinning them to the panel's
 * edges stopped the overflow but broke the pairing, which was the only reason to put them on
 * the dish at all. The radius is chosen so the widest name ("SmartRecruiters") still clears
 * the card at the narrowest width the page is built for, and that is checked by measurement
 * rather than by eye.
 */
function Radar() {
  // No timer: each name lights on the same CSS clock as the sweep, delayed by the time the
  // beam takes to reach its angle — so it lights the moment it is touched, never before, and
  // a background tab cannot knock the two out of step.
  // Blips on the dish's middle ring; names on a slightly wider circle, just outside them.
  const marks = ATS.map((n, i) => {
    const a = (i / ATS.length) * 2 * Math.PI - Math.PI / 2;
    return {
      n,
      bx: 100 + 64 * Math.cos(a), by: 100 + 64 * Math.sin(a),   // SVG units, inside the dish
      lx: 50 + 30 * Math.cos(a), ly: 50 + 30 * Math.sin(a)      // percent of the whole panel
    };
  });

  // Blip i sits at i/N of a turn clockwise from the top, which is where the sweep starts.
  const at = (i) => `calc(var(--turn) * ${i} / ${ATS.length})`;

  return (
    <div className="radar">
      <div className="radar-dish-wrap" aria-hidden="true">
        <div className="sweep" />
        <svg viewBox="0 0 200 200" className="radar-dish">
          <g className="rings">
            <circle cx="100" cy="100" r="92" /><circle cx="100" cy="100" r="64" /><circle cx="100" cy="100" r="36" />
            <path d="M8 100h184M100 8v184" />
          </g>
          {marks.map(({ n, bx, by }, i) => (
            <g key={n} className="blip" style={{ '--at': at(i) }}>
              <circle cx={bx} cy={by} r="11" className="halo" />
              <circle cx={bx} cy={by} r="4.5" className="dot" />
            </g>
          ))}
        </svg>
        <div className="radar-core"><Mark size={46} radius={14} /></div>
      </div>

      {marks.map(({ n, lx, ly }, i) => (
        <span key={n} className="ats" style={{ left: `${lx}%`, top: `${ly}%`, '--at': at(i) }}>
          {n}
        </span>
      ))}
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

/**
 * The skyline, as the cities it actually reads.
 *
 * Three depths: a sky with stars and a moon, a pale band of distant blocks, and black
 * silhouettes in front carrying lit windows. The landmarks are the ones a reader here
 * recognises without being told — the pyramids, the Kingdom Centre's arch, a sail on the
 * Jeddah coast — so each pin sits above a building that explains it.
 */
// x is the centre of that city's landmark in the viewBox, as a percentage; y clears its roof.
const SKY_CITIES = [
  { id: 'cairo',  x: 17, y: 24 },
  { id: 'amman',  x: 29, y: 48 },
  { id: 'riyadh', x: 46, y: 21 },
  { id: 'dubai',  x: 64, y: 13 },
  { id: 'doha',   x: 78, y: 26 },
  { id: 'jeddah', x: 91, y: 31 }
];
const SKY_NAMES = {
  ar: { cairo: 'القاهرة', amman: 'عمّان', riyadh: 'الرياض', dubai: 'دبي', doha: 'الدوحة', jeddah: 'جدة' },
  en: { cairo: 'Cairo', amman: 'Amman', riyadh: 'Riyadh', dubai: 'Dubai', doha: 'Doha', jeddah: 'Jeddah' }
};

// Fixed so the sky does not reshuffle on every render.
const STARS = [
  [34, 22], [96, 58], [152, 31], [188, 96], [243, 44], [301, 18], [338, 73], [392, 36],
  [427, 102], [481, 25], [526, 64], [575, 14], [613, 88], [668, 41], [712, 20], [757, 69],
  [803, 33], [847, 95], [892, 27], [938, 57], [981, 16], [1024, 80], [1069, 38], [1113, 63],
  [1158, 23], [1186, 90], [63, 84], [219, 67], [455, 78], [736, 52], [1003, 46], [1142, 50]
];

// x, y, width, height of every black building that should show light.
const LIT = [
  [240, 276, 42, 64], [304, 290, 88, 50], [442, 268, 32, 72],
  [502, 160, 36, 180], [560, 160, 36, 180], [624, 232, 34, 108], [680, 274, 36, 66],
  [750, 206, 32, 134], [804, 254, 38, 86], [860, 280, 30, 60],
  [910, 196, 48, 144], [980, 262, 34, 78], [1154, 250, 30, 90]
];

/** A grid of windows inside one footprint, with a scatter of unlit ones. */
function windowsIn([x, y, w, h], seed) {
  const W = 5, H = 8, gapX = 13, gapY = 17;
  const cols = Math.max(1, Math.floor((w - 6) / gapX));
  const rows = Math.max(1, Math.floor((h - 10) / gapY));
  const left = x + (w - (cols * gapX - (gapX - W))) / 2;
  const out = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const n = seed * 31 + c * 7 + r * 13;
      if (n % 5 === 0) continue;                       // nobody is home
      out.push(
        <rect key={`${seed}-${c}-${r}`} x={left + c * gapX} y={y + 8 + r * gapY}
          width={W} height={H} rx="1" opacity={n % 4 === 0 ? 0.45 : 0.92} />
      );
    }
  }
  return out;
}

function Skyline({ lang }) {
  const names = SKY_NAMES[lang] ?? SKY_NAMES.ar;
  return (
    <div className="sky">
      {SKY_CITIES.map((c, i) => (
        <span className="pin" key={c.id} data-row={i % 2}
          style={{ left: `${c.x}%`, top: `${c.y}%`, animationDelay: `${i * .45}s` }}>
          <Pin />{names[c.id]}
        </span>
      ))}

      {/* `none` with an auto height keeps the drawing's own proportions, so a pin placed at
          46% of the box lands at 46% of the viewBox — over the building it names. */}
      <svg viewBox="0 0 1200 340" preserveAspectRatio="none" role="img" aria-hidden="true">
        <g className="sky-star">
          {STARS.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1.8 : 1.1} />)}
        </g>
        <circle className="sky-moon" cx="690" cy="96" r="13" />

        {/* the pale band behind everything: distance, not detail */}
        <g className="sky-back">
          <path d="M0 340V232h46v108zM58 340V252h38v88zM108 340V214h54v126zM176 340V246h40v94z" />
          <path d="M232 340V222h50v118zM296 340V258h36v82zM346 340V206h58v134zM418 340V240h44v100z" />
          <path d="M474 340V226h40v114zM528 340V262h34v78zM576 340V200h56v140zM646 340V244h42v96z" />
          <path d="M702 340V218h48v122zM762 340V256h36v84zM812 340V210h54v130zM880 340V238h42v102z" />
          <path d="M936 340V224h46v116zM994 340V260h34v80zM1042 340V204h56v136zM1112 340V242h44v98zM1170 340V222h30v118z" />
        </g>

        <g className="sky-city">
          {/* Giza */}
          <path d="M8 340 92 232l84 108z" />
          <path d="M150 340 212 258l62 82z" />
          {/* Cairo tower: a lattice shaft with its crown */}
          <path d="M198 340V140h12v200z" />
          <path d="M190 148c0-12 8-22 14-22s14 10 14 22-8 20-14 20-14-8-14-20z" />
          <path d="M196 126h16v-18h-16z" />
          {/* a low Cairo block */}
          <path d="M236 340V272h46v68z" />

          {/* Amman: dome and minaret */}
          <path d="M300 340V282h96v58z" />
          <path d="M300 286c0-30 22-52 48-52s48 22 48 52z" />
          <path d="M344 234h8v-16h-8z" />
          <path d="M412 340V206h14v134z" />
          <path d="M406 214c0-14 6-24 13-24s13 10 13 24z" />
          <path d="M438 340V262h40v78z" />

          {/* Riyadh: the Kingdom Centre, with the gap under its arch */}
          <path d="M498 340V150c0-26 10-44 22-44s22 18 22 44v190z" />
          <path d="M556 340V150c0-26 10-44 22-44s22 18 22 44v190z" />
          <rect x="512" y="186" width="76" height="9" rx="4" />
          {/* Al Faisaliah: the pointed one beside it */}
          <path d="M620 340V198l22-56 22 56v142z" />
          <path d="M676 340V268h44v72z" />

          {/* Dubai: Burj Khalifa's stepped spire */}
          <path d="M746 340V196h40v144z" />
          <path d="M754 196V150h24v46z" />
          <path d="M760 150V104h12v46z" />
          <path d="M764 104V62h4v42z" />
          <path d="M800 340V248h46v92zM856 340V274h38v66z" />

          {/* Doha: a rounded tower, and a palm */}
          <path d="M904 340V176c0-34 14-58 30-58s30 24 30 58v164z" />
          <path d="M976 340V256h42v84z" />
          <g className="sky-palm">
            <path d="M1038 340v-54h5v54z" />
            <path d="M1040 288c-14-10-28-10-36-2 10-2 24 2 36 6zM1041 288c14-10 28-10 36-2-10-2-24 2-36 6zM1040 286c-6-14-2-26 8-32-4 10-6 22-8 32zM1042 286c6-14 14-22 26-22-10 6-20 14-26 22z" />
          </g>

          {/* Jeddah: the sail */}
          <path d="M1092 340V300c0-78 26-136 56-166-10 42-14 102-14 166v40z" />
          <path d="M1150 340V244h38v96zM1196 340V276h4v64z" />
        </g>

        {/* Lit windows belong to the black towers, not to the pale band behind them — scattering
            them by formula put rectangles in the open sky and on the distant blocks. Each
            building is filled on its own footprint, and some windows stay dark. */}
        <g className="sky-win">
          {LIT.flatMap((b, bi) => windowsIn(b, bi))}
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

const LAST_EMAIL = 'qaddim:last-email';

/**
 * Signing in by email, without the trap that email sign-in usually sets.
 *
 * A link in an email opens in whatever browser the mail app owns — on a phone that is rarely
 * the one the person started in, so the session lands somewhere they are not looking. The
 * code they can type keeps them here. Both are offered; whichever they use, they end up
 * signed in on this screen.
 */
function SignIn({ t, loading, compact, notice, boxed }) {
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
          {/* Never greyed out for a short code: the field's own minLength answers that, and a
              dim button beside a half-typed code read as "this is broken". */}
          <input inputMode="numeric" pattern="[0-9]*" minLength={6} maxLength={8} required dir="ltr" value={code}
            placeholder={t.codePh} aria-label={t.codePh} autoComplete="one-time-code" autoFocus={boxed}
            onChange={(ev) => setCode(ev.target.value.replace(/\D/g, ''))} />
          <button className="btn btn-white" disabled={busy}>{busy ? '…' : t.codeGo}</button>
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

  // In the box «الدخول» opens: what happens next is said before it is asked for, the field is
  // labelled, and the button is never greyed out for an empty field — a disabled button there
  // read as a broken one. The browser's own `required` check answers an empty submit instead.
  if (boxed) {
    return (
      <form onSubmit={send} className="signin-boxed">
        <p className="lp-signin-h">{t.signInTitle}</p>
        <p className="lp-signin-sub">{t.signInSub}</p>
        <label htmlFor="signin-email">{t.emailLabel}</label>
        <input id="signin-email" type="email" required dir="ltr" value={email} placeholder={t.emailPh}
          autoComplete="email" autoFocus onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-white" disabled={busy || loading}>{busy ? t.sending : t.sendCode}</button>
        {shown && <p className="err">{shown}</p>}
        <p className="lp-signin-foot">{t.signInFoot}</p>
      </form>
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
