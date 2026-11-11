// Which questions an estimate may answer. Run: node packages/engine/tests/answering.test.js
import { mayGuess, sameWords } from '../src/answering.js';

const results = [];
const check = (g, n, c, d) => results.push({ g, n, pass: !!c, detail: c ? '' : String(d ?? '') });
const yes = (q) => mayGuess(q).ok === true;
const no = (q) => mayGuess(q).ok === false;

// taken from the forms that stopped real applications (docs/قياس-الاستمارات.md)
for (const q of [
  'How many years of professional Linux experience do you currently have?',
  'Do you have Kubernetes hands on experience working with enterprise customers? How many years?',
  'Why Thndr?',
  'What excites you the most about joining Foodics? and why should we choose you?',
  'Have you previously worked for Everpure (formerly Pure Storage)?',
  'If you do not reside in Abu Dhabi, would you be able to relocate?',
  'Have you worked in a SaaS, software, technology, fintech, or AI company? (Yes/No)',
  'What is your current employment status?',
  'How did you hear about this job?',
  'Are you proficient in English?',
  'Headline',
  // words that only look like the held ones
  'Do you have banking or fintech experience?',
  'Do you have experience related to data analysis?',
  'Have you worked in the medical device industry?',
  'How do you stay courteous with a difficult customer?'
]) check('Guess', q.slice(0, 60), yes(q), JSON.stringify(mayGuess(q)));

for (const q of [
  'Will you now or in the future require sponsorship for employment visa status?',
  'Are you authorized to work in the country you are applying to work in?',
  'Does the deemed export rule affect your employment by Everpure?',
  'Do you have any relatives/friends working with Aldar or its subsidiaries?',
  'Do you have any Relatives inside Incorta?',
  'Have you ever been convicted of a criminal offence?',
  'Please confirm that the information provided is true and complete.',
  'I certify that my answers are accurate',
  'Are you subject to a non-compete agreement?',
  'Passport number',
  'Date of Birth (DD/MM/YYYY)',
  'Do you have a medical condition we should know about?',
  'هل لك أقارب يعملون في الشركة؟',
  'أقر بأن جميع البيانات صحيحة'
]) check('Held', q.slice(0, 60), no(q), JSON.stringify(mayGuess(q)));

{
  const eeo = mayGuess('Disability status', ['Yes, I have a disability', 'No', 'I do not wish to answer']);
  check('Protected', 'A statistics question is never assessed', eeo.ok === false);
  check('Protected', 'Declining is chosen when it is offered', eeo.decline === 'I do not wish to answer', eeo.decline);
  check('Protected', 'And nothing is chosen when it is not', mayGuess('Veteran status', ['Yes', 'No']).decline === undefined);
  check('Protected', '"Gender identity" is one; "embrace" and "trace" are not', no('Gender identity') && yes('How do you embrace change and trace issues?'));
}
check('Words', 'Spacing and punctuation do not make a new question',
  sameWords('  Why  Thndr?* ') === sameWords('why thndr') && sameWords('A') !== sameWords('B'));
check('Words', 'An empty question is nobody\'s to answer', mayGuess('').ok === false && mayGuess(null).ok === false);

let fail = 0;
for (const r of results) {
  if (!r.pass) fail++;
  console.log((r.pass ? 'PASS ' : 'FAIL ') + (r.g + '          ').slice(0, 12) + r.n + (r.pass ? '' : '  <-- ' + r.detail));
}
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
