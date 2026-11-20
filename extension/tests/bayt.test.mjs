// «أضف لقدّم» on a Bayt job page: does it read the job, only on a job page, and only when pressed?
// Run against pages built here — Bayt itself is never fetched.
//
//   npm run test:bayt
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const src = await readFile(new URL('../src/bayt.js', import.meta.url), 'utf8');
let fails = 0;
const check = (w, ok, x = '') => { console.log(`  ${ok ? '✓' : '✗'} ${w}${x ? ' · ' + x : ''}`); if (!ok) fails++; };

const browser = await chromium.launch();
async function open(path, body) {
  const page = await browser.newPage();
  // served at Bayt's address shape, from here
  await page.route('https://www.bayt.com/**', (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<!doctype html><html><body>${body}</body></html>` }));
  await page.goto('https://www.bayt.com' + path);
  await page.evaluate(`(function(){ const chrome = { runtime: { sendMessage(m, cb) { (window.__sent = window.__sent || []).push(m); cb({ ok: true, queued: !!m.job.applyUrl }); } } }; ${src} })()`);
  return page;
}

const LD = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Senior Product Manager',
  hiringOrganization: { '@type': 'Organization', name: 'Acme Arabia' }, datePosted: '2026-11-17',
  jobLocation: { '@type': 'Place', address: { addressLocality: 'Riyadh', addressCountry: { name: 'Saudi Arabia' } } },
  description: '<p>Own the roadmap.</p><ul><li>5 years</li></ul>' })}</script><h1>Senior Product Manager</h1>`;

{
  const page = await open('/en/saudi-arabia/jobs/senior-product-manager-5123456/', LD + '<a href="https://www.bayt.com/en/apply/">Apply</a>');
  check('a job page gets the button', await page.locator('[data-qaddim=add]').count() === 1);
  check('and nothing is sent before it is pressed', await page.evaluate(() => !window.__sent));
  await page.click('[data-qaddim=add]');
  const sent = await page.evaluate(() => window.__sent?.[0]);
  check('pressed: the job is read from the page', sent?.type === 'qaddim:add-job' && sent.job.title === 'Senior Product Manager' && sent.job.company === 'Acme Arabia', JSON.stringify(sent?.job).slice(0, 120));
  check('with its place, date and text', sent.job.location === 'Riyadh, Saudi Arabia' && sent.job.posted === '2026-11-17' && /Own the roadmap/.test(sent.job.description) && /5 years/.test(sent.job.description));
  check('its address, without anything after it', sent.job.url === 'https://www.bayt.com/en/saudi-arabia/jobs/senior-product-manager-5123456/');
  check('applied to on Bayt: no outside apply link', sent.job.applyUrl === null);
  check('and the button says so', (await page.textContent('[data-qaddim=add]')).includes('قدّم عليها هنا في بيت'));
  await page.close();
}
{
  const page = await open('/ar/uae/jobs/analyst-7654321/', LD + '<a href="https://apply.workable.com/acme/j/ABC123/">قدّم</a><a href="https://tracker.example/x">x</a>');
  await page.click('[data-qaddim=add]');
  const sent = await page.evaluate(() => window.__sent?.[0]);
  check('a posting that sends applicants to Workable: that link is kept', sent.job.applyUrl === 'https://apply.workable.com/acme/j/ABC123/');
  check('and the button says qaddim applies', (await page.textContent('[data-qaddim=add]')).includes('يقدّم عليها قدّم'));
  await page.close();
}
{
  const page = await open('/en/saudi-arabia/jobs/data-analyst-2345678/', '<h1>Data Analyst</h1><meta property="og:description" content="Analyse things.">');
  await page.click('[data-qaddim=add]');
  const sent = await page.evaluate(() => window.__sent?.[0]);
  check('no structured description: the page heading is read', sent?.job.title === 'Data Analyst');
  await page.close();
}
{
  const page = await open('/en/saudi-arabia/jobs/', '<h1>Jobs in Saudi Arabia</h1>');
  check('a search page gets no button', await page.locator('[data-qaddim=add]').count() === 0);
  await page.close();
}

await browser.close();
console.log(fails ? `\n✗ ${fails}` : '\n✓ «أضف لقدّم» يقرأ الوظيفة من صفحتها، ولا شيء قبل الضغط');
process.exit(fails ? 1 : 0);
