// Every job has a field, and these are the titles that decided how. Each case below was a real
// title from the open jobs on 14 Nov 2026 that a simpler rule put in the wrong field.
// Run: node packages/engine/tests/fields.test.js
import { fieldOf, FIELDS, FIELD_AR } from '../src/fields.js';

const results = [];
const is = (title, want, company = '') => {
  const got = fieldOf(title, company);
  results.push({ name: `${title}${company ? ' · ' + company : ''} → ${want}`, pass: got === want, got });
};

// The order that matters: an explicit job title beats every broad word.
is('Software Engineer - Market Data', 'tech');
is('Software Engineer - AI Tooling', 'tech');
is('Data Scientist - Fraud Analytics', 'data');
is('Product Manager, AI Applications', 'product');
is('Accountant-ERP', 'finance');
is('AR ACCOUNTANT + INCOME AUDITOR', 'finance');
is('Senior React Engineer (TypeScript) - 6 to 12 months - Immediate Hire', 'tech');
is('Forward Deployed Engineer - UAE', 'tech');
is('Prompt Engineer (LLM Systems, Evals & Safety)', 'data');
is('Senior Manager, Application Security', 'tech');
is('Design Engineer', 'engineering');
is('Vice President - Civil Design', 'engineering');
is('AML Framework Design (Family Office)', 'legal');
is('Creative Copywriter', 'marketing');
is('Admin Employee', 'admin');
is('Accounts Clerk - Emirati Talent', 'finance');
is('Car Electrician (Auto Electrical Technician)', 'trades');
is('GHI X-Ray Technician', 'health');

// A broad word that would misread the title.
is('Windows Server Engineer', 'tech');
is('Server', 'hospitality');
is('Captain', 'hospitality');
is('Direct Entry Captain A321', 'aviation');
is('Digital Marketing Manager at Conrad Dubai', 'marketing');
is('Data Entry Clerk', 'admin');
is('Assistant Manager, GCSO Office', 'leadership');
is('Financial Crime Compliance Manager (1st & 2nd Line) - Payments', 'legal');
is('Executive Talent Network - Always Open', 'other');
is('Ken Fix It', 'trades');
is('Case Analyst (Arabic speaker)', 'other');
is('Anti-Bribery & Corruption (ABC) Consultant (immediate start contract)', 'legal');
is('Midlevel QA Security Analyst (8 Months Contract) - Octopus by RTG', 'tech');
is('Merchandise Planner', 'retail');
is('PRODUCTION PLANNER', 'manufacturing');
is('Maintenance Planner', 'trades');
is('Buyer - Sports', 'retail');
is('Personal Trainer_Fitness_Abu Dhabi Mall Fitness First UAE_HOSP', 'fitness');
is('Document Controller', 'admin');
is('Stock Controller', 'operations');
is('Receptionist | The WB™ Abu Dhabi, Curio Collection by Hilton™', 'admin');

// The property is where the job is, not what it is.
is('Finance Analyst - DoubleTree by Hilton Resort & Spa Marjan Island', 'finance');
is('Safety Agent - DoubleTree by Hilton Resort & Spa Marjan Island', 'security');
is('Assistant Manager – Stewarding & Hygiene - Doubletree by Hilton Fujairah City', 'hospitality');
is('Room Attendant - Waldorf Astoria Ras Al Khaimah', 'hospitality');
is('Hotel Sales - Sales Executive', 'sales');

// Fields the office-and-technology families never had.
is('برنامج نواة للضيافة الجوية', 'aviation');
is('Cabin Crew - Recruitment Event | Riyadh, Saudi Arabia', 'aviation');
is('Pharmacist (الرياض و جدة)', 'health');
is('Paramedic (207995)', 'health');
is('Kindergarten Teacher', 'education');
is('Chef de Partie - Arabic Sweets', 'hospitality');
is('Visual Merchandiser', 'retail');
is('Quantity Surveyor - Roads & Bridges', 'construction');
is('Forklift Driver', 'trades');
is('HSE Engineer', 'security');
is('QC Inspector', 'manufacturing');
is('Accounting Co-op', 'programs');
is('Database Administrator - Tamheer Program', 'programs');

// A title that names no field takes its employer's; one that does keeps its own.
is('Duty Manager - KSA', 'aviation', 'Riyadh Air');
is('Duty Manager', 'hospitality', 'Hilton');
is('OPD Manager', 'health', 'Hayat National Hospital');
is('Supervisor', 'retail', 'Apparel Group');
is('Manager - Strategic Projects', 'leadership', 'Landmark Group');
is('Software Engineer', 'tech', 'Hilton');
is('Supervisor', 'other');

// The list itself.
results.push({ name: 'Every field has an Arabic name', pass: FIELDS.every((f) => f.ar && FIELD_AR[f.id] === f.ar) });
results.push({ name: 'Nothing comes back empty', pass: ['', null, undefined, '—'].every((t) => fieldOf(t) === 'other') });

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.pass ? '' : `  <-- got ${r.got}`));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
