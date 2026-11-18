// Search over job titles. Pure: no network, no browser. Each case was a real query that a
// simpler matcher answered wrongly. Run: node apps/web/tests/search.test.mjs
import { parseQuery, matches, usable, fold } from '../src/search.js';
import { fieldOf } from '../../../packages/engine/src/fields.js';

const J = (title, city = 'riyadh', company = 'Acme', location = '') => ({ title, city, company, location, field: fieldOf(title, company) });
const jobs = [
  J('Senior Accountant'), J('Accountant', 'jeddah'), J('Executive - Key Accounts'), J('Senior Social Media Analyst'),
  J('Cybersecurity Consultant'), J('SOC Analyst - Tier 1'), J('Project Manager'), J('Contract Manager, PDS Projects'),
  J('Pharmacist (Riyadh)'), J('Human Resources Manager'), J('Civil Engineer - Bridges'), J('HVAC Technician'),
  J('Database Administrator - Tamheer Program'), J('Cabin Crew - Recruitment Event', 'riyadh', 'Riyadh Air'), J('Chef de Partie', 'dubai')
];
const find = (q) => {
  const { kept, dropped, nothing } = usable(parseQuery(q), jobs);
  return { titles: nothing ? [] : jobs.filter((j) => matches(j, kept)).map((j) => j.title), dropped };
};
let fail = 0;
const check = (name, ok, detail = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : '  <-- ' + detail}`); };
const same = (q, want) => { const { titles } = find(q); check(`«${q}» → ${want.join(' · ') || 'لا شيء'}`, JSON.stringify(titles.sort()) === JSON.stringify([...want].sort()), titles.join(' · ')); };

same('محاسب', ['Senior Accountant', 'Accountant']);                       // not "Key Accounts"
same('امن سيبراني', ['Cybersecurity Consultant', 'SOC Analyst - Tier 1']); // not "Social Media"
same('project manager', ['Project Manager']);                             // a phrase, not two words anywhere
same('الصيدلي', ['Pharmacist (Riyadh)']);
same('صيدلي', ['Pharmacist (Riyadh)']);
same('محاسب الرياض', ['Senior Accountant']);                               // the city narrows
same('وظيفة محاسب في جدة', ['Accountant']);
same('accountant riyadh', ['Senior Accountant']);                         // a phrase nowhere, read word by word
same('hr', ['Human Resources Manager']);
same('مهندس مدني', ['Civil Engineer - Bridges']);                          // the other word order
same('فني تكييف', ['HVAC Technician']);
same('تمهير', ['Database Administrator - Tamheer Program']);
same('مضيف جوي', ['Cabin Crew - Recruitment Event']);
same('طاهي دبي', ['Chef de Partie']);
same('الصحة', ['Pharmacist (Riyadh)']);                                    // a field's own name
check('A word found nowhere is set aside and named', JSON.stringify(find('محاسب zzqq').dropped) === '["zzqq"]' && find('محاسب zzqq').titles.length === 2);
check('A query that finds nothing answers nothing, never everything', find('zzqq qqzz').titles.length === 0);
check('Alef, ta marbuta and marks fold to one spelling', fold('إدارة') === fold('ادارة') && fold('مُحاسِب') === 'محاسب');

console.log(fail ? `\n✗ ${fail} failed` : '\n✓ all passed');
process.exit(fail ? 1 : 0);
