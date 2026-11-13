// Reads job feeds straight from the hiring systems companies already use.
//
// Two rules:
//   1. GET only, and only to the hosts listed here. There is no code path that posts anywhere.
//   2. Every job keeps the employer's own link. Nothing is reposted under our name.

import { stripHtml, clean, dateOnly, canonicalUrl, fnv1a, decodeEntities } from './text.js';
import { CITY_ALIASES, CITY_COUNTRY, COUNTRY_ALIASES, ELSEWHERE, COVERS_REGION, SHARED_CITY_NAMES, US_STATE_CODE } from './taxonomy.js';
import { norm, hasAny } from './text.js';
import { arrangementOf } from './score.js';

export const ALLOWED_HOSTS = [
  'api.ashbyhq.com', 'api.lever.co', 'api.eu.lever.co',
  'boards-api.greenhouse.io', 'api.smartrecruiters.com', 'apply.workable.com'
];

/**
 * Recruitee gives every customer its own host, so there is no fixed name to list. The
 * suffix is pinned instead, and the part before it may only be a slug — no dots, so
 * `evil.com.recruitee.com.attacker.net` cannot slip through, and no userinfo or port.
 */
export const ALLOWED_HOST_SUFFIXES = [
  { suffix: '.recruitee.com', slug: /^[a-z0-9][a-z0-9-]{0,62}$/ },
  // Workday gives every customer a host under a numbered data centre: acme.wd3.myworkdayjobs.com
  { suffix: '.myworkdayjobs.com', slug: /^[a-z0-9][a-z0-9-]{0,62}\.wd\d{1,2}$/ }
];

/**
 * The one place a search query may be POSTed, and the only shape it may take.
 *
 * The rule here has always been that this package can never send anything on anyone's behalf.
 * Workday publishes its job search as a POST — the query travels in the body rather than the
 * query string — so keeping to GET would mean giving up every large employer in the region,
 * which is most of the ones a Saudi job seeker wants.
 *
 * The guarantee is therefore stated by what it protects rather than by the verb: this package
 * may POST a *job search* to a Workday careers host, and nothing else, anywhere. The body is
 * built here from three numbers and a string; it is never passed through from a caller, so
 * there is no path by which an application, a form, or any other payload could leave.
 */
const SEARCH_POST = { suffix: '.myworkdayjobs.com', path: /^\/wday\/cxs\/[^/]+\/[^/]+\/jobs$/ };

export function searchPostAllowed(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host.endsWith(SEARCH_POST.suffix)) return false;
  const left = host.slice(0, -SEARCH_POST.suffix.length);
  if (!/^[a-z0-9][a-z0-9-]{0,62}\.wd\d{1,2}$/.test(left)) return false;
  return SEARCH_POST.path.test(u.pathname);
}

/** A job search, and only a job search. The body is built here; callers pass no body. */
export async function searchJson(url, { limit = 20, offset = 0, searchText = '' } = {}, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!searchPostAllowed(url)) throw new BlockedHost(`Not a job-search endpoint: ${url}`);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST', signal: ctrl?.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      // Three numbers and a string. Nothing a caller supplies reaches this object.
      body: JSON.stringify({
        appliedFacets: {},
        limit: Math.min(Math.max(1, limit | 0), 20),
        offset: Math.max(0, offset | 0),
        searchText: String(searchText).slice(0, 80)
      })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
    return await res.json();
  } finally { if (timer) clearTimeout(timer); }
}

export function hostAllowed(host) {
  if (ALLOWED_HOSTS.includes(host)) return true;
  return ALLOWED_HOST_SUFFIXES.some(({ suffix, slug }) =>
    host.endsWith(suffix) && slug.test(host.slice(0, -suffix.length)));
}

export class BlockedHost extends Error {}

/** The only way this package reaches the network. */
export async function getJson(url, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const host = (String(url).match(/^https:\/\/([^/?#]+)/i) || [])[1]?.toLowerCase();
  if (!host || !hostAllowed(host)) throw new BlockedHost(`Blocked by allowlist: ${host}`);
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { method: 'GET', signal: ctrl?.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
    return await res.json();
  } finally { if (timer) clearTimeout(timer); }
}

/** Normalises whatever a board gives us into one shape. */
function raw(o) {
  const url = String(o.url || '').trim();
  const canonical = canonicalUrl(url) || `${o.source}#${o.source_job_id}`;
  const location = clean(decodeEntities(o.location), 300);
  const { city, country } = placeOf(location);
  return {
    id: 'j' + fnv1a(canonical).toString(36),
    title: clean(decodeEntities(o.title), 200),
    company: clean(decodeEntities(o.company), 120),
    location,
    city,
    country,
    arrangement: arrangementOf(o.arrangement, location, o.description),
    salary_published: clean(o.salary, 120) || null,
    description: String(o.description || '').slice(0, 20000),
    url,
    canonical_url: canonical,
    source: o.source,
    source_type: o.source_type || 'ats',
    source_job_id: String(o.source_job_id || ''),
    published_at: dateOnly(o.published_at) || null,
    official: true
  };
}

/** Which city and country a free-text location refers to. */
export function placeOf(location) {
  const t = norm(location);
  let city = null;
  for (const [name, terms] of Object.entries(CITY_ALIASES)) {
    if (hasAny(t, terms)) { city = name; break; }
  }
  let country = city ? (CITY_COUNTRY[city] || null) : null;
  let named = null;                       // a region country written out, not inferred from a city
  for (const [code, terms] of Object.entries(COUNTRY_ALIASES)) {
    if (hasAny(t, terms)) { named = code; break; }
  }
  if (!country) country = named;

  // Somewhere else? Only when nothing here is named. A posting listed for "Dubai; London" is a
  // Dubai posting; one listed for "London" alone is not ours, however remote it says it is.
  const away = hasAny(t, ELSEWHERE) || (US_STATE_CODE.test(String(location ?? '')) ? 'a US state' : null);
  if (country && away && !named && SHARED_CITY_NAMES.includes(city)) {
    // "Medina, Ohio": the city's name matched, the country it sits in is not one of ours.
    return { city: null, country: null, elsewhere: true };
  }
  // "Africa" covers Egypt; "South Africa" is a country. The part of a name is not the area.
  const areas = t.replace(/ (south|southern|west|east|central|sub saharan) africa(n)? /g, ' ');
  const elsewhere = !country && !!away && !hasAny(areas, COVERS_REGION);
  return { city, country, elsewhere };
}

// ── one adapter per hiring system ───────────────────────────────────────────
const ADAPTERS = {
  async ashby(slug, opts) {
    const j = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}?includeCompensation=true`, opts);
    return (j.jobs || []).filter((x) => x.isListed !== false).map((x) => {
      const locs = [x.location, ...(x.secondaryLocations || []).map((l) => l.location || l.locationName || '')];
      const salary = x.shouldDisplayCompensationOnJobPostings && x.compensation
        ? (x.compensation.scrapeableCompensationSalarySummary || x.compensation.compensationTierSummary || '') : '';
      return raw({
        source: `ashby:${slug}`, source_job_id: x.id, title: x.title, company: opts?.label || slug,
        location: locs.filter(Boolean).join('; '),
        arrangement: x.isRemote ? 'Remote' : (x.workplaceType || null),
        description: x.descriptionPlain || stripHtml(x.descriptionHtml),
        url: x.jobUrl || x.applyUrl, published_at: x.publishedAt, salary
      });
    });
  },

  async lever(slug, opts) {
    const host = opts?.eu ? 'api.eu.lever.co' : 'api.lever.co';
    const j = await getJson(`https://${host}/v0/postings/${encodeURIComponent(slug)}?mode=json`, opts);
    return (j || []).map((x) => {
      const c = x.categories || {};
      const r = x.salaryRange;
      const salary = r && (r.min || r.max)
        ? `${r.currency || ''} ${fmt(r.min)}${r.max ? '–' + fmt(r.max) : ''}${r.interval ? ' ' + String(r.interval).replace(/-/g, ' ') : ''}`.trim()
        : '';
      const desc = [x.descriptionPlain || stripHtml(x.description),
        ...(x.lists || []).map((l) => (l.text || '') + '\n' + stripHtml(l.content)),
        x.additionalPlain || ''].join('\n');
      return raw({
        source: `lever:${slug}`, source_job_id: x.id, title: x.text, company: opts?.label || slug,
        location: (c.allLocations?.length ? c.allLocations.join('; ') : c.location) || '',
        arrangement: x.workplaceType || null, description: desc,
        url: x.hostedUrl || x.applyUrl, published_at: x.createdAt, salary
      });
    });
  },

  async greenhouse(slug, opts) {
    // EU-hosted boards are served from the same API host; boards-api.eu.greenhouse.io does not exist.
    const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, opts);
    return (j.jobs || []).map((x) => raw({
      source: `greenhouse:${slug}`, source_job_id: x.id, title: x.title, company: opts?.label || slug,
      location: x.location?.name || '', description: stripHtml(x.content),
      url: x.absolute_url, published_at: x.first_published || x.updated_at, salary: ''
    }));
  },

  async workable(slug, opts) {
    const j = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=true`, opts);
    return (j.jobs || []).map((x) => raw({
      source: `workable:${slug}`, source_job_id: x.shortcode || x.id, title: x.title,
      company: opts?.label || j.name || slug,
      location: [x.city, x.state, x.country].filter(Boolean).join(', '),
      arrangement: x.telecommuting ? 'Remote' : null,
      description: stripHtml(x.description || ''),
      url: x.url || x.application_url, published_at: x.published_on || x.created_at, salary: ''
    }));
  },

  async recruitee(slug, opts) {
    const j = await getJson(`https://${encodeURIComponent(slug)}.recruitee.com/api/offers/`, opts);
    return (j.offers || []).filter((x) => x.status === 'published' || !x.status).map((x) => {
      const places = (x.locations || []).map((l) => l.full_address || [l.city, l.country].filter(Boolean).join(', '));
      const location = places.length ? places.join('; ') : [x.city, x.country].filter(Boolean).join(', ');
      return raw({
        source: `recruitee:${slug}`, source_job_id: x.id, title: x.title,
        company: opts?.label || x.company_name || slug,
        location,
        arrangement: x.remote ? 'Remote' : (x.hybrid ? 'Hybrid' : null),
        description: stripHtml([x.description, x.requirements].filter(Boolean).join('\n')),
        url: x.careers_url || x.careers_apply_url, published_at: x.published_at || x.created_at, salary: ''
      });
    });
  },

  /**
   * Workday. `slug` is "tenant.wdN/siteName" — the host and the careers site, which are
   * separate things and both needed: alfanar.wd3 plus alfanar_Careers.
   *
   * The search gives a title, a location string and a path; everything else — the description,
   * the country, the requisition id, the real apply URL — comes from the job's own page over
   * GET. That is a request per job, so the number of pages read is capped.
   */
  async workday(slug, opts) {
    const [tenantHost, site] = String(slug).split('/');
    if (!tenantHost || !site) throw new Error(`workday slug must be "tenant.wdN/site": ${slug}`);
    const base = `https://${tenantHost}.myworkdayjobs.com/wday/cxs/${encodeURIComponent(tenantHost.split('.')[0])}/${encodeURIComponent(site)}`;

    // A global employer's board holds thousands of jobs and a handful in this region. Reading
    // all of them to find those few is pointless and rude; Workday's own search filters by
    // place, so it is asked once per region term instead. Cisco: 1,479 postings → one query
    // for "Saudi" returns 10, eight of them actually here.
    const terms = opts?.searchTerms ?? ['Saudi Arabia', 'Riyadh', 'Jeddah', 'Dubai', 'Doha', 'Egypt', 'Jordan'];
    const wanted = opts?.maxJobs ?? 80;
    const found = [], seenPaths = new Set();
    for (const term of terms) {
      for (let offset = 0; offset < 40 && found.length < wanted; offset += 20) {
        const page = await searchJson(`${base}/jobs`, { limit: 20, offset, searchText: term }, opts);
        const batch = page?.jobPostings ?? [];
        for (const x of batch) {
          if (x.externalPath && !seenPaths.has(x.externalPath)) { seenPaths.add(x.externalPath); found.push(x); }
        }
        if (batch.length < 20) break;
      }
      if (found.length >= wanted) break;
    }

    const out = [];
    let unread = 0;
    for (const x of found.slice(0, wanted)) {
      const path = String(x.externalPath || '');
      if (!path) continue;
      let info = {};
      try {
        const detail = await getJson(base + path, opts);
        info = detail?.jobPostingInfo ?? {};
      } catch {
        // The search listed it and its page would not load. It used to be stored anyway, from
        // the search alone — no description, no country — and that copy then overwrote the
        // good one, fell out of the region filter for want of a country, and was closed. It
        // is left out instead, and the read is marked incomplete so nobody concludes from
        // its absence that the job has gone.
        unread++;
        continue;
      }
      const places = [info.location, ...(info.additionalLocations || [])].filter(Boolean);
      out.push(raw({
        source: `workday:${slug}`, source_job_id: info.jobReqId || info.id || path.split('/').pop(),
        title: info.title || x.title, company: opts?.label || tenantHost.split('.')[0],
        location: places.length ? places.join('; ') : (x.locationsText || ''),
        arrangement: /remote/i.test(places.join(' ') + ' ' + (x.locationsText || '')) ? 'Remote' : null,
        description: stripHtml(info.jobDescription || ''),
        url: info.externalUrl || `https://${tenantHost}.myworkdayjobs.com/${encodeURIComponent(site)}${path}`,
        published_at: info.startDate || info.postedOn || null, salary: ''
      }));
    }
    if (unread) incomplete(out, `${unread} of ${found.length} job pages did not load`);
    return out;
  },

  /**
   * SmartRecruiters. Its list is filtered by country, so it is asked once for each country
   * of the region: asked only about Saudi Arabia, a hotel group showed 105 roles and kept its
   * 106 in the Emirates, Qatar and Egypt to itself.
   *
   * The list carries no description — the text every score is computed from — so each posting
   * the database does not already hold is read once from its own page. `opts.known` is the
   * set of job ids already stored with their text; those are not asked for again, and come
   * back flagged so the caller knows not to overwrite what it has with nothing.
   */
  async smartrecruiters(slug, opts) {
    const api = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings`;
    const listed = [], seen = new Set();
    for (const c of opts?.countries ?? REGION) {
      for (let offset = 0; offset < 1000; offset += 100) {
        const page = await getJson(`${api}?country=${c}&limit=100&offset=${offset}`, opts);
        const batch = page.content || [];
        for (const x of batch) if (x.id && !seen.has(x.id)) { seen.add(x.id); listed.push(x); }
        if (batch.length < 100) break;
      }
    }
    const out = [];
    let unread = 0, asked = 0;
    for (const x of listed) {
      const l = x.location || {};
      // The API gives the country as a code. Written as a name, a posting in a town this
      // file has never heard of is still placed in its country instead of being dropped.
      const countryName = COUNTRY_ALIASES[String(l.country || '').toLowerCase()]?.[0] || l.country;
      const job = raw({
        source: `smartrecruiters:${slug}`, source_job_id: x.id, title: x.name,
        company: x.company?.name || opts?.label || slug,
        location: [l.city, l.region, countryName].filter(Boolean).join(', '),
        arrangement: l.remote ? 'Remote' : (l.hybrid ? 'Hybrid' : null),
        description: '', url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(x.id)}`,
        published_at: x.releasedDate, salary: ''
      });
      if (opts?.known?.has(job.id)) { job.keep_description = true; out.push(job); continue; }
      // A first read of a large board is hundreds of pages. It is spread over passes: what is
      // not read this time is left out, the read is marked incomplete, and the next pass —
      // which already knows the ones read now — takes the rest.
      if (asked >= (opts?.maxDetails ?? 150)) { unread++; continue; }
      asked++;
      try {
        const detail = await getJson(`${api}/${encodeURIComponent(x.id)}`, opts);
        const sections = detail?.jobAd?.sections ?? {};
        job.description = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
          .map((k) => stripHtml(sections[k]?.text || '')).filter(Boolean).join('\n\n').slice(0, 20000);
      } catch { unread++; continue; }
      out.push(job);
      if (opts?.pauseMs) await new Promise((r) => setTimeout(r, Math.min(opts.pauseMs, 80)));
    }
    if (unread) incomplete(out, `${unread} of ${listed.length} postings not read yet`);
    return out;
  }
};

const fmt = (n) => (Number.isFinite(+n) ? String(Math.round(+n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '');

export const SYSTEMS = Object.keys(ADAPTERS);

/** Fetch one source. Never throws past the caller: a broken board must not stop the sweep. */
export async function fetchSource(source, opts = {}) {
  const adapter = ADAPTERS[source.system];
  if (!adapter) throw new Error(`Unknown hiring system: ${source.system}`);
  return adapter(source.slug, { ...opts, label: source.label, eu: source.eu, country: source.country });
}

/**
 * One posting, named by what it is rather than where it was found.
 *
 * The canonical URL already stops the same page being stored twice. It cannot see the other
 * shape of duplication: an employer re-posting the same role, which arrives with a brand new
 * id every time. Aldar's "Vice President - Development" was on the board three times — 2024,
 * 2025 and 2026 — and all three were offered to users as current.
 */
export function fingerprintOf(job) {
  const title = norm(job.title || '')
    .replace(/\b(senior|sr|junior|jr|lead|principal|staff)\b/g, ' ')   // the same role, graded
    .replace(/\b(m\s*f\s*d|m\s*w\s*d|all genders)\b/g, ' ')          // "(m/f/d)" and friends
    .replace(/\s+/g, ' ').trim();
  const company = norm(job.company || '').replace(/\b(inc|llc|ltd|gmbh|co|company|group)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return [title, company, job.city || ''].join('|');
}

/**
 * Hosts a job link may point at — the public posting pages of the boards we read.
 *
 * Separate from ALLOWED_HOSTS, which guards the feed APIs. Checking whether a posting is
 * still there means fetching the employer's own page, and that is a different set of hosts;
 * listing them keeps the checker from wandering anywhere a feed happens to link to.
 */
export const LINK_HOSTS = [
  'apply.workable.com', 'jobs.lever.co', 'jobs.ashbyhq.com',
  'boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io',
  'jobs.smartrecruiters.com', 'careers.smartrecruiters.com'
];

export function linkHostAllowed(url) {
  let host;
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return false; }
  if (LINK_HOSTS.includes(host)) return true;
  // Recruitee gives each customer a host, and lets them put it on their own domain.
  return ALLOWED_HOST_SUFFIXES.some(({ suffix, slug }) =>
    host.endsWith(suffix) && slug.test(host.slice(0, -suffix.length)));
}

/**
 * Where to ask whether one posting still exists.
 *
 * Not its public page: Greenhouse and Workable both answer 200 for a job id that was never
 * real, serving a "not found" page with a success status — so a page check reports every dead
 * Greenhouse job as alive. Each board's API answers 404 properly, and those are the hosts the
 * reader is already allowed to talk to.
 */
export function probeUrlFor(job) {
  const [system, slug] = String(job.source || '').split(':');
  const id = String(job.source_job_id || '').trim();
  if (!slug || !id) return null;
  switch (system) {
    case 'greenhouse': return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`;
    case 'workable':   return `https://apply.workable.com/api/v1/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`;
    case 'lever':      return `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`;
    // Recruitee hosts postings on the employer's own domain (jobs.unifonic.com), which is
    // nowhere we are allowed to go — but its API lives under the tenant we already read.
    case 'recruitee':  return `https://${encodeURIComponent(slug)}.recruitee.com/api/offers/${encodeURIComponent(id)}`;
    // Workday's job page answers 404 once a requisition closes.
    case 'workday':    return job.url || null;
    // Ashby and SmartRecruiters 404 honestly on their own posting pages.
    case 'ashby':
    case 'smartrecruiters': return job.url || null;
    default: return null;
  }
}

/**
 * Is this posting still there?
 *
 * A feed can keep listing a job after the page behind it is gone, so "we fetched the feed"
 * was never evidence that it exists. GET only. A timeout or a 500 decides nothing — closing a
 * live job because a server hiccuped is the worse mistake — so only 404 and 410 mean gone.
 */
export async function checkLink(job, { fetchImpl = fetch, timeoutMs = 12000 } = {}) {
  const target = typeof job === 'string' ? job : probeUrlFor(job);
  if (!target) return { ok: null, status: 0, reason: 'no way to ask' };
  if (!linkHostAllowed(target) && !hostAllowed(hostOf(target))) {
    return { ok: null, status: 0, reason: 'host not checked' };
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(target, {
      method: 'GET', redirect: 'follow', signal: ctrl?.signal,
      headers: { accept: 'application/json, text/html', 'user-agent': 'QaddimLinkCheck/1.0 (+https://qaddim.netlify.app)' }
    });
    return { ok: res.status !== 404 && res.status !== 410, status: res.status, reason: '' };
  } catch (e) {
    return { ok: null, status: 0, reason: String(e?.name || e).slice(0, 60) };
  } finally { if (timer) clearTimeout(timer); }
}

const hostOf = (url) => { try { return new URL(String(url)).hostname.toLowerCase(); } catch { return ''; } };

/** The countries this board serves. */
// ── where the extension can apply ────────────────────────────────────────────
// We *read* jobs from more systems than we can *apply* on. Workday, SuccessFactors and Oracle
// make every applicant open an account with each employer first; the extension has no script
// on them. A job there can be saved and applied to by hand, but it must never be put in the
// queue — queued, it was opened, found unanswerable, and reported as "the page did not respond".
// The list mirrors the extension's manifest; the engine's tests fail if the two drift.
export const APPLY_HOSTS = [
  /^apply\.workable\.com$/, /^jobs\.lever\.co$/, /^jobs\.ashbyhq\.com$/, /(^|\.)greenhouse\.io$/,
  /^(jobs|careers)\.smartrecruiters\.com$/, /\.recruitee\.com$/, /^jobs\.unifonic\.com$/
];
export function autoApplyable(url) {
  let host = '';
  try { const u = new URL(url); if (u.protocol !== 'https:') return false; host = u.hostname; } catch { return false; }
  return APPLY_HOSTS.some((re) => re.test(host));
}

export const REGION = ['sa', 'ae', 'qa', 'bh', 'kw', 'om', 'eg', 'jo'];

/**
 * Is this posting for someone here?
 *
 * A global employer's board is worth reading for its handful of Gulf roles, but storing the
 * other three hundred would bury them: the app loads the most recently seen jobs, so jobs
 * nobody here can take would push out the ones they can.
 *
 * Remote with no country named stays — that is open from anywhere, which includes here.
 */
export function servesRegion(job) {
  if (job.country && REGION.includes(job.country)) return true;
  if (job.country) return false;
  // "Remote" with a place attached is remote *from that place*. It used to pass whenever the
  // place was one this file did not know — which was nearly all of them.
  if (placeOf(job.location || '').elsewhere) return false;
  return job.arrangement === 'Remote' || /\bremote\b|عن بعد/i.test(job.location || '');
}

/** Fetch every source, collecting failures instead of aborting. */
/**
 * Marks what an adapter returns as not the whole board. The jobs in it are good; what must
 * not be read from it is that a job missing from the list has closed.
 */
function incomplete(list, why) {
  Object.defineProperty(list, 'partial', { value: why, enumerable: false });
  return list;
}

/**
 * Reads every source. Three things come back about how the reading went, and they mean
 * different things to whoever closes postings:
 *
 *   errors   the board did not answer — nothing is known about it this time
 *   partial  it answered, but not completely — its jobs are real, its silences are not
 *   (neither) it answered in full — a job it no longer lists is gone
 *
 * `opts.known` (a Set of job ids already stored with their description) is passed through to
 * the adapters that read one page per posting, so they do not read the same page every pass.
 */
export async function fetchAll(sources, opts = {}) {
  const jobs = [], errors = [], partial = [], runs = [];
  for (const s of sources) {
    const source = `${s.system}:${s.slug}`, began = Date.now();
    try {
      const found = await fetchSource(s, opts);
      if (found.partial) partial.push({ source, why: found.partial });
      jobs.push(...found);
      runs.push({ source, ok: true, partial: found.partial || null, listed: found.length, ms: Date.now() - began, error: null });
    } catch (e) {
      const error = String(e?.message || e);
      errors.push({ source, error });
      runs.push({ source, ok: false, partial: null, listed: 0, ms: Date.now() - began, error });
    }
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  // one row per posting, even if two boards carry it
  const seen = new Set(), unique = [];
  let elsewhere = 0;
  for (const j of jobs) {
    if (seen.has(j.canonical_url)) continue;
    seen.add(j.canonical_url);
    if (opts.allRegions !== true && !servesRegion(j)) { elsewhere++; continue; }
    unique.push(j);
  }
  // `runs` is the account of the reading itself, one line per source: did it answer, how
  // many postings it listed (before the region filter), how long it took.
  return { jobs: unique, errors, partial, elsewhere, runs };
}
