import React from 'react';

export const L = {
  brand: 'فرصة',
  tagline: 'وظائف جديدة في السعودية والمنطقة',
  signIn: 'ادخل', signOut: 'خروج',
  today: 'وظائف اليوم', applications: 'طلباتي', settings: 'ملفي',
  approve: 'يهمني', reject: 'لا يناسبني', details: 'تفاصيل', openListing: 'الإعلان الأصلي',
  saved: 'محفوظة', applied: 'قدّمت', interview: 'مقابلة', offer: 'عرض', closed: 'مغلقة',
  score: 'المطابقة', coding: 'البرمجة', noSalary: 'الراتب غير معلن',
  openNow: 'وظيفة مفتوحة', updated: 'آخر تحديث', justNow: 'الآن', minAgo: 'دقيقة', hAgo: 'ساعة'
};

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
            <option value="">—</option>
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
