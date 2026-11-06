// Ingestion contract, checked against recorded shapes from the real boards.
// No network: every response here is a fixture. Run: node packages/engine/tests/sources.test.js
import { fetchAll, fetchSource, getJson, placeOf, ALLOWED_HOSTS, BlockedHost } from '../src/sources.js';

const results = [];
const check = (g, n, c, d) => results.push({ g, n, pass: !!c, detail: c ? '' : String(d ?? '') });

const FIXTURES = {
  'https://apply.workable.com/api/v1/widget/accounts/mozn-ai?details=true': {
    name: 'Mozn',
    jobs: [
      { shortcode: 'A1', title: 'Commercial Operations Analyst', city: 'Riyadh', state: 'Riyadh Province',
        country: 'Saudi Arabia', telecommuting: false, description: '<p>Work with <b>stakeholders</b> &amp; data.</p>',
        url: 'https://apply.workable.com/j/A1?utm_source=x', published_on: '2026-11-01' },
      { shortcode: 'A2', title: 'AI Engineer', city: 'Dubai', country: 'United Arab Emirates',
        telecommuting: true, description: 'Python, Kubernetes.', url: 'https://apply.workable.com/j/A2',
        published_on: '2026-10-28' }
    ]
  },
  'https://api.lever.co/v0/postings/rewaatech?mode=json': [
    { id: 'L1', text: 'Business Analyst', categories: { location: 'Riyadh, Saudi Arabia' },
      descriptionPlain: 'Requirements and user stories.', hostedUrl: 'https://jobs.lever.co/rewaatech/L1/',
      createdAt: 1762300000000, salaryRange: { currency: 'SAR', min: 15000, max: 20000, interval: 'per-month' } }
  ],
  'https://boards-api.greenhouse.io/v1/boards/tamara/jobs?content=true': {
    jobs: [{ id: 9001, title: 'Tamara Builders Program', location: { name: 'Riyadh, Saudi Arabia' },
      content: '&lt;p&gt;Graduate programme&lt;/p&gt;', absolute_url: 'https://job-boards.eu.greenhouse.io/tamara/jobs/9001?gh_src=abc',
      first_published: '2026-10-20T00:00:00Z' }]
  },
  'https://api.ashbyhq.com/posting-api/job-board/leantech?includeCompensation=true': {
    jobs: [{ id: 'AS1', title: 'Product Analyst', location: 'Riyadh', isListed: true, isRemote: false,
      descriptionPlain: 'Product adoption and user problems.', jobUrl: 'https://jobs.ashbyhq.com/leantech/AS1',
      publishedAt: '2026-10-26', shouldDisplayCompensationOnJobPostings: false }]
  }
};

const fetchImpl = async (url) => {
  if (!(url in FIXTURES)) throw new Error('unexpected url ' + url);
  return { ok: true, status: 200, json: async () => FIXTURES[url] };
};

const SOURCES = [
  { system: 'workable', slug: 'mozn-ai', label: 'Mozn' },
  { system: 'lever', slug: 'rewaatech', label: 'Rewaa' },
  { system: 'greenhouse', slug: 'tamara', label: 'Tamara' },
  { system: 'ashby', slug: 'leantech', label: 'Lean Technologies' }
];

const { jobs, errors } = await fetchAll(SOURCES, { fetchImpl });

check('Ingest', 'Every board is read', errors.length === 0 && jobs.length === 5, JSON.stringify(errors));
const mozn = jobs.find((j) => j.source_job_id === 'A1');
check('Ingest', 'Workable fields land in the right columns',
  mozn.title === 'Commercial Operations Analyst' && mozn.company === 'Mozn' && mozn.city === 'riyadh' && mozn.country === 'sa',
  JSON.stringify(mozn));
check('Ingest', 'HTML in a description becomes plain text with entities decoded',
  mozn.description === 'Work with stakeholders & data.', mozn.description);
check('Ingest', 'Tracking parameters are stripped from the canonical URL, the real link is kept',
  mozn.canonical_url === 'https://apply.workable.com/j/A1' && mozn.url.includes('utm_source'), mozn.canonical_url);
check('Ingest', 'Remote is read from the board', jobs.find((j) => j.source_job_id === 'A2').arrangement === 'Remote');
check('Ingest', 'A Dubai posting is placed in the UAE', jobs.find((j) => j.source_job_id === 'A2').country === 'ae');

const lever = jobs.find((j) => j.source === 'lever:rewaatech');
check('Ingest', 'A published salary is kept verbatim', lever.salary_published === 'SAR 15,000–20,000 per month', lever.salary_published);
check('Ingest', 'A job with no published salary stores null, never a guess', mozn.salary_published === null);

const gh = jobs.find((j) => j.source === 'greenhouse:tamara');
check('Ingest', 'Greenhouse entity-escaped HTML is decoded', gh.description === 'Graduate programme', gh.description);
check('Ingest', 'The employer link is preserved, including its own parameters', gh.url.includes('gh_src=abc'));

check('Ingest', 'Ids are stable across runs',
  (await fetchAll(SOURCES, { fetchImpl })).jobs.find((j) => j.source_job_id === 'A1').id === mozn.id);
check('Ingest', 'The same posting from two boards is stored once', new Set(jobs.map((j) => j.canonical_url)).size === jobs.length);

// One broken board must not take the sweep down with it.
const flaky = async (url) => { if (url.includes('lever')) throw new Error('HTTP 500'); return fetchImpl(url); };
const partial = await fetchAll(SOURCES, { fetchImpl: flaky });
check('Resilience', 'A failing board is recorded and the others still load',
  partial.errors.length === 1 && partial.errors[0].source === 'lever:rewaatech' && partial.jobs.length === 4,
  JSON.stringify(partial.errors));

// The allowlist.
let blocked = null;
try { await getJson('https://api.openai.com/v1/chat', { fetchImpl }); } catch (e) { blocked = e; }
check('Safety', 'A host outside the allowlist is refused', blocked instanceof BlockedHost);
check('Safety', 'Only hiring-system hosts are allowed',
  ALLOWED_HOSTS.every((h) => /greenhouse|lever|ashby|workable|smartrecruiters/.test(h)));
check('Safety', 'The adapters issue GET only',
  !/method:\s*['"]?(POST|PUT|PATCH|DELETE)/i.test(await (await import('node:fs/promises')).readFile(new URL('../src/sources.js', import.meta.url), 'utf8')));

check('Places', 'Arabic city names are understood', placeOf('الرياض، السعودية').city === 'riyadh');
check('Places', 'A country with no city still resolves', placeOf('Saudi Arabia').country === 'sa' && placeOf('Saudi Arabia').city === null);

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + (r.g + '          ').slice(0, 12) + r.n + (r.pass ? '' : '  <-- ' + r.detail));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
