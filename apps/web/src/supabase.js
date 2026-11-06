import { createClient } from '@supabase/supabase-js';

/**
 * What the sign-in link brought back, read before anything else.
 *
 * `detectSessionInUrl` wipes these parameters from the address as soon as the client starts,
 * so a component that looks later finds an empty URL and shows the sign-in form again — which
 * is exactly how an expired link comes to look like a link that did nothing.
 */
export const authReturn = (() => {
  if (typeof location === 'undefined') return { state: 'none' };
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
  if (err) return { state: 'error', message: decodeURIComponent(err.replace(/\+/g, ' ')) };
  if (q.get('code') || h.get('access_token')) return { state: 'signing' };
  return { state: 'none' };
})();

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  // Fail loudly in development rather than showing an empty app with silent 401s.
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY — copy .env.example to .env.local');
}

/**
 * The browser only ever holds the publishable key, which is designed to be public:
 * every table is guarded by row-level security, so this key can read nothing that
 * does not belong to the signed-in user.
 */
export const supabase = createClient(url ?? '', key ?? '', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

export async function currentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/** A CV lives under <user id>/<file>, which is exactly what the storage policy allows. */
export function cvPathFor(userId, fileName) {
  const safe = String(fileName).replace(/[^\w.\-]+/g, '_').slice(-80);
  return `${userId}/${Date.now()}_${safe}`;
}
