// Questions the profile answers by itself — no browser, no form. Run: npm run test:fields
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { forExtension } from '../../apps/web/src/extension-profile.js';

const ctx = {};
vm.runInNewContext((await readFile(new URL('../src/fields.js', import.meta.url), 'utf8')) + '\nthis.F = QaddimFields;', ctx);
const F = ctx.F;
let fails = 0;
const check = (w, ok, x = '') => { console.log(`  ${ok ? '✓' : '✗'} ${w}${x ? ' · ' + x : ''}`); if (!ok) fails++; };
const saudi = forExtension({ full_name: 'Sara Ahmed', nationality: 'سعودي', cities: ['riyadh'], current_title: 'Product Analyst', answers: {} });
const other = forExtension({ full_name: 'Omar Ali', nationality: 'مصري', cities: ['dubai'], answers: {} });
const ans = (q, p) => F.answerFor(q, p, { country: 'sa' });

check('«Are you fluent or proficient in Arabic?» → Yes, for a Saudi national', ans('Are you fluent or proficient in Arabic?*', saudi)?.value === 'Yes');
check('«Are you fluent in Arabic?» too', ans('Are you fluent in Arabic?', saudi)?.value === 'Yes');
check('and an Arabic level list accepts Native', ans('Arabic proficiency', saudi)?.accept.includes('native'));
check('not a Saudi national: not answered «no» — left for the person', ans('Are you fluent in Arabic?', other)?.value == null);
check('«Are you currently in KSA?» → Yes, for someone whose city is Riyadh', ans('Are you currently in KSA?*', saudi)?.value === 'Yes');
check('but not for someone in Dubai', ans('Are you currently in KSA?', other)?.value == null);
check('«based in Riyadh?» → Yes', ans('Are you based in Riyadh?', saudi)?.value === 'Yes');
check('«What is your current or more recent job title?» → the title', ans('What is your current or more recent job title?', saudi)?.value === 'Product Analyst');
check('an Arabic form gets نعم', ans('هل تجيد العربية؟', saudi)?.value === 'نعم');
check('a question about Arabic tools is not about speaking it', F.keyFor('Do you have experience with Arabic NLP models?') !== 'speaks_arabic');

// «How did you hear about this job?» — the employer's own site, which is where every job here comes from.
const heard = ans('How did you hear about this job?*', saudi);
check('«How did you hear about this job?» → Company website', heard?.value === 'Company website', heard?.value);
check('a list offering «Careers Page» accepts it', heard?.accept.includes('careers page'));
check('never a friend, a recruiter or LinkedIn', !['friend', 'referral', 'linkedin', 'recruiter', 'employee referral'].some((x) => heard?.accept.includes(x)));
check('«Where did you hear about us?» is the same question', F.keyFor('Where did you hear about us?') === 'heard_from');
check('an Arabic form: موقع الشركة', ans('كيف عرفت عن هذه الوظيفة؟', saudi)?.value === 'موقع الشركة');
check('what they wrote themselves for it still wins', F.answerFor('How did you hear about this job?',
  forExtension({ full_name: 'S', answers: { 'How did you hear about this job?': 'LinkedIn' } }), { country: 'sa' })?.value === 'LinkedIn');

console.log(fails ? `\n✗ ${fails}` : '\n✓ ما يُستنتج من الملف يُجاب، وما لا يُستنتج يُترك لصاحبه');
process.exit(fails ? 1 : 0);
