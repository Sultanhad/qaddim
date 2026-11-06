import React, { useMemo, useState } from 'react';
import { supabase } from './supabase.js';
import { APPLY_FIELDS } from './profile-fields.js';

// The same list the editor collects, so the sheet can never ask for something nothing fills.
const FIELDS = APPLY_FIELDS.map((f) => [f.key, f.label]);

/**
 * The practical half of applying.
 *
 * Nobody can press "submit" for you — hiring sites put a "verify you are human" box in front of it
 * precisely to stop that. What a platform *can* do is make sure you never retype an answer: every
 * field an employer asks for is here, already written by you, one tap to copy.
 *
 * Nothing on this panel is generated. Blank stays blank, and says so.
 */


function Copy({ value, children }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(String(value));
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* clipboard refused — the text is on screen anyway */ }
  }
  return (
    <button type="button" className="btn" onClick={copy} style={{ margin: 0, padding: '6px 12px', fontSize: 13 }}>
      {done ? 'نُسخ ✓' : (children ?? 'نسخ')}
    </button>
  );
}

export default function ApplySheet({ profile, job, onClose }) {
  const [answers, setAnswers] = useState(profile.answers ?? {});
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [cvUrl, setCvUrl] = useState(null);
  const [busy, setBusy] = useState(false);

  const filled = useMemo(() => FIELDS.filter(([k]) => String(profile[k] ?? '').trim() !== ''), [profile]);
  const missing = useMemo(() => FIELDS.filter(([k]) => String(profile[k] ?? '').trim() === ''), [profile]);

  async function openCv() {
    if (!profile.cv_path) return;
    const { data } = await supabase.storage.from('cvs').createSignedUrl(profile.cv_path, 300);
    if (data?.signedUrl) { setCvUrl(data.signedUrl); open(data.signedUrl, '_blank', 'noopener'); }
  }

  async function saveAnswer() {
    const q = newQ.trim(), a = newA.trim();
    if (!q || !a) return;
    setBusy(true);
    const next = { ...answers, [q]: a };
    const { error } = await supabase.from('profiles').update({ answers: next }).eq('id', profile.id);
    setBusy(false);
    if (!error) { setAnswers(next); setNewQ(''); setNewA(''); }
  }

  async function removeAnswer(q) {
    const next = { ...answers };
    delete next[q];
    await supabase.from('profiles').update({ answers: next }).eq('id', profile.id);
    setAnswers(next);
  }

  const all = filled.map(([k, label]) => `${label}: ${profile[k]}`).join('\n');

  return (
    <div className="card" style={{ borderColor: 'var(--blue)' }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#fff' }}>ورقة التعبئة</p>
          <p className="faint" style={{ margin: '4px 0 0' }}>{job.company} · {job.title}</p>
        </div>
        <button className="btn" onClick={onClose} style={{ margin: 0 }}>إغلاق</button>
      </div>

      <p className="muted" style={{ fontSize: 14, marginTop: 14 }}>
        افتح استمارة الشركة في تبويب، وانسخ من هنا. لا أحد — ولا أي أداة — يستطيع تجاوز مربع
        «تحقّق أنك لست روبوتاً»، لكن لن تعيد كتابة إجابة مرتين.
      </p>

      <div className="row" style={{ marginTop: 12 }}>
        <a className="btn btn-go" href={job.url} target="_blank" rel="noopener noreferrer">افتح الاستمارة ↗</a>
        {profile.cv_path
          ? <button className="btn" onClick={openCv}>افتح سيرتك</button>
          : <span className="faint">لم ترفع سيرة بعد</span>}
        <Copy value={all}>انسخ كل البيانات</Copy>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <tbody>
          {filled.map(([k, label]) => (
            <tr key={k}>
              <td style={{ padding: '9px 0', borderTop: '1px solid var(--line)', color: 'var(--faint)', fontSize: 13, whiteSpace: 'nowrap' }}>{label}</td>
              <td style={{ padding: '9px 10px', borderTop: '1px solid var(--line)', fontSize: 14 }} dir="auto">{String(profile[k])}</td>
              <td style={{ padding: '9px 0', borderTop: '1px solid var(--line)', textAlign: 'end' }}><Copy value={profile[k]} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {!!missing.length && (
        <p className="faint" style={{ marginTop: 12 }}>
          لم تكتبها بعد: {missing.map(([, l]) => l).join(' · ')} — أضفها من <a href="#settings">ملفك</a> لتظهر هنا.
        </p>
      )}

      <h2 style={{ fontSize: 16, marginTop: 22 }}>أسئلة تتكرر عليك</h2>
      <p className="faint" style={{ marginTop: 0 }}>
        اكتب الإجابة مرة واحدة — «لماذا هذه الشركة؟»، «احكِ عن مشروع أدرته» — وستجدها جاهزة في كل استمارة بعدها.
      </p>
      {Object.entries(answers).map(([q, a]) => (
        <div key={q} style={{ borderTop: '1px solid var(--line)', padding: '10px 0' }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700 }} dir="auto">{q}</p>
          <p className="muted" style={{ margin: '4px 0 8px', fontSize: 14, whiteSpace: 'pre-wrap' }} dir="auto">{a}</p>
          <Copy value={a} />
          <button className="btn btn-no" style={{ margin: '0 8px', padding: '6px 12px', fontSize: 13 }}
            onClick={() => removeAnswer(q)}>احذف</button>
        </div>
      ))}
      <div className="field" style={{ marginTop: 12 }}>
        <input type="text" placeholder="نص السؤال كما يظهر في الاستمارة" value={newQ}
          onChange={(e) => setNewQ(e.target.value)} dir="auto" />
      </div>
      <div className="field">
        <textarea rows={3} placeholder="إجابتك بكلماتك أنت" value={newA}
          onChange={(e) => setNewA(e.target.value)} dir="auto" />
      </div>
      <button className="btn btn-go" disabled={busy || !newQ.trim() || !newA.trim()} onClick={saveAnswer}>
        {busy ? '…' : 'احفظ الإجابة'}
      </button>
    </div>
  );
}
