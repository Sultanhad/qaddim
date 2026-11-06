import { createClient } from '@supabase/supabase-js';

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
