// Reads job feeds straight from the hiring systems companies already use.
//
// Two rules:
//   1. GET only, and only to the hosts listed here. There is no code path that posts anywhere.
//   2. Every job keeps the employer's own link. Nothing is reposted under our name.

import { stripHtml, clean, dateOnly, canonicalUrl, fnv1a, decodeEntities } from './text.js';
import { CITY_ALIASES, CITY_COUNTRY, COUNTRY_ALIASES } from './taxonomy.js';
import { norm, hasAny } from './text.js';

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
  { suffix: '.recruitee.com', slug: /^[a-z0-9][a-z0-9-]{0,62}$/ }
];

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
    arrangement: o.arrangement || null,
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
  if (!country) {
    for (const [code, terms] of Object.entries(COUNTRY_ALIASES)) {
      if (hasAny(t, terms)) { country = code; break; }
    }
  }
  return { city, country };
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

  async smartrecruiters(slug, opts) {
    const country = opts?.country || 'sa';
    const j = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?country=${country}&limit=100`, opts);
    return (j.content || []).map((x) => {
      const l = x.location || {};
      return raw({
        source: `smartrecruiters:${slug}`, source_job_id: x.id, title: x.name,
        company: x.company?.name || opts?.label || slug,
        location: [l.city, l.region, l.country].filter(Boolean).join(', '),
        arrangement: l.remote ? 'Remote' : (l.hybrid ? 'Hybrid' : null),
        description: '', url: `https://jobs.smartrecruiters.com/${encodeURIComponent(slug)}/${encodeURIComponent(x.id)}`,
        published_at: x.releasedDate, salary: ''
      });
    });
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
  return job.arrangement === 'Remote' || /\bremote\b|عن بعد/i.test(job.location || '');
}

/** Fetch every source, collecting failures instead of aborting. */
export async function fetchAll(sources, opts = {}) {
  const jobs = [], errors = [];
  for (const s of sources) {
    try {
      const found = await fetchSource(s, opts);
      jobs.push(...found);
    } catch (e) {
      errors.push({ source: `${s.system}:${s.slug}`, error: String(e?.message || e) });
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
  return { jobs: unique, errors, elsewhere };
}
