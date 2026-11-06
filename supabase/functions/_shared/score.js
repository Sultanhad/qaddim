// Scores one job against one user's profile. Deterministic, explainable, no model involved.
//
// Two rules this file exists to keep:
//   1. A score is always accompanied by the reasons that produced it. No unexplained numbers.
//   2. Nothing about the user is assumed. A skill the user did not confirm is a gap, never a credit.

import { norm, has, hasAny, daysBetween } from './text.js';
import {
  ROLE_FAMILIES, SKILL_AREAS, GAP_TERMS, CERT_TERMS,
  HEAVY_CODE, MEDIUM_CODE, DEV_TITLE, PROGRAM_TERMS,
  CITY_ALIASES, COUNTRY_ALIASES, CITY_COUNTRY
} from './taxonomy.js';

export const WEIGHTS = { skills: 30, path: 25, seniority: 15, location: 10, coding: 10, evidence: 10 };

const familyById = Object.fromEntries(ROLE_FAMILIES.map((f) => [f.id, f]));
const areaById = Object.fromEntries(SKILL_AREAS.map((a) => [a.id, a]));

/** Fills in what a half-written profile leaves out, without inventing anything about the person. */
export function normaliseProfile(p = {}) {
  return {
    roles: (p.roles || []).filter((id) => familyById[id]),
    skill_areas: (p.skill_areas || []).filter((id) => areaById[id]),
    extra_skills: (p.extra_skills || []).map((s) => norm(s).trim()).filter(Boolean),
    years_experience: Number.isFinite(+p.years_experience) ? +p.years_experience : 0,
    cities: (p.cities || []).map((c) => norm(c).trim()).filter(Boolean),
    countries: (p.countries || []).map((c) => String(c).toLowerCase().trim()).filter(Boolean),
    accept_remote: p.accept_remote !== false,
    exclude_companies: (p.exclude_companies || []).map((c) => norm(c).trim()).filter(Boolean),
    exclude_title_words: (p.exclude_title_words || []).map((w) => String(w).toLowerCase().trim()).filter(Boolean),
    avoid_software_roles: !!p.avoid_software_roles,
    min_score: Number.isFinite(+p.min_score) ? +p.min_score : 70
  };
}

/** Which role family a title belongs to, if any. */
export function roleFamilyOf(title) {
  const t = norm(title);
  for (const f of ROLE_FAMILIES) if (hasAny(t, f.terms)) return f;
  return null;
}

export function isDevTitle(title) {
  const t = norm(title);
  if (has(t, 'analyst') || has(t, 'product manager') || has(t, 'product owner') || has(t, 'محلل')) return false;
  return !!hasAny(t, DEV_TITLE);
}

export function seniorityLevel(title) {
  const t = norm(title);
  if (hasAny(t, ['head', 'director', 'vp', 'vice president', 'chief', 'principal'])) return 'exec';
  if (hasAny(t, ['senior', 'sr', 'lead', 'staff', 'expert'])) return 'senior';
  if (hasAny(t, ['intern', 'internship', 'trainee']) || hasAny(t, PROGRAM_TERMS)) return 'program';
  if (hasAny(t, ['junior', 'jr', 'associate', 'entry', 'entry level', 'assistant', 'graduate'])) return 'junior';
  return 'mid';
}

export function yearsRequired(desc) {
  const s = String(desc || '');
  const re = /(\d{1,2})\s*(?:\+|plus)?\s*(?:-|–|to)?\s*(?:\d{1,2})?\s*\+?\s*(?:years?|yrs)/gi;
  let m, max = null;
  while ((m = re.exec(s)) !== null) {
    const around = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).toLowerCase();
    if (!around.includes('experience') && !around.includes('exp')) continue;
    const n = Number(m[1]);
    if (n > 0 && n < 30 && (max === null || n > max)) max = n;
  }
  return max;
}

/** Where a posting is, judged against the cities and countries this user accepts. */
export function classifyLocation(job, profile) {
  const t = norm([job.location, job.arrangement_raw].join(' '));
  const d = norm(String(job.description || '').slice(0, 5000));
  const remote = has(t, 'remote') || has(t, 'عن بعد') || has(t, 'work from home');
  const hybrid = has(t, 'hybrid') || has(t, 'هجين');

  let matchedCity = null;
  for (const want of profile.cities) {
    const terms = CITY_ALIASES[want] || [want];
    if (hasAny(t, terms)) { matchedCity = want; break; }
  }
  let otherCity = null;
  for (const [city, terms] of Object.entries(CITY_ALIASES)) {
    if (matchedCity || profile.cities.includes(city)) continue;
    if (hasAny(t, terms)) { otherCity = city; break; }
  }
  let country = null;
  for (const [code, terms] of Object.entries(COUNTRY_ALIASES)) {
    if (hasAny(t, terms)) { country = code; break; }
  }
  if (!country && (matchedCity || otherCity)) country = CITY_COUNTRY[matchedCity || otherCity] || null;
  const countryWanted = country
    ? (profile.countries.includes(country) || profile.cities.some((c) => CITY_COUNTRY[c] === country))
    : false;

  let cls;
  if (matchedCity) cls = 'target_city';
  else if (remote) cls = (countryWanted || hasAny(d, COUNTRY_ALIASES.sa) || has(t, 'mena') || has(t, 'gcc')) ? 'remote_ok' : 'remote_unknown';
  else if (otherCity) cls = 'other_city';
  else if (countryWanted) cls = 'country_only';
  else if (!String(job.location || '').trim()) cls = 'unknown';
  else cls = 'elsewhere';

  const arrangement = remote ? 'Remote'
    : hybrid ? 'Hybrid'
      : (has(t, 'onsite') || has(t, 'on site') || has(t, 'in office')) ? 'On-site' : 'Not stated';
  return { cls, city: matchedCity, otherCity, country, arrangement, remote, hybrid };
}

/** A cheap gate before scoring. Returns null when the job is worth scoring, else the reason it is not. */
export function filterReason(job, profile) {
  const p = profile.roles ? profile : normaliseProfile(profile);
  if (!job.title) return { code: 'no_title', text: 'No title' };

  const titleN = norm(job.title), companyN = norm(job.company);
  const word = hasAny(titleN, p.exclude_title_words);
  if (word) return { code: 'excluded_word', text: `Title contains a word you excluded (${word})` };
  const co = p.exclude_companies.find((c) => c && companyN.includes(c));
  if (co) return { code: 'excluded_company', text: `Company you excluded (${co})` };

  if (p.avoid_software_roles && isDevTitle(job.title)) {
    return { code: 'software_role', text: 'Software-development role (you asked to skip these)' };
  }

  const L = classifyLocation(job, p);
  if (!p.accept_remote && (L.cls === 'remote_ok' || L.cls === 'remote_unknown')) {
    return { code: 'remote_off', text: 'Remote role (you turned remote off)' };
  }
  if (L.cls === 'elsewhere') return { code: 'elsewhere', text: 'Not in your cities and not remote' };
  if (L.cls === 'other_city') return { code: 'other_city', text: `In ${L.otherCity}, which is not one of your cities` };

  const family = roleFamilyOf(job.title);
  if (family && p.roles.includes(family.id)) return null;

  // No exact family match: let it through only if the description really overlaps your skills.
  const allN = norm(job.title + ' ' + job.description);
  const overlap = p.skill_areas.filter((id) => hasAny(allN, areaById[id].terms)).length;
  if (hasAny(titleN, PROGRAM_TERMS) && overlap >= 1) return null;
  if (overlap >= 2) return null;
  return { code: 'unrelated', text: 'Not related to the roles you chose' };
}

/**
 * The score. Returns { total, breakdown, reasons, gaps, flags, coding, arrangement }.
 * `reasons` is what the user is shown — a number without them is never displayed.
 */
export function scoreJob(job, profile, today = new Date().toISOString().slice(0, 10)) {
  const p = profile.roles ? profile : normaliseProfile(profile);
  const titleN = norm(job.title);
  const descN = norm(job.description);
  const allN = norm(job.title + ' ' + job.description);
  const hasDesc = String(job.description || '').length >= 200;
  const flags = [], gaps = [], penaltyNotes = [];
  let penalties = 0;

  // Skills — only areas the user confirmed can earn points.
  const matched = p.skill_areas.filter((id) => hasAny(allN, areaById[id].terms));
  const extraHit = p.extra_skills.some((x) => x && has(allN, x));
  let skills = Math.min(WEIGHTS.skills, Math.round(WEIGHTS.skills * (matched.length + (extraHit ? 1 : 0)) / 4));
  if (!hasDesc) {
    flags.push({ code: 'no_description', text: 'No description published — scored from the title and location only' });
    skills = Math.min(skills + 6, 18);
  }

  // Career path — how high the job's family sits in the user's own ranking.
  const family = roleFamilyOf(job.title);
  let path = 0, pathLabel = '';
  const rank = family ? p.roles.indexOf(family.id) : -1;
  if (rank === 0) { path = WEIGHTS.path; pathLabel = `Your first-choice field: ${family.label}`; }
  else if (rank > 0) { path = Math.max(12, Math.round(WEIGHTS.path * (1 - rank * 0.09))); pathLabel = `Your choice #${rank + 1}: ${family.label}`; }
  else if (hasAny(titleN, PROGRAM_TERMS)) { path = 14; pathLabel = 'Graduate / early-career programme'; }
  else {
    const overlap = matched.length;
    path = Math.min(12, (has(titleN, 'analyst') || has(titleN, 'محلل') ? 6 : 2) + overlap * 2);
    pathLabel = 'Adjacent role — the description overlaps your skills';
  }

  // Seniority against the years the user actually has.
  const level = seniorityLevel(job.title);
  const yrs = yearsRequired(job.description);
  let seniority = { junior: 15, program: 12, mid: 12, senior: 5, exec: 1 }[level];
  if (yrs !== null) {
    if (yrs <= p.years_experience + 1 && (level === 'mid' || level === 'junior')) {
      seniority = Math.max(seniority, 14);
    } else if (yrs >= p.years_experience + 4) {
      seniority = Math.min(seniority, 3); penalties += 15;
      penaltyNotes.push(`Asks for ${yrs}+ years; you have ${p.years_experience}`);
      gaps.push(`${yrs}+ years of experience`);
    } else if (yrs >= p.years_experience + 2) {
      seniority = Math.min(seniority, 9); penalties += 6;
      penaltyNotes.push(`Asks for ${yrs}+ years; you have ${p.years_experience}`);
      gaps.push(`${yrs}+ years of experience`);
    }
  }

  // Location.
  const L = classifyLocation(job, p);
  let location = { target_city: 9, remote_ok: 8, country_only: 6, remote_unknown: 5, unknown: 4, other_city: 0, elsewhere: 0 }[L.cls];
  if (L.cls === 'target_city' && L.arrangement === 'Hybrid') location = 10;
  if (L.cls === 'target_city' && L.arrangement === 'Remote') location = 10;
  if (L.cls === 'remote_unknown') flags.push({ code: 'remote_confirm', text: 'Remote — confirm you are eligible from where you live' });
  if (L.cls === 'unknown') flags.push({ code: 'location_unknown', text: 'Location not stated' });

  // Coding load.
  const heavy = HEAVY_CODE.filter((x) => has(descN, x)).length;
  const medium = MEDIUM_CODE.filter((x) => has(descN, x)).length;
  const coding = (isDevTitle(job.title) || heavy >= 4) ? 'High' : (heavy >= 2 || medium >= 2) ? 'Medium' : (hasDesc ? 'Low' : 'Unknown');
  const codingPts = p.avoid_software_roles
    ? { Low: 10, Medium: 5, High: 0, Unknown: 7 }[coding]
    : { Low: 7, Medium: 9, High: 9, Unknown: 7 }[coding];

  // Evidence — how much this posting actually tells us. Never a judgement about the employer.
  let evidence = 0; const evidenceNotes = [];
  if (job.official) { evidence += 4; evidenceNotes.push('official employer board'); }
  else { evidence += 2; evidenceNotes.push(job.source_type === 'email' ? 'job-alert email' : 'feed'); }
  if (String(job.description || '').length >= 600) { evidence += 2; evidenceNotes.push('full description'); }
  if (job.salary) { evidence += 2; evidenceNotes.push('salary published'); }
  const age = job.publication_date ? daysBetween(job.publication_date, today) : null;
  if (age !== null && age <= 21) { evidence += 2; evidenceNotes.push(`posted ${age}d ago`); }

  // Gaps and required certificates.
  const seen = {};
  for (const [term, label] of GAP_TERMS) {
    if (has(descN, term) && !p.extra_skills.includes(norm(term).trim()) && !seen[label]) {
      seen[label] = 1; gaps.push(label);
    }
  }
  let certPenalty = 0;
  const raw = String(job.description || '').toLowerCase();
  for (const [term, label] of CERT_TERMS) {
    if (!has(descN, term) || p.extra_skills.includes(norm(term).trim())) continue;
    gaps.push(`${label} certification`);
    const i = raw.indexOf(term.split(' ')[0]);
    const window = i >= 0 ? raw.slice(Math.max(0, i - 80), i + 80) : '';
    if (/requir|must|mandatory/.test(window) && certPenalty < 10) certPenalty += 5;
  }
  if (certPenalty) { penalties += certPenalty; penaltyNotes.push('Required certificate you have not listed'); }

  if (/saudi nationals? only|saudi national|for saudi nationals|سعودي(ين)? فقط/i.test(job.title + ' ' + job.description)) {
    flags.push({ code: 'saudi_only', text: 'Mentions a Saudi-national requirement — check you are eligible' });
  }
  if (!job.salary) flags.push({ code: 'no_salary', text: 'Salary not published' });

  const total = Math.max(0, Math.min(100, skills + path + seniority + location + codingPts + evidence - penalties));

  // The three strongest true statements about this match.
  // Each reason carries a code and the ids behind it, so a screen can say it in its own
  // language. `text` is the English rendering, kept so anything reading the raw score still
  // has a sentence to print.
  const candidates = [];
  if (rank >= 0) candidates.push([path / WEIGHTS.path, { code: 'path', rank, familyId: family.id, text: pathLabel }]);
  if (matched.length) {
    candidates.push([skills / WEIGHTS.skills, {
      code: 'skills', areaIds: matched,
      text: `Uses ${matched.length} of your confirmed skill areas: ${matched.map((id) => areaById[id].label.split(' (')[0]).join(', ')}`
    }]);
  }
  if (location >= 8) {
    const inCity = L.cls === 'target_city';
    candidates.push([location / 10, {
      code: inCity ? 'in_city' : 'remote_ok', city: L.city, arrangement: L.arrangement,
      text: inCity
        ? `${String(L.city).replace(/\b\w/g, (c) => c.toUpperCase())}${L.arrangement !== 'Not stated' ? ', ' + L.arrangement : ''}`
        : 'Remote and open to where you are'
    }]);
  }
  if (p.avoid_software_roles && coding === 'Low') candidates.push([0.95, { code: 'coding_low', text: 'Low coding requirement' }]);
  if (seniority >= 14) candidates.push([seniority / 15, { code: 'seniority_fit', text: 'Seniority fits your experience' }]);
  if (evidence >= 6) candidates.push([evidence / 10, { code: 'evidence', notes: evidenceNotes, text: `Strong evidence: ${evidenceNotes.join(', ')}` }]);
  candidates.sort((a, b) => b[0] - a[0]);

  return {
    total,
    coding,
    arrangement: L.arrangement,
    locationClass: L.cls,
    breakdown: { skills, path, seniority, location, coding: codingPts, evidence, penalties, level, years_required: yrs },
    reasons: candidates.slice(0, 3).map((c) => c[1]),
    penaltyNotes,
    evidenceNotes,
    gaps: gaps.slice(0, 8),
    flags
  };
}
