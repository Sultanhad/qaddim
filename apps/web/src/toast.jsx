import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Saying what happened.
 *
 * Eleven writes in this app used to fire and ignore the answer: the status dropdown moved,
 * the note looked saved, the job vanished from the list — and if the request had failed, the
 * screen said nothing and the next reload undid it all. A silent failure is worse than a loud
 * one, because the reader goes on believing.
 *
 * Success is quiet (it is already visible on screen); failure is not, and carries the retry.
 */
const Ctx = createContext(() => {});
export const useToast = () => useContext(Ctx);

export function ToastHost({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, ...t }]);
    if (t.kind !== 'bad') setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 2600);
    return id;
  }, []);

  const api = useCallback({
    ok: (text) => push({ kind: 'good', text }),
    fail: (text, retry) => push({ kind: 'bad', text, retry })
  }, [push]);

  return (
    <Ctx.Provider value={api}>
      {children}
      {!!items.length && (
        <div className="toasts" role="status" aria-live="polite">
          {items.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>
              <span>{t.text}</span>
              {t.retry && <button className="btn" onClick={() => { setItems((xs) => xs.filter((x) => x.id !== t.id)); t.retry(); }}>أعد المحاولة</button>}
              <button className="toast-x" aria-label="إغلاق" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>×</button>
            </div>
          ))}
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Supabase speaks English and in error codes; this is what a person needs to read. */
export function errorAr(e) {
  const m = String(e?.message || e || '');
  if (/fetch|network|offline/i.test(m)) return 'لا اتصال بالشبكة.';
  if (/jwt|expired|not authenticated|401/i.test(m)) return 'انتهت جلستك — ادخل من جديد.';
  if (/violates row-level security|403/i.test(m)) return 'لا صلاحية لهذه العملية.';
  if (/duplicate key/i.test(m)) return 'هذه محفوظة عندك أصلاً.';
  if (/check constraint|violates check/i.test(m)) return 'قيمة خارج المسموح — راجع ما كتبته.';
  if (/payload too large|exceeded the maximum/i.test(m)) return 'الملف أكبر من المسموح (٥ ميغابايت).';
  if (/mime type|not allowed/i.test(m)) return 'نوع الملف غير مقبول — PDF أو Word.';
  return m || 'تعذّرت العملية.';
}

/** React to the browser going offline, because every write below will fail while it is. */
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false);
    addEventListener('online', up); addEventListener('offline', down);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);
  return online;
}
