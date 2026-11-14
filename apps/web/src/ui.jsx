import React from 'react';

export const L = {
  brand: 'قدّم',
  tagline: 'وظائف جديدة في السعودية والمنطقة',
  signIn: 'ادخل', signOut: 'خروج',
  today: 'وظائف اليوم', applications: 'طلباتي', settings: 'ملفي',
  approve: 'يهمني', reject: 'لا يناسبني', details: 'تفاصيل', openListing: 'الإعلان الأصلي',
  saved: 'محفوظة', applied: 'قدّمت', interview: 'مقابلة', offer: 'عرض', closed: 'مغلقة',
  score: 'المطابقة', coding: 'البرمجة', noSalary: 'الراتب غير معلن',
  openNow: 'وظيفة مفتوحة', updated: 'آخر تحديث', justNow: 'الآن', minAgo: 'دقيقة', hAgo: 'ساعة'
};

/**
 * One stroke weight, one 24-grid. Icons carry the bottom bar: at 11px a label alone is
 * read, not recognised — the pair is what makes a tab findable without reading.
 */
const ICONS = {
  jobs: <><path d="M3.6 7.8h16.8v10.4a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2V7.8Z" /><path d="M9 7.8V6a1.8 1.8 0 0 1 1.8-1.8h2.4A1.8 1.8 0 0 1 15 6v1.8" /><path d="M3.6 12.6c2.9 1.3 5.7 2 8.4 2s5.5-.7 8.4-2" /></>,
  apps: <><path d="M4 6.5h9" /><path d="M4 12h9" /><path d="M4 17.5h6" /><path d="m15.5 16.6 2 2 4-4.4" /></>,
  profile: <><path d="M12 12.4a3.7 3.7 0 1 0 0-7.4 3.7 3.7 0 0 0 0 7.4Z" /><path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" /></>,
  settings: <><path d="M3.5 7.5h5" /><path d="M12.5 7.5h8" /><path d="M3.5 16.5h8" /><path d="M15.5 16.5h5" /><circle cx="10.5" cy="7.5" r="2" /><circle cx="13.5" cy="16.5" r="2" /></>,
  help: <><circle cx="12" cy="12" r="8.4" /><path d="M9.7 9.6a2.4 2.4 0 1 1 2.7 2.5v1.4" /><path d="M12.3 16.6h.01" /></>,
  shield: <><path d="M12 3.6 5.4 6.2v5c0 3.9 2.6 7.4 6.6 9.2 4-1.8 6.6-5.3 6.6-9.2v-5L12 3.6Z" /></>,
  out: <><path d="M14.4 7.4V5.8a1.8 1.8 0 0 0-1.8-1.8H6.3a1.8 1.8 0 0 0-1.8 1.8v12.4A1.8 1.8 0 0 0 6.3 20h6.3a1.8 1.8 0 0 0 1.8-1.8v-1.6" /><path d="M10 12h9.5" /><path d="m16.8 9 2.7 3-2.7 3" /></>,
  file: <><path d="M13.6 3.6H7.2a1.8 1.8 0 0 0-1.8 1.8v13.2a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V8.6l-5-5Z" /><path d="M13.4 3.8v4.9h5" /><path d="M9 13h6" /><path d="M9 16.4h4" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.2" /><path d="m15.4 15.4 4.6 4.6" /></>,
  // Points toward the end of the line: left in Arabic. Flipped for a left-to-right page.
  chev: <><path d="m14.5 6.5-5.5 5.5 5.5 5.5" /></>
};

export function Icon({ name, size = 22 }) {
  return (
    <svg className="ic" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** The logo, one shape at every size — the bar, the radar core, the landing hero. */
export function Mark({ size = 64, radius = 18, className = '' }) {
  return (
    <span className={'mark ' + className} style={{ width: size, height: size, borderRadius: radius }} aria-hidden="true">
      <i style={{ width: size * .4, height: Math.max(3, size * .078) }} />
      <i style={{ width: size * .28, height: Math.max(3, size * .078) }} />
    </span>
  );
}

/**
 * Which browser this is, as far as the extension is concerned. Only desktop Chrome can load
 * it — and the install steps used to begin "open chrome://extensions" for everyone, which in
 * Safari is an address that goes nowhere and says nothing about why.
 */
export function browserKind() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return 'mobile';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/(Chrome|Chromium|Edg)\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}
export const BROWSER_AR = { safari: 'سفاري', firefox: 'فايرفوكس', mobile: 'متصفح الجوال', other: 'متصفح آخر' };

export function Hero({ title, eyebrow = L.brand, children }) {
  return (
    <div className="hero">
      <div className="hero-inner">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function Score({ value }) {
  const n = Number(value) || 0;
  const cls = n >= 85 ? 'score-high' : n >= 70 ? 'score-mid' : 'score-low';
  return <span className={`score ${cls}`}>{n}<small>/100</small></span>;
}

export function Live({ open, updatedAt }) {
  if (open == null) return null;
  const mins = updatedAt ? Math.round((Date.now() - new Date(updatedAt).getTime()) / 60000) : null;
  const ago = mins == null ? '' : mins < 1 ? L.justNow : mins < 60 ? `${mins} ${L.minAgo}` : `${Math.round(mins / 60)} ${L.hAgo}`;
  return (
    <p className="live"><span className="dot" /><b style={{ color: 'var(--text)' }}>{open}</b> {L.openNow}
      {ago && <> · {L.updated} {ago}</>}
    </p>
  );
}

/**
 * A choice that can be ranked: tapping adds it to the end, tapping again removes it.
 *
 * `limit` shows only the first few and hides the rest behind one more tap. Twenty options
 * laid out at once read as a form to be endured; eight read as a question to be answered.
 * Anything already chosen stays visible whether or not it falls inside the limit.
 */
export function RankedChips({ options, value, onChange, labelKey = 'label_ar', limit }) {
  const [all, setAll] = React.useState(false);
  const toggle = (id) => {
    const i = value.indexOf(id);
    onChange(i >= 0 ? value.filter((x) => x !== id) : [...value, id]);
  };
  const shown = !limit || all
    ? options
    : options.filter((o, i) => i < limit || value.includes(o.id));
  return (
    <div>
      {shown.map((o) => {
        const i = value.indexOf(o.id);
        return (
          <button key={o.id} type="button" className="chip" aria-pressed={i >= 0} onClick={() => toggle(o.id)}>
            {i >= 0 && <span className="rank">{i + 1}</span>}
            {o[labelKey] || o.label}
          </button>
        );
      })}
      {shown.length < options.length && (
        <button type="button" className="chip chip-more" onClick={() => setAll(true)}>
          + {options.length - shown.length} غيرها
        </button>
      )}
    </div>
  );
}

export function Banner({ kind = 'warn', children }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function Skeleton({ lines = 3 }) {
  return <div className="card">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 18}%` }} />)}</div>;
}

/** One question from APPLY_FIELDS, rendered as the right control for its type. */
export function Field({ field, value, onChange, autoFocus }) {
  const id = `f_${field.key}`;
  const common = {
    id, value: value ?? '', autoFocus,
    onChange: (e) => onChange(e.target.value),
    dir: field.dir, placeholder: field.ph
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.need === 'apply' && <span className="req" title="بدونه لا يمكن إرسال أي طلب"> ·</span>}
      </label>
      {field.type === 'select'
        ? <select {...common}>
            <option value="">{field.empty ?? '—'}</option>
            {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        : <input type={field.type} {...common} />}
    </div>
  );
}

/**
 * How far this profile has climbed, and the one thing to do next.
 * A ladder rather than a percentage: each rung unlocks something real, and says what.
 */
export function Ladder({ rungs, done, onNext, nextLabel }) {
  const n = done.filter(Boolean).length;
  if (n === rungs.length) return null;
  return (
    <button type="button" className="ladder" onClick={onNext}>
      <span className="ladder-bars" aria-hidden="true">
        {done.map((d, i) => <i key={i} data-on={d ? '' : undefined} />)}
      </span>
      <span className="ladder-text">
        <b>{nextLabel}</b>
        <small>{n} من {rungs.length} · {rungs[done.findIndex((d) => !d)]}</small>
      </span>
      <span className="ladder-go" aria-hidden="true">←</span>
    </button>
  );
}
