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

export class BlockedHost extends Error {}

/** The only way this package reaches the network. */
export async function getJson(url, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const host = (String(url).match(/^https:\/\/([^/?#]+)/i) || [])[1]?.toLowerCase();
  if (!host || !ALLOWED_HOSTS.includes(host)) throw new BlockedHost(`Blocked by allowlist: ${host}`);
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
  for (const j of jobs) {
    if (seen.has(j.canonical_url)) continue;
    seen.add(j.canonical_url);
    unique.push(j);
  }
  return { jobs: unique, errors };
}
