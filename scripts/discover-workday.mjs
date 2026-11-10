// Finds a company's Workday tenant by following its own careers page.
//
//   node scripts/discover-workday.mjs example.com another.com
//
// Guessing does not work: the tenant is usually the company's name but the *site* is not —
// NVIDIA's is "NVIDIAExternalCareerSite" — so a probe that tries a list of likely site names
// misses almost everything, including NVIDIA. A careers page, though, either links straight
// to the Workday host or redirects to it, and the URL carries both halves.

const UA = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' };
const PATHS = ['/careers', '/en/careers', '/careers/', '/jobs', '/en/jobs', '/join-us', '/about/careers', '/'];
const WD = /([a-z0-9-]+)\.(wd\d{1,3})\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/;

async function grab(url) {
  try {
    const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return { url: r.url, html: r.ok ? (await r.text()).slice(0, 900000) : '' };
  } catch { return { url: '', html: '' }; }
}

/** Confirm a tenant/site pair by actually asking it for jobs. */
async function confirm(tenant, dc, site) {
  try {
    const r = await fetch(`https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.jobPostings) return null;
    const here = j.jobPostings.filter((x) =>
      /saudi|riyadh|jeddah|dammam|khobar|dhahran|ksa|dubai|abu dhabi|uae|doha|qatar|bahrain|kuwait|oman|cairo|egypt|amman|jordan/i
        .test(x.locationsText || '')).length;
    return { total: j.total ?? 0, seen: j.jobPostings.length, region: here };
  } catch { return null; }
}

for (const domain of process.argv.slice(2)) {
  let hit = null;
  for (const path of PATHS) {
    const { url, html } = await grab(`https://${domain}${path}`);
    const m = (url + ' ' + html).match(WD);
    if (m) { hit = { tenant: m[1], dc: m[2], site: m[3], via: path }; break; }
  }
  if (!hit) { console.log(`  — ${domain}`); continue; }
  const ok = await confirm(hit.tenant, hit.dc, hit.site);
  console.log(ok
    ? `  ✓ ${domain.padEnd(26)} ${hit.tenant}.${hit.dc}/${hit.site}  ${ok.total} وظيفة · ${ok.region}/${ok.seen} من المنطقة`
    : `  ? ${domain.padEnd(26)} ${hit.tenant}.${hit.dc}/${hit.site}  (وُجد في الصفحة، لم يردّ على الاستعلام)`);
}
