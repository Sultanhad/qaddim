// Does the filler read a form correctly, answer only what the profile can answer, and stop
// when it cannot? Run against forms built here — never against an employer's.
//
//   npm run test:fill
//
// The two styled dropdowns below copy the markup Greenhouse and Workable ship (read from their
// live pages, see docs/قياس-الاستمارات.md) and the way each opens: react-select on mousedown,
// Workable's on click. They are stand-ins: what they prove is that the filler handles that
// structure, not that either vendor's script behaves the same way tomorrow.
import { readFile } from 'node:fs/promises';
import { chromium } from '/Users/sultan_kill/Downloads/riyadh-job-agent/local-apply/node_modules/playwright/index.mjs';

const root = new URL('../../', import.meta.url).pathname;
const src = (f) => readFile(root + 'extension/src/' + f, 'utf8');
// The content scripts as shipped; `chrome.runtime` is handed to them as a local.
const BUNDLE = `(function(){
  const chrome = { runtime: { onMessage: { addListener(fn) { window.__apply = fn; } } } };
  ${await src('fields.js')}
  ${await src('read.js')}
  ${await src('fill.js')}
  window.__read = QaddimRead;
})()`;

let fails = 0;
const check = (what, ok, extra = '') => { console.log(`  ${ok ? '✓' : '✗'} ${what}${extra ? ' · ' + extra : ''}`); if (!ok) fails++; };

const PROFILE = {
  full_name: 'Sara Ahmed', first_name: 'Sara', last_name: 'Ahmed',
  email_for_applications: 'sara@example.com', phone: '+966500000000',
  city: 'Riyadh', country: 'Saudi Arabia', location: 'Riyadh, Saudi Arabia',
  nationality: 'سعودي', saudi_national: 'yes', work_authorization: 'مواطن',
  notice_period: 'شهر', education_degree: 'بكالوريوس', gender: 'أنثى',
  date_of_birth: '1995-03-10', marital_status: 'أعزب', current_company: 'Example Co',
  answers: { _facts: { gender: 'أنثى' } }
};

const attr = (options) => JSON.stringify(options).replace(/'/g, '&#39;');   // "Bachelor's" inside a quoted attribute
const reactSelect = (id, label, options, required = true) => `
  <div class="field-wrapper"><div class="select"><div class="select__container">
    <label id="${id}-label" for="${id}" class="label select__label">${label}${required ? '<span aria-hidden="true">*</span>' : ''}</label>
    <div class="select-shell" data-options='${attr(options)}'><div><div class="select__control">
      <div class="select__value-container"><div class="select__placeholder">Select...</div>
        <div class="select__input-container"><input class="select__input" id="${id}" type="text" role="combobox"
          aria-labelledby="${id}-label" ${required ? 'aria-required="true"' : ''} aria-expanded="false" value=""></div></div>
    </div></div>
    <input class="requiredInput" ${required ? 'required' : ''} aria-hidden="true" tabindex="-1" value=""></div>
  </div></div></div>`;

const workableSelect = (id, label, options) => `
  <div class="styles--3aPac"><span><span><strong>*</strong></span><span><span id="${id}_label"><strong>${label}</strong></span></span></span>
    <div data-ui="${id}" data-input-type="select" data-options='${attr(options)}'><label class="styles--2bW8g"><div data-role="illustrated-input"><div class="styles--3qHIU">
      <input id="input_${id}_input" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="input_${id}_listbox"
        aria-labelledby="${id}_label" placeholder="Select an option…" type="text" value="" readonly>
      <svg viewBox="0 0 20 20" width="20" height="20"><desc aria-hidden="true"><p>SVGs not supported by this browser.</p></desc></svg>
    </div></div></label><input name="${id}" required tabindex="-1" aria-hidden="true" value=""></div></div>`;

const WIDGETS = `
  // react-select: the control opens the menu on mousedown; an option is chosen on click.
  document.querySelectorAll('.select-shell').forEach((shell) => {
    const control = shell.querySelector('.select__control'), input = shell.querySelector('.select__input');
    const close = () => shell.querySelector('.select__menu')?.remove();
    control.addEventListener('mousedown', () => {
      if (shell.querySelector('.select__menu')) return;
      const menu = document.createElement('div'); menu.className = 'select__menu'; menu.setAttribute('role', 'listbox');
      JSON.parse(shell.dataset.options).forEach((text) => {
        const o = document.createElement('div'); o.className = 'select__option'; o.setAttribute('role', 'option'); o.textContent = text;
        o.addEventListener('click', () => {
          shell.querySelector('.select__placeholder, .select__single-value').outerHTML = '<div class="select__single-value">' + text + '</div>';
          shell.querySelector('.requiredInput').value = text; close();
        });
        menu.appendChild(o);
      });
      shell.appendChild(menu);
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    // typing only filters — it never chooses, which is why setting .value used to do nothing
    input.addEventListener('input', () => { window.__typedIntoCombo = true; });
  });
  // Workable: a read-only box that opens its list on click.
  document.querySelectorAll('[data-ui][data-input-type="select"]').forEach((ui) => {
    const input = ui.querySelector('input[role=combobox]');
    input.addEventListener('click', () => {
      if (document.getElementById(input.getAttribute('aria-controls'))) return;
      const ul = document.createElement('ul'); ul.id = input.getAttribute('aria-controls'); ul.setAttribute('role', 'listbox');
      JSON.parse(ui.dataset.options).forEach((text) => {
        const li = document.createElement('li'); li.setAttribute('role', 'option'); li.textContent = text;
        li.addEventListener('click', () => { input.value = text; ui.querySelector('input[aria-hidden]').value = text; ul.remove(); });
        ul.appendChild(li);
      });
      ui.appendChild(ul);
    });
  });
  document.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault(); window.__submitted = true; document.body.insertAdjacentHTML('beforeend', '<p>Thank you for applying</p>');
  });`;

const page_ = (body) => `<!doctype html><html><body><form>${body}
  <button type="submit">Submit application</button></form><script>${WIDGETS}</script></body></html>`;

const FULL = page_(`
  <div class="field"><label for="first">First Name *</label><input id="first" required></div>
  <div class="field"><label for="last">Last Name *</label><input id="last" required></div>
  <div class="field"><label for="email">Email *</label><input id="email" type="email" required></div>
  <div class="field"><label for="tel">Phone *</label><input id="tel" type="tel" required></div>
  ${reactSelect('q_country', 'Country', ['Qatar', 'Saudi Arabia', 'United Arab Emirates'])}
  ${reactSelect('q_sponsor', 'Will you now or in the future require employer sponsorship to work in the country where this role is based?', ['Yes', 'No'])}
  ${reactSelect('q_edu', 'What is your highest level of education?', ["High School", "Bachelor's Degree", "Master's Degree"])}
  ${workableSelect('CA_1', 'Gender', ['Female', 'Male'])}
  <div class="field"><label for="g2">Gender *</label><select id="g2" required><option value="">Select</option><option value="f">Female</option><option value="m">Male</option></select></div>
  <div class="field"><label for="so">Sexual orientation</label><select id="so"><option value="">Select</option><option>Prefer not to say</option><option>Other</option></select></div>
  <fieldset><legend>Are you a Saudi national? *</legend>
    <label><input type="radio" name="saudi" value="1"> YES</label><label><input type="radio" name="saudi" value="0"> NO</label></fieldset>
  <div class="field"><label for="dob">Date of Birth (DD/MM/YYYY) *</label><input id="dob" required></div>
  <div class="field"><label for="np">Notice period *</label><input id="np" required></div>
  <div class="field"><label for="loc">Current location ✱<span>No location found. Try entering a different location</span></label><input id="loc"></div>
  <div class="field"><label><input type="checkbox" id="agree" required> I agree to the privacy policy *</label></div>
`);

const BLOCKED = page_(`
  <div class="field"><label for="first">First Name *</label><input id="first" required></div>
  <div class="field"><label for="why">Why do you want to work here? *</label><textarea id="why" required></textarea></div>
  <div class="field"><label for="dob2">Date of birth *</label><input id="dob2" required></div>
  ${reactSelect('q_home', 'Home Country', ['Qatar', 'Saudi Arabia'])}
  <fieldset><legend>How did you hear about us? *</legend>
    <label><input type="checkbox" name="heard" value="a"> LinkedIn</label>
    <label><input type="checkbox" name="heard" value="b"> A friend</label>
    <label><input type="checkbox" name="heard" value="c"> Other</label></fieldset>
`);

// An employer's own questions: two about the company, one that only looks like one, one whose
// options are not the profile's words, and one too short for the old matcher to ever match.
const EMPLOYER = page_(`
  <div class="field"><label for="first">First Name *</label><input id="first" required></div>
  ${reactSelect('q_worked', 'Have you previously worked with Aldar or its subsidiaries?', ['Yes', 'No'])}
  <fieldset><legend>Do you have any relatives/friends working with Aldar or its subsidiaries? *</legend>
    <label><input type="radio" name="rel" value="y"> Yes</label><label><input type="radio" name="rel" value="n"> No</label></fieldset>
  ${reactSelect('q_k8s', 'Have you previously worked with Kubernetes?', ['Yes', 'No'])}
  <div class="field"><label for="edu">What is your highest level of education? *</label>
    <select id="edu" required><option value="">Select</option><option value="ug">Undergraduate degree (BS/BA)</option><option value="gr">Graduate degree</option></select></div>
  <div class="field"><label for="np2">Notice period *</label>
    <select id="np2" required><option value="">Select</option><option value="a">Less than 2 weeks</option><option value="b">More than 2 months</option></select></div>
  <div class="field"><label for="hl">Headline *</label><input id="hl" required></div>
`);
const ALDAR = { country: 'ae', company: 'Aldar' };
const USUAL = { ...PROFILE, worked_here_before: 'no', relatives_here: 'no' };

const browser = await chromium.launch();
const run = async (html, { job = { country: 'sa' }, autoSubmit = false, profile = PROFILE } = {}) => {
  const page = await browser.newPage();
  await page.setContent(html);
  await page.evaluate(BUNDLE);
  const result = await page.evaluate(([profile, job, autoSubmit]) => new Promise((resolve) => {
    window.__apply({ type: 'qaddim:apply', profile, job, autoSubmit }, null, resolve);
  }), [profile, job, autoSubmit]);
  return { page, result };
};
const val = (page, sel) => page.evaluate((s) => document.querySelector(s)?.value ?? null, sel);
const shown = (page, id) => page.evaluate((i) =>
  document.querySelector('#' + i).closest('.select-shell').querySelector('.select__single-value')?.textContent ?? null, id);

console.log('قراءة الاستمارة');
{
  const { page } = await run(FULL);
  const qs = await page.evaluate(() => window.__read.questions().map((x) => ({ kind: x.kind, q: x.q, required: x.required })));
  check('كل قائمة منسدلة سؤال واحد لا اثنان', qs.filter((x) => /^Country/.test(x.q)).length === 1, `${qs.length} سؤالاً`);
  check('القوائم تُقرأ كقوائم لا كنصّ', qs.filter((x) => x.kind === 'combo').length === 4);
  check('نصّ الأيقونة لا يُقرأ كسؤال', !qs.some((x) => /SVGs not supported/.test(x.q)));
  check('قائمة Workable تُعرف أنها إلزامية', qs.find((x) => x.q === 'Gender' && x.kind === 'combo')?.required === true);
  await page.close();
}
{
  const { page } = await run(BLOCKED);
  const qs = await page.evaluate(() => window.__read.questions().map((x) => ({ kind: x.kind, q: x.q, n: x.els?.length })));
  const heard = qs.filter((x) => x.kind === 'checks');
  check('مجموعة المربعات سؤال واحد', heard.length === 1 && heard[0].n === 3, heard[0]?.q);
  await page.close();
}

console.log('\nالتعبئة');
{
  const { page, result } = await run(FULL);
  const missing = result.report.missing.map((m) => m.q);
  check('لا شيء إلزامي بقي بلا جواب', result.status === 'filled' && missing.length === 0, missing.join(' | '));
  check('الدولة اختيرت من القائمة', await shown(page, 'q_country') === 'Saudi Arabia');
  check('الكتابة في القائمة لم تُستعمل بديلاً عن الاختيار', await page.evaluate(() => !window.__typedIntoCombo));
  check('الكفالة: «لا» لمواطن والوظيفة في السعودية', await shown(page, 'q_sponsor') === 'No');
  check('«بكالوريوس» وجدت خيارها الإنجليزي', await shown(page, 'q_edu') === "Bachelor's Degree");
  check('قائمة Workable اختيرت', await val(page, '#input_CA_1_input') === 'Female');
  check('أنثى لا تصير Male ولا العكس', await val(page, '#g2') === 'f');
  check('سؤال التوجّه الجنسي لم يُلمس', await val(page, '#so') === '');
  check('«هل أنت سعودي؟» أُجيب بنعم', await page.evaluate(() => document.querySelector('input[name=saudi][value="1"]').checked));
  check('تاريخ الميلاد بالصيغة المطلوبة', await val(page, '#dob') === '10/03/1995', await val(page, '#dob'));
  check('مهلة الإشعار بالإنجليزية', await val(page, '#np') === '1 month', await val(page, '#np'));
  check('الموقع قُرئ رغم نصّ المساعدة الملتصق به', await val(page, '#loc') === 'Riyadh, Saudi Arabia');
  check('إقرار الخصوصية عُلّم', await page.evaluate(() => document.querySelector('#agree').checked));
  check('ولم يُضغط الإرسال', await page.evaluate(() => !window.__submitted));
  await page.close();
}
{
  // The same person, a job in Dubai: the profile says nothing about the UAE.
  const { page, result } = await run(FULL, { job: { country: 'ae' } });
  const stop = result.report.missing.find((m) => /sponsorship/.test(m.q));
  check('وظيفة خارج السعودية: سؤال الكفالة يُترك لصاحبه', result.status === 'needs_you' && !!stop && await shown(page, 'q_sponsor') === null, stop?.why);
  await page.close();
}

console.log('\nالتوقف');
{
  const { page, result } = await run(BLOCKED, { autoSubmit: true });
  const missing = result.report.missing.map((m) => m.q);
  check('سؤال بلا جواب في الملف يوقف الطلب', result.status === 'needs_you', result.reason);
  check('«لماذا تريد العمل هنا؟» لم يُخترع له جواب', missing.some((q) => /Why do you want/.test(q)) && await val(page, '#why') === '');
  check('تاريخ بلا صيغة محددة لا يُخمَّن', missing.some((q) => /^Date of birth/.test(q)) && await val(page, '#dob2') === '');
  check('«بلد الأصل» ليس بلد الإقامة', await shown(page, 'q_home') === null);
  check('مجموعة المربعات لم يُعلَّم منها شيء', await page.evaluate(() => !document.querySelector('input[name=heard]:checked')));
  check('والاستمارة لم تُرسل', await page.evaluate(() => !window.__submitted));
  await page.close();
}
{
  const { page, result } = await run(FULL, { autoSubmit: true });
  check('استمارة مكتملة والإرسال مفعّل: تُرسل', result.status === 'submitted' && await page.evaluate(() => window.__submitted === true), result.reason);
  await page.close();
}

console.log('\nأسئلة عن الشركة، والمسودة');
{
  const { page, result } = await run(EMPLOYER, { job: ALDAR });
  const m = result.report.missing;
  check('بلا جواب معتاد: «هل عملت عندنا؟» يُترك لصاحبه', m.some((x) => /worked with Aldar/.test(x.q)) && await shown(page, 'q_worked') === null);
  await page.close();
}
{
  const { page, result } = await run(EMPLOYER, { job: ALDAR, profile: USUAL });
  const m = result.report.missing, of = (re) => m.find((x) => re.test(x.q));
  check('بجواب معتاد «لا»: يُجاب «هل عملت عندنا؟»', await shown(page, 'q_worked') === 'No');
  check('و«هل لك قريب عندنا؟»', await page.evaluate(() => document.querySelector('input[name=rel][value=n]').checked));
  check('«هل عملت بـKubernetes؟» ليس سؤالاً عن الشركة', await shown(page, 'q_k8s') === null && !!of(/Kubernetes/));
  check('وخياراته تصل للمسودة', JSON.stringify(of(/Kubernetes/)?.options) === '["Yes","No"]', JSON.stringify(of(/Kubernetes/)?.options));
  check('والقائمة أُغلقت بعد قراءتها', await page.evaluate(() => !document.querySelector('.select__menu')));
  check('«بكالوريوس» وجدت Undergraduate degree (BS/BA)', await val(page, '#edu') === 'ug');
  check('جواب الملف ليس بين الخيارات: يُعرض ما في القائمة', of(/^Notice period/)?.options?.length === 2 && await val(page, '#np2') === '', of(/^Notice period/)?.why);
  check('سؤال نصّي بلا خيارات', of(/^Headline/)?.kind === 'text' && !of(/^Headline/)?.options);
  check('لا شيء منها «يُكمَل باليد»', m.every((x) => !x.manual));
  await page.close();
}
{
  // What the draft screen saves: each answer under the question's own words.
  const profile = { ...USUAL, answers: {
    'Have you previously worked with Kubernetes?': 'Yes',
    'What is your highest level of education?': 'Graduate degree',
    'Notice period': 'Less than 2 weeks',
    'Headline': 'Product analyst' } };
  const { page, result } = await run(EMPLOYER, { job: ALDAR, profile });
  check('بعد الإجابة في المسودة: لا شيء ناقص', result.status === 'filled', result.report.missing.map((x) => x.q).join(' | '));
  check('جوابك لهذا السؤال يغلب حقل الملف', await val(page, '#edu') === 'gr' && await val(page, '#np2') === 'a');
  check('والسؤال القصير يُطابَق', await val(page, '#hl') === 'Product analyst');
  check('وجواب المسودة اختير من القائمة', await shown(page, 'q_k8s') === 'Yes');
  await page.close();
}
{
  const { page, result } = await run(BLOCKED, { profile: { ...PROFILE, answers: { 'Date of birth': '10 March 1995' } } });
  check('تاريخ بلا صيغة: يُكتب كما كتبه صاحبه مرة', await val(page, '#dob2') === '10 March 1995');
  check('ومجموعة المربعات «تُكمَل باليد»', result.report.missing.find((x) => /hear about us/.test(x.q))?.manual === true);
  await page.close();
}

await browser.close();
console.log(fails ? `\n✗ ${fails} فحص فشل` : '\n✓ القارئ والمعبّئ يعملان على الاستمارات المحلية');
process.exit(fails ? 1 : 0);
