// Which field a job is in, from its title — one field for every job.
//
// ROLE_FAMILIES (taxonomy.js) is what a person says they want, and the scorer matches against
// it; it was written for office and technology work and knows nothing of a pharmacist, a chef
// or a cabin crew member. Measured on 14 Nov 2026, it placed 444 of 2,948 open jobs: 85% had
// no field at all. This file answers a different question — "what kind of job is this?" — for
// every posting, so the jobs can be browsed and filtered by field.
//
// How it decides: the title is normalised (case, accents, Arabic marks) and the rules below are
// tried in order; the first whose words appear in it wins. Order is the whole design — a
// "Software Engineer" must be caught by technology before engineering sees "engineer", and a
// "Visual Merchandiser" by retail before design sees "visual". Each rule's words are whole
// words; a trailing * makes one a prefix ("pharmac*" is pharmacy, pharmacist, pharmaceutical).
//
// Every open job's title was classified with these rules and read, field by field, before they
// were written down here; tests/fields.test.js holds the cases that decided the order.
import { norm, has } from './text.js';

/** The fields, in the order a person browsing would want them listed. */
export const FIELDS = [
  { id: 'tech', ar: 'التقنية والبرمجة' },
  { id: 'data', ar: 'البيانات والذكاء الاصطناعي' },
  { id: 'product', ar: 'المنتجات وتحليل الأعمال' },
  { id: 'design', ar: 'التصميم والإبداع' },
  { id: 'engineering', ar: 'الهندسة' },
  { id: 'construction', ar: 'المشاريع والإنشاءات والعقار' },
  { id: 'trades', ar: 'الفنيون والصيانة والسائقون' },
  { id: 'manufacturing', ar: 'التصنيع والإنتاج والجودة' },
  { id: 'health', ar: 'الصحة والصيدلة' },
  { id: 'hospitality', ar: 'الفنادق والمطاعم والضيافة' },
  { id: 'fitness', ar: 'اللياقة والرياضة' },
  { id: 'retail', ar: 'التجزئة والتجارة الإلكترونية' },
  { id: 'aviation', ar: 'الطيران' },
  { id: 'sales', ar: 'المبيعات وتطوير الأعمال' },
  { id: 'marketing', ar: 'التسويق والإعلام' },
  { id: 'finance', ar: 'المالية والمحاسبة والبنوك' },
  { id: 'hr', ar: 'الموارد البشرية' },
  { id: 'legal', ar: 'القانون والامتثال والمخاطر' },
  { id: 'operations', ar: 'العمليات وسلاسل الإمداد' },
  { id: 'customer', ar: 'خدمة العملاء' },
  { id: 'admin', ar: 'الإدارة والدعم المكتبي' },
  { id: 'education', ar: 'التعليم والتدريب' },
  { id: 'security', ar: 'الأمن والسلامة' },
  { id: 'programs', ar: 'برامج التدريب والخرّيجين' },
  { id: 'leadership', ar: 'القيادة والاستراتيجية والاستشارات' },
  { id: 'other', ar: 'أخرى' }
];
export const FIELD_AR = Object.fromEntries(FIELDS.map((f) => [f.id, f.ar]));

// [field, words]. Tried top to bottom; the first rule with a word in the title decides.
//
// Three tiers, and the order inside each was settled by reading every open job's title:
//   1. the airline and the programmes — a cabin-crew programme or an accounting internship is
//      that before it is anything else;
//   2. explicit job titles ("Software Engineer", "Accountant", "Product Manager", "Technician")
//      — they decide before any broad word gets a say;
//   3. fields by their broad words, specialist fields first, leadership last as the catch-all
//      for a title that only says "Manager" or "Director".
// A field may appear more than once, once in each tier it needs.
const RULES = [
  // ── 1. the airline, then the programmes ──
  ['aviation', ['cabin crew', 'cabin supervisor', 'purser', 'pilot', 'first officer', 'direct entry captain', 'captain a*', 'captain b*',
    'flight', 'aircraft', 'aviation', 'airline', 'airport', 'avionics', 'airframe', 'powerplant', 'line maintenance', 'engineer i cabin',
    'navigation engineer', 'b787', 'a321', 'a320', 'ground handling', 'ancillary', 'نواة', 'للضيافة الجوية', 'ضيافة جوية', 'طيار']],
  ['programs', ['intern', 'interns', 'internship*', 'coop', 'co op', 'trainee', 'graduate program*', 'graduate analyst program',
    'graduate analyst', 'graduate', 'graduates', 'fresh graduate*', 'builders program', 'accelerator program', 'student program',
    'rotational', 'launch program*', 'elite program', 'qadat', 'apprentice*', 'tamheer', 'تمهير', 'تدريب تعاوني', 'حديثي التخرج']],

  // ── 2. explicit job titles ──
  ['data', ['data scientist*', 'data science', 'data engineer*', 'data analyst*', 'data architect', 'bi developer', 'bi engineer',
    'power bi', 'business intelligence', 'machine learning', 'ml engineer', 'ai engineer', 'applied ai', 'prompt engineer', 'llm', 'speech']],
  ['tech', ['software engineer*', 'software engineering', 'software development', 'software developer', 'software architect',
    'full stack', 'fullstack', 'backend', 'back end', 'frontend', 'front end', 'devops', 'devsecops', 'site reliability', 'sre',
    'technical program*', 'technical project manager', 'application security', 'integration support', 'developer',
    'forward deployed', 'deployment engineer', 'release engineer', 'sdk', 'react', 'typescript', 'python', 'java', 'golang',
    'net developer', 'application support', 'support engineer', 'solutions engineer*', 'solutions engineering',
    'professional services engineer', 'managed services', 'infrastructure engineer*', 'infrastructure architect', 'systems engineer',
    'performance engineer', 'security engineer', 'security operations', 'security management', 'infrastructure security',
    'embedded security', 'purple team*', 'red team*', 'qa security', 'security analyst', 'finops', 'staff engineer', 'principal engineer',
    'customer success engineer', 'microsoft', 'end user computing', 'sase', 'engineering manager', 'application architect',
    'business architect', 'cloud architect', 'enterprise architect', 'solution architect', 'solutions architect', 'technology architect']],
  ['finance', ['finance analyst', 'financial analyst', 'cost controller', 'accountant', 'accountants', 'accounting', 'accounts clerk', 'accounts payable', 'accounts receivable', 'income auditor',
    'ar accountant', 'ap accountant', 'revenue assurance', 'asset management', 'محاسب*']],
  ['legal', ['counsel', 'lawyer', 'attorney', 'paralegal', 'compliance', 'mlro', 'money laundering', 'aml', 'kyc', 'sanctions',
    'transaction monitoring', 'financial crime', 'fcc', 'grc', 'legal', 'bribery', 'corruption', 'forensic*', 'محامي', 'امتثال']],
  ['design', ['designer', 'designers', 'product design*', 'ux', 'ui', 'user experience', 'graphic*', 'art director', 'animator',
    'motion graphics', 'مصمم']],
  ['product', ['product manager', 'product owner', 'product lead', 'head of product', 'product director', 'vp product',
    'business analyst', 'business analysis', 'محلل أعمال']],
  ['admin', ['executive assistant', 'personal assistant', 'administrative assistant', 'secretary', 'data entry', 'receptionist',
    'document control*', 'سكرتير*']],
  ['hr', ['talent acquisition', 'recruitment', 'recruiter', 'recruiting', 'human resource*', 'hr', 'hrms', 'people operations',
    'people partner*', 'hrbp', 'موارد بشرية', 'توظيف']],
  ['marketing', ['digital marketing', 'marketing', 'copywriter', 'digital media', 'paid media', 'social media', 'crm executive', 'seo',
    'تسويق']],
  ['sales', ['account executive', 'account manager', 'key account*', 'business development', 'sales executive', 'sales manager',
    'director of sales', 'sales director', 'sales coordinator']],
  ['construction', ['land acquisition', 'fit out', 'landscape', 'construction manager']],
  ['engineering', ['chief engineer', 'hardware engineer', 'inverter', 'water treatment', 'design engineer', 'civil design', 'mep design', 'structural design',
    'structure design', 'utilities engineer']],
  ['trades', ['fix it', 'handyman']],
  ['health', ['x ray', 'pharmacy technician', 'lab technician', 'laboratory technician', 'dental technician']],
  ['trades', ['technician', 'technicians', 'electrician', 'carpenter', 'plumber', 'welder', 'mason', 'painter', 'driver', 'forklift',
    'mechanic', 'hvac']],
  ['manufacturing', ['production', 'packag*', 'tandem line', 'octg', 'qc', 'qa qc', 'quality control', 'quality engineer',
    'quality inspector', 'food safety', 'quality and safety', 'quality assurance']],
  ['customer', ['careline']],
  ['leadership', ['strategic projects', 'special projects']],

  // ── 3. fields by their broad words: specialist fields first ──
  ['operations', ['inventory', 'stock controller', 'stock', 'oil movement', 'procurement', 'materials management', 'materials manager',
    'materials coordinator', 'direct materials', 'material flow', 'dc', 'warehouse', 'storekeeper', 'store keeper', 'spare parts',
    'finished goods', 'distribution center', 'distribution centre']],
  // A trainer at "Abu Dhabi Mall Fitness First" is a trainer, so fitness reads before retail's "mall";
  // a sports buyer is the one fitness title retail has to take first.
  ['retail', ['buyer sports']],
  ['fitness', ['personal trainer', 'fitness', 'gym', 'group exercise', 'swim*', 'lifeguard', 'sports', 'football', 'fitness coach',
    'head coach', 'goalkeeper', 'athlet*', 'yoga', 'pilates', 'health club']],
  ['retail', ['merchandise', 'space planner', 'buying', 'visual merchandis*', 'merchandiser', 'merchandising', 'store manager',
    'store supervisor', 'assistant store manager', 'sales associate', 'sales advisor', 'retail sales', 'cashier', 'boutique', 'showroom',
    'category manager', 'personal shopping', 'personal shopper', 'backstore', 'floor in charge', 'sis area', 'mall', 'assortment',
    'e commerce', 'ecommerce', 'shop', 'retail', 'store', 'كاشير', 'بائع', 'مدير فرع', 'مدير متجر']],
  ['hospitality', ['chef', 'chefs', 'commis', 'cook', 'cooks', 'kitchen', 'culinary', 'pastry', 'baker', 'butcher', 'partie', 'sous',
    'waiter*', 'waitress*', 'bartender', 'barman', 'bar back', 'bar team', 'bar', 'bars', 'barista', 'sommelier', 'mixologist',
    'food runner', 'runner', 'steward*', 'housekeep*', 'room attendant', 'laundry', 'linen', 'pressing attendant', 'washing attendant',
    'polisher', 'cleaner', 'hygiene', 'front office', 'front desk', 'guest', 'concierge', 'bellman', 'bell boy', 'bellboy',
    'bell attendant', 'bell valet', 'valet', 'butler', 'doorman', 'door attendant', 'lobby', 'lounge', 'reservation*', 'banquet*',
    'conference', 'events group', 'group events', 'f b', 'food and beverage', 'food beverage', 'food and drinks', 'food drinks', 'drinks', 'restaurant', 'outlet',
    'hostess', 'host', 'captain', 'spa', 'massage', 'masseuse', 'beauty', 'make up', 'recreation', 'kids club', 'pool attendant',
    'catering', 'hotel', 'hotels', 'resort', 'hospitality', 'room service', 'night auditor', 'night manager', 'night club',
    'heart of the house', 'venue', 'entertainment', 'telephone operator', 'public area*', 'order taker', 'service crew', 'usher',
    'florist', 'pianist', 'musician', 'entertainer', 'tailor', 'staff accommodation', 'طاهي', 'شيف', 'نادل', 'مطعم', 'فندق']],
  ['security', ['security guard', 'security officer*', 'security supervisor', 'guard', 'hse', 'hsse', 'hseq', 'ehs', 'health and safety',
    'safety', 'fire', 'loss prevention', 'gate controller', 'حارس', 'سلامة']],
  ['health', ['pharmac*', 'pharma', 'nurs*', 'physician', 'doctor', 'dentist', 'dental', 'medical', 'clinical', 'clinic', 'surgeon',
    'surgery', 'radiolog*', 'laborator*', 'physiotherap*', 'dermatolog*', 'paediatric*', 'pediatric*', 'gynecolog*', 'obstetric*',
    'anesthes*', 'cardiolog*', 'patholog*', 'optometr*', 'dietitian', 'nutritionist', 'midwife', 'paramedic', 'infection', 'health',
    'hospital', 'patient', 'registrar', 'oncology', 'urology', 'critical care', 'صيدل*', 'ممرض*', 'طبيب', 'أسنان', 'تمريض']],
  ['education', ['teacher', 'lecturer', 'professor', 'tutor', 'instructor', 'faculty', 'school', 'kindergarten', 'curriculum', 'education*',
    'academic', 'learning and development', 'learning development', 'l d', 'trainer', 'training', 'معلم*', 'مدرس*', 'تدريب']],
  ['sales', ['sales', 'salesman', 'partnership*', 'pre sales', 'presales', 'bd', 'bdm', 'bdr', 'sdr', 'wholesale', 'van sales*',
    'relationship manag*', 'relationship management', 'renewals', 'mid market', 'affiliate', 'acquisition', 'pay expansion',
    'vendor engagement', 'vendor performance', 'مبيعات', 'مندوب']],
  ['marketing', ['loyalty', 'martech', 'marcom', 'growth marketing', 'crm lifecycle', 'lifecycle', 'activation*', 'campaign*', 'social', 'ads']],
  // Technology before engineering: what is left of "engineer" after this is engineering.
  ['data', ['data', 'analytics', 'bi', 'ml', 'ai', 'artificial intelligence', 'deep learning', 'nlp', 'genai', 'computer vision',
    'statistic*', 'بيانات', 'ذكاء اصطناعي']],
  ['tech', ['software', 'programmer', 'server engineer', 'server administrator', 'windows', 'linux', 'unix', 'vmware', 'cloud', 'platform engineer', 'network engineer*', 'network administrator', 'network security',
    'networking', 'networks', 'it', 'ict', 'information technology',
    'information security', 'cyber*', 'soc', 'system administrator', 'systems administrator', 'sysadmin', 'database', 'dba',
    'qa engineer', 'test engineer', 'tester', 'automation engineer', 'mobile engineer', 'ios', 'android', 'web', 'erp', 'sap', 'oracle',
    'salesforce', 'servicenow', 'dynamics', 'business application*', 'epm', 'crm developer', 'technical architect', 'security architect',
    'scrum master', 'agile', 'implementation', 'technical success', 'tech', 'technology', 'digital', 'helpdesk', 'help desk',
    'service desk', 'desktop support', 'technical support', 'blockchain', 'smart contract', 'solidity', 'مطور', 'مبرمج', 'برمجيات',
    'تقنية المعلومات', 'أمن سيبراني']],
  // A restaurant server, once technology has taken "Server Engineer".
  ['hospitality', ['server', 'servers']],
  ['product', ['product', 'منتج']],
  // Not "contract": "(12 Months Contract)" is how a role is offered, in every field. Not "planner":
  // merchandise, production and maintenance planners each belong to their own field.
  ['construction', ['construction', 'site engineer', 'site manager', 'site supervisor', 'quantity surveyor', 'surveyor', 'planning engineer',
    'urban planner', 'master planning', 'scheduling', 'cost control*', 'cost engineer', 'cost manager', 'contracts', 'contract manager',
    'contracts manager', 'contract management', 'contracts management', 'contracts engineer', 'technical contract', 'tender*',
    'project control*', 'project manager', 'project director', 'project engineer', 'projects', 'project', 'architect', 'architecture',
    'interior', 'real estate', 'property', 'facilit*', 'valuation', 'leasing', 'bim', 'مشاريع', 'مشروع', 'إنشاءات', 'عقار*']],
  ['engineering', ['engineer', 'engineering', 'mechanical', 'electrical', 'civil', 'structural', 'mep', 'instrumentation',
    'process engineer', 'chemical', 'petroleum', 'reservoir', 'drilling', 'wellsite', 'geolog*', 'geophys*', 'piping', 'commissioning',
    'railway', 'roads', 'bridges', 'materials', 'environmental', 'sustainability', 'elevator', 'energy', 'utilities', 'automation manager',
    'dcs',
    'مهندس', 'هندسة']],
  ['design', ['design', 'creative', 'illustrat*', 'motion', 'تصميم']],
  ['trades', ['field service', 'technical supervisor', 'fitter', 'fabricator', 'maintenance', 'machinist', 'rigger', 'scaffold*', 'crane',
    'chauffeur', 'operator', 'helper', 'labour*', 'labor*', 'foreman', 'craftsman', 'فني', 'كهربائي', 'سباك', 'لحام', 'صيانة', 'سائق']],
  ['manufacturing', ['manufactur*', 'plant', 'factory', 'machine', 'production line', 'quality', 'qa', 'inspector', 'inspection',
    'process manager', 'process assistant manager', 'sugar', 'integrated management system', 'r d', 'research and development',
    'research development', 'إنتاج', 'تصنيع', 'جودة', 'مصنع']],
  ['legal', ['risk', 'governance', 'screening', 'due diligence', 'fraud', 'audit*', 'regulatory', 'regulation', 'internal control*',
    'business continuity', 'government affairs', 'قانون*', 'مخاطر', 'تدقيق']],
  ['hr', ['human capital', 'people', 'talent management', 'talent development', 'talent specialist', 'talent partner', 'recruit*',
    'employee relations', 'employee experience', 'compensation', 'benefits', 'reward*', 'workforce', 'organizational development',
    'organization development', 'organisation development', 'organisation and reward', 'org development']],
  ['finance', ['finance', 'financial', 'accounts', 'tax', 'treasury', 'controller', 'fp a', 'investment*', 'invest*', 'portfolio', 'wealth',
    'banking', 'bank', 'credit', 'collection*', 'actuar*', 'payroll', 'billing', 'cfo', 'equity', 'capital', 'fund', 'trading', 'trader',
    'quant*', 'fixed income', 'global markets', 'payment validation', 'corporate development', 'مالي*', 'مالية']],
  ['sales', ['market development', 'partner manager', 'commercial', 'revenue', 'growth', 'merchant', 'distributor', 'territory']],
  ['marketing', ['brand', 'communication*', 'pr', 'public relations', 'media', 'content', 'writer', 'editor', 'journalist', 'events',
    'event', 'influencer', 'community', 'photograph*', 'videograph*', 'producer', 'presenter', 'translator', 'translation', 'إعلام',
    'محتوى']],
  ['customer', ['customer', 'customer care', 'partner care', 'care advisor', 'client service*', 'client support', 'call center',
    'call centre', 'contact center', 'contact centre', 'support agent', 'support specialist', 'self service', 'service experience',
    'real time analyst', 'cs', 'agent', 'خدمة العملاء', 'عملاء']],
  ['operations', ['operations', 'operation', 'supply chain', 'logistic*', '3pl', 'purchasing', 'buyer', 'sourcing', 'fleet', 'delivery',
    'rider', 'picker', 'receiver', 'dispatch*', 'shipping', 'import', 'export', 'customs', 'transport*', 'distribution', 'demand planning',
    'planning', 'expediter', 'courier', 'محضر طلبات', 'عمليات', 'مشتريات', 'مستودع', 'لوجست*']],
  ['admin', ['administrative', 'administration', 'administrator', 'admin', 'office assistant', 'office manager', 'office administrator',
    'office coordinator', 'reception', 'clerk', 'records', 'government relations', 'pro', 'coordinator', 'travel desk', 'إداري*',
    'استقبال']],
  ['security', ['security', 'أمن']],
  // Not a job but a standing invitation to apply. Last but one, so "BIM Manager - Talent Pool" is
  // still a BIM manager; only a pool with no role in its name has no field, and says so.
  ['other', ['talent pool', 'talent network', 'professional network', 'always open', 'future job vacancies', 'gig guru']],
  ['leadership', ['chief', 'ceo', 'coo', 'cto', 'president', 'vice president', 'vp', 'general manager', 'managing director', 'director',
    'head', 'strategy', 'strategic', 'strategist', 'consultant', 'consulting', 'advisor', 'adviser', 'transformation', 'excellence', 'pmo',
    'program manager', 'programme manager', 'chairman', 'partner', 'principal', 'manager', 'performance', 'استراتيجي*', 'مستشار', 'مدير']]
];

function classify(text) {
  const t = norm(text);
  for (const [field, words] of RULES) {
    for (const w of words) if (has(t, w)) return field;
  }
  return 'other';
}

// Where a title names the property after the role — "Finance Analyst - DoubleTree by Hilton Resort
// & Spa", "Digital Marketing Manager at Conrad Dubai", "Fitness Instructor | The Mangroves" — the
// property's words ("Resort", "Spa", "Hotel") say where the job is, not what it is. Only that last
// segment goes: "Assistant Manager – Stewarding & Hygiene - Doubletree" keeps its stewarding.
const VENUE = /(?:\s[-–|l]\s|\sat\s|\s\|)[^-–|]*\b(?:hilton|doubletree|waldorf|conrad|lxr|curio|radisson|citymax|marriott|hyatt|accor|rotana|resort|hotel|hotels)\b[^-–|]*$/i;

// Employers that are one industry through and through. Asked only when the title itself says
// nothing more than "Duty Manager", "Manager" or "Section Head": at Riyadh Air that is an airport
// duty manager, at Hilton a hotel one. Never used to overrule a title that names its field.
const EMPLOYER_FIELD = {
  'riyadh air': 'aviation',
  hilton: 'hospitality', 'radisson hotel group': 'hospitality', 'rotana hotels resorts': 'hospitality',
  'hayat national hospital': 'health', nahdi: 'health', gsk: 'health', astrazeneca: 'health', sanofi: 'health', pfizer: 'health',
  novartis: 'health', medtronic: 'health', abbott: 'health', bd: 'health',
  'riyadh schools': 'education', 'quality education company': 'education', udacity: 'education',
  'saudi pro league': 'fitness',
  'landmark group': 'retail', 'apparel group': 'retail'
};

/**
 * The field id of one job, from its title (and, for a title that names no field, its employer).
 * Never null: what nothing names is 'other'.
 *
 * The role is read without the property it is at; only if the role alone names no field is the
 * whole title read ("Room Attendant - Hotel X" is housekeeping either way; a title that is only
 * a hotel's name is a hotel).
 */
export function fieldOf(title, company = '') {
  const whole = String(title ?? '');
  const role = whole.replace(VENUE, '');
  let f = role && role !== whole ? classify(role) : 'other';
  if (f === 'other') f = classify(whole);
  // A strategy or consulting role is that wherever it is; only a bare "Manager" takes its employer's.
  if (f === 'other' || (f === 'leadership' && !/strateg|consult|pmo|transformation/i.test(whole))) {
    const by = EMPLOYER_FIELD[norm(company).trim()];
    if (by) return by;
  }
  return f;
}
