// Where the scripts get their configuration.
//
// On the owner's machine that is `.env.local` (gitignored, chmod 600). On a server there is no
// such file and there must not be one: the secrets live in the platform's own store and reach
// the process as environment variables. This reads both, and the environment wins — so the
// same script runs unchanged in either place, and a server can never be made to prefer a file
// someone left lying in the image.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
// Only names this project owns are taken from the environment; PATH and the rest stay out.
const OURS = /^(VITE_SUPABASE_|SUPABASE_|ANTHROPIC_|QADDIM_|RESEND_)/;

const parse = (text) => Object.fromEntries(text.split('\n')
  .map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

/** One env file as written, or null when there is none. The environment is not consulted. */
export async function readEnvFile(file) {
  try { return parse(await readFile(new URL(file, root), 'utf8')); } catch (e) {
    if (e?.code !== 'ENOENT') throw e;          // unreadable is a problem; absent is a server
    return null;
  }
}

export async function loadEnv(file = '.env.local') {
  const fromFile = (await readEnvFile(file)) ?? {};
  const fromEnv = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v && OURS.test(k)));
  const env = { ...fromFile, ...fromEnv };
  // The site's build calls it VITE_SUPABASE_URL; a server has no reason to.
  env.VITE_SUPABASE_URL ||= env.SUPABASE_URL;
  return env;
}

/** Which Supabase project an address points at — its reference, never a key. */
export const projectRef = (url) => { try { return new URL(url).hostname.split('.')[0]; } catch { return ''; } };
