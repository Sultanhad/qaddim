// Every open job in the countries a person can work in — for searching and browsing by field.
//
// The scored pool (App.jsx) is the 600 newest jobs with their full text, which is what the
// scorer needs. Searching that pool missed half of Saudi Arabia: on 14 Nov 2026 there were 1,186
// open jobs a Saudi-based profile could see. This list is all of them, without the text — 44 KB
// over the wire instead of 1.2 MB — and the text is fetched afterwards for the matches only.
import { useEffect, useState } from 'react';
import { supabase } from './supabase.js';
import { fieldOf } from '@engine/fields.js';
export { fold, parseQuery, matches, usable } from './search.js';

const TTL = 300000;
const CATALOG_COLS = 'id,title,company,location,city,country,arrangement,salary_published,url,published_at,last_seen';
let CATALOG = null, CATALOG_AT = 0, CATALOG_FOR = '';

async function loadCatalog(countries) {
  const key = countries.join(',');
  if (CATALOG && CATALOG_FOR === key && Date.now() - CATALOG_AT < TTL) return CATALOG;
  const rows = [];
  // PostgREST hands back a thousand rows at most; read until a page comes back short.
  for (let from = 0; from < 20000; from += 1000) {
    let q = supabase.from('jobs').select(CATALOG_COLS).eq('is_open', true);
    if (countries.length) q = q.or(`country.in.(${countries.join(',')}),country.is.null`);
    const { data, error } = await q.order('published_at', { ascending: false, nullsFirst: false }).order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  for (const j of rows) j.field = fieldOf(j.title, j.company);
  CATALOG = rows; CATALOG_AT = Date.now(); CATALOG_FOR = key;
  return rows;
}

export function useCatalog(countries) {
  const key = countries.join(',');
  const [state, setState] = useState(() => (CATALOG_FOR === key ? CATALOG : null));
  useEffect(() => {
    let live = true;
    loadCatalog(countries).then((c) => live && setState(c)).catch(() => live && setState([]));
    return () => { live = false; };
  }, [key]);
  return state;
}

// ── the text, for the matches only ──────────────────────────────────────────
const TEXT = new Map();   // job id → description, kept for the session

/** Fills in the descriptions the scorer needs, a hundred ids a request. */
export async function withText(jobs) {
  const missing = jobs.filter((j) => !TEXT.has(j.id)).map((j) => j.id);
  for (let i = 0; i < missing.length; i += 100) {
    const ids = missing.slice(i, i + 100);
    const { data, error } = await supabase.from('jobs').select('id,description').in('id', ids);
    if (error) throw error;
    for (const r of data ?? []) TEXT.set(r.id, r.description ?? '');
    for (const id of ids) if (!TEXT.has(id)) TEXT.set(id, '');
  }
  return jobs.map((j) => ({ ...j, description: TEXT.get(j.id) ?? '' }));
}
