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

  // ── Global employers that post real jobs in the region ────────────────────
  { system: 'greenhouse', slug: 'binance', label: 'Binance' },
  { system: 'greenhouse', slug: 'okx', label: 'OKX' },
  { system: 'greenhouse', slug: 'bybit', label: 'Bybit' },
  { system: 'greenhouse', slug: 'udacity', label: 'Udacity' },
  { system: 'smartrecruiters', slug: 'deliveryhero', label: 'Delivery Hero' },
  { system: 'lever', slug: 'dlocal', label: 'dLocal' }
];
