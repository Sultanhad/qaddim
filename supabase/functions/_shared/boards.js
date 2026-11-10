// Every board we read, in one list.
//
// It used to live in two files — the local worker and the edge function — which is how a
// source gets added in one place and silently missing from the other.
//
// `region` is how many of a board's postings were in the Gulf, Egypt or Jordan when it was
// added. It is a note, not a filter: the engine decides what each user sees. Boards whose
// postings are all somewhere else are not listed at all, however many jobs they have.

export const BOARDS = [
  // ── Saudi Arabia ──────────────────────────────────────────────────────────
  { system: 'workable', slug: 'mozn-ai', label: 'Mozn' },
  { system: 'workable', slug: 'lucidya', label: 'Lucidya' },
  { system: 'workable', slug: 'foodics', label: 'Foodics' },
  { system: 'workable', slug: 'mrsool-3', label: 'Mrsool' },
  { system: 'workable', slug: 'salla', label: 'Salla' },
  { system: 'ashby', slug: 'leantech', label: 'Lean Technologies' },
  { system: 'lever', slug: 'rewaatech', label: 'Rewaa' },
  { system: 'greenhouse', slug: 'tamara', label: 'Tamara' },
  { system: 'recruitee', slug: 'unifonic', label: 'Unifonic' },
  { system: 'smartrecruiters', slug: 'almosafer', label: 'Almosafer' },
  { system: 'smartrecruiters', slug: 'seera', label: 'Seera Group' },
  { system: 'workable', slug: 'morni', label: 'Morni' },

  // ── United Arab Emirates ──────────────────────────────────────────────────
  { system: 'lever', slug: 'aldar', label: 'Aldar' },
  { system: 'ashby', slug: 'ziina', label: 'Ziina' },
  { system: 'greenhouse', slug: 'careem', label: 'Careem' },
  { system: 'lever', slug: 'flowlife', label: 'Flow' },

  // ── Egypt, Jordan ─────────────────────────────────────────────────────────
  { system: 'workable', slug: 'robusta', label: 'Robusta' },
  { system: 'ashby', slug: 'thndr', label: 'Thndr' },
  { system: 'workable', slug: 'tamatem', label: 'Tamatem' },
  { system: 'recruitee', slug: 'sahl', label: 'Sahl' },
  { system: 'lever', slug: 'incorta', label: 'Incorta' },


  // ── Added 10 Nov 2026, after a sector-by-sector search of the Saudi market. Each was
  // fetched before being listed; the count beside it is how many of its postings were in
  // this region at that moment.
  { system: 'workable', slug: 'rotana-hotels', label: 'Rotana Hotels & Resorts' },
  { system: 'workable', slug: 'capitex', label: 'Capitex' },
  { system: 'workable', slug: 'sihamco', label: 'SIHAMCO' },
  { system: 'greenhouse', slug: 'alpaca', label: 'Alpaca' },
  { system: 'greenhouse', slug: 'datadog', label: 'Datadog' },
  { system: 'greenhouse', slug: 'purestorage', label: 'Pure Storage' },
  { system: 'workable', slug: 'webook', label: 'webook' },
  { system: 'workable', slug: 'khibraty', label: 'Khibraty' },
  { system: 'workable', slug: 'zaintech', label: 'ZainTECH' },
  { system: 'greenhouse', slug: 'scaleai', label: 'Scale AI' },
  { system: 'workable', slug: 'ultimate-peaks', label: 'Ultimate Peaks' },
  { system: 'greenhouse', slug: 'elastic', label: 'Elastic' },
  { system: 'greenhouse', slug: 'strategyandmiddleeast', label: 'Strategy& Middle East' },
  { system: 'smartrecruiters', slug: 'RolandBerger', label: 'Roland Berger' },
  { system: 'workable', slug: 'gathern', label: 'Gathern' },
  { system: 'smartrecruiters', slug: 'RHG', label: 'Radisson Hotel Group' },
  { system: 'workable', slug: 'baraka-investment', label: 'Baraka Investment' },
  { system: 'greenhouse', slug: 'teneo', label: 'Teneo' },
  { system: 'smartrecruiters', slug: 'QualityEducationCompany', label: 'Quality Education Company' },
  { system: 'workable', slug: 'alwatania-information-systems', label: 'Al-Watania Information Systems' },

  // ── Workday tenants ───────────────────────────────────────────────────────
  // The large employers live here. Each is asked by region rather than read whole: Cisco
  // lists 1,479 postings and eight of them are in Saudi Arabia.
  { system: 'workday', slug: 'slihrms.wd3/Careers', label: 'AtkinsRéalis' },
  { system: 'workday', slug: 'visa.wd5/Visa', label: 'Visa' },
  { system: 'workday', slug: 'jll.wd1/jllcareers', label: 'JLL' },
  { system: 'workday', slug: 'cisco.wd5/Cisco_Careers', label: 'Cisco' },
  { system: 'workday', slug: 'bdx.wd1/EXTERNAL_CAREER_SITE_SAUDI_ARABIA', label: 'BD' },
  { system: 'workday', slug: 'mastercard.wd1/CorporateCareers', label: 'Mastercard' },
  { system: 'workday', slug: 'snapchat.wd1/snap', label: 'Snap' },
  { system: 'workday', slug: 'wwecorp.wd5/IMG', label: 'IMG' },
  { system: 'workday', slug: 'vanderlande.wd3/careers', label: 'Vanderlande' },

  // ── Global employers that post real jobs in the region ────────────────────
  { system: 'greenhouse', slug: 'binance', label: 'Binance' },
  { system: 'greenhouse', slug: 'okx', label: 'OKX' },
  { system: 'greenhouse', slug: 'bybit', label: 'Bybit' },
  { system: 'greenhouse', slug: 'udacity', label: 'Udacity' },
  { system: 'smartrecruiters', slug: 'deliveryhero', label: 'Delivery Hero' },
  { system: 'lever', slug: 'dlocal', label: 'dLocal' }
];
