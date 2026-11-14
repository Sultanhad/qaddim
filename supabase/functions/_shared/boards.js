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
  { system: 'lever', slug: 'dlocal', label: 'dLocal' },

  // ── Added 12 Nov 2026, counted under the corrected region rule ────────────
  // Sixty-six candidates looked worth adding while "remote, wherever" was being counted as
  // "here": OpenAI alone showed 581. Counted again with remote-from-elsewhere excluded, these
  // eighteen had three or more postings that are in the region or open to it (the number
  // beside each); the rest had fewer, or only a bare "Remote" from an employer that hires in
  // one country. Run `node scripts/discover-boards.mjs` before adding to this list.
  { system: 'greenhouse', slug: 'lucidmotors', label: 'Lucid Motors' },       // 35 — Saudi Arabia
  { system: 'greenhouse', slug: 'deliveroo', label: 'Deliveroo' },            // 22 — Dubai, Kuwait
  { system: 'ashby', slug: 'supabase', label: 'Supabase' },                   // 46 — "Remote, Global"
  { system: 'lever', slug: 'offchainlabs', label: 'Offchain Labs' },          // 12 — remote
  { system: 'ashby', slug: 'elevenlabs', label: 'ElevenLabs' },               //  8 — UAE, Saudi Arabia
  { system: 'greenhouse', slug: 'consensys', label: 'Consensys' },            //  8 — EMEA remote
  { system: 'greenhouse', slug: 'gitlab', label: 'GitLab' },                  //  7 — remote, KSA, UAE
  { system: 'ashby', slug: 'cohere', label: 'Cohere' },                       //  7 — Dubai, Riyadh
  { system: 'ashby', slug: 'oyster', label: 'Oyster' },                       //  6 — EMEA, global
  { system: 'ashby', slug: 'posthog', label: 'PostHog' },                     //  6 — remote
  { system: 'greenhouse', slug: 'coinbase', label: 'Coinbase' },              //  4 — UAE
  { system: 'lever', slug: 'appen', label: 'Appen' },                         //  4 — Qatar, Bahrain, UAE
  { system: 'greenhouse', slug: 'thunes', label: 'Thunes' },                  //  4 — Riyadh, Dubai
  { system: 'ashby', slug: 'airwallex', label: 'Airwallex' },                 //  3 — Dubai, Abu Dhabi
  { system: 'ashby', slug: 'openai', label: 'OpenAI' },                       //  3 — Abu Dhabi
  { system: 'ashby', slug: 'zapier', label: 'Zapier' },                       //  3 — EMEA remote
  { system: 'greenhouse', slug: 'celonis', label: 'Celonis' },                //  3 — UAE
  { system: 'greenhouse', slug: 'alixpartners', label: 'AlixPartners' },      //  3 — Riyadh, Dubai

  // ── Oracle Recruiting Cloud, added 14 Nov 2026 ────────────────────────────
  // Where most large Saudi employers actually post. Found from their own careers pages and
  // the portals' public addresses, then read live through the adapter before being listed;
  // the number is postings in Saudi Arabia on that read (the last three were still filling).
  // Left out: one pod whose employer could not be identified, and WSP (4,197 jobs, no way to
  // ask for this region alone).
  { system: 'oracle', slug: 'iaeegs.fa.ocs.oraclecloud.com/CX_1', label: 'Napco' },                       // 71
  { system: 'oracle', slug: 'ejpi.fa.em2.oraclecloud.com/CX_5001', label: 'Riyadh Schools' },             // 45
  { system: 'oracle', slug: 'iaasbk.fa.ocs.oraclecloud.com/CX_1', label: 'Hayat National Hospital' },     // 32
  { system: 'oracle', slug: 'efan.fa.em3.oraclecloud.com/CX_1', label: 'Nahdi' },                         // 18
  { system: 'oracle', slug: 'fa-ewxl-saasfaprod1.fa.ocs.oraclecloud.com/CX_1001', label: 'Savola' },      // 14
  { system: 'oracle', slug: 'iaazkf.fa.ocs.oraclecloud.com/CX_1', label: 'Saudi Pro League' },            // 10
  { system: 'oracle', slug: 'efva.fa.em3.oraclecloud.com/CX_1', label: 'Al Gihaz Holding' },              //  9
  { system: 'oracle', slug: 'fa-epph-saasfaprod1.fa.ocs.oraclecloud.com/CX_1', label: 'ROSHN' },          //  5
  { system: 'oracle', slug: 'careers.mobily.com.sa/CX_4002', label: 'Mobily' },                           //  2
  { system: 'oracle', slug: 'fa-eqlf-saasfaprod1.fa.ocs.oraclecloud.com/CX_1', label: 'Saudi Arabia Railways' }, // 1
  // Regional and global, asked per country:
  { system: 'oracle', slug: 'efet.fa.us2.oraclecloud.com/CX_1009', label: 'Hilton' },                     // 203 listed
  { system: 'oracle', slug: 'ediu.fa.em2.oraclecloud.com/CX_1013', label: 'Apparel Group' },              // 152 listed
  { system: 'oracle', slug: 'efhi.fa.em3.oraclecloud.com/CX_1', label: 'Landmark Group' },                // 82
  { system: 'oracle', slug: 'hcib.fa.us2.oraclecloud.com/CX_1001', label: 'Hill International' },         // 43
  { system: 'oracle', slug: 'egay.fa.us6.oraclecloud.com/CX_4001', label: 'NOV' },                        // 25

  // ── iCIMS ─────────────────────────────────────────────────────────────────
  // Riyadh Air keeps four portals; 67 of their 69 postings were based in Riyadh on 14 Nov 2026
  // (cabin crew, pilots and engineering among them).
  { system: 'icims', slug: 'careers-riyadhair', label: 'Riyadh Air' },
  { system: 'icims', slug: 'cabincrew-riyadhair', label: 'Riyadh Air' },
  { system: 'icims', slug: 'pilots-riyadhair', label: 'Riyadh Air' },
  { system: 'icims', slug: 'engineering-riyadhair', label: 'Riyadh Air' }
];
