// The engine's contract, checked against three very different users.
// Run: node packages/engine/tests/score.test.js
import { scoreJob, filterReason, normaliseProfile, classifyLocation, roleFamilyOf, seniorityLevel, yearsRequired } from '../src/score.js';
import { canonicalUrl, stripHtml, norm } from '../src/text.js';

const results = [];
const check = (group, name, cond, detail) => results.push({ group, name, pass: !!cond, detail: cond ? '' : String(detail ?? '') });
const TODAY = '2026-11-05';

// Three users the platform must serve equally well.
const sultan = normaliseProfile({
  roles: ['product', 'business_analysis', 'data', 'digital_transformation'],
  skill_areas: ['product', 'ba', 'data', 'ai', 'dt', 'ops', 'design'],
  extra_skills: [], years_experience: 1, cities: ['riyadh'], countries: ['sa'],
  avoid_software_roles: true, min_score: 70
});
const engineer = normaliseProfile({
  roles: ['software', 'data_science'],
  skill_areas: ['data', 'ai'], extra_skills: ['python', 'sql'], years_experience: 5,
  cities: ['dubai', 'riyadh'], countries: ['ae', 'sa'], avoid_software_roles: false, min_score: 70
});
const accountant = normaliseProfile({
  roles: ['finance', 'compliance'], skill_areas: ['finance'], extra_skills: ['socpa'],
  years_experience: 3, cities: ['jeddah'], countries: ['sa'], avoid_software_roles: true, min_score: 65
});

const job = (o) => ({
  title: '', company: 'Acme', location: 'Riyadh, Saudi Arabia', arrangement: null,
  description: '', official: true, source_type: 'ats', salary: '', publication_date: TODAY, ...o
});

// ── the profile decides everything ───────────────────────────────────────────
const pmJob = job({
  title: 'Product Analyst',
  description: 'You will work with stakeholders on business requirements and user stories, build dashboards in Power BI, and support product adoption. Low coding.'.repeat(4)
});
const sultanPM = scoreJob(pmJob, sultan, TODAY);
const engineerPM = scoreJob(pmJob, engineer, TODAY);
check('Per-user', 'The same job scores differently for different people', sultanPM.total !== engineerPM.total,
  `${sultanPM.total} vs ${engineerPM.total}`);
check('Per-user', 'It scores high for the person whose first choice it is', sultanPM.total >= 80, sultanPM.total);
check('Per-user', 'It scores low for someone who never chose that field', engineerPM.total < 70, engineerPM.total);

const devJob = job({ title: 'Senior Backend Engineer', description: 'Python, Django, microservices, Kubernetes, code reviews, production code. 5+ years of experience.'.repeat(4) });
check('Per-user', 'A software role is filtered out for someone avoiding them',
  filterReason(devJob, sultan)?.code === 'software_role');
check('Per-user', 'The same role is welcome for the engineer', filterReason(devJob, engineer) === null);

// The board's own word about where the job is worked. For a long time this was read from a
// field name nothing produced, so "Remote" postings were judged from their location text only.
check('Places', 'A board that says Remote is believed',
  classifyLocation({ location: 'Dubai, United Arab Emirates', arrangement: 'Remote', description: '' }, sultan).remote === true);
check('Places', 'A board that says onsite is not read as remote',
  classifyLocation({ location: 'Riyadh', arrangement: 'onsite', description: '' }, sultan).arrangement === 'On-site');
check('Places', 'Spelling variants of on-site agree',
  classifyLocation({ location: 'Riyadh', arrangement: 'OnSite', description: '' }, sultan).arrangement === 'On-site');
check('Places', 'No declaration falls back to the location text',
  classifyLocation({ location: 'Remote - EMEA', arrangement: null, description: '' }, sultan).remote === true);

// ── reasons always accompany the number ──────────────────────────────────────
check('Explainability', 'Every score comes with reasons', sultanPM.reasons.length > 0 && sultanPM.reasons.length <= 3, JSON.stringify(sultanPM.reasons));
check('Explainability', 'The breakdown adds up to the total',
  Math.max(0, sultanPM.breakdown.skills + sultanPM.breakdown.path + sultanPM.breakdown.seniority +
    sultanPM.breakdown.location + sultanPM.breakdown.coding + sultanPM.breakdown.evidence - sultanPM.breakdown.penalties) === sultanPM.total,
  JSON.stringify(sultanPM.breakdown));
check('Explainability', 'No weight can exceed its cap',
  sultanPM.breakdown.skills <= 30 && sultanPM.breakdown.path <= 25 && sultanPM.breakdown.seniority <= 15 &&
  sultanPM.breakdown.location <= 10 && sultanPM.breakdown.coding <= 10 && sultanPM.breakdown.evidence <= 10);

// ── a skill the user never confirmed is a gap, never a credit ────────────────
const sqlJob = job({ title: 'Data Analyst', description: 'Strong SQL and Python required. Build Tableau dashboards. Analytics and reporting.'.repeat(4) });
const sultanSql = scoreJob(sqlJob, sultan, TODAY);
check('Honesty', 'Skills the user never confirmed are listed as gaps',
  sultanSql.gaps.includes('SQL') && sultanSql.gaps.includes('Python'), JSON.stringify(sultanSql.gaps));
check('Honesty', 'The same skills are not gaps for someone who listed them',
  !scoreJob(sqlJob, engineer, TODAY).gaps.includes('SQL'));
check('Honesty', 'A missing description is flagged, and caps the skill points',
  scoreJob(job({ title: 'Product Analyst' }), sultan, TODAY).flags.some((f) => /No description/.test(f.text)));
check('Honesty', 'A required certificate the user lacks costs points and is named',
  scoreJob(job({ title: 'Business Analyst', description: 'PMP certification is required. Business requirements, user stories.'.repeat(4) }), sultan, TODAY)
    .gaps.some((g) => /PMP/.test(g)));
check('Honesty', 'A job asking far more years than you have is penalised',
  scoreJob(job({ title: 'Product Analyst', description: 'We need 8+ years of experience in product analytics and stakeholder management.'.repeat(4) }), sultan, TODAY)
    .breakdown.penalties >= 15);
check('Honesty', 'An unpublished salary is flagged, never estimated',
  sultanPM.flags.some((f) => f.text === 'Salary not published') && !JSON.stringify(sultanPM).match(/estimated salary/i));

// ── location is the user's own list ──────────────────────────────────────────
const jeddahJob = job({ title: 'Business Analyst', location: 'Jeddah, Saudi Arabia', description: 'business requirements and user stories, process mapping'.repeat(4) });
check('Location', 'A city the user did not pick is filtered out', filterReason(jeddahJob, sultan)?.code === 'other_city');
check('Location', 'The same city is fine for a user who picked it', filterReason(jeddahJob, accountant) === null || filterReason(jeddahJob, accountant)?.code === 'unrelated');
check('Location', 'Dubai works for the engineer', classifyLocation(job({ location: 'Dubai, UAE' }), engineer).cls === 'target_city');
check('Location', 'Remote is recognised and kept', classifyLocation(job({ location: 'Remote - Saudi Arabia' }), sultan).cls === 'remote_ok');
check('Location', 'Remote can be switched off',
  filterReason(job({ title: 'Product Analyst', location: 'Remote' }), normaliseProfile({ ...sultan, accept_remote: false }))?.code === 'remote_off');
check('Location', 'Hybrid in your own city is the best case',
  scoreJob(job({ title: 'Product Analyst', location: 'Riyadh', arrangement: 'Hybrid', description: 'product adoption and user stories'.repeat(8) }), sultan, TODAY)
    .breakdown.location === 10);

// ── the user's exclusion lists ───────────────────────────────────────────────
const picky = normaliseProfile({ ...sultan, exclude_title_words: ['sales'], exclude_companies: ['acme'] });
check('Exclusions', 'An excluded title word removes the job',
  filterReason(job({ title: 'Sales Analyst', company: 'Other' }), picky)?.code === 'excluded_word');
check('Exclusions', 'An excluded company removes the job',
  filterReason(job({ title: 'Product Analyst', company: 'Acme Corp' }), picky)?.code === 'excluded_company');

// ── helpers ──────────────────────────────────────────────────────────────────
check('Helpers', 'Role families recognise Arabic titles', roleFamilyOf('محلل أعمال أول')?.id === 'business_analysis');
check('Helpers', 'Seniority is read from the title', seniorityLevel('Senior Product Manager') === 'senior' && seniorityLevel('Associate Analyst') === 'junior');
check('Helpers', 'Years are read only near the word experience',
  yearsRequired('5+ years of experience required') === 5 && yearsRequired('5 years of company history') === null);
check('Helpers', 'URLs canonicalise to one form per job',
  canonicalUrl('HTTP://Jobs.Lever.co/acme/abc/?utm_source=x#apply') === 'https://jobs.lever.co/acme/abc');
check('Helpers', 'Entity-escaped HTML becomes plain text',
  stripHtml('&lt;p&gt;Hello &amp; welcome&lt;/p&gt;') === 'Hello & welcome');
check('Helpers', 'Normalisation survives accents and tashkeel', norm('Résumé').trim() === 'resume');

// ── report ───────────────────────────────────────────────────────────────────
let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + (r.group + '            ').slice(0, 15) + r.name + (r.pass ? '' : '  <-- ' + r.detail));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
