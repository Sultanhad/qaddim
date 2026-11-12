// Which database the test suites talk to — and what happens to it when one of them falls over.
//
// The suites create real accounts, real applications and real profile rows. Until now they
// did that in the only database there was: production. A failed run left its account behind
// beside the real ones, and a mistake in a test was a mistake in people's data.
//
//   .env.test.local   a second Supabase project, for tests only. When this file exists, every
//                     suite uses it and production is never touched:
//                         VITE_SUPABASE_URL=…  VITE_SUPABASE_PUBLISHABLE_KEY=…  SUPABASE_SERVICE_KEY=…
//                     and the site under test is built for it:  npm run preview:test
//   (no such file)    the suites fall back to .env.local, say so in one line, and are careful:
//                     throwaway addresses only, removed at the end — and now also on a crash.
//
// On CI there are no files: the same three names come from the environment, and they must be
// the test project's.
import { loadEnv, readEnvFile, projectRef } from './env.mjs';

let told = false;

export async function testEnv({ quiet = false } = {}) {
  const prod = await readEnvFile('.env.local');
  const test = await readEnvFile('.env.test.local');
  const fromCi = process.env.CI && process.env.SUPABASE_SERVICE_KEY ? await loadEnv('.env.none') : null;

  let env, where;
  if (test) {
    if (prod && projectRef(test.VITE_SUPABASE_URL) === projectRef(prod.VITE_SUPABASE_URL)) {
      throw new Error('.env.test.local points at the same project as .env.local — that is production, not a test database');
    }
    env = { ...test, QADDIM_TEST_DB: 'test' }; where = 'test';
  } else if (fromCi) {
    env = { ...fromCi, QADDIM_TEST_DB: 'test' }; where = 'test';
  } else if (prod) {
    env = { ...prod, QADDIM_TEST_DB: 'production' }; where = 'production';
  } else {
    throw new Error('no database to test against: neither .env.test.local nor .env.local exists');
  }
  for (const k of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_KEY']) {
    if (!env[k]) throw new Error(`${k} is missing from the ${where} environment`);
  }
  if (where === 'production' && !quiet && !told) {
    told = true;
    console.error('  ! لا قاعدة اختبار (.env.test.local) — هذه الفحوص تجري على قاعدة الإنتاج بحسابات مؤقتة تُحذف في آخرها');
  }

  // A suite that dies — a thrown error, a connection that dropped — never reaches the line
  // that deletes its account. Whatever kills it, the sweep runs first.
  if (!quiet) {
    const crash = async (e) => {
      console.error('\n✗ ' + (e?.message ?? e));
      try {
        const { sweepTestUsers } = await import('./clean-test-users.mjs');
        const r = await sweepTestUsers(env, () => { });
        if (r.accounts) console.error(`  (${r.accounts} test account(s) removed on the way out)`);
      } catch (x) { console.error('  ! could not clean up: ' + (x?.message ?? x) + ' — run: npm run clean:tests'); }
      process.exit(1);
    };
    process.once('uncaughtException', crash);
    process.once('unhandledRejection', crash);
  }
  return env;
}

/**
 * Is the site at `base` built for the same project the suite is about to write to? A test
 * account made in one database and a page talking to another fails in ways that say nothing
 * about why; this says it first.
 */
export async function siteMatches(base, env) {
  const ref = projectRef(env.VITE_SUPABASE_URL);
  const html = await fetch(base.replace(/\/$/, '') + '/').then((r) => r.text());
  const script = /(?:src|href)="([^"]*assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  if (!script) throw new Error(`no built site at ${base} — start it first (npm run preview / preview:test)`);
  const js = await fetch(new URL(script, base.replace(/\/$/, '') + '/')).then((r) => r.text());
  if (!js.includes(ref)) {
    throw new Error(`the site at ${base} is built for another database than the one under test (${env.QADDIM_TEST_DB}) — `
      + (env.QADDIM_TEST_DB === 'test' ? 'run: npm run preview:test' : 'run: npm run build && npm --prefix apps/web run preview'));
  }
}
