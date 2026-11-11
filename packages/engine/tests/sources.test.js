// Ingestion contract, checked against recorded shapes from the real boards.
// No network: every response here is a fixture. Run: node packages/engine/tests/sources.test.js
import { fetchAll, fetchSource, getJson, placeOf, ALLOWED_HOSTS, BlockedHost, hostAllowed, fingerprintOf, linkHostAllowed, checkLink, probeUrlFor, searchPostAllowed, searchJson, autoApplyable } from '../src/sources.js';

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

// Re-posting. The same role comes back with a new id every year, and all of them were being
// shown as current; the fingerprint is what lets the newest stand in for the rest.
const fp = (t, c, city) => fingerprintOf({ title: t, company: c, city });
check('Dedup', 'A re-posted role matches its earlier posting',
  fp('Vice President - Development', 'Aldar', 'abu dhabi') === fp('Vice President - Development', 'Aldar', 'abu dhabi'));
check('Dedup', 'Seniority words do not split one role in two',
  fp('Senior Product Manager', 'Tamara', 'riyadh') === fp('Product Manager', 'Tamara', 'riyadh'));
check('Dedup', 'A gender tag does not make a new job',
  fp('Data Analyst (m/f/d)', 'Mozn', 'riyadh') === fp('Data Analyst', 'Mozn', 'riyadh'));
check('Dedup', 'A legal suffix does not make a new company',
  fp('Data Analyst', 'Mozn Inc', 'riyadh') === fp('Data Analyst', 'Mozn', 'riyadh'));
check('Dedup', 'Different roles stay different',
  fp('Data Analyst', 'Mozn', 'riyadh') !== fp('Data Engineer', 'Mozn', 'riyadh'));
check('Dedup', 'The same role in another city stays separate',
  fp('Data Analyst', 'Mozn', 'riyadh') !== fp('Data Analyst', 'Mozn', 'jeddah'));

// Link checking reaches employer pages, which is a different set of hosts from the feed APIs.
check('Safety', 'A board posting page is checkable', linkHostAllowed('https://jobs.lever.co/aldar/abc'));
check('Safety', 'A Recruitee tenant is checkable', linkHostAllowed('https://unifonic.recruitee.com/o/x'));
check('Safety', 'Somewhere else is not checked', !linkHostAllowed('https://evil.example.com/x'));
check('Safety', 'A look-alike is not checked', !linkHostAllowed('https://jobs.lever.co.attacker.net/x'));
check('Safety', 'Rubbish is not checked', !linkHostAllowed('not a url'));

// Greenhouse and Workable serve a "not found" page with status 200, so the page cannot be
// the question. Each board's own API is asked instead.
check('Links', 'Greenhouse is asked through its API, not its page',
  probeUrlFor({ source: 'greenhouse:tamara', source_job_id: '42', url: 'https://job-boards.greenhouse.io/tamara/jobs/42' })
    === 'https://boards-api.greenhouse.io/v1/boards/tamara/jobs/42');
check('Links', 'Workable too',
  probeUrlFor({ source: 'workable:salla', source_job_id: 'ABC', url: 'https://apply.workable.com/salla/j/ABC/' })
    === 'https://apply.workable.com/api/v1/accounts/salla/jobs/ABC');
check('Links', 'Ashby answers honestly on its own page',
  probeUrlFor({ source: 'ashby:leantech', source_job_id: 'x', url: 'https://jobs.ashbyhq.com/leantech/x' })
    === 'https://jobs.ashbyhq.com/leantech/x');
check('Links', 'Recruitee is asked at its tenant, not the employer domain',
  probeUrlFor({ source: 'recruitee:unifonic', source_job_id: '2765217', url: 'https://jobs.unifonic.com/o/x' })
    === 'https://unifonic.recruitee.com/api/offers/2765217');
check('Links', 'A job with no source id cannot be asked about',
  probeUrlFor({ source: 'greenhouse:tamara', source_job_id: '' }) === null);

// 404 means gone; a timeout means we do not know, and must not close a live job.
const fake = (status) => () => Promise.resolve({ status });
check('Links', 'A 404 marks the posting gone',
  (await checkLink('https://jobs.lever.co/x/1', { fetchImpl: fake(404) })).ok === false);
check('Links', 'A 410 marks it gone too',
  (await checkLink('https://jobs.lever.co/x/1', { fetchImpl: fake(410) })).ok === false);
check('Links', 'A 200 keeps it',
  (await checkLink('https://jobs.lever.co/x/1', { fetchImpl: fake(200) })).ok === true);
check('Links', 'A server error is not an answer',
  (await checkLink('https://jobs.lever.co/x/1', { fetchImpl: fake(500) })).ok === true);
check('Links', 'A network failure decides nothing',
  (await checkLink('https://jobs.lever.co/x/1', { fetchImpl: () => Promise.reject(new Error('boom')) })).ok === null);
check('Links', 'An unlisted host is skipped, not failed',
  (await checkLink('https://elsewhere.test/x', { fetchImpl: fake(404) })).ok === null);

// ── the one POST this package may make ──────────────────────────────────────
// Workday publishes job search as a POST, so the rule is stated by what it protects rather
// than by the verb: a job search, to a Workday careers host, and nothing else anywhere. These
// are the ways someone would try to widen that.
check('Safety', 'A Workday job search is allowed',
  searchPostAllowed('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs'));
check('Safety', 'Another path on the same host is refused',
  !searchPostAllowed('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/apply'));
check('Safety', 'A job detail path is refused for POST',
  !searchPostAllowed('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs/US/x_JR1'));
check('Safety', 'A path that merely ends in /jobs elsewhere is refused',
  !searchPostAllowed('https://nvidia.wd5.myworkdayjobs.com/anything/jobs'));
check('Safety', 'A look-alike host is refused',
  !searchPostAllowed('https://myworkdayjobs.com.attacker.net/wday/cxs/a/b/jobs'));
check('Safety', 'A tenant without a data-centre segment is refused',
  !searchPostAllowed('https://nvidia.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs'));
check('Safety', 'Plain http is refused',
  !searchPostAllowed('http://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs'));
check('Safety', 'Every other host in the world is refused',
  !searchPostAllowed('https://boards-api.greenhouse.io/v1/boards/x/jobs') &&
  !searchPostAllowed('https://apply.workable.com/api/v1/accounts/x/jobs') &&
  !searchPostAllowed('https://example.com/wday/cxs/a/b/jobs'));
check('Safety', 'searchJson refuses anywhere else outright',
  await searchJson('https://example.com/wday/cxs/a/b/jobs', {}, { fetchImpl: () => { throw new Error('must not be called'); } })
    .then(() => false, (e) => e instanceof BlockedHost));

// The body is built inside, from three numbers and a string — nothing a caller hands over
// can become a payload, which is what stops this from ever submitting anything.
let sentBody = null, sentMethod = null;
await searchJson('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/Site/jobs',
  { limit: 9999, offset: -5, searchText: 'x'.repeat(500) },
  { fetchImpl: (u, init) => { sentMethod = init.method; sentBody = JSON.parse(init.body); return Promise.resolve({ ok: true, status: 200, json: async () => ({}) }); } });
check('Safety', 'It sends POST and only a search', sentMethod === 'POST' &&
  Object.keys(sentBody).sort().join(',') === 'appliedFacets,limit,offset,searchText');
check('Safety', 'Absurd paging is clamped, not passed through',
  sentBody.limit === 20 && sentBody.offset === 0 && sentBody.searchText.length === 80);

// The allowlist.
let blocked = null;
try { await getJson('https://api.openai.com/v1/chat', { fetchImpl }); } catch (e) { blocked = e; }
check('Safety', 'A host outside the allowlist is refused', blocked instanceof BlockedHost);

// Recruitee hands every customer its own host, so that one suffix is pinned rather than
// listed. A suffix rule is a door: these are the ways someone would try to walk through it.
check('Safety', 'A real Recruitee tenant is allowed', hostAllowed('unifonic.recruitee.com'));
check('Safety', 'A look-alike domain is refused', !hostAllowed('recruitee.com.attacker.net'));
check('Safety', 'A deeper label under the suffix is refused', !hostAllowed('a.b.recruitee.com'));
check('Safety', 'The bare suffix is refused', !hostAllowed('recruitee.com'));
check('Safety', 'A host with userinfo is refused', !hostAllowed('evil@x.recruitee.com'));
check('Safety', 'A host with a port is refused', !hostAllowed('x.recruitee.com:8080'));
check('Safety', 'Another vendor is still refused', !hostAllowed('api.example.com'));
check('Safety', 'Only hiring-system hosts are allowed',
  ALLOWED_HOSTS.every((h) => /greenhouse|lever|ashby|workable|smartrecruiters/.test(h)));
// This used to assert "no POST appears in this file", which stopped being the right question
// the day Workday was added — its job search is a POST. The property that actually matters is
// that nothing here can write: the only non-GET in the file is the one search, and no adapter
// builds a request method of its own.
{
  const src = await (await import('node:fs/promises')).readFile(new URL('../src/sources.js', import.meta.url), 'utf8');
  const writes = src.match(/method:\s*['"]?(POST|PUT|PATCH|DELETE)/gi) || [];
  check('Safety', 'Nothing in the reader writes', writes.length === 1 && /POST/i.test(writes[0]),
    writes.join(', ') || 'none');
  check('Safety', 'And that one POST lives in the search function',
    /export async function searchJson[\s\S]*?method: 'POST'/.test(src));
  check('Safety', 'No adapter chooses its own method',
    !/ADAPTERS[\s\S]*method:\s*['"](POST|PUT|PATCH|DELETE)/i.test(src));
}

// What may be queued for the extension has to be exactly what the extension has a script on.
{
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../../extension/manifest.json', import.meta.url), 'utf8'));
  const pages = manifest.content_scripts[0].matches.map((m) => m.replace('*.', 'x.').replace('/*', '/job/1'));
  const refused = pages.filter((u) => !autoApplyable(u));
  check('Applying', 'Every page the extension fills may be queued', refused.length === 0, refused.join(', '));
  check('Applying', 'A Workday job is never queued', !autoApplyable('https://cisco.wd5.myworkdayjobs.com/Cisco_Careers/job/Riyadh/X_1'));
  check('Applying', 'Nor SuccessFactors, nor an employer\'s own site',
    !autoApplyable('https://career5.successfactors.eu/career?company=x') && !autoApplyable('https://careers.datadoghq.com/detail/1/'));
  check('Applying', 'A look-alike host is refused', !autoApplyable('https://evilgreenhouse.io/x') && !autoApplyable('https://apply.workable.com.evil.io/j/1'));
  check('Applying', 'Greenhouse on its newer board is allowed', autoApplyable('https://job-boards.eu.greenhouse.io/binance/jobs/5024608101'));
  check('Applying', 'Junk is not a URL', !autoApplyable('') && !autoApplyable(null) && !autoApplyable('http://jobs.lever.co/a/b'));
}

check('Places', 'Arabic city names are understood', placeOf('الرياض، السعودية').city === 'riyadh');
check('Places', 'A country with no city still resolves', placeOf('Saudi Arabia').country === 'sa' && placeOf('Saudi Arabia').city === null);

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + (r.g + '          ').slice(0, 12) + r.n + (r.pass ? '' : '  <-- ' + r.detail));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
